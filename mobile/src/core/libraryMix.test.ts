import { expect, it } from 'vitest';
import { isMyMusicSetting, libraryOrder, libraryPool, spreadArtists, type LibraryEntry } from './libraryMix';

interface Item { id: number; artist: number; version: string }
const item = (id: number, artist = id, version = 'v' + id): Item => ({ id, artist, version });
const keys = (track: Item): string[] => [track.version];
const key = (track: Item): string => track.version;
const entries = (list: Item[]): LibraryEntry<Item>[] => list.map((track) => ({ track, from: '' }));
// Детерминированный «случай» для перемешивания
const seeded = (seed: number) => (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

it('настройка: режим и источники по аккаунтам, чужое и лишнее не проходит', () => {
    expect(isMyMusicSetting({ mode: 'shuffle', pick: { 77: ['likes', 'playlist:8'] } })).toBe(true);
    expect(isMyMusicSetting({ mode: 'order', pick: {} })).toBe(true);
    for (const value of [
        null, [], { mode: 'random', pick: {} }, { mode: 'smart' }, { mode: 'smart', pick: [] }, { mode: 'smart', pick: {}, extra: 1 },
        { mode: 'smart', pick: { 77: ['likes', 'likes'] } }, { mode: 'smart', pick: { 77: ['playlist:0'] } }, { mode: 'smart', pick: { 77: ['album:5'] } },
        { mode: 'smart', pick: { abc: ['likes'] } }, { mode: 'smart', pick: { 77: 'likes' } },
        { mode: 'smart', pick: { 77: Array.from({ length: 101 }, (_, i) => 'playlist:' + (i + 1)) } },
        { mode: 'smart', pick: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i + 1), ['likes']])) },
    ]) expect(isMyMusicSetting(value)).toBe(false);
});

it('пул: источники по порядку выбора, трек и перезалив той же версии один раз, запреты отсекаются', () => {
    const likes = [item(1), item(2), item(3, 3, 'song')];
    const playlist = [item(2), item(4, 4, 'song'), item(5), item(6)];
    const pool = libraryPool([{ key: 'likes', name: '', tracks: likes }, { key: 'playlist:8', name: 'Mine', tracks: playlist }], (track) => track.id !== 5, keys, key, (track) => track.artist);
    expect(pool.map((entry) => entry.track.id)).toEqual([1, 2, 3, 6]);
    expect(pool.map((entry) => entry.from)).toEqual(['', '', '', 'Mine']);
});

it('пул: одинаковое название у одного аккаунта это разные треки, копией считается только загрузка другого аккаунта', () => {
    // Две «Interlude» аккаунта 7 с разных альбомов остаются, перезалив той же версии аккаунтом 8 нет
    const likes = [item(1, 7, 'interlude'), item(2, 7, 'interlude'), item(3, 8, 'interlude'), item(4, 8, 'other')];
    const pool = libraryPool([{ key: 'likes', name: '', tracks: likes }], () => true, keys, key, (track) => track.artist);
    expect(pool.map((entry) => entry.track.id)).toEqual([1, 2, 4]);
});

it('артисты разносятся, пока есть кем разбавить', () => {
    const artistOf = (track: Item): number => track.artist;
    expect(spreadArtists([item(1, 7), item(2, 7), item(3, 8), item(4, 9)], artistOf).map(artistOf)).toEqual([7, 8, 7, 9]);
    // Разбавить нечем: хвост остаётся подряд, ничего не теряется
    expect(spreadArtists([item(1, 7), item(2, 8), item(3, 7), item(4, 7)], artistOf).map((track) => track.id)).toEqual([1, 2, 3, 4]);
});

it('порядок: «По порядку» как собран, в перемешивании слышанное за 3 дня уходит в конец, а не выпадает', () => {
    const pool = entries(Array.from({ length: 12 }, (_, i) => item(i + 1, i % 3)));
    expect(libraryOrder(pool, 'order', (track) => track.artist, () => true, Math.random).map((entry) => entry.track.id)).toEqual(pool.map((entry) => entry.track.id));
    const shuffled = libraryOrder(pool, 'shuffle', (track) => track.artist, (track) => track.id <= 3, seeded(7)).map((entry) => entry.track);
    expect(shuffled.slice(0, 9).map((track) => track.id).sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(shuffled.slice(9).map((track) => track.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    for (let i = 1; i < 9; i++) expect(shuffled[i].artist).not.toBe(shuffled[i - 1].artist);
    // Слышано всё: весь пул перемешан, ничего не теряется
    expect(libraryOrder(pool, 'smart', (track) => track.artist, () => true, seeded(3))).toHaveLength(12);
});
