import type { TrackCredit } from './trackIdentity';

// Типы и константы истории прослушиваний из desktop-файлов historyIndex, recommendStore и waveExclusions, нужные модели вкуса.
// Здесь только то, что читает buildTaste; хранилище это src/store/history.ts

/** Прослушивание считается от 30 секунд звука */
export const COUNTED_MS = 30000;
/** Меньше секунды звука: трек сменили с порога */
export const HEARD_MIN_MS = 1000;

export function localDayStart(at: number): number {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export interface TastePlay {
    at: number;
    id: number;
    artist: number;
    heard: number;
    dur: number;
    end: string;
    source: string;
    likedNow: boolean;
    away: boolean;
    /** Уникальное покрытие сыгранными участками, мс; null, если не считалось */
    covered: number | null;
    /** Кто сменил трек; пусто, если неизвестно */
    endedBy: 'user' | 'auto' | '';
    /** Запущен кликом по самому треку */
    picked: boolean;
    /** Круг повтора: тот же трек сразу после своего конца */
    looped: boolean;
    genre: string;
    tags: string;
    title: string;
    artistName: string;
    artwork: string;
    path: string;
}

/** Исход треков волны по исходной причине за период: ключ, дослушано, ранних пропусков */
export interface WaveSlice {
    key: string;
    done: number;
    early: number;
}

export interface TasteUpload {
    id: number;
    uploader: number;
    uploaderName: string;
    title: string;
    duration: number;
    genre: string;
    tags: string;
    credits: TrackCredit[];
}

export interface TasteLibrary {
    /** Лайки сайта, новые сверху; added 0, если дата неизвестна. upload null, если загрузка не сохранилась */
    likes: Array<{ id: number; added: number; upload: TasteUpload | null }>;
    /** Подписки: id аккаунтов */
    follows: number[];
    /** Треки своих (own) и сохранённых плейлистов, без повторов */
    playlists: Array<{ id: number; own: boolean; upload: TasteUpload | null }>;
    uploads: TasteUpload[];
}

export interface TasteMark {
    id: number;
    /** Загрузчик трека; у отметки аккаунта сам аккаунт */
    artist: number;
    genre: string;
    tags: string;
    at: number;
    /** Без вида это «Больше такого» */
    kind?: 'more' | 'track' | 'artist' | 'later-track' | 'later-artist';
    title?: string;
    name?: string;
}
