import type { Page } from '../api/soundcloud';
import type { Query } from '../api/client';
import { copyKey, copyKeys, familyKey } from '../core/trackIdentity';
import { genreEnglish, genreKeys, genreKeysFor, parseGenres, trackMatchesGenre } from '../core/waveGenres';
import { acceptCandidate, artistNames, isNewArtist, pickSpaced, shuffleInPlace, spacingGap, spacingKeys, trackArtist } from '../core/wavePicks';
import type { WaveCandidate, WaveFilter, WaveMode, WaveReason, WaveTrack } from '../core/waveTypes';

// Ядро «Моей волны» для телефона: сколько нужно найти, берёт зёрна из истории и лайков (или трек/артиста, выбранного
// руками), ищет похожее и страницы жанра, отбирает фильтрами из core и отдаёт пачками с разнесёнными артистами.
// Вкус и история в SQLite придут в этапе 6: пока найденное тасуется. Сеть и хранилище приходят снаружи (WaveApi).

export interface WaveApi {
    history(): Promise<WaveTrack[]>;
    /** ids это все известные id лайков (свежие первыми), tracks это полные свежие лайки для зёрен */
    likes(): Promise<{ ids: number[]; tracks: WaveTrack[] }>;
    related(id: number): Promise<WaveTrack[]>;
    /** Лучшие треки аккаунта */
    artistTop(id: number): Promise<WaveTrack[]>;
    genrePage(source: 'recent' | 'search', tag: string, query?: Query): Promise<Page<WaveTrack>>;
}

export type WaveSeed = { kind: 'track'; track: WaveTrack } | { kind: 'artist'; id: number; name: string };

export interface WaveExclusions {
    tracks: ReadonlySet<number>;
    artists: ReadonlySet<number>;
}

export interface WaveOptions {
    mode: WaveMode;
    /** Жанры через запятую или слэш; пусто или null: любой */
    genre?: string | null;
    seed?: WaveSeed;
    /** «Не нравится» и скрытые артисты; читается при каждом проходе */
    excluded?(): WaveExclusions;
}

export interface Wave {
    /** До count новых треков; пустой список значит, что найти больше нечего. Вызовы идут по очереди */
    next(count: number): Promise<WaveCandidate[]>;
}

const SEEDS_PER_ROUND = 3;
const ROUNDS = 4;
const HISTORY_RECENT = 200;

const title = (track: WaveTrack): string => (track.title ?? '').trim() || '…';
export function createWave(api: WaveApi, options: WaveOptions): Wave {
    const { mode, seed } = options;
    const tags = !seed && options.genre ? parseGenres(options.genre) : [];
    const keys = tags.length ? genreKeysFor(options.genre ?? null) : [];

    let profile: Promise<{ history: WaveTrack[]; liked: Set<number>; likedTracks: WaveTrack[]; knownIds: Set<number>; knownNames: Set<string> }> | null = null;
    let pool: WaveCandidate[] = [];
    const own: WaveCandidate[] = [];
    let seedTracks: WaveTrack[] = seed?.kind === 'track' ? [seed.track] : [];
    const derived: WaveTrack[] = [];
    const taken = new Set<number>(seed?.kind === 'track' ? [seed.track.id] : []);
    const usedSeeds = new Set<number>();
    const signatures = new Set<string>();
    const families = new Set<string>();
    const cursors = new Map<string, { query?: Query; done: boolean }>();
    const recentKeys: string[][] = [];
    let ownAdded = false;
    let fallbackDone = false;
    let exhausted = false;
    let queue: Promise<unknown> = Promise.resolve();

    function load() {
        profile ??= (async () => {
            const [history, likes] = await Promise.allSettled([api.history(), api.likes()]);
            if (history.status === 'rejected' && likes.status === 'rejected') throw history.reason;
            const past = history.status === 'fulfilled' ? history.value.slice(0, HISTORY_RECENT) : [];
            const liked = likes.status === 'fulfilled' ? likes.value : { ids: [], tracks: [] };
            const known = [...past, ...liked.tracks];
            return {
                history: past, liked: new Set(liked.ids), likedTracks: liked.tracks,
                knownIds: new Set(known.map(trackArtist)), knownNames: artistNames(known),
            };
        })().catch((error: unknown) => {
            profile = null;
            throw error;
        });
        return profile;
    }

    async function filterOf(): Promise<WaveFilter> {
        const p = await load();
        const marks = options.excluded?.();
        const recent = new Set(p.history.map((track) => track.id));
        return {
            mode, taken, recent, heard: recent, liked: p.liked, skipped: new Set(),
            excludedTracks: new Set(marks?.tracks), excludedArtists: new Set(marks?.artists), excludedFamilies: new Map(),
        };
    }

    // Один проход подбора может принять трек только раз: копия на другом канале и другая версия той же песни отсекаются
    function accept(list: WaveCandidate[], candidate: WaveCandidate, filter: WaveFilter, ownList = false): boolean {
        const track = candidate.track;
        if (!acceptCandidate(track, filter) || signatures.has(copyKey(track))) return false;
        const family = ownList ? '' : familyKey(track);
        if (family && families.has(family)) return false;
        if (family) families.add(family);
        for (const key of copyKeys(track)) signatures.add(key);
        taken.add(track.id);
        list.push(candidate);
        return true;
    }

    async function seedList(): Promise<WaveTrack[]> {
        const p = await load();
        const marks = options.excluded?.();
        const mixed: WaveTrack[] = [];
        if (seed) mixed.push(...seedTracks, ...derived);
        else {
            const history = shuffleInPlace(p.history.slice());
            const likes = shuffleInPlace(p.likedTracks.slice());
            for (let i = 0; i < Math.max(history.length, likes.length); i++) {
                if (history[i]) mixed.push(history[i]);
                if (likes[i]) mixed.push(likes[i]);
            }
        }
        const seen = new Set<number>();
        const eligible = mixed.filter((track) => {
            if (seen.has(track.id) || usedSeeds.has(track.id)) return false;
            // Руками выбранный трек остаётся зерном, даже если его артист скрыт
            if (!seed && (marks?.tracks.has(track.id) || marks?.artists.has(trackArtist(track)))) return false;
            seen.add(track.id);
            return true;
        });
        if (seed || !keys.length) return eligible;
        const strict = eligible.filter((track) => trackMatchesGenre(track, keys, true));
        return strict.length ? strict : eligible.filter((track) => trackMatchesGenre(track, keys));
    }

    const pagesLeft = (): boolean => tags.some((tag) => (['recent', 'search'] as const).some((source) => !cursors.get(source + ':' + genreEnglish(tag))?.done));

    async function round(): Promise<number> {
        const p = await load();
        const filter = await filterOf();
        const found: WaveCandidate[] = [];

        if (seed?.kind === 'artist' && !ownAdded) {
            const top = await api.artistTop(seed.id);
            ownAdded = true;
            seedTracks = top;
            // Лучшее артиста идёт первым и играет, даже если недавно слушалось
            const ownFilter: WaveFilter = { ...filter, recent: new Set(), excludedArtists: new Set() };
            for (const track of top) accept(own, { track, reason: { kind: 'artistTrack', artist: seed.name } }, ownFilter, true);
        }

        const listed = await seedList();
        const picked: WaveTrack[] = [];
        if (seed) picked.push(...listed.slice(0, SEEDS_PER_ROUND));
        else {
            // Одно зерно на артиста за проход: любимый артист иначе засеет все три
            const artists = new Set<number>();
            for (const track of listed.slice(0, 12)) {
                if (picked.length >= SEEDS_PER_ROUND) break;
                if (artists.has(trackArtist(track))) continue;
                artists.add(trackArtist(track));
                picked.push(track);
            }
            for (const track of listed) if (picked.length < SEEDS_PER_ROUND && !picked.includes(track)) picked.push(track);
        }
        for (const track of picked) usedSeeds.add(track.id);

        let failures = 0;
        const take = (track: WaveTrack, from: WaveTrack): void => {
            if (!trackMatchesGenre(track, keys)) return;
            const matched = tags.find((tag) => trackMatchesGenre(track, genreKeys(tag)));
            const reason: WaveReason = matched
                ? { kind: 'genreSimilar', genre: matched, seed: title(from) }
                : mode === 'fresh' && isNewArtist(track, p.knownIds, p.knownNames)
                    ? { kind: 'newArtist' }
                    : { kind: mode === 'fresh' ? 'fresh' : 'similar', seed: title(from) };
            if (accept(found, { track, reason }, filter) && seed && derived.length < 100) derived.push(track);
        };
        const tasks: Promise<void>[] = picked.map((from) =>
            api.related(from.id).then((list) => { for (const track of list) take(track, from); }, (error: unknown) => {
                failures++;
                usedSeeds.delete(from.id);
                console.warn('Волна: похожие не загружены', error);
            }));
        for (const tag of tags)
            for (const source of ['recent', 'search'] as const) {
                const cursorKey = source + ':' + genreEnglish(tag);
                const cursor = cursors.get(cursorKey) ?? { done: false };
                if (cursor.done) continue;
                tasks.push(api.genrePage(source, genreEnglish(tag), cursor.query).then((page) => {
                    cursors.set(cursorKey, { query: page.next ?? undefined, done: !page.next });
                    for (const track of page.items)
                        accept(found, { track, reason: { kind: source === 'recent' ? 'genreFresh' : 'genrePopular', genre: tag } }, filter);
                }, (error: unknown) => { failures++; console.warn('Волна: жанр не загружен', error); }));
            }
        await Promise.all(tasks);

        // У трека почти без похожих волна идёт по другим трекам его артиста, один раз
        if (seed?.kind === 'track' && found.length < 3 && !fallbackDone) {
            fallbackDone = true;
            const artist = trackArtist(seed.track);
            if (artist)
                try {
                    for (const track of await api.artistTop(artist))
                        accept(found, { track, reason: { kind: 'artistTrack', artist: seed.track.user?.username ?? '' } }, filter);
                } catch (error) {
                    console.warn('Волна: треки артиста не загружены', error);
                }
        }

        if (tasks.length && failures === tasks.length && !found.length) throw new Error('Источники волны не ответили');
        pool.push(...shuffleInPlace(found));
        if (!found.length && !(await seedList()).length && !pagesLeft()) exhausted = true;
        return found.length;
    }

    function takeFromPool(count: number): WaveCandidate[] {
        const picked: WaveCandidate[] = [];
        const gap = spacingGap(pool);
        while (picked.length < count && (own.length || pool.length)) {
            const item = own.length ? own.shift() : pickSpaced(pool, 1, recentKeys, gap)[0];
            if (!item) break;
            pool = pool.filter((entry) => entry !== item);
            picked.push(item);
            recentKeys.push(spacingKeys(item.track));
            if (recentKeys.length > 6) recentKeys.shift();
        }
        return picked;
    }

    async function next(count: number): Promise<WaveCandidate[]> {
        for (let i = 0; i < ROUNDS && pool.length + own.length < count && !exhausted; i++) {
            try {
                await round();
            } catch (error) {
                // Часть пачки уже есть: отдаём её, ошибка повторится на следующем вызове
                if (!pool.length && !own.length) throw error;
                break;
            }
        }
        return takeFromPool(count);
    }

    return {
        next(count) {
            // Вызовы по очереди: два одновременных не разделят зёрна и пул
            const run = queue.catch(() => undefined).then(() => next(count));
            queue = run;
            return run;
        },
    };
}
