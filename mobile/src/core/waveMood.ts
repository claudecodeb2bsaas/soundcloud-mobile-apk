// Настроение трека для пресетов волны (В3): оценка 0-1 по пяти настроениям без звука и внешних сервисов.
// Источники по убыванию веса: метка автора, жанр по ручной карте, слово в названии, перенос от исполнителя,
// голоса соседей по похожим. Словарь целиком в moodDictionary. Функции уходят на страницу текстом
// (pageHelpers в wave.ts) и зовут друг друга по голому имени, поэтому импорт через пространство имён
import * as genres from './waveGenres';
import type { WaveTrack } from './waveTypes';

const { trackMatchesGenre } = genres;

export type WaveMood = 'happy' | 'sad' | 'aggressive' | 'calm' | 'energetic';
export type MoodScores = Record<WaveMood, number>;
export interface ArtistMoods { count: number; hits: MoodScores }

export function moodList(): WaveMood[] {
    return ['happy', 'sad', 'aggressive', 'calm', 'energetic'];
}

// Словарь: метки автора, жанры по ручной карте, слова в названии и метки для поиска кандидатов на SoundCloud.
// Жанры сравниваются как в фильтре жанра (hip hop и rap одно, rock находится в Alternative Rock). «Hip Hop/Rap», «Pop»,
// «Electronic» ничего не говорят о настроении и в карту не входят. У кириллицы нет \b: слова в названии корнями
export function moodDictionary(): Record<WaveMood, { tags: string[]; genres: string[]; words: string; search: string[] }> {
    return {
        happy: {
            tags: ['happy', 'feelgood', 'feel good', 'upbeat', 'positive', 'joy', 'joyful', 'cheerful', 'fun', 'funny', 'summer', 'sunny', 'весёлое', 'веселое', 'весело', 'позитив', 'радость', 'лето'],
            genres: ['disco', 'nu disco', 'kpop', 'jpop', 'city pop', 'ska', 'afrobeats', 'afrobeat', 'tropical house', 'bubblegum pop', 'reggae', 'dancehall'],
            words: '\\bhappy\\b|feel ?good|upbeat|\\bpositive\\b|\\bsummer\\b|\\bsunny\\b|\\bsmile\\b|вес[её]л|позитив|радост|улыб',
            search: ['happy', 'feel good', 'summer'],
        },
        sad: {
            tags: ['sad', 'sadness', 'sadboy', 'sadgirl', 'sad rap', 'sadrap', 'sadtrap', 'melancholic', 'melancholy', 'depressive', 'depression', 'lonely', 'heartbreak', 'emotional', 'грустное', 'грустно', 'грусть', 'грустный', 'печаль', 'тоска', 'депрессия', 'меланхолия'],
            genres: ['emo', 'emo rap', 'sad', 'slowcore', 'shoegaze', 'darkwave', 'witch house', 'slowed'],
            words: '\\bsad\\b|грус|печал|тоск|depress|депресс|melanchol|меланхол|lonely|одинок|heartbreak|broken heart|\\bcry(ing)?\\b|сл[её]з|\\btears\\b|\\bpain\\b|slowed|reverb',
            search: ['sad', 'sad rap', 'melancholic'],
        },
        aggressive: {
            tags: ['aggressive', 'agressive', 'angry', 'rage', 'hard', 'brutal', 'агрессивное', 'агрессия', 'агрессивно', 'жёстко', 'жестко'],
            genres: ['phonk', 'drift phonk', 'drill', 'rage', 'hardstyle', 'hardcore', 'metal', 'metalcore', 'deathcore', 'nu metal', 'trap metal', 'horrorcore', 'dubstep', 'riddim', 'memphis', 'crunk', 'breakcore', 'industrial', 'punk'],
            words: 'aggressive|агрессив|\\brage\\b|ярост|\\bwar\\b|\\bkill|murder|\\bdrift\\b|phonk|фонк|brutal',
            search: ['aggressive', 'rage', 'phonk'],
        },
        calm: {
            tags: ['chill', 'chillout', 'relax', 'relaxing', 'calm', 'peaceful', 'mellow', 'sleep', 'study', 'meditation', 'dreamy', 'спокойное', 'спокойно', 'релакс', 'расслабление', 'чилл'],
            genres: ['lofi', 'ambient', 'chillout', 'chill', 'chillhop', 'chillwave', 'downtempo', 'jazz', 'acoustic', 'piano', 'new age', 'lounge', 'classical', 'bossa nova', 'dream pop', 'meditation'],
            words: 'lo-?fi|лофи|\\bchill|чилл|relax|\\bcalm\\b|спокойн|\\bsleep|\\bstudy\\b|meditat|acoustic|акустик|\\bpiano\\b|\\brain\\b|дожд',
            search: ['chill', 'lofi', 'ambient'],
        },
        energetic: {
            tags: ['energetic', 'energy', 'hype', 'workout', 'gym', 'party', 'dance', 'club', 'drive', 'энергичное', 'энергия', 'драйв', 'танцы', 'движ'],
            genres: ['edm', 'dance', 'house', 'techno', 'trance', 'hardbass', 'jersey club', 'baile funk', 'funk', 'electro', 'drum and bass', 'uk garage', 'hyperpop', 'nightcore', 'big room', 'bass house'],
            words: 'sped ?up|speed ?up|nightcore|\\bhype\\b|workout|\\bgym\\b|\\benergy\\b|энерг|\\bclub\\b|\\bdance\\b|танц|\\brave\\b',
            search: ['energetic', 'workout', 'dance'],
        },
    };
}

// Своё настроение трека: метка автора 0,9, поле жанра 0,7, жанр в метках 0,55, слово в названии 0,5. Источники одного
// настроения складываются как независимые свидетельства: 1 - (1 - a)(1 - b)
export function trackMood(track: WaveTrack): MoodScores {
    const dict = moodDictionary();
    const genre = { id: track.id, genre: track.genre ?? '', tag_list: '' };
    const tags = { id: track.id, genre: '', tag_list: track.tag_list ?? '' };
    const title = (track.title ?? '').toLowerCase();
    const scores = { happy: 0, sad: 0, aggressive: 0, calm: 0, energetic: 0 };
    for (const mood of moodList()) {
        const entry = dict[mood];
        const parts: number[] = [];
        // Метки дают одно свидетельство: метка настроения или, если её нет, жанр из карты среди меток
        const tagged = !!tags.tag_list && trackMatchesGenre(tags, entry.tags);
        if (tagged) parts.push(0.9);
        if (genre.genre && trackMatchesGenre(genre, entry.genres)) parts.push(0.7);
        else if (!tagged && tags.tag_list && trackMatchesGenre(tags, entry.genres)) parts.push(0.55);
        if (title && new RegExp(entry.words, 'u').test(title)) parts.push(0.5);
        scores[mood] = 1 - parts.reduce((rest, part) => rest * (1 - part), 1);
    }
    return scores;
}

// Настроение по названиям чужих плейлистов с треком (П12): название разбирается словарём как метка или жанр, и
// слова как в названии трека. Каждое совпавшее название слабое свидетельство 0,4, несколько складываются как
// независимые: два плейлиста «sad» дают 0,64
export function playlistMood(titles: string[]): MoodScores {
    const dict = moodDictionary();
    const scores = { happy: 0, sad: 0, aggressive: 0, calm: 0, energetic: 0 };
    for (const mood of moodList()) {
        const entry = dict[mood];
        const words = new RegExp(entry.words, 'u');
        let rest = 1;
        for (const title of titles) {
            const label = { id: 0, genre: title, tag_list: '' };
            if (words.test(title.toLowerCase()) || trackMatchesGenre(label, entry.tags) || trackMatchesGenre(label, entry.genres)) rest *= 0.6;
        }
        scores[mood] = 1 - rest;
    }
    return scores;
}

// Сколько известных треков каждого исполнителя с каким настроением: для переноса на его треки без меток.
// Настроение трека засчитывается от 0,5
export function artistMoods(tracks: WaveTrack[], moodOf: (track: WaveTrack) => MoodScores): Map<number, ArtistMoods> {
    const map = new Map<number, ArtistMoods>();
    const seen = new Set<number>();
    for (const track of tracks) {
        const artist = track.user_id ?? track.user?.id ?? 0;
        if (!artist || seen.has(track.id)) continue;
        seen.add(track.id);
        const entry = map.get(artist) ?? { count: 0, hits: { happy: 0, sad: 0, aggressive: 0, calm: 0, energetic: 0 } };
        entry.count++;
        const own = moodOf(track);
        for (const mood of moodList()) if (own[mood] >= 0.5) entry.hits[mood]++;
        map.set(artist, entry);
    }
    return map;
}

// Доля соседей с этим настроением: похожие на одно зерно похожи и друг на друга. Меньше восьми соседей весят меньше
export function neighborMood(tracks: WaveTrack[], moodOf: (track: WaveTrack) => MoodScores): MoodScores {
    const shares = { happy: 0, sad: 0, aggressive: 0, calm: 0, energetic: 0 };
    if (!tracks.length) return shares;
    const scale = Math.min(1, tracks.length / 8) / tracks.length;
    for (const track of tracks) {
        const own = moodOf(track);
        for (const mood of moodList()) if (own[mood] >= 0.5) shares[mood] += scale;
    }
    return shares;
}

// Итог по настроению: своё, перенос от исполнителя и соседи (до 0,3). Перенос до 0,6: исполнитель, у которого три
// других трека из трёх грустные, сам проходит порог 0,5, два из трёх уже нет; с одним-двумя треками перенос меньше.
// counted: трек сам входит в статистику исполнителя (лайк, история), тогда он из неё вычитается
export function moodScore(own: number, artist: ArtistMoods | undefined, neighbors: number, mood: WaveMood, counted = false): number {
    const count = artist ? artist.count - (counted ? 1 : 0) : 0;
    const hits = artist ? artist.hits[mood] - (counted && own >= 0.5 ? 1 : 0) : 0;
    const transfer = count > 0 ? 0.6 * (hits / count) * Math.min(1, count / 3) : 0;
    return 1 - (1 - own) * (1 - transfer) * (1 - 0.3 * neighbors);
}
