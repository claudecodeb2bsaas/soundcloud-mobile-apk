import { COUNTED_MS, HEARD_MIN_MS, type TastePlay } from './historyTypes';
import { genreMain } from './waveGenres';

// История активности: сколько ты слушал и что. Считается из журнала прослушиваний (TastePlay), без сети.
// Время это реально прозвучавшие секунды (heard), поэтому пропущенные с порога треки в часы не попадают.

export type Bucket = 'day' | 'month';

export interface ActivityBar { start: number; ms: number }
export interface ActivityGenre { key: string; label: string; ms: number; share: number }
export interface ActivityArtist { id: number; name: string; ms: number; plays: number; artwork: string }
export interface ActivityTrack { id: number; title: string; artist: string; artwork: string; plays: number; ms: number }

export interface Activity {
    totalMs: number;
    /** Прослушивания: от 30 секунд звука */
    plays: number;
    tracks: number;
    artists: number;
    bars: ActivityBar[];
    /** Каждый день периода — для теплокарты как на GitHub */
    days: ActivityBar[];
    genres: ActivityGenre[];
    topArtists: ActivityArtist[];
    topTracks: ActivityTrack[];
    /** Дней с музыкой за период и самая долгая серия подряд, оканчивающаяся сегодня или вчера */
    activeDays: number;
    streak: number;
    best: ActivityBar | null;
}

const startOf = (at: number, bucket: Bucket): number => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    if (bucket === 'month') date.setDate(1);
    return date.getTime();
};

function starts(from: number, now: number, bucket: Bucket): number[] {
    const out: number[] = [];
    const date = new Date(startOf(from, bucket));
    while (date.getTime() <= now) {
        out.push(date.getTime());
        if (bucket === 'month') date.setMonth(date.getMonth() + 1);
        else date.setDate(date.getDate() + 1);
    }
    return out;
}

export function buildActivity(plays: TastePlay[], from: number, now: number, bucket: Bucket = 'day', limit = 5): Activity {
    const bars = new Map<number, number>(starts(from, now, bucket).map((start) => [start, 0]));
    const dayMs = new Map<number, number>();
    const genres = new Map<string, ActivityGenre>();
    const artists = new Map<number, ActivityArtist>();
    const tracks = new Map<number, ActivityTrack>();
    let totalMs = 0;
    let counted = 0;

    for (const play of plays) {
        if (play.at < from || play.at > now || play.heard < HEARD_MIN_MS || play.away) continue;
        totalMs += play.heard;
        const bar = startOf(play.at, bucket);
        bars.set(bar, (bars.get(bar) ?? 0) + play.heard);
        const day = startOf(play.at, 'day');
        dayMs.set(day, (dayMs.get(day) ?? 0) + play.heard);

        const main = genreMain(play.genre);
        if (main.key) {
            const entry = genres.get(main.key) ?? { key: main.key, label: main.label, ms: 0, share: 0 };
            entry.ms += play.heard;
            genres.set(main.key, entry);
        }
        if (play.artist) {
            const entry = artists.get(play.artist) ?? { id: play.artist, name: play.artistName, ms: 0, plays: 0, artwork: '' };
            entry.ms += play.heard;
            entry.name ||= play.artistName;
            artists.set(play.artist, entry);
        }
        if (play.heard < COUNTED_MS) continue;
        counted++;
        if (play.artist) (artists.get(play.artist) as ActivityArtist).plays++;
        const track = tracks.get(play.id) ?? { id: play.id, title: play.title, artist: play.artistName, artwork: play.artwork, plays: 0, ms: 0 };
        track.plays++;
        track.ms += play.heard;
        track.artwork ||= play.artwork;
        tracks.set(play.id, track);
    }

    const genreTotal = [...genres.values()].reduce((sum, entry) => sum + entry.ms, 0);
    const list = [...bars].map(([start, ms]) => ({ start, ms })).sort((a, b) => a.start - b.start);
    const best = list.reduce<ActivityBar | null>((top, bar) => (bar.ms > (top?.ms ?? 0) ? bar : top), null);

    // Серия считается назад от сегодня; пустой сегодняшний день её не рвёт, день ещё идёт
    let streak = 0;
    const cursor = new Date(startOf(now, 'day'));
    if (!dayMs.get(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
    while (dayMs.get(cursor.getTime())) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    const artistTop = [...artists.values()].sort((a, b) => b.ms - a.ms).slice(0, limit);
    const trackByArtist = new Map<string, string>();
    for (const track of tracks.values()) if (track.artwork && !trackByArtist.has(track.artist)) trackByArtist.set(track.artist, track.artwork);
    for (const artist of artistTop) artist.artwork = trackByArtist.get(artist.name) ?? '';

    return {
        totalMs,
        plays: counted,
        tracks: tracks.size,
        artists: new Set([...tracks.values()].map((track) => track.artist)).size,
        bars: list,
        days: starts(from, now, 'day').map((start) => ({ start, ms: dayMs.get(start) ?? 0 })),
        genres: [...genres.values()].sort((a, b) => b.ms - a.ms).slice(0, limit).map((entry) => ({ ...entry, share: genreTotal ? entry.ms / genreTotal : 0 })),
        topArtists: artistTop,
        topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, limit),
        activeDays: [...dayMs.keys()].filter((day) => day >= startOf(from, 'day')).length,
        streak,
        best,
    };
}

/** «12 ч 40 мин», «45 мин», «0 мин» */
export function hoursText(ms: number): string {
    const minutes = Math.round(ms / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
}
