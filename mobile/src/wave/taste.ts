import type { SoundCloud } from '../api/soundcloud';
import type { TasteLibrary, TasteUpload } from '../core/historyTypes';
import { buildTaste } from '../core/tasteModel';
import { trackCredits } from '../core/trackIdentity';
import { trackArtist } from '../core/wavePicks';
import { tasteMaps } from '../core/waveTaste';
import type { TasteMaps, WaveTrack } from '../core/waveTypes';
import type { History } from '../store/history';

// Вкус для подбора: модель из core по журналу прослушиваний (SQLite), отметкам и лайкам с подписками аккаунта.
// Профиль считается не чаще раза в 30 минут; без истории вкус строится по лайкам, так что холодный старт не пустой

const DAY = 86400000;
const HORIZON_DAYS = 365;
const CACHE_MS = 30 * 60000;
const SOURCES_DAYS = 14;

export interface TasteDeps {
    history: Pick<History, 'tastePlays' | 'marks' | 'waveOrigins'>;
    library(user: number): Promise<TasteLibrary | null>;
    now?(): number;
}

export interface Taste {
    /** Вкус аккаунта; null, если модель не посчиталась (подбор тогда идёт перемешиванием) */
    maps(user: number): Promise<TasteMaps | null>;
    /** Профиль устарел: после лайка, отметки или новой порции прослушиваний */
    invalidate(user?: number): void;
}

export function createTaste(deps: TasteDeps): Taste {
    const now = deps.now ?? (() => Date.now());
    const cache = new Map<number, { at: number; maps: TasteMaps | null }>();
    const running = new Map<number, Promise<TasteMaps | null>>();

    async function compute(user: number): Promise<TasteMaps | null> {
        const at = now();
        const [plays, marks, sources, library] = await Promise.all([
            deps.history.tastePlays(user, at - HORIZON_DAYS * DAY),
            deps.history.marks(user),
            // Статистика источников не обязательна: без неё вкус не страдает
            deps.history.waveOrigins(user, at - SOURCES_DAYS * DAY, at).catch(() => []),
            // Лайки не прочитались: вкус только по истории
            deps.library(user).catch((error: unknown) => {
                console.warn('Вкус волны: лайки и подписки не прочитаны', error);
                return null;
            }),
        ]);
        const { profile } = buildTaste(plays, marks, { artists: [], tags: [] }, at, library, sources);
        return tasteMaps(profile);
    }

    return {
        async maps(user) {
            const hit = cache.get(user);
            if (hit && now() - hit.at < CACHE_MS) return hit.maps;
            let job = running.get(user);
            if (!job) {
                job = compute(user)
                    .then((maps) => {
                        cache.set(user, { at: now(), maps });
                        return maps;
                    })
                    .finally(() => running.delete(user));
                running.set(user, job);
            }
            return job;
        },
        invalidate(user) {
            if (user === undefined) cache.clear();
            else cache.delete(user);
        },
    };
}

export function uploadOf(track: WaveTrack): TasteUpload {
    return {
        id: track.id, uploader: trackArtist(track), uploaderName: track.user?.username ?? '', title: track.title ?? '',
        duration: track.full_duration ?? track.duration ?? 0, genre: track.genre ?? '', tags: track.tag_list ?? '', credits: trackCredits(track),
    };
}

const LIKES_FOR_TASTE = 200;

/** Лайки (последние 200, даты у сайта нет) и подписки аккаунта для модели вкуса. Плейлисты в модель пока не входят */
export async function tasteLibraryOf(sc: Pick<SoundCloud, 'likedIds' | 'tracksByIds' | 'followings'>, user: number): Promise<TasteLibrary> {
    const [ids, follows] = await Promise.all([
        sc.likedIds({ limit: LIKES_FOR_TASTE }),
        sc.followings(user, 200).catch(() => []),
    ]);
    const tracks = await sc.tracksByIds(ids.items.slice(0, LIKES_FOR_TASTE));
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return {
        likes: ids.items.slice(0, LIKES_FOR_TASTE).map((id) => ({ id, added: 0, upload: byId.has(id) ? uploadOf(byId.get(id) as WaveTrack) : null })),
        follows: follows.map((user) => user.id),
        playlists: [],
        uploads: [],
    };
}
