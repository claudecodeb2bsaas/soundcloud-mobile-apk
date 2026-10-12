// Отбор кандидатов волны: годен ли трек, фильтр, разнос артистов, лимиты, «давно не слушал», новые исполнители.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts): чужие функции зовутся по голому имени,
// поэтому импорт через пространство имён и разбор в константы, как в wave.ts
import * as identity from './trackIdentity';
import type { WaveCandidate, WaveFilter, WaveTrack } from './waveTypes';

const { copyKey, familyKey, nameKey, performerKey, trackCredits, versionKey } = identity;

export function trackArtist(track: WaveTrack): number {
    return track.user_id ?? track.user?.id ?? 0;
}

/** Запоминает id не больше limit штук, вытесняя самые старые; true, если id встретился впервые */
export function rememberRecent(seen: Set<number>, id: number, limit: number): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > limit) seen.delete(seen.values().next().value as number);
    return true;
}

// Треки Go+ (SNIP) играют 30 секунд на бесплатном тарифе, BLOCK не играет вовсе, длинные миксы волну не держат
export function isWaveEligible(track: WaveTrack): boolean {
    if (!track || typeof track.id !== 'number' || (track.kind !== undefined && track.kind !== 'track')) return false;
    if (track.streamable === false || track.policy === 'SNIP' || track.policy === 'BLOCK') return false;
    const duration = track.full_duration || track.duration || 0;
    return duration >= 30000 && duration <= 15 * 60000;
}

// Мягкий порог «Свежего в жанре» (В2.12): свежая загрузка без лайков и почти без прослушиваний чаще всего пропускается.
// Без счётчиков трек проходит
export function freshEnough(track: WaveTrack): boolean {
    const likes = typeof track.likes_count === 'number' ? track.likes_count : null;
    const plays = typeof track.playback_count === 'number' ? track.playback_count : null;
    if (likes === null && plays === null) return true;
    return (likes ?? 0) >= 1 || (plays ?? 0) >= 30;
}

export function acceptCandidate(track: WaveTrack, filter: WaveFilter): boolean {
    if (!isWaveEligible(track) || filter.taken.has(track.id) || filter.skipped.has(copyKey(track))) return false;
    if (filter.excludedTracks.has(track.id) || filter.excludedArtists.has(trackArtist(track))) return false;
    if (filter.excludedFamilies.size && !(filter.excludedFamilies.get(familyKey(track))?.has(versionKey(track)) ?? true)) return false;
    if (filter.mode === 'fresh') return !filter.heard.has(track.id) && !filter.liked.has(track.id);
    return !filter.recent.has(track.id);
}

/** Ключи артиста для разнесения: аккаунт загрузчика и исполнитель из названия, если песня чужая */
export function spacingKeys(track: WaveTrack): string[] {
    const account = 'u:' + trackArtist(track);
    const performer = performerKey(trackArtist(track), track.user?.username, trackCredits(track));
    return performer === account ? [account] : [account, performer];
}
/** Окно разнесения по пулу: чем больше разных исполнителей, тем шире, от 2 до 5 */
export function spacingGap(pool: WaveCandidate[]): number {
    const performers = new Set(pool.map((item) => spacingKeys(item.track).slice(-1)[0]));
    return Math.max(2, Math.min(5, Math.floor(performers.size / 3)));
}
// Следующие треки из пула: ни аккаунт, ни исполнитель не повторяются в окне из gap последних, пул не меняется.
// recent: ключи недавно поставленных треков, старые первыми. Одну песню исполнителя на трёх каналах окно ловит по исполнителю
export function pickSpaced(pool: WaveCandidate[], count: number, recent: string[][], gap = 3): WaveCandidate[] {
    const picked: WaveCandidate[] = [];
    const rest = pool.slice();
    const window = recent.slice(-gap);
    const keys = new Map(rest.map((item) => [item, spacingKeys(item.track)] as const));
    const free = (item: WaveCandidate): boolean => !window.some((list) => list.some((key) => keys.get(item)?.includes(key)));
    while (picked.length < count && rest.length) {
        let index = rest.findIndex(free);
        if (index < 0) index = 0;
        const [item] = rest.splice(index, 1);
        picked.push(item);
        window.push(keys.get(item) ?? []);
        if (window.length > gap) window.shift();
    }
    return picked;
}

export function shuffleInPlace<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// Не больше cap треков одного артиста, порядок сохраняется: любимый артист не забирает подборку жанра целиком
export function capPerArtist(tracks: WaveTrack[], cap: number): WaveTrack[] {
    const taken = new Map<number, number>();
    return tracks.filter((track) => {
        const artist = trackArtist(track);
        const count = taken.get(artist) ?? 0;
        taken.set(artist, count + 1);
        return count < cap;
    });
}

// «Давно не слушал»: лайки и любимое без лайка, чего нет среди прослушанного за последние недели. Вес любви (П11):
// 1 + дослушано + 2 × круги повтора - 2 × ранние пропуски за год плюс вкус трека. Лайк, который рано пропускали и ни
// разу не дослушали, не берётся; трек без лайка берётся от трёх дослушиваний. Без seed по весу, дальше лайки постарше;
// с seed (дата) выборка дня с этим весом, чтобы каждый день были не те же 60 треков (решение владельца 28.09.2026).
// liked идёт от новых лайков к старым, heard это треки со счётчиками любви
export function forgottenPicks(
    liked: WaveTrack[], recent: Set<number>, weights: Map<number, number> | null, limit: number, seed = '',
    love: Map<number, { done: number; early: number; loops: number }> | null = null, heard: WaveTrack[] = [],
): WaveTrack[] {
    const likedIds = new Set(liked.map((track) => track.id));
    const candidates = [...liked, ...heard.filter((track) => !likedIds.has(track.id) && (love?.get(track.id)?.done ?? 0) >= 3)];
    const entries = candidates
        .map((track, order) => {
            const count = love?.get(track.id);
            const taste = weights?.get(track.id) ?? 0;
            const fondness = count ? count.done + 2 * count.loops - 2 * count.early : 0;
            return { track, order, taste, skippedOnly: !!count && count.early > 0 && count.done === 0, weight: 1 + fondness + taste };
        })
        .filter((entry) => entry.taste > -1 && !entry.skippedOnly && entry.weight > 0 && !recent.has(entry.track.id) && isWaveEligible(entry.track));
    const ordered = seed
        ? daySample(entries, (entry) => entry.track.id, (entry) => entry.weight, limit, seed)
        : entries.sort((a, b) => b.weight - a.weight || b.order - a.order).slice(0, limit);
    return ordered.map((entry) => entry.track);
}

// Выборка дня: случайная с весом, одна и та же весь день (seed это дата). Ключ u^(1/w) (Эфраимидис и Спиракис):
// чем больше вес, тем вероятнее место и выше в порядке. u из хеша зерна и номера, поэтому порядок входа ничего не решает
export function daySample<T>(items: T[], idOf: (item: T) => number, weightOf: (item: T) => number, limit: number, seed: string): T[] {
    const unit = (id: number): number => {
        const text = seed + ':' + id;
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
        hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
        hash ^= hash >>> 16;
        // Строго между 0 и 1: дальше логарифм
        return ((hash >>> 0) + 1) / 4294967298;
    };
    return items
        .map((item) => ({ item, id: idOf(item), key: Math.log(unit(idOf(item))) / Math.max(1e-6, weightOf(item)) }))
        .sort((a, b) => b.key - a.key || a.id - b.id)
        .slice(0, limit)
        .map((entry) => entry.item);
}

// Ключи имён исполнителей: загрузчик, если выложил своё, и участники из названия и метаданных, кроме авторов песни
export function artistNames(tracks: WaveTrack[]): Set<string> {
    const names = new Set<string>();
    for (const track of tracks) {
        const credits = trackCredits(track).filter((credit) => credit.role !== 'writer');
        const uploader = nameKey(track.user?.username);
        if (uploader && !credits.some((credit) => credit.role === 'artist' && credit.key !== uploader)) names.add(uploader);
        for (const credit of credits) names.add(credit.key);
    }
    return names;
}

// Исполнители записи по ключу имени с написанием: загрузчик, если выложил своё, и участники из названия и метаданных,
// кроме авторов песни и продюсеров
export function performerNames(track: WaveTrack): Map<string, string> {
    const names = new Map<string, string>();
    const credits = trackCredits(track).filter((credit) => credit.role !== 'writer' && credit.role !== 'producer');
    const uploader = nameKey(track.user?.username);
    if (uploader && !credits.some((credit) => credit.role === 'artist' && credit.key !== uploader)) names.set(uploader, (track.user?.username ?? '').trim());
    for (const credit of credits) if (!names.has(credit.key)) names.set(credit.key, credit.name);
    return names;
}
// Общий исполнитель двух записей по написанию в первой; пусто, если общего нет
export function sharedPerformer(a: WaveTrack, b: WaveTrack): string {
    const theirs = performerNames(b);
    for (const [key, name] of performerNames(a)) if (theirs.has(key)) return name;
    return '';
}

// Новый исполнитель: у чужой песни на канале решают участники из названия, у своей ещё и сам аккаунт
export function isNewArtist(track: WaveTrack, knownIds: Set<number>, knownNames: Set<string>): boolean {
    const credits = trackCredits(track).filter((credit) => credit.role !== 'writer');
    const uploader = nameKey(track.user?.username);
    const foreign = credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    if (!foreign && (knownIds.has(trackArtist(track)) || (!!uploader && knownNames.has(uploader)))) return false;
    return !credits.some((credit) => knownNames.has(credit.key));
}

// Разнести по ключу в порядке списка: следующий берётся первый, чей ключ не встречался среди последних gap,
// а если такого нет, просто первый. Ничего не выбрасывается
export function spreadBy<T>(list: T[], keyOf: (item: T) => string | number, gap: number): T[] {
    const rest = list.slice();
    const result: T[] = [];
    const window: Array<string | number> = [];
    while (rest.length) {
        let index = rest.findIndex((item) => !window.includes(keyOf(item)));
        if (index < 0) index = 0;
        const [item] = rest.splice(index, 1);
        result.push(item);
        window.push(keyOf(item));
        if (window.length > gap) window.shift();
    }
    return result;
}
