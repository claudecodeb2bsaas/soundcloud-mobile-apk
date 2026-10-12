import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { createPicks, PICKS_MAX } from './picks';

const track = (id: number): WaveTrack => ({ id, kind: 'track', title: 'Song ' + id, duration: 200000 });

describe('набор из меню', () => {
  it('добавляет, убирает и держит не больше пяти', () => {
    const picks = createPicks();
    let calls = 0;
    picks.subscribe(() => calls++);
    for (let id = 1; id <= PICKS_MAX; id++) expect(picks.toggle(track(id))).toBe('added');
    expect(picks.toggle(track(9))).toBe('full');
    expect(picks.toggle(track(1))).toBe('removed');
    expect(picks.has(1)).toBe(false);
    expect(picks.getSnapshot().map((item) => item.id)).toEqual([2, 3, 4, 5]);
    expect(calls).toBe(6);
  });

  it('запуск отдаёт волну по похожему на все треки и очищает набор', () => {
    const picks = createPicks();
    expect(picks.take()).toBeNull();
    for (const id of [1, 2, 3]) picks.toggle(track(id));
    const seed = picks.take();
    expect(seed?.title).toBe('Song 1, Song 2 +1');
    expect(seed?.seeds.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(seed?.own).toEqual([]);
    expect(picks.getSnapshot()).toEqual([]);
  });
});
