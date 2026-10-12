import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { emptyQueue, makeItem, replaceQueue } from './queue';
import { compactTrack, makeSnapshot, parseSnapshot, queueOf } from './session';

const full = {
  id: 5, kind: 'track', title: 'T', user_id: 9, user: { id: 9, username: 'A', avatar_url: 'a', permalink_url: 'p' }, artwork_url: 'x-large.jpg', duration: 1000,
  track_authorization: 'SECRET', media: { transcodings: [{ url: 'u' }] }, huge: 'x'.repeat(100),
} as unknown as WaveTrack;

describe('сессия плеера', () => {
  it('compactTrack оставляет нужное и выбрасывает потоки и ключи', () => {
    const compact = compactTrack(full) as unknown as Record<string, unknown>;
    expect(compact).toMatchObject({ id: 5, title: 'T', user: { username: 'A' }, artwork_url: 'x-large.jpg' });
    expect(compact.track_authorization).toBeUndefined();
    expect(compact.media).toBeUndefined();
    expect(compact.huge).toBeUndefined();
  });

  it('снимок и разбор возвращают ту же очередь', () => {
    const queue = replaceQueue(emptyQueue('all'), [makeItem(full), makeItem({ id: 6 } as WaveTrack, 'похоже на X')], 1);
    const snapshot = makeSnapshot(queue, 42.5, 1000);
    const back = parseSnapshot(JSON.stringify(snapshot));
    expect(back).toMatchObject({ index: 1, position: 42.5, repeat: 'all', at: 1000 });
    const restored = queueOf(back!);
    expect(restored.items.map((item) => item.track.id)).toEqual([5, 6]);
    expect(restored.items[1].reason).toBe('похоже на X');
    expect(restored.index).toBe(1);
    expect(restored.repeat).toBe('all');
  });

  it('огромная очередь режется окном вокруг играющего', () => {
    const items = Array.from({ length: 800 }, (_, i) => makeItem({ id: i + 1 } as WaveTrack));
    const snapshot = makeSnapshot(replaceQueue(emptyQueue(), items, 700), 0, 0);
    expect(snapshot.items).toHaveLength(500);
    expect(snapshot.items[snapshot.index].track.id).toBe(701);
  });

  it('parseSnapshot отбрасывает мусор и чинит поля', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('{')).toBeNull();
    expect(parseSnapshot({ version: 2, items: [] })).toBeNull();
    expect(parseSnapshot({ version: 1, items: [] })).toBeNull();
    expect(parseSnapshot({ version: 1, items: [{ track: { id: 'x' } }, null, { track: { id: -1 } }] })).toBeNull();
    const fixed = parseSnapshot({ version: 1, index: 99, position: -5, repeat: 'weird', items: [{ track: { id: 1 } }, { track: { id: 2 }, reason: 5 }] });
    expect(fixed).toMatchObject({ index: 1, position: 0, repeat: 'off' });
    expect(fixed?.items[1].reason).toBeUndefined();
  });
});
