// Ссылки и сайт: разбор адресов soundcloud.com, обложка, дослушивание, источник очереди, пауза перед повтором.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts)
import type { WaveLinkKind, WaveTrack } from './waveTypes';

// Ссылка на soundcloud.com в список, карточку или шапку: трек, артист или плейлист (в том числе системный)
export function classifyLink(href: string, base: string): { kind: WaveLinkKind; url: string } | null {
    const reserved = [
        'sets', 'likes', 'tracks', 'albums', 'reposts', 'popular-tracks', 'followers', 'following', 'comments', 'spotlight', 'toptracks',
        'you', 'discover', 'search', 'feed', 'stream', 'upload', 'settings', 'messages', 'notifications', 'charts', 'stations', 'pages',
        'terms-of-use', 'mobile', 'people', 'jobs', 'imprint', 'pro', 'signin', 'logout', 'artists', 'creators', 'tags', 'recommended',
    ];
    let url: URL;
    try {
        url = new URL(href, base);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'soundcloud.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const clean = url.origin + '/' + parts.join('/');
    if (parts.length === 1 && !reserved.includes(parts[0])) return { kind: 'artist', url: clean };
    if (parts.length === 2 && !reserved.includes(parts[0]) && !reserved.includes(parts[1])) return { kind: 'track', url: clean };
    if (parts.length === 3 && parts[1] === 'sets' && (parts[0] === 'discover' || !reserved.includes(parts[0]))) return { kind: 'playlist', url: clean };
    return null;
}

// Жанр по ссылке сайта soundcloud.com/tags/<жанр>: название без кодировки адреса, до 60 знаков; иначе пусто
export function classifyTag(href: string, base: string): string {
    let url: URL;
    try {
        url = new URL(href, base);
    } catch {
        return '';
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'soundcloud.com' || parts.length !== 2 || parts[0] !== 'tags') return '';
    let tag = parts[1];
    try {
        tag = decodeURIComponent(tag);
    } catch {
        return '';
    }
    tag = tag.replace(/\s+/g, ' ').trim();
    return tag.length <= 60 ? tag : '';
}

// Та же форма ссылки, что хранит main: без запроса, хвоста и регистра
export function canonicalUrl(value: string | undefined): string {
    if (!value) return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'soundcloud.com' ? (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase() : '';
    } catch {
        return '';
    }
}

// Путь трека /user/track для журнала; у приватного трека в адресе третьим сегментом секретная ссылка, такой путь не пишется
export function trackPath(value: unknown): string {
    const url = canonicalUrl(typeof value === 'string' ? value : undefined);
    const path = url ? new URL(url).pathname : '';
    return /^\/[a-z0-9_-]+\/[a-z0-9_-]+$/.test(path) ? path : '';
}

/** Пауза перед повтором после failures сбоев подряд: 30 с, 2, 5, 15, дальше 30 мин; без сбоев 0 */
export function retryDelay(failures: number): number {
    const steps = [30000, 120000, 300000, 900000, 1800000];
    return failures > 0 ? steps[Math.min(failures, steps.length) - 1] : 0;
}

export function artworkUrl(track: WaveTrack, size: 't300x300' | 't500x500'): string {
    const url = track.artwork_url || track.user?.avatar_url || '';
    return /^https:\/\//.test(url) ? url.replace(/-large\.(jpg|png)/, '-' + size + '.$1') : '';
}
/** Обложки для коллажа карточки: до четырёх разных */
export function coversOf(tracks: WaveTrack[]): string[] {
    return [...new Set(tracks.map((track) => artworkUrl(track, 't300x300')).filter(Boolean))].slice(0, 4);
}

// Дослушал, если ушёл не раньше чем за 15 секунд до конца
export function playEnd(duration: number, position: number): 'done' | 'skip' {
    return duration > 0 && position >= duration - 15000 ? 'done' : 'skip';
}

// Источник трека не из волны: тип очереди сайта (single, playlist, stream, history...)
export function siteSource(type: unknown): string {
    return 'site' + (typeof type === 'string' && /^[a-z][a-z_-]{0,23}$/i.test(type) ? ':' + type.toLowerCase() : '');
}
