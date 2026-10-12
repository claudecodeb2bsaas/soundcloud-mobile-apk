import { describe, expect, it } from 'vitest';
import type { WaveCandidate, WaveTrack } from '../core/waveTypes';
import { WAVE_TEXTS } from '../core/waveTexts';
import { currentItem, emptyQueue, moveItem, removeAt, replaceQueue, type QueueItem, type QueueState } from '../player/queue';
import type { Wave, WaveSignal } from './engine';
import { createWaveSession, parseSettings, type WaveSessionDeps } from './session';

const track = (id: number): WaveTrack => ({ id, kind: 'track', title: 'T' + id, duration: 200000, user: { username: 'A' } });
const candidate = (id: number): WaveCandidate => ({ track: track(id), reason: { kind: 'similar', seed: 'S' } });

function fakePlayer() {
  let queue: QueueState = emptyQueue();
  let ended = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    nexted: 0,
    get queue() { return queue; },
    getState: () => ({ queue, ended }) as never,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    playItems(items: QueueItem[], index = 0) { queue = replaceQueue(queue, items, index); ended = false; emit(); },
    appendItems(items: QueueItem[]) { queue = { ...queue, items: [...queue.items, ...items] }; emit(); },
    next() { this.nexted++; queue = { ...queue, index: queue.index + 1 }; emit(); },
    removeAt(index: number) { queue = removeAt(queue, index).state; emit(); },
    move(from: number, to: number) { queue = moveItem(queue, from, to); emit(); },
    goTo(index: number) { queue = { ...queue, index }; emit(); },
    finish() { ended = true; },
  };
}

const FIRST = [1, 2, 3, 4, 5, 6];

/** fail: любой запрос отказывает; failFrom: отказывают запросы начиная с этого номера (с нуля) */
function setup(batches: number[][], options: { fail?: boolean; failFrom?: number; signals?: WaveSignal[] } = {}) {
  const player = fakePlayer();
  const requested: number[] = [];
  const feedback: string[] = [];
  const calls: string[] = [];
  const created: Array<{ mode: string; genre: string; seed: unknown }> = [];
  const stored: { value: string | null } = { value: null };
  let time = 0;
  const deps: WaveSessionDeps = {
    player,
    texts: WAVE_TEXTS.ru,
    settings: { get: () => stored.value, set: (v) => { stored.value = v; } },
    now: () => time,
    createWave: (settings, seed) => {
      created.push({ ...settings, seed });
      const queue = batches.slice();
      const wave: Wave = {
        next: async (count) => {
          requested.push(count);
          if (options.fail || (options.failFrom !== undefined && requested.length > options.failFrom)) throw new Error('net');
          return (queue.shift() ?? []).map(candidate);
        },
        feedback: (t, sign, heard) => { feedback.push(`${t.id}:${sign}` + (heard === undefined ? '' : ':' + heard)); return options.signals ?? []; },
        listened: (t) => { calls.push('listened:' + t.id); },
        releaseTrait: (key) => { calls.push('release:' + key); },
        pickFork: (id) => { calls.push('pick:' + id); return id === 99 ? candidate(99) : null; },
        closeFork: () => { calls.push('closeFork'); },
        reclaim: (tracks, fresh) => { calls.push('reclaim:' + tracks.map((t) => t.id).join(',') + (fresh ? ':fresh' : '')); return tracks.length; },
      };
      return wave;
    },
  };
  const session = createWaveSession(deps);
  return { session, player, requested, feedback, calls, created, stored, advance: (ms: number) => { time += ms; } };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const ids = (queue: QueueState) => queue.items.map((item) => item.track.id);

describe('сессия волны', () => {
  it('start ставит первую пачку с причинами и переходит в running', async () => {
    const ctx = setup([[1, 2, 3]]);
    await ctx.session.start();
    expect(ctx.session.getState().status).toBe('running');
    expect(ids(ctx.player.queue)).toEqual([1, 2, 3]);
    expect(ctx.player.queue.items[0].reason).toContain('S');
  });

  it('от трека он играет первым с причиной «seedTrack»', async () => {
    const ctx = setup([[2, 3]]);
    await ctx.session.start({ kind: 'track', track: track(9) });
    expect(ids(ctx.player.queue)).toEqual([9, 2, 3]);
    expect(ctx.session.getState().seedLabel).toBe('T9');
  });

  it('пустая волна не трогает очередь, сбой даёт error', async () => {
    const empty = setup([[]]);
    await empty.session.start();
    expect(empty.session.getState().status).toBe('empty');
    expect(empty.player.queue.items).toEqual([]);
    const broken = setup([], { fail: true });
    await broken.session.start();
    expect(broken.session.getState().status).toBe('error');
  });

  it('дописывает пачку, когда впереди остаётся не больше трёх, и не раньше', async () => {
    const ctx = setup([FIRST, [7, 8, 9]]);
    await ctx.session.start();
    expect(ctx.requested).toEqual([10]);
    ctx.player.goTo(1);
    await tick();
    expect(ctx.requested).toEqual([10]);
    ctx.player.goTo(2);
    await tick();
    expect(ids(ctx.player.queue)).toEqual([...FIRST, 7, 8, 9]);
    expect(ctx.requested).toEqual([10, 10]);
  });

  it('если очередь доиграла, пока искали, продолжает со следующего', async () => {
    const ctx = setup([FIRST, [7]]);
    await ctx.session.start();
    ctx.player.finish();
    ctx.player.goTo(5);
    await tick();
    expect(ctx.player.nexted).toBe(1);
  });

  it('когда подбор иссяк, больше не спрашивает', async () => {
    const ctx = setup([FIRST, []]);
    await ctx.session.start();
    ctx.player.goTo(3);
    await tick();
    ctx.player.goTo(4);
    await tick();
    expect(ctx.requested).toEqual([10, 10]);
  });

  it('после сбоя догрузки повтор не раньше чем через 15 секунд', async () => {
    const ctx = setup([FIRST, [7]], { failFrom: 1 });
    await ctx.session.start();
    ctx.player.goTo(3);
    await tick();
    expect(ctx.requested).toHaveLength(2);
    ctx.player.goTo(4);
    await tick();
    expect(ctx.requested).toHaveLength(2);
    ctx.advance(15000);
    ctx.player.goTo(5);
    await tick();
    expect(ctx.requested).toHaveLength(3);
  });

  it('выходит, когда человек включил своё', async () => {
    const ctx = setup([FIRST]);
    await ctx.session.start();
    ctx.player.playItems([{ key: 'own', track: track(50) }]);
    expect(ctx.session.getState().status).toBe('idle');
    expect(currentItem(ctx.player.queue)?.track.id).toBe(50);
    await tick();
    expect(ctx.requested).toEqual([10]);
  });

  it('stop выходит, но очередь остаётся', async () => {
    const ctx = setup([[1, 2, 3]]);
    await ctx.session.start();
    ctx.session.stop();
    expect(ctx.session.getState().status).toBe('idle');
    expect(ids(ctx.player.queue)).toEqual([1, 2, 3]);
  });

  it('configure хранит настройки и перезапускает идущую волну с тем же зерном', async () => {
    const ctx = setup([[1, 2, 3], [4, 5, 6]]);
    ctx.session.configure({ mode: 'fresh', genre: 'phonk' });
    expect(JSON.parse(ctx.stored.value ?? '{}')).toEqual({ mode: 'fresh', genre: 'phonk', preset: '' });
    expect(ctx.created).toEqual([]);
    await ctx.session.start({ kind: 'artist', id: 5, name: 'Five' });
    ctx.session.configure({ mode: 'similar' });
    await tick();
    expect(ctx.created.map((c) => c.mode)).toEqual(['fresh', 'similar']);
    expect(ctx.created[1].seed).toEqual({ kind: 'artist', id: 5, name: 'Five' });
    ctx.session.configure({ mode: 'similar' });
    expect(ctx.created).toHaveLength(2);
  });

  it('parseSettings терпит мусор', () => {
    expect(parseSettings(null)).toEqual({ mode: 'similar', genre: '', preset: '' });
    expect(parseSettings('{"mode":"fresh","genre":"x","preset":"calm"}')).toEqual({ mode: 'fresh', genre: 'x', preset: 'calm' });
    expect(parseSettings('{{')).toEqual({ mode: 'similar', genre: '', preset: '' });
    expect(parseSettings('{"mode":5,"genre":7,"preset":"loud"}')).toEqual({ mode: 'similar', genre: '', preset: '' });
  });

  it('треки несут источник, причину и настроение для журнала', async () => {
    const ctx = setup([FIRST]);
    ctx.session.configure({ preset: 'calm' });
    await ctx.session.start();
    expect(ctx.player.queue.items[0].meta).toMatchObject({ source: 'wave:similar', why: 'similar', preset: 'calm' });
    await ctx.session.start({ kind: 'artist', id: 5, name: 'Five' });
    expect(ctx.player.queue.items[0].meta).toMatchObject({ source: 'wave:artist' });
    expect(ctx.player.queue.items[0].meta?.preset).toBeUndefined();
  });

  it('feedback доходит до волны только пока она идёт', async () => {
    const ctx = setup([FIRST]);
    ctx.session.feedback(track(1), -1);
    await ctx.session.start();
    ctx.session.feedback(track(2), -1);
    ctx.session.stop();
    ctx.session.feedback(track(3), 1);
    expect(ctx.feedback).toEqual(['2:-1']);
  });

  it('«Моя музыка» ставится как волна от набора', async () => {
    const ctx = setup([FIRST]);
    await ctx.session.start({ kind: 'library', title: 'Лайки и Chill', own: [], order: 'fixed', seeds: [] });
    expect(ctx.session.getState().seedLabel).toBe('Лайки и Chill');
    expect(ctx.player.queue.items[0].meta?.source).toBe('wave:library');
  });

  it('feedback передаёт, сколько звучало, а listened доходит до волны', async () => {
    const ctx = setup([FIRST]);
    await ctx.session.start();
    ctx.session.feedback(track(2), -1, 4000);
    ctx.session.listened(track(3));
    expect(ctx.feedback).toEqual(['2:-1:4000']);
    expect(ctx.calls).toEqual(['listened:3']);
  });

  it('П7: признак серии показывается подсказкой, «Отменить» снимает его и пересобирает очередь', async () => {
    const signals: WaveSignal[] = [
      { kind: 'trait', trait: { kind: 'lang', key: 'cyr', label: 'cyr' } },
      { kind: 'rebuild', fresh: false },
    ];
    const ctx = setup([FIRST, [7, 8, 9]], { signals });
    await ctx.session.start();
    ctx.session.feedback(track(2), -1, 20000);
    expect(ctx.session.getState().notice).toEqual({ text: WAVE_TEXTS.ru.traitLessCyr, trait: 'lang:cyr' });
    await tick();
    ctx.session.undoNotice();
    expect(ctx.session.getState().notice).toBeNull();
    expect(ctx.calls).toContain('release:lang:cyr');
    ctx.session.dismissNotice();
    expect(ctx.session.getState().notice).toBeNull();
  });

  it('пересборка: впереди стоящее волны возвращается волне, очередь заменяется новым, играющее и своё остаются', async () => {
    const ctx = setup([FIRST, [7, 8, 9]], { signals: [{ kind: 'rebuild', fresh: true }] });
    await ctx.session.start();
    ctx.player.queue.items.splice(3, 0, { key: 'own', track: track(50) });
    ctx.session.feedback(track(1), -1, 20000);
    await tick();
    expect(ctx.calls).toEqual(['reclaim:2,3,4,5,6:fresh']);
    expect(ctx.requested.at(-1)).toBe(5);
    expect(ids(ctx.player.queue)).toEqual([1, 50, 7, 8, 9]);
  });

  it('П8: развилка с подписями, выбор ставит трек следующим и играет его, закрытие возвращает варианты', async () => {
    const options = [
      { candidate: candidate(99), label: { kind: 'newArtist' as const } },
      { candidate: candidate(98), label: { kind: 'calm' as const } },
      { candidate: candidate(97), label: { kind: 'artist' as const, name: 'Ann' } },
      { candidate: candidate(96), label: { kind: 'reason' as const } },
    ];
    const ctx = setup([FIRST], { signals: [{ kind: 'fork', options }, { kind: 'rebuild', fresh: false }] });
    await ctx.session.start();
    ctx.session.feedback(track(2), -1, 1000);
    const fork = ctx.session.getState().fork;
    expect(fork?.options.map((option) => option.label)).toEqual([
      WAVE_TEXTS.ru.whyNewArtist, WAVE_TEXTS.ru.forkCalm, 'Ты любишь Ann', WAVE_TEXTS.ru.whySimilar.replace('{seed}', 'S'),
    ]);
    ctx.session.pickFork(99);
    expect(ctx.session.getState().fork).toBeNull();
    expect(ctx.calls).toContain('pick:99');
    expect(ctx.player.nexted).toBe(1);
    expect(ctx.player.queue.items[ctx.player.queue.index].track.id).toBe(99);
    expect(ctx.player.queue.items[ctx.player.queue.index].meta?.source).toBe('wave:similar');

    ctx.session.feedback(track(3), -1, 1000);
    expect(ctx.session.getState().fork).not.toBeNull();
    ctx.session.closeFork();
    expect(ctx.session.getState().fork).toBeNull();
    expect(ctx.calls).toContain('closeFork');
  });

  it('остановка волны убирает развилку и подсказку', async () => {
    const ctx = setup([FIRST], { signals: [{ kind: 'trait', trait: { kind: 'lang', key: 'inst', label: 'inst' } }] });
    await ctx.session.start();
    ctx.session.feedback(track(2), -1, 20000);
    expect(ctx.session.getState().notice?.text).toBe(WAVE_TEXTS.ru.traitLessInst);
    ctx.session.stop();
    expect(ctx.session.getState().notice).toBeNull();
    expect(ctx.session.getState().fork).toBeNull();
  });
});
