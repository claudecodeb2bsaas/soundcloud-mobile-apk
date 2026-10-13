import { describe, expect, it } from 'vitest';
import { buildActivity, hoursText } from './activity';
import type { TastePlay } from './historyTypes';

const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime();
const HOUR = 3600000;

const play = (daysAgo: number, heard: number, extra: Partial<TastePlay> = {}): TastePlay => ({
    at: NOW - daysAgo * 24 * HOUR - HOUR, id: 1, artist: 5, heard, dur: heard, end: 'done', source: 'app', likedNow: false, away: false, covered: null,
    endedBy: '', picked: false, looped: false, genre: 'Techno', tags: '', title: 'Song', artistName: 'Ann', artwork: '', path: '', ...extra,
});

describe('история активности', () => {
    it('считает часы, жанры, серию и столбики по дням', () => {
        const plays = [
            play(0, HOUR),
            play(1, HOUR / 2, { id: 2, artist: 6, artistName: 'Bob', genre: 'Hip-hop & Rap' }),
            play(1, 500, { id: 3 }),
            play(2, HOUR / 2, { id: 4, genre: 'Hip Hop/Rap - Trap' }),
            play(40, HOUR),
        ];
        const result = buildActivity(plays, NOW - 6 * 24 * HOUR, NOW);
        expect(result.totalMs).toBe(HOUR * 2);
        expect(result.plays).toBe(3);
        expect(result.bars).toHaveLength(7);
        expect(result.days).toHaveLength(7);
        expect(result.days.filter((day) => day.ms > 0)).toHaveLength(3);
        expect(result.streak).toBe(3);
        expect(result.activeDays).toBe(3);
        expect(result.genres.map((genre) => genre.key)).toEqual(['techno', 'hiphop', 'trap']);
        expect(result.genres[0].share).toBe(0.5);
        expect(result.topArtists[0]).toMatchObject({ id: 5, ms: HOUR * 1.5 });
    });

    it('без прослушиваний всё нули, а hoursText читается', () => {
        const result = buildActivity([], NOW - 6 * 24 * HOUR, NOW);
        expect(result).toMatchObject({ totalMs: 0, plays: 0, streak: 0, best: null });
        expect(hoursText(0)).toBe('0 мин');
        expect(hoursText(HOUR * 12 + 40 * 60000)).toBe('12 ч 40 мин');
    });
});
