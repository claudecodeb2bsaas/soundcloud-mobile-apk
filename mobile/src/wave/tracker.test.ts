import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { emptyQueue, makeItem, replaceQueue, type QueueState } from '../player/queue';
import type { PlayRecord } from '../store/history';
import { createTracker } from './tracker';

const track = (id: number): WaveTrack => ({ id, kind: 'track', title: 'T' + id, duration: 200000, user_id: 5, user: { id: 5, username: 'A' }, genre: 'g' });

function setup(user: number | null = 1, incognito = false) {
  let queue: QueueState = emptyQueue();
  let status = 'idle';
  let ended = false;
  let position = 0;
  let duration = 200;
  let time = 1000;
  const listeners = new Set<() => void>();
  const records: PlayRecord[] = [];
  const played: string[] = [];
  const player = {
    getState: () => ({ queue, status, ended }) as never,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    getProgress: () => ({ position, duration }),
  };
  const tracker = createTracker({
    player, now: () => time, user: () => user, incognito: () => incognito,
    record: (_user, record) => { records.push(record); },
    onPlay: (record, item) => played.push(`${item.track.id}:${record.end}`),
  });
  const emit = () => listeners.forEach((l) => l());
  return {
    tracker, records, played,
    load(ids: number[], index = 0, meta?: { source: string; why?: string }) { queue = replaceQueue(queue, ids.map((id) => makeItem(track(id), undefined, meta)), index); ended = false; status = 'loading'; emit(); },
    set(next: string, pos = position) { status = next; position = pos; if (next !== 'paused') ended = false; emit(); },
    go(index: number, pos = position) { queue = { ...queue, index }; position = pos; status = 'loading'; emit(); },
    clear() { queue = emptyQueue(); status = 'idle'; emit(); },
    end() { ended = true; status = 'paused'; position = 200; emit(); },
    wait(ms: number) { time += ms; },
  };
}

describe('журнал прослушиваний', () => {
  it('пропуск человеком записывает, сколько слышали, с источником и причиной', () => {
    const ctx = setup();
    ctx.load([1, 2], 0, { source: 'wave:similar', why: 'similar' });
    ctx.set('playing');
    ctx.wait(12000);
    ctx.go(1, 12);
    expect(ctx.records).toHaveLength(1);
    expect(ctx.records[0]).toMatchObject({ id: 1, artist: 5, dur: 200000, heard: 12000, end: 'skip', endedBy: 'user', source: 'wave:similar', why: 'similar', picked: false, genre: 'g' });
    expect(ctx.played).toEqual(['1:skip']);
  });

  it('конец трека в последние 3 секунды это «дослушал», автоматически', () => {
    const ctx = setup();
    ctx.load([1, 2]);
    ctx.set('playing');
    ctx.wait(199000);
    ctx.go(1, 198);
    expect(ctx.records[0]).toMatchObject({ end: 'done', endedBy: 'auto', source: 'app', picked: true, heard: 199000 });
  });

  it('пауза не считается звуком, повторное включение продолжает счёт', () => {
    const ctx = setup();
    ctx.load([1, 2]);
    ctx.set('playing');
    ctx.wait(10000);
    ctx.set('paused', 10);
    ctx.wait(60000);
    ctx.set('playing');
    ctx.wait(5000);
    ctx.go(1, 15);
    expect(ctx.records[0].heard).toBe(15000);
  });

  it('меньше секунды звука в журнал не идёт, без входа тоже', () => {
    const quick = setup();
    quick.load([1, 2]);
    quick.set('playing');
    quick.wait(500);
    quick.go(1, 0);
    expect(quick.records).toEqual([]);
    const anon = setup(null);
    anon.load([1, 2]);
    anon.set('playing');
    anon.wait(20000);
    anon.go(1, 20);
    expect(anon.records).toEqual([]);
  });

  it('очистка очереди записывает остановку, доигранная очередь дослушивание', () => {
    const ctx = setup();
    ctx.load([1]);
    ctx.set('playing');
    ctx.wait(20000);
    ctx.clear();
    expect(ctx.records[0]).toMatchObject({ end: 'stop' });
    ctx.load([2]);
    ctx.set('playing');
    ctx.wait(200000);
    ctx.end();
    expect(ctx.records[1]).toMatchObject({ id: 2, end: 'done' });
    ctx.set('playing', 0);
    ctx.wait(1500);
    ctx.clear();
    expect(ctx.records).toHaveLength(3);
  });

  it('лайк во время прослушивания помечает запись, flush закрывает как остановку и считает дальше', () => {
    const ctx = setup();
    ctx.load([1, 2]);
    ctx.set('playing');
    ctx.wait(40000);
    ctx.tracker.noteLike(1);
    ctx.tracker.noteLike(99);
    ctx.tracker.flush();
    expect(ctx.records[0]).toMatchObject({ id: 1, end: 'stop', likedNow: true, heard: 40000 });
    ctx.wait(8000);
    ctx.go(1, 48);
    expect(ctx.records[1]).toMatchObject({ id: 1, end: 'skip', likedNow: false, heard: 8000 });
  });

  it('инкогнито: журнал молчит, onPlay всё равно зовётся', () => {
    const ctx = setup(1, true);
    ctx.load([1, 2]);
    ctx.set('playing');
    ctx.wait(12000);
    ctx.go(1, 12);
    expect(ctx.records).toEqual([]);
    expect(ctx.played).toEqual(['1:skip']);
  });
});
