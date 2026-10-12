import type { WaveTrack } from '../core/waveTypes';
import type { ApiClient, CallOptions, Query } from './client';

export interface Me {
    id: number;
    username: string;
    permalink: string;
    avatarUrl: string | null;
}

export interface Page<T> {
    items: T[];
    /** Запрос следующей страницы; null, когда страницы кончились */
    next: Query | null;
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Список из ответа: массив как есть или поле collection */
export function listOf(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    const collection = (body as { collection?: unknown } | null)?.collection;
    return Array.isArray(collection) ? collection : [];
}

/** Запрос следующей страницы из next_href. Ключ клиента отбрасывается: его подставит клиент API */
export function nextQueryOf(body: unknown): Query | null {
    const href = (body as { next_href?: unknown } | null)?.next_href;
    if (typeof href !== 'string' || !href) return null;
    try {
        const query: Query = {};
        for (const [key, value] of new URL(href).searchParams) if (key !== 'client_id') query[key] = value;
        return Object.keys(query).length ? query : null;
    } catch {
        return null;
    }
}

/** Трек из ответа сайта: нужен числовой id и вид track (у заготовок без полей вид тоже track) */
export function trackOf(value: unknown): WaveTrack | null {
    const track = value && typeof value === 'object' ? (value as WaveTrack) : null;
    if (!track || !isId(track.id)) return null;
    if (track.kind !== undefined && track.kind !== 'track') return null;
    return track;
}

export function tracksOf(body: unknown): WaveTrack[] {
    return listOf(body).flatMap((entry) => {
        // Лайки и история приходят обёрнутыми: {track: {...}}
        const inner = entry && typeof entry === 'object' && 'track' in entry ? (entry as { track: unknown }).track : entry;
        const track = trackOf(inner);
        return track ? [track] : [];
    });
}

export function idsOf(body: unknown): number[] {
    return listOf(body).filter(isId);
}

export function meOf(body: unknown): Me | null {
    const user = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!user || !isId(user.id)) return null;
    return {
        id: user.id,
        username: typeof user.username === 'string' ? user.username : '',
        permalink: typeof user.permalink === 'string' ? user.permalink : '',
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
    };
}

export interface UserSummary {
    id: number;
    username: string;
    avatarUrl: string | null;
    followers: number;
    trackCount: number;
    city: string;
}

export function userOf(body: unknown): UserSummary | null {
    const user = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!user || !isId(user.id) || (user.kind !== undefined && user.kind !== 'user')) return null;
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    return {
        id: user.id,
        username: typeof user.username === 'string' ? user.username : '',
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
        followers: num(user.followers_count),
        trackCount: num(user.track_count),
        city: typeof user.city === 'string' ? user.city : '',
    };
}

export function usersOf(body: unknown): UserSummary[] {
    return listOf(body).flatMap((entry) => {
        const user = userOf(entry);
        return user ? [user] : [];
    });
}

const BATCH = 50;

export function createSoundCloud(api: ApiClient) {
    return {
        async me(options?: CallOptions): Promise<Me | null> {
            return meOf((await api.call('me', {}, {}, options)).body);
        },

        /** Страница id лайкнутых треков, новые первыми */
        async likedIds(query: Query = { limit: 200 }, options?: CallOptions): Promise<Page<number>> {
            const { body } = await api.call('soundLikesIds', {}, query, options);
            return { items: idsOf(body), next: nextQueryOf(body) };
        },

        /** Полные треки по id пачками по 50, порядок как в запросе; не найденные пропускаются */
        async tracksByIds(ids: number[], options?: CallOptions): Promise<WaveTrack[]> {
            const unique = [...new Set(ids.filter(isId))];
            const parts: number[][] = [];
            for (let i = 0; i < unique.length; i += BATCH) parts.push(unique.slice(i, i + BATCH));
            const found = new Map<number, WaveTrack>();
            const bodies = await Promise.all(parts.map((part) => api.call('trackBatch', {}, { ids: part.join(',') }, options)));
            for (const { body } of bodies) for (const track of tracksOf(body)) found.set(track.id, track);
            return unique.flatMap((id) => (found.has(id) ? [found.get(id) as WaveTrack] : []));
        },

        async searchTracks(q: string, limit = 30, options?: CallOptions): Promise<Page<WaveTrack>> {
            const { body } = await api.call('searchCategory', { category: 'tracks' }, { q, limit }, options);
            return { items: tracksOf(body), next: nextQueryOf(body) };
        },

        async searchUsers(q: string, limit = 20, options?: CallOptions): Promise<UserSummary[]> {
            return usersOf((await api.call('searchCategory', { category: 'users' }, { q, limit }, options)).body);
        },

        async user(id: number, options?: CallOptions): Promise<UserSummary | null> {
            return userOf((await api.call('user', { id }, {}, options)).body);
        },

        async userTracks(id: number, limit = 20, options?: CallOptions): Promise<WaveTrack[]> {
            return tracksOf((await api.call('userTracks', { id }, { limit }, options)).body);
        },

        async userToptracks(id: number, limit = 10, options?: CallOptions): Promise<WaveTrack[]> {
            return tracksOf((await api.call('userToptracks', { id }, { limit }, options)).body);
        },

        /** Недавно слушанное: новые первыми, без повторов */
        async history(limit = 50, options?: CallOptions): Promise<WaveTrack[]> {
            const { body } = await api.call('playHistoryTracks', {}, { limit }, options);
            const seen = new Set<number>();
            return tracksOf(body).filter((track) => !seen.has(track.id) && !!seen.add(track.id));
        },

        async relatedTracks(trackId: number, limit = 50, options?: CallOptions): Promise<WaveTrack[]> {
            return tracksOf((await api.call('relatedSounds', { track_id: trackId }, { limit }, options)).body);
        },

        /** Ссылка сайта в объект: трек, плейлист или аккаунт */
        async resolve(url: string, options?: CallOptions): Promise<unknown> {
            return (await api.call('resolve', {}, { url }, options)).body;
        },
    };
}

export type SoundCloud = ReturnType<typeof createSoundCloud>;
