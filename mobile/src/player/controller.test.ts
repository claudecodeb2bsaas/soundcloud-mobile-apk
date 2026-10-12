import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { createPlayerController, type AudioEngine, type EngineStatus, type PlayerController } from './controller';
import { makeItem } from './queue';
import { StreamUnavailableError, type ResolvedStream, type StreamResolver } from './stream';
import { parseSnapshot, type SessionSnapshot, type SessionStore } from './session';

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({ id, kind: 'track', title: 'T' + id, user: { username: 'A' + id }, duration: 100000, ...extra });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeEngine implements AudioEngine {
  loads: Array<{ url: string; title: string; autoplay: boolean; startAt: number }> = [];
  calls: string[] = [];
  private listener: ((status: EngineStatus) => void) | null = null;
  load(url: string, meta: { title: string }, options: { autoplay: boolean; startAt: number }) {
    this.loads.push({ url, title: meta.title, ...options });
  }
  play() { this.calls.push('play'); }
  pause() { this.calls.push('pause'); }
  seekTo(seconds: number) { this.calls.push('seek:' + seconds); }
  subscribe(listener: (status: EngineStatus) => void) { this.listener = listener; return () => { this.listener = null; }; }
  release() { this.calls.push('release'); }
  emit(patch: Partial<EngineStatus> = {}) {
    this.listener?.({ playing: false, buffering: false, loaded: true, position: 0, duration: 100, finished: false, error: null, ...patch });
  }
}

function setup(options: { unavailable?: number[]; fail?: Map<number, unknown>; hold?: Map<number, Promise<void>>; session?: SessionStore } = {}) {
  const engine = new FakeEngine();
  const resolved: number[] = [];
  const skipped: Array<[number, string]> = [];
  const resolver: StreamResolver = {
    async resolve(t): Promise<ResolvedStream> {
      resolved.push(t.id);
      await options.hold?.get(t.id);
      if (options.fail?.has(t.id)) throw options.fail.get(t.id);
      if (options.unavailable?.includes(t.id)) throw new StreamUnavailableError('protected');
      return { url: `https://cdn/${t.id}`, kind: 'progressive', preview: false };
    },
  };
  const timers: Array<() => void> = [];
  let clock = 0;
  const player = createPlayerController({
    engine, resolver, session: options.session,
    now: () => clock,
    later: (run) => { timers.push(run); return timers.length; },
    cancel: () => undefined,
    onUnavailable: (t, reason) => skipped.push([t.id, reason]),
  });
  return { engine, player, resolved, skipped, flush: () => timers.splice(0).forEach((run) => run()), advance: (ms: number) => { clock += ms; } };
}

const titles = (player: PlayerController) => player.getState().queue.items.map((item) => item.track.id);
const playingNow = async (ctx: ReturnType<typeof setup>) => { await tick(); ctx.engine.emit({ playing: true }); };

describe('запуск и переходы', () => {
  it('playTracks грузит трек и включает его', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2)], 0);
    expect(ctx.player.getState().status).toBe('loading');
    await tick();
    expect(ctx.engine.loads).toEqual([{ url: 'https://cdn/1', title: 'T1', autoplay: true, startAt: 0 }]);
    ctx.engine.emit({ playing: true, position: 1.5 });
    expect(ctx.player.getState().status).toBe('playing');
    expect(ctx.player.getProgress()).toEqual({ position: 1.5, duration: 100 });
  });

  it('доигранный трек ведёт к следующему, конец очереди это пауза в конце', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2)], 0);
    await playingNow(ctx);
    ctx.engine.emit({ playing: false, finished: true, position: 100 });
    await tick();
    expect(ctx.player.getState().queue.index).toBe(1);
    expect(ctx.engine.loads.map((l) => l.url)).toEqual(['https://cdn/1', 'https://cdn/2']);
    ctx.engine.emit({ playing: true });
    ctx.engine.emit({ playing: false, finished: true, position: 100 });
    expect(ctx.player.getState()).toMatchObject({ status: 'paused', ended: true });
    // Play после конца начинает очередь заново
    ctx.player.play();
    await tick();
    expect(ctx.player.getState()).toMatchObject({ ended: false });
    expect(ctx.player.getState().queue.index).toBe(0);
  });

  it('повторный сигнал «доиграл» не пропускает лишний трек', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2), track(3)], 0);
    await playingNow(ctx);
    ctx.engine.emit({ finished: true });
    ctx.engine.emit({ finished: true });
    await tick();
    expect(ctx.player.getState().queue.index).toBe(1);
  });

  it('повтор одного держит трек, повтор всех идёт по кругу', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2)], 1);
    await playingNow(ctx);
    ctx.player.setRepeat('one');
    ctx.engine.emit({ finished: true });
    await tick();
    expect(ctx.player.getState().queue.index).toBe(1);
    expect(ctx.engine.loads).toHaveLength(2);
    ctx.engine.emit({ playing: true });
    ctx.player.setRepeat('all');
    ctx.engine.emit({ finished: true });
    await tick();
    expect(ctx.player.getState().queue.index).toBe(0);
  });

  it('следующий и предыдущий; в конце «дальше» ничего не делает', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2)], 1);
    await playingNow(ctx);
    ctx.player.next();
    await tick();
    expect(ctx.engine.loads).toHaveLength(1);
    // Больше трёх секунд: «назад» перематывает в начало
    ctx.engine.emit({ playing: true, position: 10 });
    ctx.player.previous();
    expect(ctx.engine.calls).toContain('seek:0');
    expect(ctx.engine.loads).toHaveLength(1);
    ctx.engine.emit({ playing: true, position: 1 });
    ctx.player.previous();
    await tick();
    expect(ctx.player.getState().queue.index).toBe(0);
    expect(ctx.engine.loads.at(-1)?.url).toBe('https://cdn/1');
  });

  it('предыдущий ответ запуска не перебивает новый выбор', async () => {
    let release!: () => void;
    const hold = new Map([[1, new Promise<void>((resolve) => { release = resolve; })]]);
    const ctx = setup({ hold });
    ctx.player.playTracks([track(1), track(2)], 0);
    ctx.player.jumpTo(1);
    await tick();
    release();
    await tick();
    expect(ctx.engine.loads.map((l) => l.url)).toEqual(['https://cdn/2']);
  });
});

describe('сбои', () => {
  it('недоступный трек пропускается, причина уходит в onUnavailable', async () => {
    const ctx = setup({ unavailable: [1, 2] });
    ctx.player.playTracks([track(1), track(2), track(3)], 0);
    await tick();
    await tick();
    await tick();
    expect(ctx.skipped).toEqual([[1, 'protected'], [2, 'protected']]);
    expect(ctx.player.getState().queue.index).toBe(2);
    expect(ctx.engine.loads.map((l) => l.url)).toEqual(['https://cdn/3']);
  });

  it('после пяти недоступных подряд остановка с ошибкой', async () => {
    const ctx = setup({ unavailable: [1, 2, 3, 4, 5, 6, 7] });
    ctx.player.playTracks([1, 2, 3, 4, 5, 6, 7].map((id) => track(id)), 0);
    for (let i = 0; i < 10; i++) await tick();
    expect(ctx.player.getState()).toMatchObject({ status: 'error', error: 'unavailable' });
    expect(ctx.engine.loads).toEqual([]);
    expect(ctx.skipped).toHaveLength(5);
  });

  it('сетевой сбой это ошибка network, play повторяет', async () => {
    const fail = new Map<number, unknown>([[1, new TypeError('Network request failed')]]);
    const ctx = setup({ fail });
    ctx.player.playTracks([track(1)], 0);
    await tick();
    expect(ctx.player.getState()).toMatchObject({ status: 'error', error: 'network' });
    fail.clear();
    ctx.player.play();
    await tick();
    expect(ctx.engine.loads).toHaveLength(1);
  });

  it('ошибка движка: один повтор с того же места, второй раз ошибка', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1)], 0);
    await playingNow(ctx);
    ctx.engine.emit({ playing: true, position: 42 });
    ctx.engine.emit({ error: 'HTTP 403' });
    await tick();
    expect(ctx.resolved).toEqual([1, 1]);
    expect(ctx.engine.loads.at(-1)).toMatchObject({ startAt: 42, autoplay: true });
    ctx.engine.emit({ error: 'HTTP 403' });
    expect(ctx.player.getState()).toMatchObject({ status: 'error', error: 'playback' });
  });
});

describe('управление', () => {
  it('пауза снаружи (шторка) отражается, play продолжает без новой загрузки', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1)], 0);
    await playingNow(ctx);
    ctx.engine.emit({ playing: false });
    expect(ctx.player.getState().status).toBe('paused');
    ctx.player.play();
    expect(ctx.engine.calls).toContain('play');
    expect(ctx.engine.loads).toHaveLength(1);
  });

  it('toggle: пауза и игра; пауза во время загрузки не включает звук', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1)], 0);
    ctx.player.toggle();
    await tick();
    expect(ctx.engine.loads[0].autoplay).toBe(false);
    ctx.engine.emit({ playing: false });
    expect(ctx.player.getState().status).toBe('paused');
    ctx.player.toggle();
    expect(ctx.engine.calls).toEqual(['play']);
  });

  it('следующий трек готовится заранее', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2)], 0);
    await playingNow(ctx);
    await tick();
    expect(ctx.resolved).toEqual([1, 2]);
    ctx.player.next();
    await tick();
    // Поток из подготовки, второй запрос не нужен
    expect(ctx.resolved).toEqual([1, 2]);
  });

  it('очередь: вставки, удаление играющего, перенос', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1), track(2), track(3)], 0);
    await playingNow(ctx);
    ctx.player.insertNext(track(9));
    ctx.player.insertLast(track(8));
    expect(titles(ctx.player)).toEqual([1, 9, 2, 3, 8]);
    ctx.player.move(4, 1);
    expect(titles(ctx.player)).toEqual([1, 8, 9, 2, 3]);
    ctx.player.removeAt(0);
    await tick();
    expect(titles(ctx.player)).toEqual([8, 9, 2, 3]);
    expect(ctx.engine.loads.at(-1)?.url).toBe('https://cdn/8');
    ctx.player.removeAt(3);
    expect(titles(ctx.player)).toEqual([8, 9, 2]);
  });

  it('appendItems дописывает в конец и не трогает играющий трек', async () => {
    const ctx = setup();
    ctx.player.appendItems([makeItem(track(1)), makeItem(track(2))]);
    await playingNow(ctx);
    expect(titles(ctx.player)).toEqual([1, 2]);
    ctx.player.appendItems([makeItem(track(3))]);
    expect(titles(ctx.player)).toEqual([1, 2, 3]);
    expect(ctx.player.getState().queue.index).toBe(0);
    expect(ctx.engine.loads).toHaveLength(1);
  });

  it('вставка в пустую очередь включает трек, очистка всё сбрасывает', async () => {
    const ctx = setup();
    ctx.player.insertNext(track(4));
    await tick();
    expect(ctx.engine.loads).toHaveLength(1);
    ctx.engine.emit({ playing: true });
    ctx.player.clear();
    expect(ctx.player.getState()).toMatchObject({ status: 'idle' });
    expect(titles(ctx.player)).toEqual([]);
    expect(ctx.engine.calls).toContain('pause');
    expect(ctx.player.getProgress()).toEqual({ position: 0, duration: 0 });
  });

  it('удаление единственного играющего трека опустошает очередь', async () => {
    const ctx = setup();
    ctx.player.playTracks([track(1)], 0);
    await playingNow(ctx);
    ctx.player.removeAt(0);
    expect(ctx.player.getState().status).toBe('idle');
  });

  it('подписчики получают изменения и отписываются', async () => {
    const ctx = setup();
    let count = 0;
    const off = ctx.player.subscribe(() => count++);
    ctx.player.playTracks([track(1)], 0);
    await tick();
    expect(count).toBeGreaterThan(0);
    off();
    const before = count;
    ctx.player.cycleRepeat();
    expect(count).toBe(before);
    expect(ctx.player.getState().queue.repeat).toBe('all');
  });
});

describe('сессия', () => {
  const memory = () => {
    const saved: SessionSnapshot[] = [];
    let stored: unknown = null;
    const store: SessionStore = { load: async () => stored, save: async (snapshot) => { saved.push(snapshot); stored = JSON.stringify(snapshot); } };
    return { store, saved };
  };

  it('сохраняется с задержкой и без потоков', async () => {
    const mem = memory();
    const ctx = setup({ session: mem.store });
    ctx.player.playTracks([track(1, { track_authorization: 'SECRET' } as Partial<WaveTrack>), track(2)], 1);
    await playingNow(ctx);
    ctx.engine.emit({ playing: true, position: 33 });
    ctx.flush();
    await tick();
    const last = mem.saved.at(-1)!;
    expect(last).toMatchObject({ version: 1, index: 1, position: 33 });
    expect(JSON.stringify(last)).not.toContain('SECRET');
  });

  it('место в треке пишется раз в 15 секунд игры', async () => {
    const mem = memory();
    const ctx = setup({ session: mem.store });
    ctx.player.playTracks([track(1)], 0);
    await playingNow(ctx);
    ctx.flush();
    await tick();
    const before = mem.saved.length;
    ctx.advance(16000);
    ctx.engine.emit({ playing: true, position: 20 });
    await tick();
    expect(mem.saved.length).toBe(before + 1);
    expect(mem.saved.at(-1)?.position).toBe(20);
  });

  it('restore ставит очередь на паузу без загрузки, play продолжает с сохранённого места', async () => {
    const mem = memory();
    const first = setup({ session: mem.store });
    first.player.playTracks([track(1), track(2)], 1);
    await playingNow(first);
    first.engine.emit({ playing: true, position: 61 });
    first.flush();
    await tick();

    const second = setup({ session: mem.store });
    expect(await second.player.restore()).toBe(true);
    expect(second.player.getState()).toMatchObject({ status: 'paused' });
    expect(second.player.getState().queue.index).toBe(1);
    expect(second.player.getProgress().position).toBe(61);
    expect(second.engine.loads).toEqual([]);
    second.player.play();
    await tick();
    expect(second.engine.loads).toEqual([{ url: 'https://cdn/2', title: 'T2', autoplay: true, startAt: 61 }]);
  });

  it('restore без записи или поверх уже выбранной музыки ничего не меняет', async () => {
    const empty = setup({ session: memory().store });
    expect(await empty.player.restore()).toBe(false);
    const mem = memory();
    mem.saved.length = 0;
    await mem.store.save(parseSnapshot({ version: 1, items: [{ track: { id: 1 } }] })!);
    const busy = setup({ session: mem.store });
    busy.player.playTracks([track(7)], 0);
    expect(await busy.player.restore()).toBe(false);
    expect(titles(busy.player)).toEqual([7]);
  });

  it('dispose отпускает движок', () => {
    const ctx = setup();
    ctx.player.dispose();
    expect(ctx.engine.calls).toContain('release');
  });
});
