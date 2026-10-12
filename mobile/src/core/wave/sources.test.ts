import { describe, expect, it } from 'vitest';
import { interleaveMixes, likedOwner, likedTracksOf, likersOf, neighborLikes, relatedArtistsOf, scMixesOf, tasteNeighbors, type ScMix } from './sources';

describe('источники SoundCloud', () => {
    it('похожие артисты: только аккаунты с треками, без повторов, мусор отбрасывается', () => {
        expect(relatedArtistsOf({ collection: [
            { id: 1, username: ' LUFNAEL ', track_count: 29, followers_count: 400 },
            { id: 2, username: 'пустой', track_count: 0 },
            { id: 1, username: 'повтор', track_count: 5 },
            { id: 'x', username: 'мусор', track_count: 5 },
            null,
        ] })).toEqual([{ id: 1, username: 'LUFNAEL', tracks: 29, followers: 400 }]);
        expect(relatedArtistsOf(null)).toEqual([]);
        expect(relatedArtistsOf({ collection: 'нет' })).toEqual([]);
    });

    it('подборки: Your Mix, Daily Drops, Weekly Wave и Liked By с номерами треков; станции, тренды и похожие на трек не берутся', () => {
        const item = (urn: string, title: string, ids: number[]) => ({ kind: 'system-playlist', urn, title, tracks: ids.map((id) => ({ id, kind: 'track', policy: 'MONETIZE' })) });
        const body = { collection: [
            { urn: 'soundcloud:selections:personalized-tracks:7', items: { collection: [item('soundcloud:system-playlists:personalized-tracks:7:2250509282', 'Related tracks: x', [1])] } },
            { urn: 'soundcloud:selections:your-moods', items: { collection: [item('soundcloud:system-playlists:your-moods:7:1', 'Your Mix 1', [10, 11, 10]), item('soundcloud:system-playlists:your-moods:7:1', 'Повтор', [12])] } },
            { urn: 'soundcloud:selections:made-for-you', items: { collection: [item('soundcloud:system-playlists:new-for-you:7', 'Daily Drops', [20]), item('soundcloud:system-playlists:weekly:7', 'Weekly Wave', [30])] } },
            { urn: 'soundcloud:selections:liked-by-7', items: { collection: [item('soundcloud:system-playlists:liked-by:525777930', "katanacss's Picks", [40])] } },
            { urn: 'soundcloud:selections:artist-stations', items: { collection: [item('soundcloud:system-playlists:artist-stations:1:2', 'IVOXYGEN', [50])] } },
            { urn: 'soundcloud:selections:trending-by-genre-playlists', items: { collection: [item('soundcloud:system-playlists:trending-by-genre:hip-hop', 'Hip Hop', [60])] } },
            { urn: 'soundcloud:selections:recently-played:7', items: { collection: [{ kind: 'user', urn: 'soundcloud:users:1' }] } },
            { items: null },
        ] };
        expect(scMixesOf(body)).toEqual([
            { kind: 'mix', title: 'Your Mix 1', urn: 'soundcloud:system-playlists:your-moods:7:1', ids: [10, 11], owner: 0 },
            { kind: 'daily', title: 'Daily Drops', urn: 'soundcloud:system-playlists:new-for-you:7', ids: [20], owner: 0 },
            { kind: 'weekly', title: 'Weekly Wave', urn: 'soundcloud:system-playlists:weekly:7', ids: [30], owner: 0 },
            { kind: 'liked', title: "katanacss's Picks", urn: 'soundcloud:system-playlists:liked-by:525777930', ids: [40], owner: 525777930 },
        ]);
        expect(scMixesOf({ collection: 'нет' })).toEqual([]);
    });

    it('номера подборок вперемешку по кругу, без повторов, только выбранные виды', () => {
        const mix = (kind: ScMix['kind'], ids: number[]): ScMix => ({ kind, title: kind, urn: kind, ids, owner: 0 });
        const list = interleaveMixes([mix('mix', [1, 2, 3]), mix('daily', [4, 1]), mix('liked', [9]), mix('weekly', [])], ['mix', 'daily', 'weekly']);
        expect(list.map((entry) => entry.id)).toEqual([1, 4, 2, 3]);
        expect(list[1].mix.kind).toBe('daily');
    });

    it('П13: чьи лайки в «Liked By», по названию подборки', () => {
        expect(likedOwner("katanacss's Picks")).toBe('katanacss');
        expect(likedOwner("Liked By HARDX's Picks")).toBe('HARDX');
        expect(likedOwner(' Liked by Lil’ B’s Picks ')).toBe('Lil’ B');
        expect(likedOwner('Weekly Wave')).toBe('Weekly Wave');
    });

    it('П14: лайкнувшие без повторов, соседи от трёх общих нишевых треков без себя, больше общих выше', () => {
        expect(likersOf({ collection: [{ id: 5 }, { id: 5 }, { id: -1 }, null, { id: 6 }] })).toEqual([5, 6]);
        expect(likersOf(null)).toEqual([]);
        const lists = [[1, 2, 3, 77], [1, 2, 77], [1, 2, 77, 2], [1, 4], [4, 5]];
        expect(tasteNeighbors(lists, 77)).toEqual([{ id: 1, shared: 4 }, { id: 2, shared: 3 }]);
        expect(tasteNeighbors(lists, 77, 2, 1)).toEqual([{ id: 1, shared: 4 }]);
    });

    it('П14: свежие лайки соседей по числу соседей, старое и исходные треки не в счёт', () => {
        const at = Date.parse('2026-10-01T00:00:00Z');
        expect(likedTracksOf({ collection: [{ created_at: '2026-10-01T00:00:00Z', track: { id: 9 } }, { created_at: 'вчера', track: { id: 8 } }, { track: null }] }))
            .toEqual([{ id: 9, at }, { id: 8, at: 0 }]);
        const since = at - 60 * 86400000;
        const lists = [[{ id: 10, at }, { id: 11, at }, { id: 12, at: since - 1 }, { id: 10, at }], [{ id: 13, at }, { id: 10, at }, { id: 99, at }]];
        expect(neighborLikes(lists, since, new Set([99]))).toEqual([{ id: 10, count: 2 }, { id: 11, count: 1 }, { id: 13, count: 1 }]);
        expect(neighborLikes(lists, since, new Set(), 1)).toEqual([{ id: 10, count: 2 }]);
    });
});
