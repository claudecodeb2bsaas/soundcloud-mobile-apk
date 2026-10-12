import { describe, expect, it } from 'vitest';
import { artistMoods, moodDictionary, moodList, moodScore, neighborMood, playlistMood, trackMood } from './waveMood';
import type { WaveTrack } from './waveTypes';

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({ id, kind: 'track', user_id: 1, duration: 180000, title: 'Track ' + id, ...extra });

describe('настроение трека', () => {
    it('метка автора весит больше жанра, жанр больше слова в названии', () => {
        expect(trackMood(track(1, { tag_list: 'sad "sad rap"' })).sad).toBeCloseTo(0.9);
        expect(trackMood(track(2, { genre: 'Emo Rap' })).sad).toBeCloseTo(0.7);
        expect(trackMood(track(3, { title: 'Грустная песня' })).sad).toBeCloseTo(0.5);
        // Свидетельства складываются, но не выше единицы
        const all = trackMood(track(4, { genre: 'Emo', tag_list: 'sad', title: 'sad song' })).sad;
        expect(all).toBeGreaterThan(0.97);
        expect(all).toBeLessThanOrEqual(1);
    });
    it('жанр по карте: phonk агрессивное, lo-fi спокойное, techno энергичное, Hip Hop и Pop без настроения', () => {
        expect(trackMood(track(1, { genre: 'Brazilian Phonk' })).aggressive).toBeCloseTo(0.7);
        expect(trackMood(track(2, { genre: 'Lo-Fi' })).calm).toBeCloseTo(0.7);
        expect(trackMood(track(3, { genre: 'Techno' })).energetic).toBeCloseTo(0.7);
        expect(trackMood(track(4, { genre: 'Dance & EDM' })).energetic).toBeCloseTo(0.7);
        expect(trackMood(track(5, { genre: 'Disco' })).happy).toBeCloseTo(0.7);
        const neutral = trackMood(track(6, { genre: 'Hip-hop & Rap' }));
        expect(Math.max(...moodList().map((mood) => neutral[mood]))).toBe(0);
        expect(Math.max(...moodList().map((mood) => trackMood(track(7, { genre: 'Pop' }))[mood]))).toBe(0);
    });
    it('witch house грустное, но не энергичное: house только звучит похоже', () => {
        const mood = trackMood(track(1, { genre: 'Witch House' }));
        expect(mood.sad).toBeCloseTo(0.7);
        expect(mood.energetic).toBe(0);
    });
    it('жанр в метках весит меньше поля жанра', () => {
        expect(trackMood(track(1, { genre: '', tag_list: 'phonk drift' })).aggressive).toBeCloseTo(0.55);
    });
    it('русские метки и слова: грустное, спокойное, агрессивное', () => {
        expect(trackMood(track(1, { tag_list: 'грустное' })).sad).toBeCloseTo(0.9);
        expect(trackMood(track(2, { tag_list: 'релакс' })).calm).toBeCloseTo(0.9);
        expect(trackMood(track(3, { title: 'АГРЕССИВНЫЙ ФОНК' })).aggressive).toBeCloseTo(0.5);
        expect(trackMood(track(4, { title: 'Под дождём' })).calm).toBeCloseTo(0.5);
    });
    it('короткое слово не находится внутри другого: sad не в Sadie, chill не в chilli, emo не в Emotional', () => {
        expect(trackMood(track(1, { title: 'Sadie' })).sad).toBe(0);
        expect(trackMood(track(2, { genre: 'Emotional' })).sad).toBe(0);
        expect(trackMood(track(3, { tag_list: 'fun' })).happy).toBeCloseTo(0.9);
        expect(trackMood(track(4, { tag_list: 'funk' })).happy).toBe(0);
    });
    it('у каждого настроения есть метки, жанры, слова и поиск', () => {
        const dict = moodDictionary();
        for (const mood of moodList()) {
            expect(dict[mood].tags.length).toBeGreaterThan(3);
            expect(dict[mood].genres.length).toBeGreaterThan(3);
            expect(dict[mood].search.length).toBeGreaterThanOrEqual(3);
            expect(() => new RegExp(dict[mood].words, 'u')).not.toThrow();
        }
    });
});

describe('перенос и соседи', () => {
    it('перенос от исполнителя: доля его грустных треков, у исполнителя с одним треком втрое меньше, три из трёх проходят порог', () => {
        const tracks = [
            track(1, { user_id: 5, genre: 'Emo' }), track(2, { user_id: 5, tag_list: 'sad' }), track(3, { user_id: 5 }), track(4, { user_id: 5, title: 'грусть' }),
            track(5, { user_id: 6, genre: 'Emo' }),
        ];
        const artists = artistMoods(tracks, trackMood);
        expect(artists.get(5)).toEqual({ count: 4, hits: { happy: 0, sad: 3, aggressive: 0, calm: 0, energetic: 0 } });
        // Без своих меток трек исполнителя 5 получает 0,6 * 3/4
        expect(moodScore(0, artists.get(5), 0, 'sad')).toBeCloseTo(0.45);
        expect(moodScore(0, artists.get(6), 0, 'sad')).toBeCloseTo(0.2);
        expect(moodScore(0, { count: 3, hits: { happy: 0, sad: 3, aggressive: 0, calm: 0, energetic: 0 } }, 0, 'sad')).toBeCloseTo(0.6);
        expect(moodScore(0, undefined, 0, 'sad')).toBe(0);
        // Трек 3 сам в статистике исполнителя 5: остаются три других, все грустные
        expect(moodScore(0, artists.get(5), 0, 'sad', true)).toBeCloseTo(0.6);
        // Единственный трек исполнителя 6 переносить не с чего
        expect(moodScore(0.7, artists.get(6), 0, 'sad', true)).toBeCloseTo(0.7);
    });
    it('голоса соседей: доля соседей с настроением, меньше восьми соседей весят меньше', () => {
        const eight = Array.from({ length: 8 }, (_, i) => track(i, { genre: i < 6 ? 'Lo-Fi' : 'Techno' }));
        expect(neighborMood(eight, trackMood).calm).toBeCloseTo(0.75);
        expect(neighborMood(eight.slice(0, 4), trackMood).calm).toBeCloseTo(0.5);
        expect(neighborMood([], trackMood).calm).toBe(0);
        expect(moodScore(0, undefined, 1, 'calm')).toBeCloseTo(0.3);
    });
    it('итог: своё, перенос и соседи складываются, одно слово в названии уже проходит порог 0,5', () => {
        expect(moodScore(0.5, undefined, 0, 'sad')).toBeCloseTo(0.5);
        expect(moodScore(0.5, { count: 3, hits: { happy: 0, sad: 3, aggressive: 0, calm: 0, energetic: 0 } }, 1, 'sad')).toBeCloseTo(1 - 0.5 * 0.4 * 0.7);
    });
});

it('П12: настроение по названиям плейлистов: каждое совпавшее 0,4, несколько складываются, чужое не в счёт', () => {
    const one = playlistMood(['my sad songs']);
    expect(one.sad).toBeCloseTo(0.4, 6);
    expect(one.happy).toBe(0);
    const two = playlistMood(['Sad Rap 2024', 'грустное на ночь', 'Workout']);
    expect(two.sad).toBeCloseTo(0.64, 6);
    expect(two.energetic).toBeCloseTo(0.4, 6);
    // Жанр из карты настроений в названии тоже метка: phonk агрессивный
    expect(playlistMood(['PHONK']).aggressive).toBeCloseTo(0.4, 6);
    expect(playlistMood(['Mix', 'Likes', '']).sad).toBe(0);
    expect(playlistMood([])).toEqual({ happy: 0, sad: 0, aggressive: 0, calm: 0, energetic: 0 });
});
