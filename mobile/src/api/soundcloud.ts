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

export interface PlaylistInfo {
    id: number;
    title: string;
    count: number;
    /** Все id по порядку сайта; треки в ответе приходят полными только у первых, остальные заготовки */
    ids: number[];
    /** Полные треки из ответа (заготовки без названия сюда не входят) */
    tracks: WaveTrack[];
    artwork?: string | null;
    owner?: string;
}

export function playlistOf(body: unknown): PlaylistInfo | null {
    const item = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!item || !isId(item.id)) return null;
    const raw = Array.isArray(item.tracks) ? item.tracks : [];
    const ids = [...new Set(raw.map((track: unknown) => (track as { id?: unknown } | null)?.id).filter(isId))];
    const tracks = tracksOf(raw).filter((track) => typeof track.title === 'string');
    return {
        id: item.id,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        count: typeof item.track_count === 'number' ? item.track_count : ids.length,
        ids,
        tracks,
        artwork: typeof item.artwork_url === 'string' ? item.artwork_url : null,
        owner: typeof (item.user as { username?: unknown } | null)?.username === 'string' ? (item.user as { username: string }).username : '',
    };
}

/** Чарты сайта: подборки по странам (Music Charts US/UK), в каждой плейлисты по жанрам. Состав плейлиста грузится отдельно */
export function chartsOf(body: unknown): Array<{ title: string; lists: PlaylistInfo[] }> {
    return listOf(body).flatMap((entry) => {
        const selection = entry && typeof entry === 'object' ? (entry as { title?: unknown; items?: unknown }) : null;
        const lists = listOf(selection?.items).flatMap((item) => playlistOf(item) ?? []);
        return lists.length ? [{ title: typeof selection?.title === 'string' ? selection.title : '', lists }] : [];
    });
}

const BATCH = 50;

export function createSoundCloud(api: ApiClient) {
    const sc = {
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

        /** На кого подписан аккаунт (первая страница) */
        async followings(id: number, limit = 200, options?: CallOptions): Promise<UserSummary[]> {
            return usersOf((await api.call('userFollowings', { id }, { limit }, options)).body);
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

        async playlist(id: number, options?: CallOptions): Promise<PlaylistInfo | null> {
            return playlistOf((await api.call('playlist', { id }, {}, options)).body);
        },

        /** Плейлист со всеми треками по порядку сайта (до limit): в ответе полные только первые, остальные добираются пачками */
        async playlistTracks(id: number, limit = 500, options?: CallOptions): Promise<{ info: PlaylistInfo; tracks: WaveTrack[] } | null> {
            const info = await sc.playlist(id, options);
            if (!info) return null;
            const ids = info.ids.slice(0, limit);
            const full = new Map(info.tracks.map((track) => [track.id, track]));
            const missing = ids.filter((trackId) => !full.has(trackId));
            for (const track of missing.length ? await sc.tracksByIds(missing, options) : []) full.set(track.id, track);
            return { info, tracks: ids.flatMap((trackId) => full.get(trackId) ?? []) };
        },

        /** Лайки с полными треками, свежие первыми: страницы id по 200, пока не наберётся limit */
        async likedTracks(limit = 1000, options?: CallOptions): Promise<WaveTrack[]> {
            const ids: number[] = [];
            let query: Query | null = { limit: 200 };
            for (let page = 0; query && ids.length < limit; page++) {
                const loaded = await sc.likedIds(query, options);
                ids.push(...loaded.items);
                query = loaded.next;
            }
            return sc.tracksByIds(ids.slice(0, limit), options);
        },

        async charts(options?: CallOptions): Promise<Array<{ title: string; lists: PlaylistInfo[] }>> {
            return chartsOf((await api.call('chartSelections', {}, { limit: 20 }, options)).body);
        },

        /** Плейлисты аккаунта без альбомов (до 500) */
        async ownPlaylists(userId: number, options?: CallOptions): Promise<PlaylistInfo[]> {
            const lists: PlaylistInfo[] = [];
            let query: Query | null = { limit: 50 };
            for (let page = 0; query && page < 10; page++) {
                const { body } = await api.call('userPlaylistsWithoutAlbums', { id: userId }, query, options);
                for (const entry of listOf(body)) {
                    const list = playlistOf(entry);
                    if (list) lists.push(list);
                }
                query = nextQueryOf(body);
            }
            return lists;
        },

        /** Id сохранённых (лайкнутых) плейлистов, в том числе альбомов (до 1000) */
        async savedPlaylistIds(options?: CallOptions): Promise<number[]> {
            const ids: number[] = [];
            let query: Query | null = { limit: 200 };
            for (let page = 0; query && page < 5; page++) {
                const { body } = await api.call('playlistLikesIds', {}, query, options);
                for (const value of listOf(body)) {
                    const id = typeof value === 'number' ? value : (value as { id?: unknown } | null)?.id;
                    if (isId(id) && !ids.includes(id)) ids.push(id);
                }
                query = nextQueryOf(body);
            }
            return ids;
        },

        /** Поставить или снять лайк трека; без входа или с чужим user_id сайт ответит 401/403 */
        async setLike(userId: number, trackId: number, liked: boolean, options?: CallOptions): Promise<void> {
            const call = { ...options, method: liked ? 'PUT' : 'DELETE' } as const;
            try {
                await api.call('trackLike', { user_id: userId, track_id: trackId }, {}, call);
            } catch (error) {
                const status = (error as { status?: number } | null)?.status;
                if (status !== 401 && status !== 403 && status !== 404) throw error;
                await api.call('meTrackLike', { track_id: trackId }, {}, call);
            }
        },

        /** Страница жанра: свежие загрузки по метке (recent) или поиск по жанру и меткам (search); query это next прошлой страницы */
        async genrePage(source: 'recent' | 'search', tag: string, query?: Query, options?: CallOptions): Promise<Page<WaveTrack>> {
            const { body } =
                source === 'recent'
                    ? await api.call('recentTracks', { tag }, query ?? { limit: 50 }, options)
                    : await api.call('searchCategory', { category: 'tracks' }, query ?? { q: '*', 'filter.genre_or_tag': tag, limit: 50 }, options);
            return { items: tracksOf(body), next: nextQueryOf(body) };
        },

        async relatedTracks(trackId: number, limit = 50, options?: CallOptions): Promise<WaveTrack[]> {
            return tracksOf((await api.call('relatedSounds', { track_id: trackId }, { limit }, options)).body);
        },

        /** Ссылка сайта в объект: трек, плейлист или аккаунт */
        async resolve(url: string, options?: CallOptions): Promise<unknown> {
            return (await api.call('resolve', {}, { url }, options)).body;
        },
    };
    return sc;
}

export type SoundCloud = ReturnType<typeof createSoundCloud>;
