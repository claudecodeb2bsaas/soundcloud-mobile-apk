import { COUNTED_MS, HEARD_MIN_MS, type TastePlay } from '../core/historyTypes';
import { genreMain } from '../core/waveGenres';
import { coversOf, retryDelay } from '../core/waveLinks';
import { capPerArtist, daySample, forgottenPicks, isWaveEligible, shuffleInPlace, trackArtist } from '../core/wavePicks';
import { pickFinds, tasteForTime, tasteGroups, tasteOrder, tasteScore, tasteSlot } from '../core/waveTaste';
import { countText, fillText, localDay } from '../core/waveTexts';
import { interleaveMixes, likedOwner, type SourcesSection } from '../core/wave/sources';
import type { TasteMaps, WaveReason, WaveTexts, WaveTrack } from '../core/waveTypes';
import type { WaveExclusions, WaveSeed } from './engine';
import type { TextStore } from './marks';

// Подборки дня («полка» desktop, wave/shelf.ts): находки дня (с лайками соседей по вкусу), «Лайкнули твои артисты»,
// «Давно не слушал», до восьми жанров из вкуса и «Плейлист момента» на шесть часов. Собираются раз в сутки и хранятся
// (номера треков, названия, обложки), состав раскрывается при открытии подборки. Играет подборка волной
// {kind: 'library'}: сначала её треки по порядку, дальше похожее. Не перенесено: «сыграно из Давно не слушал за сутки»
// (П11, повторный запуск начинает с первого), перепроверка соседей после первого обхода без перезапуска.

export interface ShelfCard {
    /** 'daily', 'forgotten', 'liked', 'moment', 'group-<n>' */
    key: string;
    kind: 'daily' | 'forgotten' | 'liked' | 'group' | 'moment';
    title: string;
    sub: string;
    ids: number[];
    /** Зёрна, от которых волна идёт дальше, когда треки подборки кончились */
    seeds: number[];
    /** До четырёх обложек для коллажа */
    art: string[];
    /** «Лайкнули твои артисты»: чей лайк у трека, по порядку ids */
    by: string[];
    /** Находки дня: треки из лайков соседей по вкусу */
    neighbors: number[];
}

interface Saved {
    user: number;
    day: string;
    v: number;
    cards: ShelfCard[];
    moment: { slot: number; card: ShelfCard | null } | null;
}

/** Меняется при смене правил сборки: снимок другого формата собирается заново сразу, а не в полночь */
export const SHELF_FORMAT = 1;
const ARTIST_CAP = 5;
const DAY = 86400000;

export interface Love {
    done: number;
    early: number;
    loops: number;
}

/** Всё, что полка берёт из журнала прослушиваний телефона */
export interface ShelfInputs {
    /** Слышано от 30 секунд за 30 дней */
    recent: number[];
    /** Слышано за последние сутки: плейлист момента их не повторяет */
    today: number[];
    /** Слышано от 30 секунд за 90 дней, с описанием, новые первыми */
    heard: WaveTrack[];
    /** Счётчики любви к трекам за год (П11) */
    love: Map<number, Love>;
    /** Описание тех, у кого есть счётчики */
    loved: WaveTrack[];
}

/** Трек из строки журнала: доступность и обложку перепроверит trackBatch при раскрытии подборки */
export function playedTrack(play: Pick<TastePlay, 'id' | 'artist' | 'title' | 'artistName' | 'genre' | 'tags' | 'path' | 'artwork' | 'dur'>): WaveTrack {
    return {
        id: play.id, kind: 'track', title: play.title, genre: play.genre, tag_list: play.tags, duration: play.dur, full_duration: play.dur,
        user_id: play.artist || undefined, user: { id: play.artist || undefined, username: play.artistName },
        permalink_url: play.path ? 'https://soundcloud.com' + play.path : '', artwork_url: play.artwork || null,
    };
}

/** Дослушано (покрытие от 80%, перемотка в конец не в счёт), ранний пропуск человеком и круг повтора, как trackLove на desktop */
export function shelfInputsOf(plays: TastePlay[], now: number): ShelfInputs {
    const recent = new Set<number>();
    const today = new Set<number>();
    const heard = new Map<number, WaveTrack>();
    const love = new Map<number, Love>();
    const described = new Map<number, WaveTrack>();
    for (let i = plays.length - 1; i >= 0; i--) {
        const play = plays[i];
        if (play.away) continue;
        const age = now - play.at;
        if (play.heard >= COUNTED_MS) {
            if (age <= 30 * DAY) recent.add(play.id);
            if (age <= DAY) today.add(play.id);
            if (age <= 90 * DAY && !heard.has(play.id)) heard.set(play.id, playedTrack(play));
        }
        const entry = love.get(play.id) ?? { done: 0, early: 0, loops: 0 };
        if (play.looped) entry.loops++;
        else if ((play.dur > 0 && Math.min(play.heard, play.covered ?? play.heard) >= play.dur * 0.8) || (play.dur <= 0 && play.end === 'done')) entry.done++;
        else if (play.end === 'skip' && play.endedBy === 'user' && play.heard >= HEARD_MIN_MS && play.heard < COUNTED_MS) entry.early++;
        love.set(play.id, entry);
        if (!described.has(play.id)) described.set(play.id, playedTrack(play));
    }
    for (const [id, entry] of love) if (!entry.done && !entry.early && !entry.loops) love.delete(id);
    return {
        recent: [...recent], today: [...today], heard: [...heard.values()], love,
        loved: [...love.keys()].flatMap((id) => described.get(id) ?? []),
    };
}

export interface ShelfDeps {
    userId(): number | null;
    /** Лайки с полными треками, свежие первыми (до 1000) */
    likedTracks(): Promise<WaveTrack[]>;
    /** История сайта: последние 200 */
    history(): Promise<WaveTrack[]>;
    inputs(user: number): Promise<ShelfInputs>;
    taste(): Promise<TasteMaps | null>;
    related(id: number): Promise<WaveTrack[]>;
    sources: Pick<SourcesSection, 'scMixes' | 'tracksByIds' | 'neighbors'>;
    excluded(): WaveExclusions;
    store: TextStore;
    texts: WaveTexts;
    now?(): number;
}

export interface Shelf {
    /** Карточки на сегодня: плейлист момента, затем подборки. Сбой сборки это ошибка, повтор не чаще retryDelay */
    load(): Promise<ShelfCard[]>;
    card(key: string): ShelfCard | undefined;
    /** Играемые треки карточки по порядку */
    tracks(card: ShelfCard): Promise<WaveTrack[]>;
    /** Волна от подборки; fromId это трек из раскрытого списка, с которого начать */
    seed(card: ShelfCard, tracks: WaveTrack[], fromId?: number): Extract<WaveSeed, { kind: 'library' }>;
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function createShelf(deps: ShelfDeps): Shelf {
    const { texts: T, sources } = deps;
    const now = deps.now ?? (() => Date.now());
    let current: Saved | null = null;
    let running: Promise<ShelfCard[]> | null = null;
    let failures = 0;
    let failedAt = 0;
    let likes: { user: number; at: number; list: Promise<WaveTrack[]> } | null = null;
    // Состав подборок по id: названия и обложки добирает trackBatch один раз
    const known = new Map<number, WaveTrack>();

    const isExcluded = (track: WaveTrack): boolean => {
        const marks = deps.excluded();
        return marks.tracks.has(track.id) || marks.artists.has(trackArtist(track));
    };
    const usable = (track: WaveTrack): boolean => isWaveEligible(track) && !isExcluded(track);
    const remember = (list: WaveTrack[]): void => {
        for (const track of list) known.set(track.id, track);
    };

    function likedList(user: number): Promise<WaveTrack[]> {
        if (!likes || likes.user !== user || now() - likes.at > 30 * 60000) {
            const list = deps.likedTracks();
            likes = { user, at: now(), list };
            list.catch(() => { if (likes?.list === list) likes = null; });
        }
        return likes.list;
    }

    function readSaved(user: number, day: string): Saved | null {
        try {
            const raw = JSON.parse(deps.store.get() ?? 'null') as Partial<Saved> | null;
            if (!raw || raw.user !== user || raw.day !== day || raw.v !== SHELF_FORMAT || !Array.isArray(raw.cards)) return null;
            return raw as Saved;
        } catch {
            return null;
        }
    }
    function save(value: Saved): void {
        try {
            deps.store.set(JSON.stringify(value));
        } catch (error) {
            console.warn('Подборки не сохранены', error);
        }
    }

    // «Утро четверга»: часть суток и день недели по-русски в нужном падеже, ночь это «ночь на четверг»
    function momentName(at: number): string {
        const date = new Date(at);
        const part = Math.floor(date.getHours() / 6);
        const names = (part === 0 ? T.momentDaysOn : T.momentDaysOf).split(',');
        return fillText([T.momentNight, T.momentMorning, T.momentDay, T.momentEvening][part], { day: names[date.getDay()] ?? '' });
    }

    // Плейлист момента: до 50 треков из лайков и слышанного с плюсом во вкусе, по вкусу этого отрезка суток с его
    // поправкой вдвойне, без игравшего за сутки, не больше трёх на артиста. Мало треков или нет вкуса: карточки нет
    async function buildMoment(liked: WaveTrack[], inputs: ShelfInputs, base: TasteMaps | null, day: string, slot: number, at: number): Promise<ShelfCard | null> {
        if (!base) return null;
        const timed = tasteForTime(base, at);
        const played = new Set(inputs.today);
        const likedOk = liked.filter((track) => usable(track) && !played.has(track.id));
        const likedIds = new Set(liked.map((track) => track.id));
        const listened = inputs.heard.filter((track) => !likedIds.has(track.id) && (base.tracks.get(track.id) ?? 0) > 0 && usable(track) && !played.has(track.id));
        const pool = [...likedOk, ...listened];
        const weight = new Map(pool.map((track) => {
            const here = tasteScore(track, timed).score;
            return [track.id, here + (here - tasteScore(track, base).score)];
        }));
        const ordered = daySample(pool, (track) => track.id, (track) => Math.exp(Math.max(-4, Math.min(4, weight.get(track.id) ?? 0))), pool.length, day + ':moment:' + slot);
        const picked = capPerArtist(ordered, 3).slice(0, 50);
        if (picked.length < 10) return null;
        remember(picked);
        const genres = new Map<string, { label: string; count: number }>();
        for (const track of picked) {
            const main = genreMain(track.genre);
            if (!main.key) continue;
            const entry = genres.get(main.key) ?? { label: main.label, count: 0 };
            entry.count++;
            genres.set(main.key, entry);
        }
        const [a, b] = [...genres.values()].sort((x, y) => y.count - x.count).map((entry) => capital(entry.label));
        return {
            key: 'moment', kind: 'moment', title: momentName(at), sub: a && b ? fillText(T.groupAnd, { a, b }) : a ?? '',
            ids: picked.map((track) => track.id), seeds: [], art: coversOf(picked), by: [], neighbors: [],
        };
    }

    async function buildCards(day: string, liked: WaveTrack[], inputs: ShelfInputs, taste: TasteMaps | null, onNeighbors: () => void): Promise<ShelfCard[]> {
        const [site, mixesLoad] = [await deps.history().catch(() => [] as WaveTrack[]), sources.scMixes()];
        remember(liked);
        const likedSet = new Set(liked.map((track) => track.id));
        const eligible = liked.filter(usable);
        const weights = taste?.tracks ?? null;
        const cards: ShelfCard[] = [];

        // Находки дня: неслышанные записи из похожих на восемь любимых; знакомый аккаунт не исключается
        const seedPool = taste ? tasteOrder(eligible.map((track) => ({ track })), taste).map((entry) => entry.track) : shuffleInPlace(eligible.slice());
        const distinct = capPerArtist(seedPool, 1);
        const daySeeds = [...distinct, ...seedPool.filter((track) => !distinct.includes(track))].slice(0, 8);
        const candidates: WaveTrack[] = [];
        await Promise.all(daySeeds.map((from) => deps.related(from.id).then((list) => { candidates.push(...list); }, () => undefined)));
        const heardIds = new Set([...site.map((track) => track.id), ...inputs.recent, ...inputs.heard.map((track) => track.id), ...likedSet]);
        // Соседи по вкусу (П14): каждым третьим находкой лайк того, кто лайкает то же нишевое. Больше соседей с лайком
        // выше, при равенстве вкус; не больше двух треков артиста
        const lovedSeeds = [...inputs.love].filter(([id, entry]) => entry.done >= 2 && !likedSet.has(id)).sort((a, b) => b[1].done - a[1].done).slice(0, 50).map(([id]) => id);
        const neighborList = (await sources.neighbors([...seedPool.slice(0, 100).map((track) => track.id), ...lovedSeeds], onNeighbors))
            .filter((entry) => !heardIds.has(entry.id)).slice(0, 40);
        let fromNeighbors: WaveTrack[] = [];
        if (neighborList.length)
            try {
                const count = new Map(neighborList.map((entry) => [entry.id, entry.count]));
                const ok = (await sources.tracksByIds(neighborList.map((entry) => entry.id))).filter(usable);
                remember(ok);
                const score = new Map(ok.map((track) => [track.id, taste ? tasteScore(track, taste).score : 0]));
                ok.sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
                fromNeighbors = capPerArtist(ok, 2).slice(0, 10);
            } catch (error) {
                console.warn('Подборки: лайки соседей не загружены', error);
            }
        const neighborIds = new Set(fromNeighbors.map((track) => track.id));
        const related = pickFinds(candidates, (track) => isExcluded(track) || heardIds.has(track.id) || neighborIds.has(track.id), taste, 30 - fromNeighbors.length);
        const finds: WaveTrack[] = [];
        for (let i = 0, r = 0, n = 0; r < related.length || n < fromNeighbors.length; i++)
            finds.push((i % 3 === 2 && n < fromNeighbors.length) || r >= related.length ? fromNeighbors[n++] : related[r++]);
        remember(finds);
        if (finds.length >= 10)
            cards.push({
                key: 'daily', kind: 'daily', title: T.shelfDaily, sub: '', ids: finds.map((track) => track.id), seeds: daySeeds.map((track) => track.id),
                art: coversOf(finds), by: [], neighbors: [...neighborIds],
            });

        // «Лайкнули твои артисты» (П13): подборки SoundCloud «<артист>'s Picks» по кругу, по треку от каждого, до 60;
        // слышанное и лайкнутое не берётся
        const likedOrder = interleaveMixes((await mixesLoad).filter((mix) => mix.kind === 'liked'), ['liked']).filter((entry) => !heardIds.has(entry.id)).slice(0, 150);
        if (likedOrder.length >= 8)
            try {
                const byId = new Map((await sources.tracksByIds(likedOrder.map((entry) => entry.id))).map((track) => [track.id, track]));
                const owners = new Map(likedOrder.map((entry) => [entry.id, likedOwner(entry.mix.title)]));
                const picked = capPerArtist(likedOrder.flatMap((entry) => { const track = byId.get(entry.id); return track && usable(track) ? [track] : []; }), ARTIST_CAP).slice(0, 60);
                if (picked.length >= 8) {
                    remember(picked);
                    const by = picked.map((track) => owners.get(track.id) ?? '');
                    const counts = new Map<string, number>();
                    for (const name of by) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
                    cards.push({
                        key: 'liked', kind: 'liked', title: T.shelfLiked, sub: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name).join(', '),
                        ids: picked.map((track) => track.id), seeds: [], art: coversOf(picked), by, neighbors: [],
                    });
                }
            } catch (error) {
                console.warn('Подборки: «Лайкнули твои артисты» не загружены', error);
            }

        // «Давно не слушал»: лайки и любимое без лайка, чего нет среди прослушанного; вес любви по счётчикам за год
        const recent = new Set([...site.map((track) => track.id), ...inputs.recent]);
        const lovedTracks = inputs.loved.filter((track) => (inputs.love.get(track.id)?.done ?? 0) >= 3 && !likedSet.has(track.id) && usable(track));
        const forgotten = forgottenPicks(eligible, recent, weights, 60, day, inputs.love, lovedTracks);
        remember(forgotten);
        if (forgotten.length >= 8)
            cards.push({ key: 'forgotten', kind: 'forgotten', title: T.shelfForgotten, sub: '', ids: forgotten.map((track) => track.id), seeds: [], art: coversOf(forgotten), by: [], neighbors: [] });

        // До 8 жанров. Лайк весит 1 плюс вкус, прослушанное без лайка только своим положительным весом во вкусе
        const listened = inputs.heard.flatMap((track) => {
            const weight = weights?.get(track.id) ?? 0;
            return weight > 0 && !likedSet.has(track.id) && usable(track) ? [{ track, weight }] : [];
        });
        const tasted = [...eligible.map((track) => ({ track, weight: 1 + Math.max(0, weights?.get(track.id) ?? 0) })), ...listened];
        const tastedWeight = new Map(tasted.map((entry) => [entry.track.id, entry.weight]));
        const artistTotal = new Map<string, number>();
        for (const { track } of tasted) {
            const name = (track.user?.username ?? '').trim();
            if (name) artistTotal.set(name, (artistTotal.get(name) ?? 0) + 1);
        }
        tasteGroups(tasted, 8, 8).forEach((group, index) => {
            const [a, b] = group.labels.map(capital);
            const artists = new Map<string, number>();
            for (const track of group.tracks) {
                const name = (track.user?.username ?? '').trim();
                if (name) artists.set(name, (artists.get(name) ?? 0) + 1);
            }
            // В подписи те, кто характерен для жанра, а не самый лайкнутый артист в каждой карточке
            const typical = (name: string, count: number): number => (count * count) / (artistTotal.get(name) ?? count);
            const strong = [...artists].filter(([name, count]) => count >= 2 && typical(name, count) >= 1);
            const sub = (strong.length ? strong : [...artists]).sort((x, y) => typical(y[0], y[1]) - typical(x[0], x[1]) || y[1] - x[1]).slice(0, 3).map(([name]) => name);
            // Каждый день своя выборка жанра с весом по вкусу, а не одни и те же первые 60
            const daily = daySample(group.tracks, (track) => track.id, (track) => tastedWeight.get(track.id) ?? 1, group.tracks.length, day + ':' + group.keys.join(','));
            const shown = capPerArtist(daily, ARTIST_CAP).slice(0, 60);
            remember(shown);
            cards.push({
                key: 'group-' + index, kind: 'group', title: b ? fillText(T.groupAnd, { a, b }) : a, sub: sub.join(', '),
                ids: shown.map((track) => track.id), seeds: [], art: coversOf(shown), by: [], neighbors: [],
            });
        });
        return cards;
    }

    async function build(): Promise<ShelfCard[]> {
        const user = deps.userId();
        if (!user) throw new Error('Нет входа');
        const at = now();
        const day = localDay(at);
        const slot = tasteSlot(at);
        const saved = current && current.user === user && current.day === day && current.v === SHELF_FORMAT ? current : readSaved(user, day);
        let next = saved;
        if (!next) {
            const [liked, inputs, taste] = await Promise.all([likedList(user), deps.inputs(user), deps.taste().catch(() => null)]);
            const cards = await buildCards(day, liked, inputs, taste, () => { current = null; deps.store.set(''); });
            // Пустую полку не хранит: лайки могли не загрузиться, следующий запуск соберёт заново
            next = { user, day, v: SHELF_FORMAT, cards, moment: null };
            if (!cards.length) { current = next; return cards; }
        }
        if (next.moment?.slot !== slot) {
            const [liked, inputs, taste] = await Promise.all([likedList(user), deps.inputs(user), deps.taste().catch(() => null)]);
            next = { ...next, moment: { slot, card: await buildMoment(liked, inputs, taste, day, slot, at).catch(() => null) } };
        }
        current = next;
        save(next);
        return list();
    }

    const list = (): ShelfCard[] => (current ? [...(current.moment?.card ? [current.moment.card] : []), ...current.cards] : []);

    return {
        load() {
            const user = deps.userId();
            if (user && current && current.user === user && current.day === localDay(now()) && current.v === SHELF_FORMAT && current.moment?.slot === tasteSlot(now())) return Promise.resolve(list());
            if (running) return running;
            if (failures && now() - failedAt < retryDelay(failures)) return Promise.reject(new Error('Подборки не собрались, повтор позже'));
            running = build().then((cards) => { failures = 0; return cards; }, (error: unknown) => {
                failures++;
                failedAt = now();
                throw error;
            }).finally(() => { running = null; });
            return running;
        },

        card: (key) => list().find((card) => card.key === key),

        async tracks(card) {
            const missing = card.ids.filter((id) => !known.has(id));
            if (missing.length) remember(await sources.tracksByIds(missing));
            return card.ids.flatMap((id) => known.get(id) ?? []).filter(usable);
        },

        seed(card, tracks, fromId = 0) {
            let own = tracks;
            const at = fromId ? own.findIndex((track) => track.id === fromId) : -1;
            if (at >= 0) own = [own[at], ...own.slice(at + 1), ...own.slice(0, at)];
            // Вкус тасуется всегда, остальные подборки идут по порядку
            else if (card.kind === 'group') own = shuffleInPlace(own.slice());
            const reasonOf = (id: number): WaveReason =>
                card.kind === 'daily' ? (card.neighbors.includes(id) ? { kind: 'neighbors' } : { kind: 'daily' })
                : card.kind === 'forgotten' ? { kind: 'forgotten' }
                : card.kind === 'liked' ? { kind: 'likedBy', artist: card.by[card.ids.indexOf(id)] ?? '' }
                : { kind: 'group', name: card.title };
            const roots = card.seeds.flatMap((id) => known.get(id) ?? []);
            return {
                kind: 'library', title: card.title, order: 'fixed',
                own: own.map((track) => ({ track, from: card.title, reason: reasonOf(track.id) })),
                seeds: shuffleInPlace([...roots, ...own].slice(0, 40)),
            };
        },
    };
}

/** Подпись под названием карточки: подпись жанра или число треков */
export function cardSub(card: ShelfCard, texts: WaveTexts): string {
    return (card.kind === 'group' || card.kind === 'liked' || card.kind === 'moment') && card.sub ? card.sub : countText(card.ids.length, texts.tracksCount, texts.lang);
}
