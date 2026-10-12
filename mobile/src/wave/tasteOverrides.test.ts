import { describe, expect, it } from 'vitest';
import type { TastePlay } from '../core/historyTypes';
import { createTaste } from './taste';
import { createTasteOverrides } from './tasteOverrides';

const NOW = Date.UTC(2026, 9, 12, 12);
const DAY = 86400000;
const play = (id: number, artist: number, genre: string): TastePlay => ({
  at: NOW - DAY * (1 + (id % 5)), id, artist, heard: 200000, dur: 200000, end: 'done', source: 'app', likedNow: false, away: false, covered: null, endedBy: 'auto',
  picked: true, looped: false, genre, tags: genre.toLowerCase(), title: 'Song ' + id, artistName: 'Artist' + artist, artwork: '', path: '/a' + artist + '/s' + id,
});

function memory() {
  let value: string | null = null;
  return { get: () => value, set: (next: string) => { value = next; }, raw: () => value };
}

describe('«убрать из вкуса»', () => {
  it('убранное хранится по аккаунтам, проверяет ключи и переживает перезапуск', () => {
    const store = memory();
    const overrides = createTasteOverrides(store);
    expect(overrides.get(1)).toEqual({ artists: [], tags: [] });
    expect(overrides.set(1, 'artist', 10, true)).toBe(true);
    expect(overrides.set(1, 'tag', 'phonk', true)).toBe(true);
    expect(overrides.set(2, 'artist', 20, true)).toBe(true);
    expect(overrides.set(1, 'artist', -5, true)).toBe(false);
    expect(overrides.set(1, 'tag', 'x', true)).toBe(false);
    expect(createTasteOverrides(store).get(1)).toEqual({ artists: [10], tags: ['phonk'] });
    expect(createTasteOverrides(store).get(2)).toEqual({ artists: [20], tags: [] });
    expect(overrides.set(1, 'artist', 10, false)).toBe(true);
    expect(overrides.get(1)).toEqual({ artists: [], tags: ['phonk'] });
  });

  it('испорченное хранилище не ломает: пусто', () => {
    const store = { get: () => '{{', set: () => undefined };
    expect(createTasteOverrides(store).get(1)).toEqual({ artists: [], tags: [] });
  });

  it('помнит не больше 20 аккаунтов, самые старые уходят', () => {
    const overrides = createTasteOverrides(memory());
    for (let user = 1; user <= 25; user++) overrides.set(user, 'artist', 10, true);
    expect(overrides.get(1)).toEqual({ artists: [], tags: [] });
    expect(overrides.get(25)).toEqual({ artists: [10], tags: [] });
  });

  it('убранный артист и тег уходят из вкуса и показываются в «убрано», возврат возвращает', async () => {
    const plays = [
      ...Array.from({ length: 6 }, (_, i) => play(i + 1, 10, 'Phonk')),
      ...Array.from({ length: 6 }, (_, i) => play(i + 20, 20, 'House')),
    ];
    const taste = createTaste({
      now: () => NOW,
      history: { tastePlays: async () => plays, marks: async () => [], waveOrigins: async () => [] },
      library: async () => null,
      overrides: createTasteOverrides(memory()),
    });
    const before = await taste.maps(1);
    expect(before?.artists.get(10)).toBeGreaterThan(0);
    expect(before?.tags.get('phonk')).toBeGreaterThan(0);
    const view = await taste.view(1);
    expect(view.artists.map((entry) => entry.id).sort()).toEqual([10, 20]);
    expect(view.tags.map((entry) => entry.key)).toEqual(expect.arrayContaining(['phonk', 'house']));

    expect(taste.setRemoved(1, 'artist', 10, true)).toBe(true);
    expect(taste.setRemoved(1, 'tag', 'phonk', true)).toBe(true);
    expect(taste.setRemoved(1, 'artist', -1, true)).toBe(false);
    const after = await taste.maps(1);
    expect(after?.artists.has(10)).toBe(false);
    expect(after?.tags.has('phonk')).toBe(false);
    expect(after?.artists.get(20)).toBeGreaterThan(0);
    const changed = await taste.view(1);
    expect(changed.artists.map((entry) => entry.id)).toEqual([20]);
    expect(changed.removed.artists).toEqual([{ id: 10, name: 'Artist10' }]);
    expect(changed.removed.tags.map((entry) => entry.key)).toContain('phonk');

    taste.setRemoved(1, 'artist', 10, false);
    taste.setRemoved(1, 'tag', 'phonk', false);
    expect((await taste.maps(1))?.artists.get(10)).toBeGreaterThan(0);
  });

  it('без хранилища убранного setRemoved возвращает false', async () => {
    const taste = createTaste({ now: () => NOW, history: { tastePlays: async () => [], marks: async () => [], waveOrigins: async () => [] }, library: async () => null });
    expect(taste.setRemoved(1, 'artist', 10, true)).toBe(false);
  });
});
