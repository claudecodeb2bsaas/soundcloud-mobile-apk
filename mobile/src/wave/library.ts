import type { PlaylistInfo, SoundCloud } from '../api/soundcloud';
import { isLibraryMode, isLibrarySource, isMyMusicSetting, libraryOrder, libraryPool, type LibraryMode, type MyMusicSetting } from '../core/libraryMix';
import { copyKey, copyKeys } from '../core/trackIdentity';
import { trackArtist } from '../core/wavePicks';
import type { WaveTrack } from '../core/waveTypes';
import type { WaveExclusions, WaveSeed } from './engine';
import type { TextStore } from './marks';

// «Моя музыка»: свои лайки и плейлисты целиком, три режима порядка. Выбор источников и режим хранятся на телефоне
// по аккаунтам. Сам пул собирается по запросу и живёт 10 минут; играет его волна как seed {kind: 'library'}.

export interface LibrarySource {
    /** 'likes' или 'playlist:<id>' */
    key: string;
    title: string;
    count: number;
}

export interface LibraryView {
    mode: LibraryMode;
    pick: string[];
}

export interface LibraryDeps {
    sc: Pick<SoundCloud, 'likedIds' | 'tracksByIds' | 'playlist' | 'ownPlaylists' | 'savedPlaylistIds'>;
    userId(): number | null;
    /** Слышанное за 3 дня: в перемешанных режимах оно уходит в конец */
    heard(): Promise<Set<number>>;
    excluded?(): WaveExclusions;
    settings: TextStore;
    now?(): number;
    random?(): number;
}

export interface Library {
    getView(): LibraryView;
    subscribe(listener: () => void): () => void;
    toggleSource(key: string): void;
    setMode(mode: LibraryMode): void;
    /** Лайки и плейлисты аккаунта для выбора; живёт 10 минут */
    sources(): Promise<LibrarySource[]>;
    /** Волна от выбранного: пул в порядке режима. Выбор пустой или треков нет: ошибка с понятным текстом */
    seed(titles: { likes: string }): Promise<Extract<WaveSeed, { kind: 'library' }>>;
}

const TTL = 10 * 60000;
// ponytail: лайки до 1000 свежих (5 страниц id по 200), плейлист до 500 треков; больше телефон не собирает
const LIKES_LIMIT = 1000;
const PLAYLIST_LIMIT = 500;

export function parseSetting(text: string | null): MyMusicSetting {
    try {
        const value: unknown = JSON.parse(text ?? 'null');
        if (isMyMusicSetting(value)) return value;
    } catch {
        // испорченное хранилище: начинаем с лайков
    }
    return { mode: 'shuffle', pick: {} };
}

export function createLibrary(deps: LibraryDeps): Library {
    const now = deps.now ?? (() => Date.now());
    const random = deps.random ?? Math.random;
    let setting = parseSetting(deps.settings.get());
    const listeners = new Set<() => void>();
    let view: LibraryView = { mode: setting.mode, pick: [] };
    let sourcesCache: { at: number; user: number; list: LibrarySource[] } | null = null;
    const playlists = new Map<number, { at: number; title: string; tracks: WaveTrack[] }>();

    const user = (): number => deps.userId() ?? 0;
    const pickOf = (): string[] => setting.pick[String(user())] ?? ['likes'];
    const publish = (): void => {
        view = { mode: setting.mode, pick: pickOf() };
        for (const listener of [...listeners]) listener();
    };
    view = { mode: setting.mode, pick: pickOf() };

    function save(next: MyMusicSetting): void {
        setting = next;
        try {
            deps.settings.set(JSON.stringify(setting));
        } catch (error) {
            console.warn('Моя музыка: выбор не сохранён', error);
        }
        publish();
    }

    // Плейлист целиком по порядку сайта: полные треки из ответа, остальные добираются пачками
    async function playlistTracks(id: number): Promise<{ title: string; tracks: WaveTrack[] }> {
        const hit = playlists.get(id);
        if (hit && now() - hit.at < TTL) return hit;
        const info: PlaylistInfo | null = await deps.sc.playlist(id);
        if (!info) throw new Error('Плейлист не найден');
        const ids = info.ids.slice(0, PLAYLIST_LIMIT);
        const full = new Map(info.tracks.map((track) => [track.id, track]));
        const missing = ids.filter((trackId) => !full.has(trackId));
        for (const track of missing.length ? await deps.sc.tracksByIds(missing) : []) full.set(track.id, track);
        const loaded = { at: now(), title: info.title, tracks: ids.flatMap((trackId) => full.get(trackId) ?? []) };
        playlists.set(id, loaded);
        return loaded;
    }

    const keeps = (track: WaveTrack): boolean => {
        const marks = deps.excluded?.();
        return (
            (track.kind === undefined || track.kind === 'track') && track.streamable !== false && track.policy !== 'SNIP' && track.policy !== 'BLOCK' &&
            !marks?.tracks.has(track.id) && !marks?.artists.has(trackArtist(track))
        );
    };

    return {
        getView: () => view,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        toggleSource(key) {
            if (!isLibrarySource(key) || !user()) return;
            const list = pickOf();
            const next = list.includes(key) ? list.filter((item) => item !== key) : [...list, key].slice(0, 100);
            // В настройке не больше 20 аккаунтов, самые старые уходят
            const others = Object.entries(setting.pick).filter(([id]) => id !== String(user())).slice(-19);
            save({ mode: setting.mode, pick: { ...Object.fromEntries(others), [String(user())]: next } });
        },

        setMode(mode) {
            if (isLibraryMode(mode) && mode !== setting.mode) save({ mode, pick: setting.pick });
        },

        async sources() {
            const id = user();
            if (sourcesCache && sourcesCache.user === id && now() - sourcesCache.at < TTL) return sourcesCache.list;
            if (!id) return [];
            const [own, saved, liked] = await Promise.all([deps.sc.ownPlaylists(id), deps.sc.savedPlaylistIds(), deps.sc.likedIds({ limit: 200 })]);
            const list: LibrarySource[] = [{ key: 'likes', title: '', count: liked.items.length }];
            const seen = new Set<number>();
            for (const playlist of own) {
                seen.add(playlist.id);
                list.push({ key: 'playlist:' + playlist.id, title: playlist.title || '…', count: playlist.count });
            }
            // Сохранённые по одному, не больше четырёх запросов разом; удалённый или закрытый в выбор не попадает
            const rest = saved.filter((playlistId) => !seen.has(playlistId)).slice(0, 50);
            const infos = new Array<PlaylistInfo | null>(rest.length).fill(null);
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(4, rest.length) }, async () => {
                while (cursor < rest.length) {
                    const at = cursor++;
                    infos[at] = await deps.sc.playlist(rest[at]).catch(() => null);
                }
            }));
            for (const info of infos) if (info) list.push({ key: 'playlist:' + info.id, title: info.title || '…', count: info.count });
            sourcesCache = { at: now(), user: id, list };
            return list;
        },

        async seed(titles) {
            const pick = pickOf();
            if (!pick.length) throw new Error('Не выбрано ни одного источника');
            const sources: Array<{ key: string; name: string; tracks: WaveTrack[] }> = [];
            const names: string[] = [];
            for (const key of pick) {
                if (key === 'likes') {
                    let query: Parameters<typeof deps.sc.likedIds>[0] = { limit: 200 };
                    const ids: number[] = [];
                    for (let page = 0; query && ids.length < LIKES_LIMIT; page++) {
                        const loaded = await deps.sc.likedIds(query);
                        ids.push(...loaded.items);
                        query = loaded.next ?? undefined;
                    }
                    sources.push({ key, name: '', tracks: await deps.sc.tracksByIds(ids.slice(0, LIKES_LIMIT)) });
                    names.push(titles.likes);
                    continue;
                }
                const loaded = await playlistTracks(Number(key.slice('playlist:'.length)));
                sources.push({ key, name: loaded.title || '…', tracks: loaded.tracks });
                names.push(loaded.title || '…');
            }
            const pool = libraryPool(sources, keeps, copyKeys, copyKey, trackArtist);
            if (!pool.length) throw new Error('В выбранном нет треков, которые можно сыграть');
            const heard = setting.mode === 'order' ? new Set<number>() : await deps.heard().catch(() => new Set<number>());
            const ordered = libraryOrder(pool, setting.mode, trackArtist, (track) => heard.has(track.id), random);
            const label = names.length < 3 ? names.join(' и ') : `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}`;
            return {
                kind: 'library',
                title: label,
                own: ordered.map((entry) => ({ track: entry.track, from: entry.from })),
                order: setting.mode === 'smart' ? 'smart' : 'fixed',
                seeds: pool.map((entry) => entry.track),
            };
        },
    };
}
