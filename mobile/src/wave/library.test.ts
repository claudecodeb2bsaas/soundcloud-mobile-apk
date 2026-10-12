import { describe, expect, it } from 'vitest';
import type { PlaylistInfo } from '../api/soundcloud';
import type { WaveTrack } from '../core/waveTypes';
import { createLibrary, parseSetting, type LibraryDeps } from './library';

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
  id, kind: 'track', title: `Song ${String.fromCharCode(65 + (id % 26))}${id}`, duration: 200000, user_id: 100 + id, user: { id: 100 + id, username: 'a' + id }, ...extra,
});
const info = (id: number, title: string, ids: number[], full: WaveTrack[] = []): PlaylistInfo => ({ id, title, count: ids.length, ids, tracks: full });

function setup(overrides: Partial<LibraryDeps['sc']> = {}, deps: Partial<LibraryDeps> = {}) {
  let stored: string | null = null;
  let time = 0;
  const calls: string[] = [];
  const library = createLibrary({
    userId: () => 7,
    settings: { get: () => stored, set: (v) => { stored = v; } },
    heard: async () => new Set<number>(),
    now: () => time,
    random: () => 0.5,
    sc: {
      likedIds: async () => ({ items: [1, 2, 3], next: null }),
      tracksByIds: async (ids) => { calls.push('tracks:' + ids.join(',')); return ids.map((id) => track(id)); },
      playlist: async (id) => (id === 50 ? info(50, 'Chill', [10, 11], [track(10)]) : id === 60 ? info(60, 'Saved', [20]) : null),
      ownPlaylists: async () => [info(50, 'Chill', [10, 11])],
      savedPlaylistIds: async () => [60, 61, 50],
      ...overrides,
    },
    ...deps,
  });
  return { library, calls, advance: (ms: number) => { time += ms; }, stored: () => stored };
}

const titles = { likes: 'Лайки' };

describe('«Моя музыка»', () => {
  it('источники: лайки, свои и сохранённые плейлисты без повторов и пропавших', async () => {
    const ctx = setup();
    const list = await ctx.library.sources();
    expect(list.map((s) => [s.key, s.title])).toEqual([['likes', ''], ['playlist:50', 'Chill'], ['playlist:60', 'Saved']]);
  });

  it('выбор и режим хранятся по аккаунту и читаются обратно', () => {
    const ctx = setup();
    expect(ctx.library.getView()).toEqual({ mode: 'shuffle', pick: ['likes'] });
    let changes = 0;
    ctx.library.subscribe(() => changes++);
    ctx.library.toggleSource('playlist:50');
    ctx.library.toggleSource('likes');
    ctx.library.toggleSource('bad');
    ctx.library.setMode('smart');
    ctx.library.setMode('smart');
    expect(ctx.library.getView()).toEqual({ mode: 'smart', pick: ['playlist:50'] });
    expect(changes).toBe(3);
    expect(parseSetting(ctx.stored())).toEqual({ mode: 'smart', pick: { 7: ['playlist:50'] } });
    expect(parseSetting('{"mode":"x"}')).toEqual({ mode: 'shuffle', pick: {} });
    expect(parseSetting('{{')).toEqual({ mode: 'shuffle', pick: {} });
  });

  it('seed «по порядку»: источники по порядку выбора, плейлист добирает остальные треки', async () => {
    const ctx = setup();
    ctx.library.setMode('order');
    ctx.library.toggleSource('playlist:50');
    const seed = await ctx.library.seed(titles);
    expect(seed).toMatchObject({ kind: 'library', order: 'fixed', title: 'Лайки и Chill' });
    expect(seed.own.map((e) => [e.track.id, e.from])).toEqual([[1, ''], [2, ''], [3, ''], [10, 'Chill'], [11, 'Chill']]);
    expect(ctx.calls).toContain('tracks:11');
    expect(seed.seeds).toHaveLength(5);
  });

  it('«Умное» отдаёт order smart; слышанное в конце, запреты и закрытое отсекаются', async () => {
    const ctx = setup(
      { tracksByIds: async (ids) => ids.map((id) => track(id, id === 2 ? { policy: 'BLOCK' } : id === 3 ? { streamable: false } : {})) },
      { heard: async () => new Set([1]), excluded: () => ({ tracks: new Set([4]), artists: new Set<number>() }) },
    );
    ctx.library.setMode('smart');
    ctx.library.toggleSource('playlist:50');
    const seed = await ctx.library.seed(titles);
    expect(seed.order).toBe('smart');
    expect(seed.own.map((e) => e.track.id)).toEqual([10, 11, 1]);
  });

  it('ошибки: пустой выбор, нет годных треков, плейлист не найден', async () => {
    const ctx = setup({ likedIds: async () => ({ items: [], next: null }), tracksByIds: async () => [] });
    await expect(ctx.library.seed(titles)).rejects.toThrow('нет треков');
    ctx.library.toggleSource('likes');
    await expect(ctx.library.seed(titles)).rejects.toThrow('источника');
    ctx.library.toggleSource('playlist:99');
    await expect(ctx.library.seed(titles)).rejects.toThrow('не найден');
  });

  it('плейлист кэшируется на 10 минут', async () => {
    let loads = 0;
    const ctx = setup({ playlist: async (id) => { loads++; return info(id, 'P', [10], [track(10)]); } });
    ctx.library.toggleSource('likes');
    ctx.library.toggleSource('playlist:50');
    await ctx.library.seed(titles);
    await ctx.library.seed(titles);
    expect(loads).toBe(1);
    ctx.advance(11 * 60000);
    await ctx.library.seed(titles);
    expect(loads).toBe(2);
  });
});
