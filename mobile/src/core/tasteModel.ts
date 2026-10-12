// Копия desktop-файла tasteModel.ts без правок логики: убран класс TasteService (файлы и main), типы и константы
// истории лежат в historyTypes.ts. Хранилище и кэш профиля делает src/wave/taste.ts
import { COUNTED_MS, HEARD_MIN_MS, localDayStart, type TasteLibrary, type TasteMark, type TastePlay, type TasteUpload, type WaveSlice } from './historyTypes';
import { copyKey, familyKey, nameKey, parseTrackTitle, trackCredits, type TrackCredit } from './trackIdentity';
import { genreCanon, normalizeTag, tagShares, trackLang } from './waveGenres';
import type { WaveTrack } from './waveTypes';
import { TASTE_PARAMS, type Part } from './tasteParams';

// Модель вкуса «Моей волны» по журналу прослушиваний, лайкам и подпискам. Три части с разной памятью (раздел 6.1
// плана радара): устойчивая за год, последние 30 дней и подтверждённые новые интересы недели. Аккаунт-куратор,
// участники из названия, семья версий и пометки версии (slowed, remix) считаются отдельно.
// Числа стартовые, подбираются по доле ранних пропусков в волне, она видна на странице истории
const DAY = 86400000;
const HORIZON_DAYS = 365;
const CACHE_MS = 30 * 60000;
const LIMITS = { artists: 1000, credits: 1000, families: 1000, tags: 300, markers: 50, tracks: 1000, langs: 5, contextArtists: 100, contextTags: 60 };
const VIEW_LIMIT = 25;

const PARTS: Part[] = ['tracks', 'artists', 'credits', 'families', 'tags', 'markers', 'langs'];
export { TASTE_PARAMS } from './tasteParams';

type Weights = [track: number, artist: number, tag: number];
const EARLY_SKIP: Weights = [-1, -0.3, -0.1];
const PARTIAL: Weights = [-0.2, 0, 0];
const MOST: Weights = [0.5, 0.2, 0.1];
const FULL: Weights = [1, 0.4, 0.2];
const LIKE: Weights = [2, 0.8, 0.3];
/** «Не нравится» и «Не сейчас» у трека: явное действие против, «Не сейчас» мягче */
const DISLIKE: Weights = [-2, -0.5, -0.2];
const LATER: Weights = [-0.5, -0.1, 0];
/** Скрытый аккаунт и «Не сейчас» у аккаунта: минус самому аккаунту */
const HIDDEN_ARTIST = -1;
const LATER_ARTIST = -0.3;

export type { TasteMark } from './historyTypes';
export interface TasteOverrides {
    artists: number[];
    tags: string[];
}
/** Что уходит странице волны: [id или ключ, вес] по убыванию модуля веса */
export interface TasteProfile {
    version: number;
    /** Аккаунты-кураторы по id загрузчика */
    artists: Array<[number, number]>;
    /** Участники из названия и метаданных по ключу имени, без самого загрузчика */
    credits: Array<[string, number]>;
    /** Семьи версий (композиции) */
    families: Array<[string, number]>;
    tags: Array<[string, number]>;
    /** Пометки версии: slowed, reverb, remix, live */
    markers: Array<[string, number]>;
    tracks: Array<[number, number]>;
    /** Язык трека: cyr, inst, lat */
    langs: Array<[string, number]>;
    /** Поправки к весам артистов и тегов по отрезку суток: slot × 2 + выходной (0-7), slot 0 ночь, 1 утро, 2 день, 3 вечер */
    contexts: Array<{ key: number; artists: Array<[number, number]>; tags: Array<[string, number]> }>;
    /** Треки волны за sourcesDays по исходной причине: [причина, дослушано, ранних пропусков] */
    sources: Array<[string, number, number]>;
    counted: number;
}
export interface TasteView {
    artists: Array<{ id: number; name: string; artwork: string; path: string; weight: number }>;
    tags: Array<{ key: string; label: string; weight: number }>;
    removed: { artists: Array<{ id: number; name: string }>; tags: Array<{ key: string; label: string }> };
    counted: number;
}

/** Исход прослушивания: [трек, артист, теги] или null, если это не сигнал. Минус только за уход по воле человека:
 *  закрытие клиента, смена трека самим сайтом (ошибка, конец очереди) и перемотка в конец дизлайком не считаются */
export function playWeights(play: Pick<TastePlay, 'heard' | 'dur' | 'end' | 'likedNow'> & Partial<Pick<TastePlay, 'covered' | 'endedBy'>>): Weights | null {
    if (play.end !== 'done' && play.end !== 'skip' && play.end !== 'stop') return null;
    // Покрытие участками (v3): повтор одного места не растягивается до полного прослушивания
    const covered = typeof play.covered === 'number' ? Math.min(play.heard, play.covered) : play.heard;
    const full = play.dur <= 0 || covered >= play.dur * 0.8;
    const most = play.dur <= 0 || covered >= play.dur / 2;
    // У событий до v3 причины нет: пропуск читается как раньше, ручным
    const chosen = play.end === 'skip' && play.endedBy !== 'auto';
    // Кусок на повторе: слышно заметно больше, чем покрыто. Это интерес, а не частичный уход
    const looped = typeof play.covered === 'number' && play.heard > play.covered + 10000;
    let base: Weights | null;
    // Смена с порога, раньше секунды: так же листают очередь к нужному треку, это не оценка трека
    if (play.heard < HEARD_MIN_MS) base = null;
    else if (play.heard < COUNTED_MS) base = chosen ? EARLY_SKIP : null;
    else if (full && !chosen) base = FULL;
    else if (most) base = MOST;
    else base = chosen && !looped ? PARTIAL : null;
    if (!play.likedNow) return base;
    const sum = base ?? [0, 0, 0];
    return [sum[0] + LIKE[0], sum[1] + LIKE[1], sum[2] + LIKE[2]];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
function top(map: Map<string, number>, limit: number, floor: number): Array<[string, number]> {
    return [...map].filter(([, weight]) => Math.abs(weight) >= floor).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, limit).map(([key, weight]) => [key, round(weight)]);
}
const numeric = (list: Array<[string, number]>): Array<[number, number]> => list.map(([key, weight]) => [Number(key), weight]);
// Написание тега для людей: как в первом встреченном жанре, его части или теге трека. Ключ склеен, как в tagShares
function tagLabels(genre: string, tags: string, into: Map<string, string>): void {
    const labels = [genre, ...genre.split(/\s+-\s+|[/,;|]+/), ...Array.from(tags.matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2] ?? '')];
    for (const label of labels) {
        const key = genreCanon(normalizeTag(label));
        if (key.length >= 2 && !into.has(key)) into.set(key, label.trim().toLowerCase().slice(0, 60));
    }
}

/** Направления трека: доля куратора, участники с долями, семья, пометки версии, теги и ключ независимой записи */
interface Directions {
    curator: number;
    credits: Array<[string, number]>;
    family: string;
    markers: string[];
    /** Ключ и доля: жанр 1, метки вместе 0.5 (tagShares) */
    tags: Array<[string, number]>;
    /** Язык трека; пусто, если названия нет и судить не по чему */
    lang: string;
    record: string;
}
interface Heard {
    id: number;
    uploader: number;
    uploaderName: string;
    title: string;
    duration: number;
    genre: string;
    tags: string;
    /** Кредиты из хранилища рекомендаций (с метаданными издателя); null: только из названия */
    credits: TrackCredit[] | null;
}
function directionsOf(item: Heard): Directions {
    const track: WaveTrack = { id: item.id, title: item.title, user_id: item.uploader, user: { id: item.uploader, username: item.uploaderName }, duration: item.duration };
    const parsed = parseTrackTitle(item.title);
    const uploader = nameKey(item.uploaderName);
    const shares = new Map<string, number>();
    const credits = item.credits ?? trackCredits(track, parsed);
    for (const credit of credits) {
        if (!credit || typeof credit.key !== 'string' || !credit.key || credit.key === uploader) continue;
        const share = TASTE_PARAMS.roles[credit.role] ?? 0;
        if (share > (shares.get(credit.key) ?? 0)) shares.set(credit.key, share);
    }
    // В названии другой исполнитель: аккаунт выложил чужое, его каталог этим лайком не одобрен целиком
    const foreign = (item.credits ?? parsed.credits).some((credit) => credit.role === 'artist' && credit.key && credit.key !== uploader);
    // Своё выложил сам: имя тоже идёт в участники, чтобы интерес доходил до его песен на чужих каналах.
    // Страница не складывает это с весом самого аккаунта: у своего трека имя загрузчика в участниках не считается
    if (!foreign && uploader && uploader.length <= 60 && !shares.has(uploader)) shares.set(uploader, TASTE_PARAMS.roles.artist);
    return {
        curator: foreign ? TASTE_PARAMS.curatorShare : 1,
        credits: [...shares],
        family: item.title ? familyKey(track, parsed) : '',
        markers: [...new Set(parsed.version.map((entry) => entry.split(':')[0]))].filter(Boolean),
        tags: tagShares(item.genre, item.tags, [item.uploaderName, ...credits.map((credit) => credit?.name)]),
        lang: item.title ? trackLang({ ...track, genre: item.genre, tag_list: item.tags }) : '',
        record: item.title ? copyKey(track) : 'sc:track:' + item.id,
    };
}
const fromUpload = (upload: TasteUpload): Heard => ({
    id: upload.id, uploader: upload.uploader, uploaderName: upload.uploaderName, title: upload.title, duration: upload.duration,
    genre: upload.genre, tags: upload.tags, credits: upload.credits,
});

/** Откуда вклад: независимая запись и ручное ли действие (для подтверждения недели), насыщать ли по суткам.
 *  Сутки и затухание считаются один раз на событие, а не на каждый вклад: на полумиллионе событий это главное время */
interface Origin {
    record: string;
    manual: boolean;
    daily: boolean;
    day: number;
    /** Множитель устойчивой части; у лайка без даты постоянный */
    long: number;
    month: boolean;
    week: boolean;
}
/** Всё про один ключ: суммы трёх частей, суточные суммы для потолка и подтверждение недельного интереса */
interface Entry {
    long: number;
    month: number;
    week: number;
    daily: Map<number, number> | null;
    records: Set<string> | null;
    days: Set<number> | null;
    manual: boolean;
}
type Layer = Record<Part, Map<string, Entry>>;

export function buildTaste(
    plays: readonly TastePlay[], marks: readonly TasteMark[], overrides: TasteOverrides, now: number, library: TasteLibrary | null = null,
    sources: readonly WaveSlice[] = [],
): { profile: TasteProfile; view: TasteView } {
    const P = TASTE_PARAMS;
    const entries: Layer = { tracks: new Map(), artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), langs: new Map() };
    const entry = (part: Part, key: string): Entry => {
        let found = entries[part].get(key);
        if (!found) {
            found = { long: 0, month: 0, week: 0, daily: null, records: null, days: null, manual: false };
            entries[part].set(key, found);
        }
        return found;
    };
    const labels = new Map<string, string>();
    const names = new Map<number, { name: string; artwork: string; path: string }>();
    const lastCounted = new Map<number, number>();
    // Треки, чья серия кругов повтора уже получила голос переслушивания
    const looping = new Set<number>();
    const counted = plays.filter((play) => play.heard >= COUNTED_MS && !play.looped).length;
    // Уверенность растёт плавно от половины до полной: ступенька на пороге сдвигала все веса разом
    const confidence = 0.5 + 0.5 * Math.min(1, counted / P.confidentPlays);

    const originOf = (at: number, record: string, manual: boolean, daily: boolean, undated = false): Origin => {
        const age = Math.max(0, now - at);
        return {
            record, manual, daily, day: undated ? 0 : localDayStart(at),
            long: undated ? P.undatedLike : Math.pow(0.5, age / DAY / P.halfLifeDays),
            month: !undated && age <= P.monthDays * DAY,
            week: !undated && age <= P.weekDays * DAY,
        };
    };
    const push = (part: Part, key: string, raw: number, origin: Origin): void => {
        if (!raw || !Number.isFinite(raw)) return;
        const target = entry(part, key);
        let value = raw;
        if (origin.daily) {
            // В сутки ключ набирает не больше потолка: считается прирост ограниченной суммы, а не сам вклад
            target.daily ??= new Map();
            const before = target.daily.get(origin.day) ?? 0;
            const [low, high] = P.daily[part];
            const clamp = (sum: number): number => Math.min(high, Math.max(low, sum));
            value = clamp(before + raw) - clamp(before);
            target.daily.set(origin.day, before + raw);
            if (!value) return;
        }
        target.long += value * origin.long;
        if (!origin.month) return;
        target.month += value;
        if (!origin.week) return;
        target.week += value;
        if (value <= 0 || part === 'tracks') return;
        (target.records ??= new Set()).add(origin.record);
        (target.days ??= new Set()).add(origin.day);
        target.manual ||= origin.manual;
    };
    const apply = (weights: Weights, id: number, uploader: number, item: Directions, positive: number, origin: Origin): void => {
        // Плюсы ослабляются поправками, минусы действуют полностью
        const scale = (value: number): number => value * (value > 0 ? positive : 1);
        push('tracks', String(id), scale(weights[0]), origin);
        if (uploader > 0) push('artists', String(uploader), scale(weights[1]) * item.curator, origin);
        for (const [key, share] of item.credits) push('credits', key, scale(weights[1]) * share, origin);
        if (item.family && weights[0] > 0) push('families', item.family, scale(weights[0]) * P.familyShare, origin);
        for (const [key, share] of item.tags) push('tags', key, scale(weights[2]) * share, origin);
        for (const key of item.markers) push('markers', key, scale(weights[2]) * P.markerShare, origin);
        if (item.lang) push('langs', item.lang, scale(weights[2]) * P.langShare, origin);
    };
    // П5: суммы артистов и тегов по отрезкам суток с затуханием устойчивой части. Суточного потолка тут нет:
    // поправка относительная и ограничена потолком при сборке. 0-3 четыре отрезка, 4-11 отрезок с типом дня
    type Sums = { plays: number; artists: Map<string, number>; tags: Map<string, number> };
    const sums = (): Sums => ({ plays: 0, artists: new Map(), tags: new Map() });
    const overall = sums();
    const slices = Array.from({ length: 12 }, sums);
    // Сколько прослушиваний у ключа вообще: от него ждётся число в отрезке
    const keyPlays = { artists: new Map<string, number>(), tags: new Map<string, number>() };
    const add = (map: Map<string, number>, key: string, value: number): void => {
        if (value) map.set(key, (map.get(key) ?? 0) + value);
    };
    const noteContext = (weights: Weights, at: number, uploader: number, item: Directions, positive: number, decay: number): void => {
        const date = new Date(at);
        const slot = Math.floor(date.getHours() / 6);
        const weekend = date.getDay() === 0 || date.getDay() === 6 ? 1 : 0;
        const scale = (value: number): number => value * (value > 0 ? positive : 1) * decay;
        for (const target of [overall, slices[slot], slices[4 + slot * 2 + weekend]]) {
            target.plays += decay;
            if (uploader > 0) add(target.artists, String(uploader), scale(weights[1]) * item.curator);
            for (const [key, share] of item.tags) add(target.tags, key, scale(weights[2]) * share);
        }
        if (uploader > 0) add(keyPlays.artists, String(uploader), decay);
        for (const [key] of item.tags) add(keyPlays.tags, key, decay);
    };

    const stored = new Map((library?.uploads ?? []).map((upload) => [upload.id, upload] as const));
    const cache = new Map<number, Directions>();
    const likedInPlay = new Set<number>();
    for (const play of plays) {
        if (play.artist > 0 && play.artistName) names.set(play.artist, { name: play.artistName, artwork: play.artwork, path: play.path });
        tagLabels(play.genre, play.tags, labels);
        let item = cache.get(play.id);
        if (!item) {
            const upload = stored.get(play.id);
            item = directionsOf({
                id: play.id, uploader: play.artist, uploaderName: play.artistName, title: play.title || upload?.title || '', duration: play.dur,
                genre: play.genre, tags: play.tags, credits: upload?.credits ?? null,
            });
            cache.set(play.id, item);
        }
        if (play.likedNow) likedInPlay.add(play.id);
        // Трек, поданный волной, весит в плюс меньше выбранного руками. Простой системы (away) не штрафуется и плюсом
        // не считается: музыка играла сама. «Моя музыка» играет собранное самим человеком, это выбор без скидки (Э7), как и все треки выбранного артиста (Ф1)
        const positive = play.source.startsWith('wave:') && play.source !== 'wave:library' && play.source !== 'wave:artistAll' && !play.picked ? P.wavePositive : 1;
        const origin = originOf(play.at, item.record, play.likedNow || play.picked, true);
        // Само прослушивание насыщается по суткам, лайк во время него явное действие и идёт целиком.
        // Круг повтора не прослушивание заново: артист и теги за него ничего не получают
        const weights = play.looped ? null : playWeights({ heard: play.heard, dur: play.dur, end: play.end, likedNow: false, covered: play.covered, endedBy: play.endedBy });
        if (weights && !(play.away && weights[0] > 0)) {
            apply(weights, play.id, play.artist, item, positive, origin);
            noteContext(weights, play.at, play.artist, item, positive, origin.long);
        }
        if (play.likedNow) apply(LIKE, play.id, play.artist, item, positive, { ...origin, daily: false });
        if (!play.looped) looping.delete(play.id);
        if (play.heard < COUNTED_MS || play.away) continue;
        const previous = lastCounted.get(play.id);
        // Переслушивание плюсует трек; серия кругов повтора подряд даёт один голос, а не голос за круг
        if (previous !== undefined && play.at - previous <= P.replayDays * DAY && !(play.looped && looping.has(play.id))) push('tracks', String(play.id), positive, origin);
        if (play.looped) looping.add(play.id);
        lastCounted.set(play.id, play.at);
    }
    // Отметки: «Больше такого» как лайк, с названием и именем учит семью версий и участников; «Не нравится»,
    // скрытый аккаунт и «Не сейчас» минусом. Явные действия, без насыщения по суткам
    const marked = new Set<number>();
    for (const mark of marks) {
        const kind = mark.kind ?? 'more';
        const origin = (record: string): Origin => originOf(mark.at, record, true, false);
        if (kind === 'artist' || kind === 'later-artist') {
            push('artists', String(mark.id), kind === 'artist' ? HIDDEN_ARTIST : LATER_ARTIST, origin('sc:user:' + mark.id));
            continue;
        }
        if (kind === 'more') marked.add(mark.id);
        tagLabels(mark.genre, mark.tags, labels);
        const item = directionsOf({ id: mark.id, uploader: mark.artist, uploaderName: mark.name ?? '', title: mark.title ?? '', duration: 0, genre: mark.genre, tags: mark.tags, credits: stored.get(mark.id)?.credits ?? null });
        apply(kind === 'more' ? LIKE : kind === 'track' ? DISLIKE : LATER, mark.id, mark.artist, item, 1, origin(item.record));
    }
    // Лайки сайта: явное действие, без насыщения. Лайк, уже поставленный во время прослушивания, второй раз не идёт
    for (const like of library?.likes ?? []) {
        if (likedInPlay.has(like.id) || marked.has(like.id)) continue;
        const upload = like.upload;
        if (upload) tagLabels(upload.genre, upload.tags, labels);
        const item = upload ? directionsOf(fromUpload(upload)) : directionsOf({ id: like.id, uploader: 0, uploaderName: '', title: '', duration: 0, genre: '', tags: '', credits: null });
        apply(LIKE, like.id, upload?.uploader ?? 0, item, 1, originOf(like.added || now, item.record, true, false, !like.added));
    }
    // Треки плейлистов: даты добавления у сайта нет, поэтому как лайк без даты, с долей своего или сохранённого плейлиста.
    // Лайкнутый трек второй раз не идёт
    const likedIds = new Set((library?.likes ?? []).map((like) => like.id));
    for (const track of library?.playlists ?? []) {
        if (likedIds.has(track.id) || likedInPlay.has(track.id) || marked.has(track.id)) continue;
        const upload = track.upload;
        if (upload) tagLabels(upload.genre, upload.tags, labels);
        const item = upload ? directionsOf(fromUpload(upload)) : directionsOf({ id: track.id, uploader: 0, uploaderName: '', title: '', duration: 0, genre: '', tags: '', credits: null });
        apply(LIKE, track.id, upload?.uploader ?? 0, item, track.own ? P.playlistOwn : P.playlistSaved, originOf(now, item.record, false, false, true));
    }
    for (const id of library?.follows ?? []) entry('artists', String(id)).long += P.follow;

    const total: Record<Part, Map<string, number>> = { tracks: new Map(), artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), langs: new Map() };
    for (const part of PARTS) {
        for (const [key, item] of entries[part]) {
            // Новый интерес недели входит, только если подтверждён: две разные записи, два дня или ручное действие.
            // Копии одной версии дают один ключ записи и независимыми не считаются
            const confirmed = part === 'tracks' || item.week <= 0 || (item.records?.size ?? 0) >= 2 || (item.days?.size ?? 0) >= 2 || item.manual;
            const value = (P.blend.long * item.long + P.blend.month * item.month + (confirmed ? P.blend.week * item.week : 0)) * confidence;
            if (value) total[part].set(key, value);
        }
    }

    const droppedArtists = new Set(overrides.artists);
    // Убранные до склейки написаний (hiphopandrap) снимают и склеенный ключ (hiphop)
    const droppedTags = new Set([...overrides.tags, ...overrides.tags.map(genreCanon)]);
    // Убранный аккаунт снимается и из участников под своим именем: иначе его песни на чужих каналах шли бы по-прежнему
    for (const id of droppedArtists) {
        total.artists.delete(String(id));
        const name = nameKey(names.get(id)?.name);
        if (name) total.credits.delete(name);
    }
    for (const key of droppedTags) total.tags.delete(key);
    const artists = top(total.artists, LIMITS.artists, 0.01);
    const tags = top(total.tags, LIMITS.tags, 0.01);

    // Поправка отрезка: насколько ключ чаще или реже в отрезке, чем в среднем, от -1 до 1. Сжимается к нулю по числу
    // прослушиваний отрезка и по ожидаемому числу прослушиваний ключа в нём; отрезок с типом дня сжимается к отрезку
    // без него. Итог умножается на потолок, не больше модуля общего веса: минус не переворачивает любимое в нелюбимое
    const share = (part: 'artists' | 'tags', slice: Sums, key: string): { ratio: number; evidence: number } => {
        const f = slice.plays / overall.plays;
        const all = overall[part].get(key) ?? 0;
        const here = (slice[part].get(key) ?? 0) / f;
        const spread = Math.abs(here) + Math.abs(all);
        const expected = (keyPlays[part].get(key) ?? 0) * f;
        return { ratio: spread > 0 ? (here - all) / spread : 0, evidence: expected / (expected + P.contextKeyK) };
    };
    const correction = (part: 'artists' | 'tags', slot: number, weekend: number, key: string, weight: number): number => {
        const wide = slices[slot];
        const narrow = slices[4 + slot * 2 + weekend];
        if (!wide.plays) return 0;
        const a = share(part, wide, key);
        const base = a.ratio * a.evidence * (wide.plays / (wide.plays + P.contextK));
        let value = base;
        if (narrow.plays) {
            const b = share(part, narrow, key);
            const trust = narrow.plays / (narrow.plays + P.contextK);
            value = base + (b.ratio * b.evidence - base) * trust;
        }
        return value * Math.min(part === 'artists' ? P.contextArtistCap : P.contextTagCap, Math.abs(weight));
    };
    const contexts: TasteProfile['contexts'] = [];
    if (overall.plays > 0)
        for (let key = 0; key < 8; key++) {
            const slot = Math.floor(key / 2);
            const weekend = key % 2;
            const shifted = (part: 'artists' | 'tags', list: Array<[string, number]>, limit: number): Array<[string, number]> =>
                top(new Map(list.map(([id, weight]) => [id, correction(part, slot, weekend, id, weight)])), limit, 0.01);
            const entry = { key, artists: numeric(shifted('artists', artists, LIMITS.contextArtists)), tags: shifted('tags', tags, LIMITS.contextTags) };
            if (entry.artists.length || entry.tags.length) contexts.push(entry);
        }

    const profile: TasteProfile = {
        version: P.version,
        artists: numeric(artists),
        credits: top(total.credits, LIMITS.credits, 0.01),
        families: top(total.families, LIMITS.families, 0.01),
        tags,
        markers: top(total.markers, LIMITS.markers, 0.01),
        tracks: numeric(top(total.tracks, LIMITS.tracks, 0.1)),
        langs: top(total.langs, LIMITS.langs, 0.01),
        contexts,
        sources: sources.filter((slice) => slice.key && slice.key.length <= 40 && slice.done + slice.early > 0).slice(0, 30).map((slice) => [slice.key, slice.done, slice.early]),
        counted,
    };

    const artistPath = (path: string): string => /^\/[^/]+/.exec(path)?.[0] ?? '';
    const liked = (map: Map<string, number>): Array<[string, number]> => [...map].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, VIEW_LIMIT);
    const view: TasteView = {
        artists: liked(total.artists).map(([key, weight]) => {
            const id = Number(key);
            const known = names.get(id);
            return { id, name: known?.name ?? '', artwork: known?.artwork ?? '', path: artistPath(known?.path ?? ''), weight: round(weight) };
        }).filter((entry) => entry.name),
        tags: liked(total.tags).map(([key, weight]) => ({ key, label: labels.get(key) ?? key, weight: round(weight) })),
        removed: {
            artists: [...droppedArtists].map((id) => ({ id, name: names.get(id)?.name ?? '' })).filter((entry) => entry.name),
            tags: [...droppedTags].map((key) => ({ key, label: labels.get(key) ?? key })),
        },
        counted,
    };
    return { profile, view };
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTagKey = (value: unknown): value is string => typeof value === 'string' && value.length >= 2 && value.length <= 80 && normalizeTag(value) === value;
/** Содержимое файла «убрать из вкуса»: id аккаунтов и ключи тегов без повторов */
export function cleanTasteOverrides(value: unknown): TasteOverrides {
    const parsed = value && typeof value === 'object' ? (value as { artists?: unknown; tags?: unknown }) : null;
    return {
        artists: Array.isArray(parsed?.artists) ? [...new Set(parsed.artists.filter(isId))].slice(0, 1000) : [],
        tags: Array.isArray(parsed?.tags) ? [...new Set(parsed.tags.filter(isTagKey))].slice(0, 1000) : [],
    };
}
