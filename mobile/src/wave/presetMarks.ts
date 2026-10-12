import { tagShares } from '../core/waveGenres';
import { moodList, type WaveMood } from '../core/waveMood';
import { trackArtist } from '../core/wavePicks';
import type { WaveTrack } from '../core/waveTypes';

// Свой вкус в пресете настроения (desktop: presetMarks в wave.ts): ранние пропуски внутри пресета копятся по аккаунту
// и тегам именно для него, опускают их в этом пресете и дальше, и переживают перезапуск. a это аккаунты, t это теги

export interface PresetMarks {
    a: Record<string, number>;
    t: Record<string, number>;
}
export type PresetMarkMap = Partial<Record<WaveMood, PresetMarks>>;

const KEYS_MAX = 300;
const VALUE_MAX = 10;

export function parsePresetMarks(text: string | null): PresetMarkMap {
    const out: PresetMarkMap = {};
    try {
        const saved = JSON.parse(text ?? '{}') as Record<string, unknown> | null;
        const numbers = (value: unknown): Record<string, number> => {
            const result: Record<string, number> = {};
            if (value && typeof value === 'object')
                for (const [key, count] of Object.entries(value).slice(0, 400)) if (typeof count === 'number' && Number.isFinite(count) && count > 0) result[key.slice(0, 80)] = Math.min(count, VALUE_MAX);
            return result;
        };
        for (const mood of moodList()) {
            const entry = saved?.[mood] as { a?: unknown; t?: unknown } | undefined;
            if (entry && typeof entry === 'object') out[mood] = { a: numbers(entry.a), t: numbers(entry.t) };
        }
    } catch (error) {
        console.warn('Волна: отметки пресетов не прочитаны', error);
    }
    return out;
}

/** Штраф к оценке трека внутри пресета: аккаунт до 2 пропусков по 0.5, теги долями так же */
export function presetPenalty(marks: PresetMarks | undefined, track: WaveTrack): number {
    if (!marks) return 0;
    let penalty = 0.5 * Math.min(2, marks.a[String(trackArtist(track))] ?? 0);
    for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) penalty += share * 0.5 * Math.min(2, marks.t[key] ?? 0);
    return penalty;
}

/** Ранний пропуск трека внутри пресета: аккаунт на единицу, теги на их долю. Не больше 300 ключей, слабые уходят */
export function notePresetSkip(map: PresetMarkMap, mood: WaveMood, track: WaveTrack): PresetMarkMap {
    const marks = map[mood] ?? { a: {}, t: {} };
    const bumped = (source: Record<string, number>, key: string, value: number): Record<string, number> => {
        const next = { ...source, [key]: Math.min(VALUE_MAX, (source[key] ?? 0) + value) };
        const entries = Object.entries(next);
        return entries.length > KEYS_MAX ? Object.fromEntries(entries.sort((x, y) => y[1] - x[1]).slice(0, KEYS_MAX)) : next;
    };
    const artist = trackArtist(track);
    let a = marks.a;
    let t = marks.t;
    if (artist) a = bumped(a, String(artist), 1);
    for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) t = bumped(t, key, share);
    return { ...map, [mood]: { a, t } };
}
