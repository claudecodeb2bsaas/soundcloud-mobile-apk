import { describe, expect, it } from 'vitest';
import type { TastePlay } from '../core/historyTypes';
import type { WaveTrack } from '../core/waveTypes';
import { tasteMaps } from '../core/waveTaste';
import { WAVE_TEXTS } from '../core/waveTexts';
import { createShelf, shelfInputsOf, type ShelfDeps, type ShelfInputs } from './shelf';

const NOW = new Date(2026, 9, 12, 10, 0, 0).getTime();
const DAY = 86400000;
const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
  id, kind: 'track', title: `Song ${String.fromCharCode(65 + (id % 26))}${id}`, duration: 200000, user_id: 1000 + id, user: { id: 1000 + id, username: 'a' + id },
  genre: id <= 15 ? 'Techno' : 'House', tag_list: id <= 15 ? 'techno' : 'house', artwork_url: `https://i1.sndcdn.com/artworks-${id}-large.jpg`, ...extra,
});
const liked = Array.from({ length: 30 }, (_, i) => track(i + 1));
const emptyInputs: ShelfInputs = { recent: [], today: [], heard: [], love: new Map(), loved: [] };

function setup(overrides: Partial<ShelfDeps> = {}) {
  let stored: string | null = null;
  const calls = { liked: 0, neighbors: 0 };
  const deps: ShelfDeps = {
    userId: () => 7,
    likedTracks: async () => { calls.liked++; return liked; },
    history: async () => [],
    inputs: async () => emptyInputs,
    // Пустой вкус: модель есть, весов нет; без модели плейлиста момента нет
    taste: async () => tasteMaps({}),
    related: async (id) => Array.from({ length: 6 }, (_, i) => track(id * 100 + i)),
    sources: {
      scMixes: async () => [],
      tracksByIds: async (ids) => ids.map((id) => track(id)),
      neighbors: async () => { calls.neighbors++; return [{ id: 900, count: 3 }, { id: 901, count: 2 }]; },
    },
    excluded: () => ({ tracks: new Set<number>(), artists: new Set<number>() }),
    store: { get: () => stored, set: (value) => { stored = value; } },
    texts: WAVE_TEXTS.ru,
    now: () => NOW,
    ...overrides,
  };
  return { shelf: createShelf(deps), calls, deps, stored: () => stored };
}

const play = (id: number, extra: Partial<TastePlay> = {}): TastePlay => ({
  at: NOW - 1000, id, artist: 5, heard: 200000, dur: 200000, end: 'done', source: 'app', likedNow: false, away: false, covered: null, endedBy: 'auto',
  picked: false, looped: false, genre: 'techno', tags: 'techno', title: 'T' + id, artistName: 'Ann', artwork: '', path: '/ann/t' + id, ...extra,
});

describe('подборки дня', () => {
  it('собирает находки, давно не слушал, жанры и плейлист момента; соседи встают каждым третьим', async () => {
    const { shelf } = setup();
    const cards = await shelf.load();
    const keys = cards.map((card) => card.key);
    expect(keys[0]).toBe('moment');
    expect(keys).toEqual(expect.arrayContaining(['daily', 'forgotten', 'group-0', 'group-1']));
    const daily = cards.find((card) => card.key === 'daily');
    expect(daily?.ids[2]).toBe(900);
    expect(daily?.ids[5]).toBe(901);
    expect(daily?.neighbors).toEqual([900, 901]);
    expect(cards.every((card) => new Set(card.ids).size === card.ids.length)).toBe(true);
    // слышанное и лайкнутое в находки не идёт
    expect(daily?.ids.filter((id) => id <= 30)).toEqual([]);
  });

  it('второй вызов и перезапуск берут снимок, а не собирают заново', async () => {
    const first = setup();
    await first.shelf.load();
    await first.shelf.load();
    expect(first.calls.liked).toBe(1);
    const second = setup({ likedTracks: async () => { throw new Error('не должен звать'); } });
    const again = createShelfFrom(second.deps, first.stored());
    expect((await again.load()).map((card) => card.key)).toContain('daily');
  });

  it('вчерашний снимок собирается заново, плейлист момента меняется со сменой отрезка суток', async () => {
    let now = NOW;
    const { shelf, calls } = setup({ now: () => now });
    const first = await shelf.load();
    now += 7 * 3600000;
    const second = await shelf.load();
    // Подборки дня те же, плейлист момента новый
    expect(second.find((card) => card.key === 'daily')).toBe(first.find((card) => card.key === 'daily'));
    expect(second.find((card) => card.key === 'moment')?.title).not.toBe(first.find((card) => card.key === 'moment')?.title);
    expect(calls.neighbors).toBe(1);
    now += DAY;
    const third = await shelf.load();
    expect(third.find((card) => card.key === 'daily')).not.toBe(first.find((card) => card.key === 'daily'));
    expect(calls.neighbors).toBe(2);
  });

  it('«Не нравится» и скрытый артист не попадают в состав', async () => {
    const { shelf } = setup({ excluded: () => ({ tracks: new Set([1]), artists: new Set([1002]) }) });
    const cards = await shelf.load();
    const group = cards.find((card) => card.key === 'forgotten');
    expect(group?.ids).not.toContain(1);
    expect(group?.ids).not.toContain(2);
    const own = await shelf.tracks(cards.find((card) => card.key === 'daily') ?? cards[0]);
    expect(own.length).toBeGreaterThan(0);
  });

  it('без лайков подборок нет, без входа это ошибка', async () => {
    expect(await setup({ likedTracks: async () => [] }).shelf.load()).toEqual([]);
    await expect(setup({ userId: () => null }).shelf.load()).rejects.toThrow();
  });

  it('волна от подборки: причины по виду, выбранный трек первым, остальное по кругу', async () => {
    const { shelf } = setup();
    const cards = await shelf.load();
    const daily = cards.find((card) => card.key === 'daily');
    if (!daily) throw new Error('нет находок');
    const tracks = await shelf.tracks(daily);
    const pick = tracks[3].id;
    const seed = shelf.seed(daily, tracks, pick);
    expect(seed.kind).toBe('library');
    expect(seed.own[0].track.id).toBe(pick);
    expect(seed.own.map((entry) => entry.track.id).sort()).toEqual(tracks.map((entry) => entry.id).sort());
    expect(seed.own.find((entry) => entry.track.id === 900)?.reason).toEqual({ kind: 'neighbors' });
    expect(seed.own.find((entry) => entry.track.id !== 900 && entry.track.id !== 901)?.reason).toEqual({ kind: 'daily' });
    const forgotten = cards.find((card) => card.key === 'forgotten');
    if (!forgotten) throw new Error('нет «Давно не слушал»');
    expect(shelf.seed(forgotten, await shelf.tracks(forgotten)).own[0].reason).toEqual({ kind: 'forgotten' });
  });

  it('«Лайкнули твои артисты»: по треку от каждой подборки, чей лайк виден', async () => {
    const mixes = ['Ann', 'Bob'].map((owner, k) => ({ kind: 'liked' as const, title: `${owner}’s Picks`, urn: 'u' + k, owner: k + 1, ids: Array.from({ length: 6 }, (_, i) => 2000 + k * 100 + i) }));
    const { shelf } = setup({ sources: { ...setup().deps.sources, scMixes: async () => mixes } });
    const card = (await shelf.load()).find((item) => item.kind === 'liked');
    expect(card?.ids.slice(0, 4)).toEqual([2000, 2100, 2001, 2101]);
    expect(card?.by.slice(0, 2)).toEqual(['Ann', 'Bob']);
    expect(card?.sub).toBe('Ann, Bob');
  });
});

// Новая полка на тех же зависимостях и с тем же хранилищем: так приложение видит снимок после перезапуска
function createShelfFrom(deps: ShelfDeps, saved: string | null) {
  let stored = saved;
  return createShelf({ ...deps, store: { get: () => stored, set: (value) => { stored = value; } } });
}

describe('вход полки из журнала', () => {
  it('слышанное, сегодняшнее и любимое считаются по журналу', () => {
    const plays = [
      play(1, { at: NOW - 40 * DAY }),
      play(2, { at: NOW - 3 * 3600000 }),
      play(2, { at: NOW - 2 * 3600000, looped: true }),
      play(3, { heard: 5000, end: 'skip', endedBy: 'user', at: NOW - DAY / 2 }),
      play(4, { away: true }),
      play(5, { heard: 100000, covered: 50000, end: 'skip', endedBy: 'user' }),
    ];
    const inputs = shelfInputsOf(plays, NOW);
    expect(inputs.recent.sort()).toEqual([2, 5]);
    expect(inputs.today.sort()).toEqual([2, 5]);
    expect(inputs.heard.map((item) => item.id).sort()).toEqual([1, 2, 5]);
    expect(inputs.love.get(2)).toEqual({ done: 1, early: 0, loops: 1 });
    expect(inputs.love.get(3)).toEqual({ done: 0, early: 1, loops: 0 });
    expect(inputs.love.get(1)).toEqual({ done: 1, early: 0, loops: 0 });
    expect(inputs.love.has(5)).toBe(false);
    expect(inputs.love.has(4)).toBe(false);
    expect(inputs.loved.find((item) => item.id === 1)?.permalink_url).toBe('https://soundcloud.com/ann/t1');
  });
});
