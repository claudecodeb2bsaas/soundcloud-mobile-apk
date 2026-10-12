import { describe, expect, it } from 'vitest';
import type { TasteLibrary, TastePlay, TasteMark } from '../core/historyTypes';
import type { WaveTrack } from '../core/waveTypes';
import { createTaste, tasteLibraryOf, uploadOf } from './taste';

const NOW = Date.UTC(2026, 9, 12, 12);
const DAY = 86400000;

const play = (extra: Partial<TastePlay> & { id: number }): TastePlay => ({
  at: NOW - DAY, artist: 0, heard: 200000, dur: 200000, end: 'done', source: 'app', likedNow: false, away: false, covered: null, endedBy: 'auto',
  picked: true, looped: false, genre: '', tags: '', title: 'Song ' + extra.id, artistName: '', artwork: '', path: '', ...extra,
});

function setup(plays: TastePlay[], marks: TasteMark[] = [], library: TasteLibrary | null = null) {
  let computed = 0;
  let time = NOW;
  const taste = createTaste({
    now: () => time,
    history: {
      tastePlays: async () => { computed++; return plays; },
      marks: async () => marks,
      waveOrigins: async () => [{ key: 'similar', done: 4, early: 1 }],
    },
    library: async () => library,
  });
  return { taste, computed: () => computed, advance: (ms: number) => { time += ms; } };
}

describe('вкус', () => {
  it('дослушанное поднимает артиста и теги, ранние пропуски человеком опускают', async () => {
    const ctx = setup([
      ...Array.from({ length: 6 }, (_, i) => play({ id: i + 1, artist: 10, genre: 'Phonk', at: NOW - (i + 1) * DAY })),
      ...Array.from({ length: 4 }, (_, i) => play({ id: i + 20, artist: 20, genre: 'Pop', end: 'skip', endedBy: 'user', heard: 5000, at: NOW - (i + 1) * DAY })),
    ]);
    const maps = await ctx.taste.maps(1);
    expect(maps?.artists.get(10)).toBeGreaterThan(0);
    expect(maps?.artists.get(20)).toBeLessThan(0);
    expect(maps?.tags.get('phonk')).toBeGreaterThan(0);
    expect(maps?.sources.get('similar')).toEqual({ done: 4, early: 1 });
  });

  it('«Не нравится» и скрытый артист по отметкам дают минус', async () => {
    const ctx = setup([], [
      { id: 5, artist: 30, genre: 'Pop', tags: '', at: NOW - DAY, kind: 'track', title: 'Bad song', name: 'X' },
      { id: 30, artist: 30, genre: '', tags: '', at: NOW - DAY, kind: 'artist', name: 'X' },
    ]);
    const maps = await ctx.taste.maps(1);
    expect(maps?.tracks.get(5)).toBeLessThan(0);
    expect(maps?.artists.get(30)).toBeLessThan(0);
  });

  it('холодный старт: вкус по лайкам и подпискам, без истории', async () => {
    const liked: WaveTrack = { id: 7, kind: 'track', title: 'Liked', genre: 'House', user_id: 40, user: { id: 40, username: 'Dj' }, duration: 200000 };
    const ctx = setup([], [], { likes: [{ id: 7, added: 0, upload: uploadOf(liked) }], follows: [50], playlists: [], uploads: [] });
    const maps = await ctx.taste.maps(1);
    expect(maps?.artists.get(40)).toBeGreaterThan(0);
    expect(maps?.artists.get(50)).toBeGreaterThan(0);
    expect(maps?.tags.get('house')).toBeGreaterThan(0);
  });

  it('профиль живёт 30 минут, invalidate сбрасывает, параллельные запросы считают один раз', async () => {
    const ctx = setup([play({ id: 1, artist: 10 })]);
    await Promise.all([ctx.taste.maps(1), ctx.taste.maps(1)]);
    expect(ctx.computed()).toBe(1);
    ctx.advance(29 * 60000);
    await ctx.taste.maps(1);
    expect(ctx.computed()).toBe(1);
    ctx.advance(2 * 60000);
    await ctx.taste.maps(1);
    expect(ctx.computed()).toBe(2);
    ctx.taste.invalidate(1);
    await ctx.taste.maps(1);
    expect(ctx.computed()).toBe(3);
  });

  it('лайки не прочитались: вкус по истории', async () => {
    const taste = createTaste({
      now: () => NOW,
      history: { tastePlays: async () => [play({ id: 1, artist: 10, genre: 'Jazz' })], marks: async () => [], waveOrigins: async () => { throw new Error('db'); } },
      library: async () => { throw new Error('net'); },
    });
    expect((await taste.maps(1))?.artists.get(10)).toBeGreaterThan(0);
  });

  it('tasteLibraryOf собирает лайки с описанием и подписки', async () => {
    const tracks: WaveTrack[] = [{ id: 1, kind: 'track', title: 'A', user_id: 5, user: { id: 5, username: 'u' }, genre: 'g', tag_list: 't' }];
    const library = await tasteLibraryOf(
      {
        likedIds: async () => ({ items: [1, 2], next: null }),
        tracksByIds: async () => tracks,
        followings: async () => [{ id: 9, username: 'f', avatarUrl: null, followers: 0, trackCount: 0, city: '' }],
      },
      77,
    );
    expect(library.likes.map((like) => [like.id, like.upload?.uploader ?? null])).toEqual([[1, 5], [2, null]]);
    expect(library.follows).toEqual([9]);
  });
});
