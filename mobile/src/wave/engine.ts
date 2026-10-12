import type { Query } from '../api/client';
import type { Page } from '../api/soundcloud';
import { copyKey, copyKeys, familyKey } from '../core/trackIdentity';
import { genreEnglish, genreKeys, genreKeysFor, parseGenres, tagShares, trackLang, trackMatchesGenre } from '../core/waveGenres';
import { artistMoods, moodDictionary, moodScore, neighborMood, trackMood, type ArtistMoods, type MoodScores, type WaveMood } from '../core/waveMood';
import { acceptCandidate, artistNames, freshEnough, isNewArtist, pickSpaced, shuffleInPlace, spacingGap, spacingKeys, trackArtist } from '../core/wavePicks';
import { applyTasteReasons, sourceBias, tasteForTime, tasteOrder, tasteScore } from '../core/waveTaste';
import type { SourcesSection, ScMix } from '../core/wave/sources';
import { interleaveMixes } from '../core/wave/sources';
import type { TasteMaps, WaveCandidate, WaveFilter, WaveMode, WaveReason, WaveTrack } from '../core/waveTypes';

// Ядро «Моей волны» для телефона. Берёт зёрна из истории и лайков (или трек, артиста, «Мою музыку», выбранные руками),
// ищет похожее, станцию трека, подборки SoundCloud, треки похожих артистов, находки соседей по вкусу и страницы жанра
// и настроения; отбирает фильтрами из core, ставит по вкусу и отдаёт пачками с разнесёнными артистами.
// Сеть, вкус и журнал приходят снаружи (WaveApi), поэтому всё проверяется без устройства.

export interface WaveApi {
    history(): Promise<WaveTrack[]>;
    /** ids это все известные id лайков (свежие первыми), tracks это полные свежие лайки для зёрен */
    likes(): Promise<{ ids: number[]; tracks: WaveTrack[] }>;
    related(id: number): Promise<WaveTrack[]>;
    /** Лучшие треки аккаунта */
    artistTop(id: number): Promise<WaveTrack[]>;
    genrePage(source: 'recent' | 'search', tag: string, query?: Query): Promise<Page<WaveTrack>>;
    /** Вкус по журналу и лайкам; null или отсутствие: подбор идёт перемешиванием */
    taste?(): Promise<TasteMaps | null>;
    /** Станция трека: системный плейлист, из него сайт берёт свой автоплей */
    station?(id: number): Promise<WaveTrack[]>;
    /** Дослушанное за последний час, новые первыми: волна начинается с него */
    recentDone?(): Promise<WaveTrack[]>;
    /** Похожие артисты, подборки SoundCloud и соседи по вкусу (core/wave/sources) */
    sources?: Pick<SourcesSection, 'relatedArtists' | 'topTracks' | 'scMixes' | 'tracksByIds' | 'neighbors'>;
}

export type LibraryOrder = 'fixed' | 'smart';
export type WaveSeed =
    | { kind: 'track'; track: WaveTrack }
    | { kind: 'artist'; id: number; name: string }
    /** «Моя музыка»: own это пул в порядке режима (from это название источника), seeds для похожего */
    | { kind: 'library'; title: string; own: Array<{ track: WaveTrack; from: string }>; order: LibraryOrder; seeds: WaveTrack[] };

export interface WaveExclusions {
    tracks: ReadonlySet<number>;
    artists: ReadonlySet<number>;
}

export interface WaveOptions {
    mode: WaveMode;
    /** Жанры через запятую или слэш; пусто или null: любой */
    genre?: string | null;
    /** Настроение: действует только у обычной волны */
    preset?: WaveMood | null;
    seed?: WaveSeed;
    /** «Не нравится» и скрытые артисты; читается при каждом проходе */
    excluded?(): WaveExclusions;
}

export interface Wave {
    /** До count новых треков; пустой список значит, что найти больше нечего. Вызовы идут по очереди */
    next(count: number): Promise<WaveCandidate[]>;
    /** Ранний пропуск (-1) или лайк (1) отданного волной трека: аккаунт, теги и зерно в этой волне ниже или выше */
    feedback(track: WaveTrack, sign: 1 | -1): void;
}

const SEEDS_PER_ROUND = 3;
const ROUNDS = 4;
const HISTORY_RECENT = 200;
const SC_PER_ROUND = 10;
const NEIGHBORS_PER_ROUND = 4;
const MOOD_FIT = 0.5;

const title = (track: WaveTrack): string => (track.title ?? '').trim() || '…';
const EMPTY_TASTE: TasteMaps = {
    version: 0, artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), tracks: new Map(),
    langs: new Map(), contexts: new Map(), sources: new Map(),
};

interface Profile {
    history: WaveTrack[];
    liked: Set<number>;
    likedTracks: WaveTrack[];
    knownIds: Set<number>;
    knownNames: Set<string>;
}

export function createWave(api: WaveApi, options: WaveOptions): Wave {
    const { mode, seed } = options;
    const tags = !seed && options.genre ? parseGenres(options.genre) : [];
    const keys = tags.length ? genreKeysFor(options.genre ?? null) : [];
    // Настроение у волны от трека, артиста и «Моей музыки» своё
    const preset = seed ? null : options.preset ?? null;
    const moodSearch = preset ? moodDictionary()[preset].search : [];

    let profile: Promise<Profile> | null = null;
    let taste: TasteMaps | null = null;
    let tasteBase: TasteMaps | null = null;
    let sourceShift = new Map<string, number>();
    let pool: WaveCandidate[] = [];
    const own: WaveCandidate[] = [];
    let seedTracks: WaveTrack[] = seed?.kind === 'track' ? [seed.track] : seed?.kind === 'library' ? shuffleInPlace(seed.seeds.slice()) : [];
    const derived: WaveTrack[] = [];
    const taken = new Set<number>(seed?.kind === 'track' ? [seed.track.id] : []);
    const usedSeeds = new Set<number>();
    const usedNeighbors = new Set<number>();
    const usedStations = new Set<number>();
    const signatures = new Set<string>();
    const families = new Set<string>();
    const cursors = new Map<string, { query?: Query; done: boolean }>();
    const recentKeys: string[][] = [];
    const given = new Map<number, WaveCandidate>();
    const sessionArtists = new Map<number, number>();
    const sessionTags = new Map<string, number>();
    const sessionSeeds = new Map<number, number>();
    let ownAdded = false;
    let fallbackDone = false;
    let artistNeighborsDone = false;
    let contextPending = true;
    let scQueue: Array<{ id: number; mix: ScMix }> | null = null;
    let neighborQueue: number[] | null = null;
    let favoriteTurn = 0;
    let pickedInGeneration = 0;
    let ownRun = 0;
    let exhausted = false;
    let queue: Promise<unknown> = Promise.resolve();
    let moodReserve: Array<{ candidate: WaveCandidate; score: number }> = [];
    let moodRounds = 0;

    // ---- профиль и вкус ----
    function load(): Promise<Profile> {
        profile ??= (async () => {
            const [history, likes] = await Promise.allSettled([api.history(), api.likes()]);
            if (history.status === 'rejected' && likes.status === 'rejected') throw history.reason;
            const past = history.status === 'fulfilled' ? history.value.slice(0, HISTORY_RECENT) : [];
            const liked = likes.status === 'fulfilled' ? likes.value : { ids: [], tracks: [] };
            const known = [...past, ...liked.tracks];
            // Вкус не загрузился: подбор идёт перемешиванием, следующий проход попробует снова
            if (api.taste) tasteBase = await api.taste().catch(() => null);
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
        const excludedTracks = new Set(marks?.tracks);
        // Подмешанное к своей музыке и похожее после неё новое для библиотеки: лайков там нет
        if (seed?.kind === 'library') for (const id of p.liked) excludedTracks.add(id);
        return {
            mode: seed?.kind === 'library' ? 'similar' : mode, taken, recent, heard: recent, liked: p.liked, skipped: new Set(),
            excludedTracks, excludedArtists: new Set(marks?.artists), excludedFamilies: new Map(),
        };
    }

    const isExcluded = (track: WaveTrack): boolean => {
        const marks = options.excluded?.();
        return !!marks && (marks.tracks.has(track.id) || marks.artists.has(trackArtist(track)));
    };

    // ---- настроение ----
    const moodCache = new Map<number, MoodScores>();
    const moodOf = (track: WaveTrack): MoodScores => {
        let scores = moodCache.get(track.id);
        if (!scores) {
            scores = trackMood(track);
            if (moodCache.size > 5000) moodCache.clear();
            moodCache.set(track.id, scores);
        }
        return scores;
    };
    const moodSample: WaveTrack[] = [];
    const moodSampleIds = new Set<number>();
    let artistMoodMap: Map<number, ArtistMoods> | null = null;
    let artistMoodIds = new Set<number>();
    let profileSample: WaveTrack[] = [];

    function presetScore(track: WaveTrack, neighbors: MoodScores | null): number {
        if (!preset) return 1;
        if (!artistMoodMap) {
            const sample = [...profileSample, ...moodSample];
            artistMoodMap = artistMoods(sample, moodOf);
            artistMoodIds = new Set(sample.map((item) => item.id));
        }
        return moodScore(moodOf(track)[preset], artistMoodMap.get(trackArtist(track)), neighbors?.[preset] ?? 0, preset, artistMoodIds.has(track.id));
    }

    // Найденное делится на подходящее настроению и добивку: ближайшие по настроению, когда подходящего мало
    function splitByMood(found: WaveCandidate[], observed: WaveTrack[], observedBy: Map<number, WaveTrack[]>): WaveCandidate[] {
        for (const track of observed) {
            if (moodSampleIds.has(track.id) || moodSample.length >= 4000) continue;
            moodSampleIds.add(track.id);
            moodSample.push(track);
            artistMoodMap = null;
        }
        const neighbors = new Map<number, MoodScores>();
        const matched: WaveCandidate[] = [];
        for (const candidate of found) {
            const from = candidate.trace?.seed ?? 0;
            let near = neighbors.get(from);
            if (!near) {
                near = neighborMood(from ? observedBy.get(from) ?? [] : [], moodOf);
                neighbors.set(from, near);
            }
            const score = presetScore(candidate.track, near);
            if (score >= MOOD_FIT) matched.push(candidate);
            else moodReserve.push({ candidate, score });
        }
        moodReserve.sort((a, b) => b.score - a.score);
        if (moodReserve.length > 300) moodReserve = moodReserve.slice(0, 300);
        return matched;
    }

    // ---- оценка ----
    function sessionScore(candidate: WaveCandidate): number {
        const track = candidate.track;
        let delta = sessionArtists.get(trackArtist(track)) ?? 0;
        for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) delta += share * (sessionTags.get(key) ?? 0);
        delta += sourceShift.get(candidate.trace?.origin ?? candidate.reason.kind) ?? 0;
        const from = candidate.trace?.seed ?? 0;
        return from ? delta + (sessionSeeds.get(from) ?? 0) : delta;
    }

    function rerankPool(): void {
        if (pool.length > 1) pool = tasteOrder(pool, taste ?? EMPTY_TASTE, Math.random, sessionScore);
    }

    // Уверенный кандидат для мест 1-3 поколения: похожий артист любимого или оценка вкуса с поправкой сессии от 1,5
    function confident(candidate: WaveCandidate): boolean {
        if ((candidate.trace?.origin ?? candidate.reason.kind) === 'relatedArtist') return true;
        return !!taste && tasteScore(candidate.track, taste).score + sessionScore(candidate) >= 1.5;
    }

    // П6: кириллица от артиста, которого вкус не знает, проходит только от похожих артистов, подборок и соседей
    function strangerCyrillic(candidate: WaveCandidate): boolean {
        if (seed || !taste || ['relatedArtist', 'scMix', 'neighbors'].includes(candidate.reason.kind)) return false;
        return trackLang(candidate.track) === 'cyr' && !tasteScore(candidate.track, taste).known;
    }

    // Один проход подбора может принять трек только раз: копия на другом канале и другая версия той же песни отсекаются
    function accept(list: WaveCandidate[], candidate: WaveCandidate, filter: WaveFilter, seedId = 0, ownList = false): boolean {
        const track = candidate.track;
        if (!acceptCandidate(track, filter) || signatures.has(copyKey(track))) return false;
        if (!ownList && strangerCyrillic(candidate)) return false;
        const family = ownList ? '' : familyKey(track);
        if (family && candidate.reason.kind !== 'version' && families.has(family)) return false;
        if (family) families.add(family);
        for (const key of copyKeys(track)) signatures.add(key);
        taken.add(track.id);
        candidate.trace ??= { origin: candidate.reason.kind, seed: seedId, score: null, known: false };
        list.push(candidate);
        return true;
    }

    // ---- зёрна ----
    // Зёрна с весом по вкусу: дослушанное и лайкнутое встаёт вперёд чаще, трек с минусом зерном не становится
    function seedOrder(list: WaveTrack[]): WaveTrack[] {
        const current = taste;
        if (!current) return shuffleInPlace(list);
        return list
            .map((track) => ({ track, weight: current.tracks.get(track.id) ?? 0 }))
            .filter((entry) => entry.weight >= 0)
            .map((entry) => ({ track: entry.track, key: Math.log(Math.max(Math.random(), 1e-12)) / Math.exp(Math.min(3, entry.weight)) }))
            .sort((a, b) => b.key - a.key)
            .map((entry) => entry.track);
    }

    async function seedList(): Promise<WaveTrack[]> {
        const p = await load();
        const mixed: WaveTrack[] = [];
        if (seed) mixed.push(...seedTracks, ...derived);
        else {
            const history = seedOrder(p.history.slice());
            const likes = seedOrder(p.likedTracks.slice());
            for (let i = 0; i < Math.max(history.length, likes.length); i++) {
                if (history[i]) mixed.push(history[i]);
                if (likes[i]) mixed.push(likes[i]);
            }
        }
        const seen = new Set<number>();
        const eligible = mixed.filter((track) => {
            if (seen.has(track.id) || usedSeeds.has(track.id)) return false;
            // Руками выбранный трек остаётся зерном, даже если его артист скрыт
            if (!seed && isExcluded(track)) return false;
            seen.add(track.id);
            return true;
        });
        let list = eligible;
        if (!seed && keys.length) {
            const strict = eligible.filter((track) => trackMatchesGenre(track, keys, true));
            list = strict.length ? strict : eligible.filter((track) => trackMatchesGenre(track, keys));
        }
        // Пресет: зёрна с этим настроением идут первыми
        if (preset) list = [...list.filter((track) => presetScore(track, null) >= MOOD_FIT), ...list.filter((track) => presetScore(track, null) < MOOD_FIT)];
        return list;
    }

    const stationRoots = (): WaveTrack[] => (seed ? [...seedTracks, ...derived].filter((track) => !usedStations.has(track.id) && !isExcluded(track)) : []);
    const pagesLeft = (list: string[]): boolean => list.some((tag) => (['recent', 'search'] as const).some((source) => !cursors.get(source + ':' + genreEnglish(tag))?.done));

    const accountName = (id: number, p: Profile): string => {
        const track = p.history.find((item) => trackArtist(item) === id) ?? p.likedTracks.find((item) => trackArtist(item) === id);
        return (track?.user?.username ?? '').trim();
    };

    // Лучший трек похожего артиста: первый неслышанный из топа, иначе первый из топа
    async function neighborTrack(from: number, p: Profile): Promise<WaveTrack | null> {
        const sources = api.sources;
        if (!sources) return null;
        const near = (await sources.relatedArtists(from)).filter((artist) => !usedNeighbors.has(artist.id) && !options.excluded?.().artists.has(artist.id));
        for (const neighbor of near.slice(0, 3)) {
            usedNeighbors.add(neighbor.id);
            const tops = (await sources.topTracks(neighbor.id)).filter((track) => !isExcluded(track) && !taken.has(track.id) && !usedSeeds.has(track.id));
            const track = tops.find((item) => !p.history.some((past) => past.id === item.id)) ?? tops[0];
            if (track) return track;
        }
        return null;
    }

    // Начало обычной волны: последнее дослушанное за час и лучший трек похожего артиста его автора
    async function contextSeeds(p: Profile): Promise<{ seeds: WaveTrack[]; neighbor: { track: WaveTrack; artist: string } | null }> {
        const done = (await api.recentDone?.().catch(() => [] as WaveTrack[])) ?? [];
        const first = done.find((track) => !isExcluded(track) && !usedSeeds.has(track.id));
        if (!first) return { seeds: [], neighbor: null };
        let neighbor: { track: WaveTrack; artist: string } | null = null;
        const author = trackArtist(first);
        if (author)
            try {
                const track = await neighborTrack(author, p);
                if (track) neighbor = { track, artist: (first.user?.username ?? '').trim() || accountName(author, p) };
            } catch (error) {
                console.warn('Волна: похожие артисты для начала не загружены', error);
            }
        return { seeds: neighbor ? [first, neighbor.track] : [first], neighbor };
    }

    // Зерно за проход из похожего артиста любимого: любимые по весу во вкусе по кругу, по три попытки
    async function favoriteNeighbor(p: Profile): Promise<{ track: WaveTrack; artist: string } | null> {
        const current = taste;
        if (!current) return null;
        const hidden = options.excluded?.().artists;
        const favorites = [...current.artists].filter(([id, weight]) => weight >= 1 && !hidden?.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 20);
        for (let attempt = 0; attempt < Math.min(3, favorites.length); attempt++) {
            const [id] = favorites[favoriteTurn++ % favorites.length];
            const name = accountName(id, p);
            if (!name) continue;
            const track = await neighborTrack(id, p);
            if (track) return { track, artist: name };
        }
        return null;
    }

    // Следующие треки подборок SoundCloud: по 10 за проход вперемешку из всех подборок
    async function scMixCandidates(): Promise<Array<{ track: WaveTrack; mix: ScMix }>> {
        const sources = api.sources;
        if (!sources) return [];
        if (!scQueue) scQueue = interleaveMixes(await sources.scMixes(), ['mix', 'daily', 'weekly', 'liked']);
        const next: Array<{ id: number; mix: ScMix }> = [];
        while (scQueue.length && next.length < SC_PER_ROUND) {
            const entry = scQueue.shift();
            if (entry && !taken.has(entry.id)) next.push(entry);
        }
        if (!next.length) return [];
        const byId = new Map((await sources.tracksByIds(next.map((entry) => entry.id))).map((track) => [track.id, track]));
        return next.flatMap((entry) => {
            const track = byId.get(entry.id);
            return track ? [{ track, mix: entry.mix }] : [];
        });
    }

    // Находки соседей по вкусу: свежие лайки тех, кто лайкает то же нишевое. Кэш и обход фоном делает раздел sources
    async function neighborFinds(p: Profile): Promise<WaveTrack[]> {
        const sources = api.sources;
        if (!sources) return [];
        if (!neighborQueue) {
            const loved = taste ? [...taste.tracks].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id) : [];
            const seeds = [...new Set([...p.likedTracks.map((track) => track.id), ...loved])].slice(0, 150);
            neighborQueue = (await sources.neighbors(seeds, () => { neighborQueue = null; })).map((entry) => entry.id).filter((id) => !p.liked.has(id));
        }
        const ids: number[] = [];
        while (neighborQueue.length && ids.length < NEIGHBORS_PER_ROUND) {
            const id = neighborQueue.shift();
            if (id !== undefined && !taken.has(id)) ids.push(id);
        }
        return ids.length ? sources.tracksByIds(ids) : [];
    }

    // ---- один проход подбора ----
    async function round(): Promise<number> {
        const p = await load();
        const filter = await filterOf();
        const found: WaveCandidate[] = [];
        profileSample = [...p.likedTracks, ...p.history];
        if (tasteBase) {
            taste = tasteForTime(tasteBase, Date.now());
            sourceShift = sourceBias(taste.sources);
        }

        if (seed?.kind === 'artist' && !ownAdded) {
            const top = await api.artistTop(seed.id);
            ownAdded = true;
            seedTracks = top;
            // Лучшее артиста идёт первым и играет, даже если недавно слушалось
            const ownFilter: WaveFilter = { ...filter, recent: new Set(), excludedArtists: new Set() };
            for (const track of top) accept(own, { track, reason: { kind: 'artistTrack', artist: seed.name } }, ownFilter, 0, true);
        }
        if (seed?.kind === 'library' && !ownAdded) {
            ownAdded = true;
            // Пул уже отфильтрован при сборке: слышанное остаётся, свою музыку играем целиком
            for (const entry of seed.own) {
                taken.add(entry.track.id);
                for (const key of copyKeys(entry.track)) signatures.add(key);
                own.push({ track: entry.track, reason: { kind: 'library', name: entry.from }, trace: { origin: 'library', seed: 0, score: null, known: false } });
            }
            if (seed.order === 'fixed' && own.length >= 10) return own.length;
        }

        const listed = await seedList();
        const picked: WaveTrack[] = [];
        const neighbors: Array<{ track: WaveTrack; artist: string }> = [];
        const normal = !seed && !keys.length && !preset;
        if (seed) picked.push(...listed.slice(0, SEEDS_PER_ROUND));
        else {
            // Начало обычной волны: то, что только что дослушано, и лучший трек похожего артиста его автора
            const context = contextPending && normal ? await contextSeeds(p) : { seeds: [], neighbor: null };
            contextPending = false;
            if (context.neighbor) neighbors.push(context.neighbor);
            picked.push(...context.seeds.slice(0, SEEDS_PER_ROUND));
            // Одно зерно на артиста за проход: любимый артист иначе засеет все три
            const artists = new Set(picked.map(trackArtist));
            for (const track of listed.slice(0, 12)) {
                if (picked.length >= SEEDS_PER_ROUND) break;
                if (picked.includes(track) || artists.has(trackArtist(track))) continue;
                artists.add(trackArtist(track));
                picked.push(track);
            }
            for (const track of listed) if (picked.length < SEEDS_PER_ROUND && !picked.includes(track)) picked.push(track);
        }
        for (const track of picked) usedSeeds.add(track.id);

        // Всё, что пришло из похожих и станции, включая отсеянное: по нему считается настроение
        const observed: WaveTrack[] = [];
        const observedBy = new Map<number, WaveTrack[]>();
        let failures = 0;
        const take = (track: WaveTrack, from: WaveTrack, station = false): void => {
            observed.push(track);
            const near = observedBy.get(from.id);
            if (near) near.push(track);
            else observedBy.set(from.id, [track]);
            if (!trackMatchesGenre(track, keys)) return;
            const matched = tags.find((tag) => trackMatchesGenre(track, genreKeys(tag)));
            const reason: WaveReason = matched
                ? { kind: 'genreSimilar', genre: matched, seed: title(from) }
                : mode === 'fresh' && !seed && isNewArtist(track, p.knownIds, p.knownNames)
                    ? { kind: 'newArtist' }
                    : { kind: mode === 'fresh' && seed?.kind !== 'library' ? 'fresh' : 'similar', seed: title(from) };
            const trace: WaveCandidate['trace'] = station ? { origin: 'station', seed: from.id, score: null, known: false } : undefined;
            if (accept(found, { track, reason, trace }, filter, from.id) && seed && derived.length < 100) derived.push(track);
        };
        const similarTo = (from: WaveTrack): Promise<void> =>
            api.related(from.id).then((list) => { for (const track of list) take(track, from); }, (error: unknown) => {
                failures++;
                usedSeeds.delete(from.id);
                console.warn('Волна: похожие не загружены', error);
            });
        const neighborCandidate = (entry: { track: WaveTrack; artist: string }): void => {
            if (trackMatchesGenre(entry.track, keys)) accept(found, { track: entry.track, reason: { kind: 'relatedArtist', artist: entry.artist } }, filter);
        };
        for (const entry of neighbors) neighborCandidate(entry);

        // Сбой считается только у источников, без которых подбор пуст: похожие, жанр и настроение
        let attempts = picked.length;
        const tasks: Promise<void>[] = picked.map(similarTo);
        // Обычная волна без жанра: за проход ещё одно зерно из похожего артиста любимого
        if (!seed && !keys.length)
            tasks.push(favoriteNeighbor(p).then((entry) => {
                if (!entry) return;
                usedSeeds.add(entry.track.id);
                neighborCandidate(entry);
                return similarTo(entry.track);
            }).catch((error: unknown) => console.warn('Волна: похожий артист любимого не загружен', error)));
        // Волна от артиста: лучшее его похожих артистов, по три трека, один раз
        if (seed?.kind === 'artist' && api.sources && !artistNeighborsDone) {
            artistNeighborsDone = true;
            const { id, name } = seed;
            const sources = api.sources;
            tasks.push((async () => {
                const hidden = options.excluded?.().artists;
                const list = (await sources.relatedArtists(id)).filter((artist) => !hidden?.has(artist.id)).slice(0, 8);
                const tops = await Promise.all(list.map((artist) => sources.topTracks(artist.id).catch(() => [] as WaveTrack[])));
                for (const top of tops) for (const track of top.slice(0, 3)) neighborCandidate({ track, artist: name });
            })().catch((error: unknown) => {
                artistNeighborsDone = false;
                console.warn('Волна: похожие артисты не загружены', error);
            }));
        }
        // Обычная волна: подборки SoundCloud и находки соседей по вкусу
        if (!seed) {
            tasks.push(scMixCandidates().then((list) => {
                for (const { track, mix } of list) if (trackMatchesGenre(track, keys)) accept(found, { track, reason: { kind: 'scMix', name: mix.title } }, filter);
            }).catch((error: unknown) => console.warn('Волна: подборки SoundCloud не загружены', error)));
            if (normal)
                tasks.push(neighborFinds(p).then((list) => {
                    for (const track of list) accept(found, { track, reason: { kind: 'neighbors' } }, filter);
                }).catch((error: unknown) => console.warn('Волна: находки соседей не загружены', error)));
        }
        for (const tag of tags)
            for (const source of ['recent', 'search'] as const) {
                const cursorKey = source + ':' + genreEnglish(tag);
                const cursor = cursors.get(cursorKey) ?? { done: false };
                if (cursor.done) continue;
                attempts++;
                tasks.push(api.genrePage(source, genreEnglish(tag), cursor.query).then((page) => {
                    cursors.set(cursorKey, { query: page.next ?? undefined, done: !page.next });
                    for (const track of page.items) {
                        if (source === 'recent' && !freshEnough(track)) continue;
                        accept(found, { track, reason: { kind: source === 'recent' ? 'genreFresh' : 'genrePopular', genre: tag } }, filter);
                    }
                }, (error: unknown) => { failures++; console.warn('Волна: жанр не загружен', error); }));
            }
        // Метки настроения: популярное по каждой, свежее по первой; выбранный жанр действует и здесь
        for (const [index, tag] of moodSearch.entries())
            for (const source of index === 0 ? (['recent', 'search'] as const) : (['search'] as const)) {
                const cursorKey = source + ':' + genreEnglish(tag);
                const cursor = cursors.get(cursorKey) ?? { done: false };
                if (cursor.done) continue;
                attempts++;
                tasks.push(api.genrePage(source, genreEnglish(tag), cursor.query).then((page) => {
                    cursors.set(cursorKey, { query: page.next ?? undefined, done: !page.next });
                    for (const track of page.items) {
                        if ((source === 'recent' && !freshEnough(track)) || !trackMatchesGenre(track, keys)) continue;
                        accept(found, { track, reason: { kind: 'moodTag', tag } }, filter);
                    }
                }, (error: unknown) => { failures++; console.warn('Волна: метка настроения не загружена', error); }));
            }
        await Promise.all(tasks);

        // У маленьких артистов похожие замкнуты на их же треки: тогда волна идёт по станции трека, там десятки других артистов
        const root = api.station && found.length < 3 ? stationRoots()[0] : undefined;
        if (root && api.station) {
            usedStations.add(root.id);
            try {
                for (const track of await api.station(root.id)) take(track, root, true);
            } catch (error) {
                usedStations.delete(root.id);
                console.warn('Волна: станция трека не загружена', error);
            }
        }

        // И станция почти ничего не дала: другие треки артиста трека-зерна
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

        if (attempts && failures === attempts && !found.length) throw new Error('Источники волны не ответили');

        // Пресет: в пул идёт подходящее настроению, остальное ждёт в добивке по убыванию оценки
        const matched = preset ? splitByMood(found, observed, observedBy) : found;
        if (taste) {
            applyTasteReasons(matched, taste);
            pool.push(...tasteOrder(matched, taste, Math.random, sessionScore));
        } else pool.push(...shuffleInPlace(matched));
        if (preset) moodRounds++;
        const sourcesLeft =
            (await seedList()).length > 0 || stationRoots().length > 0 || pagesLeft(tags) || pagesLeft(moodSearch) || (!seed && (scQueue === null || scQueue.length > 0));
        if (!found.length && !sourcesLeft) exhausted = true;
        return found.length;
    }

    // ---- выдача ----
    const reserveReady = (): number => (preset && moodRounds >= 2 ? moodReserve.length : 0);
    const ready = (): number =>
        pool.length +
        (seed?.kind === 'library' && seed.order === 'smart' ? Math.min(own.length, 3 * (pool.length + 1)) : own.length) +
        reserveReady();

    function takeFromPool(count: number): WaveCandidate[] {
        const picked: WaveCandidate[] = [];
        const smart = seed?.kind === 'library' && seed.order === 'smart';
        const gap = spacingGap(pool);
        while (picked.length < count && (own.length || pool.length)) {
            const fromOwn = own.length > 0 && (smart ? !pool.length || ownRun < 3 : true);
            if (smart) ownRun = fromOwn ? ownRun + 1 : 0;
            // Места 1-3 из найденного только уверенные: первые треки после запуска пропускались втрое чаще
            const sure = !fromOwn && pickedInGeneration < 3 ? pool.filter(confident) : [];
            const item = fromOwn ? own.shift() : pickSpaced(sure.length ? sure : pool, 1, recentKeys, gap)[0];
            if (!item) break;
            if (!fromOwn) {
                pool = pool.filter((entry) => entry !== item);
                pickedInGeneration++;
            }
            picked.push(item);
            recentKeys.push(spacingKeys(item.track));
            if (recentKeys.length > 6) recentKeys.shift();
        }
        // Подходящего настроению не хватило: ближайшие по настроению
        while (picked.length < count && preset && moodReserve.length) {
            const next = moodReserve.shift();
            if (!next) break;
            picked.push(next.candidate);
            recentKeys.push(spacingKeys(next.candidate.track));
            if (recentKeys.length > 6) recentKeys.shift();
        }
        for (const item of picked) given.set(item.track.id, item);
        return picked;
    }

    async function next(count: number): Promise<WaveCandidate[]> {
        for (let i = 0; i < ROUNDS && ready() < count && !exhausted; i++) {
            try {
                await round();
            } catch (error) {
                // Часть пачки уже есть: отдаём её, ошибка повторится на следующем вызове
                if (!ready()) throw error;
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
        feedback(track, sign) {
            const candidate = given.get(track.id);
            if (!candidate) return;
            const add = <K>(map: Map<K, number>, key: K, value: number): void => { map.set(key, (map.get(key) ?? 0) + sign * value); };
            const artist = trackArtist(track);
            if (artist) add(sessionArtists, artist, 1);
            for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) add(sessionTags, key, 0.5 * share);
            const from = candidate.trace?.seed ?? 0;
            if (from) add(sessionSeeds, from, 0.5);
            // Впереди стоящее в пуле переставляется по новым поправкам
            rerankPool();
        },
    };
}