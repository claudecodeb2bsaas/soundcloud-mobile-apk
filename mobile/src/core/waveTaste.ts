// Вкус: оценка трека по профилю из main, порядок подборки, причина «почему», группы вкусов, настроение, находки дня.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts): чужие функции зовутся по голому имени,
// поэтому импорт через пространство имён и разбор в константы, как в wave.ts
import * as identity from './trackIdentity';
import * as waveGenres from './waveGenres';
import * as wavePicks from './wavePicks';
import type { SeriesTrait, TasteGroup, TasteMaps, TasteScore, WaveCandidate, WaveReason, WaveTrack } from './waveTypes';

const { copyKey, copyKeys, familyKey, nameKey, parseTrackTitle, trackCredits } = identity;
const { genreCanon, genreMain, genreParts, normalizeTag, tagKeys, tagShares, trackLang } = waveGenres;
const { capPerArtist, isWaveEligible, shuffleInPlace, spreadBy, trackArtist } = wavePicks;

// Ответ main недоверенный: берутся только пары [id или ключ, конечное число]. Старый профиль без новых частей даёт пустые
export function tasteMaps(input: unknown): TasteMaps | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as Record<'version' | 'artists' | 'credits' | 'families' | 'tags' | 'markers' | 'tracks' | 'langs' | 'contexts' | 'sources', unknown>;
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const isKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
    const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    const pairs = <K>(list: unknown, valid: (value: unknown) => value is K, limit: number): Map<K, number> => {
        const map = new Map<K, number>();
        if (!Array.isArray(list)) return map;
        for (const item of list.slice(0, limit))
            if (Array.isArray(item) && valid(item[0]) && typeof item[1] === 'number' && Number.isFinite(item[1])) map.set(item[0], item[1]);
        return map;
    };
    const contexts: TasteMaps['contexts'] = new Map();
    for (const item of Array.isArray(source.contexts) ? source.contexts.slice(0, 8) : []) {
        const entry = item && typeof item === 'object' ? (item as { key?: unknown; artists?: unknown; tags?: unknown }) : null;
        const key = entry?.key;
        if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < 8) contexts.set(key, { artists: pairs(entry?.artists, isId, 100), tags: pairs(entry?.tags, isKey, 60) });
    }
    const sources: TasteMaps['sources'] = new Map();
    for (const item of Array.isArray(source.sources) ? source.sources.slice(0, 30) : [])
        if (Array.isArray(item) && isKey(item[0]) && isCount(item[1]) && isCount(item[2])) sources.set(item[0], { done: item[1], early: item[2] });
    return {
        version: typeof source.version === 'number' && Number.isInteger(source.version) && source.version > 0 && source.version <= 1000 ? source.version : 0,
        artists: pairs(source.artists, isId, 1000),
        credits: pairs(source.credits, isKey, 1000),
        families: pairs(source.families, isKey, 1000),
        tags: pairs(source.tags, isKey, 300),
        markers: pairs(source.markers, isKey, 50),
        tracks: pairs(source.tracks, isId, 1000),
        langs: pairs(source.langs, isKey, 5),
        contexts,
        sources,
    };
}

// Отрезок суток для поправок вкуса (П5): slot × 2 + выходной, slot 0 ночь (0-6), 1 утро, 2 день, 3 вечер; время местное
export function tasteSlot(now: number): number {
    const date = new Date(now);
    return Math.floor(date.getHours() / 6) * 2 + (date.getDay() === 0 || date.getDay() === 6 ? 1 : 0);
}

// Вкус на сейчас: к весам артистов и тегов прибавлены поправки текущего отрезка суток. Новых ключей поправка не
// заводит, main шлёт её только для ключей профиля. Остальные части общие с базовым вкусом
export function tasteForTime(base: TasteMaps, now: number): TasteMaps {
    const shift = base.contexts.get(tasteSlot(now));
    if (!shift) return base;
    const artists = new Map(base.artists);
    for (const [id, delta] of shift.artists) if (artists.has(id)) artists.set(id, (artists.get(id) ?? 0) + delta);
    const tags = new Map(base.tags);
    for (const [key, delta] of shift.tags) if (tags.has(key)) tags.set(key, (tags.get(key) ?? 0) + delta);
    return { ...base, artists, tags };
}

// Признаки трека для серии пропусков (П7): пометки версии, язык кроме латиницы (она у большинства и ничего не
// различает), главный жанр, чужой канал (в названии другой исполнитель, загрузчик не он)
export function trackTraits(track: WaveTrack): SeriesTrait[] {
    const traits: SeriesTrait[] = [];
    const parsed = parseTrackTitle(track.title);
    const names: Record<string, string> = { superslowed: 'super slowed', sped: 'sped up', supersped: 'super sped up', bassboost: 'bass boosted' };
    for (const marker of new Set(parsed.version.map((item) => item.split(':')[0]))) if (marker) traits.push({ kind: 'marker', key: marker, label: names[marker] ?? marker });
    const lang = trackLang(track);
    if (lang !== 'lat') traits.push({ kind: 'lang', key: lang, label: lang });
    const main = genreMain(track.genre);
    if (main.key) traits.push({ kind: 'genre', key: main.key, label: main.label.toLowerCase() });
    const uploader = nameKey(track.user?.username);
    if (parsed.credits.some((credit) => credit.role === 'artist' && credit.key && credit.key !== uploader)) traits.push({ kind: 'foreign', key: 'foreign', label: '' });
    return traits;
}

// Общий признак всей серии ранних пропусков: самый узкий из общих, пометка версии, потом язык, жанр, чужой канал.
// skip: ключи «вид:ключ», которые уже прижаты или не различают эту волну (выбранный жанр)
export function seriesTrait(tracks: WaveTrack[], skip: string[] = []): SeriesTrait | null {
    if (tracks.length < 2) return null;
    const all = tracks.map(trackTraits);
    const order: Array<SeriesTrait['kind']> = ['marker', 'lang', 'genre', 'foreign'];
    const common = all[0]
        .filter((trait) => !skip.includes(trait.kind + ':' + trait.key) && all.every((list) => list.some((item) => item.kind === trait.kind && item.key === trait.key)))
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return common[0] ?? null;
}

// Поправка источников на один проход подбора (П9): выборка доли дослушанного из бета-распределения
// (1 + дослушано, 1 + ранних пропусков) у каждого источника, поправка log(доля / средняя доля) с потолком ±1.
// Источник без данных в карту не попадает и идёт без поправки
export function sourceBias(sources: TasteMaps['sources'], random: () => number = Math.random): Map<string, number> {
    // Гамма-распределение методом Марсальи-Цанга, нормальное по Боксу-Мюллеру
    const normal = (): number => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
    const gamma = (shape: number): number => {
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        for (let attempt = 0; attempt < 100; attempt++) {
            const x = normal();
            const v = Math.pow(1 + c * x, 3);
            if (v <= 0) continue;
            const u = Math.max(random(), 1e-12);
            if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
        }
        return shape;
    };
    const draws = new Map<string, number>();
    for (const [key, { done, early }] of sources) {
        const a = gamma(1 + done);
        const b = gamma(1 + early);
        draws.set(key, a + b > 0 ? a / (a + b) : 0.5);
    }
    const bias = new Map<string, number>();
    if (!draws.size) return bias;
    const mean = [...draws.values()].reduce((sum, value) => sum + value, 0) / draws.size;
    for (const [key, theta] of draws) bias.set(key, mean <= 0 ? 0 : theta > 0 ? Math.max(-1, Math.min(1, Math.log(theta / mean))) : -1);
    return bias;
}

export function tasteScore(track: WaveTrack, taste: TasteMaps): TasteScore {
    const artistId = trackArtist(track);
    const own = taste.tracks.get(track.id) ?? 0;
    const artist = taste.artists.get(artistId) ?? 0;
    const average = (keys: string[], map: Map<string, number>): { value: number; key: string; best: number } => {
        let sum = 0;
        let count = 0;
        let key = '';
        let best = 0;
        for (const item of keys) {
            const weight = map.get(item);
            if (weight === undefined) continue;
            sum += weight;
            count++;
            if (weight > best) {
                best = weight;
                key = item;
            }
        }
        return { value: count ? sum / count : 0, key, best };
    };
    // Анонимный ремикс без участников и имени исполнителя оценивается остальными частями, а не выпадает
    const parsed = parseTrackTitle(track.title);
    const uploader = nameKey(track.user?.username);
    // Жанр и метки долями, как в модели: одна совпавшая метка из пачки даёт десятую часть, а не вес жанра.
    // tagBest и tagKey это самый весомый вклад, по нему пишется причина «В духе ...»
    const tags = { value: 0, key: '', best: 0 };
    for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username, ...parsed.credits.map((item) => item.name)])) {
        const weight = taste.tags.get(key);
        if (weight === undefined) continue;
        tags.value += share * weight;
        if (share * weight > tags.best) {
            tags.best = share * weight;
            tags.key = key;
        }
    }
    let creditName = '';
    let creditBest = 0;
    let creditWorst = 0;
    let creditKnown = false;
    for (const credit of trackCredits(track, parsed)) {
        // Имя самого загрузчика уже учтено весом аккаунта
        if (credit.key === uploader) continue;
        const weight = taste.credits.get(credit.key);
        if (weight === undefined) continue;
        creditKnown = true;
        if (weight > creditBest) {
            creditBest = weight;
            creditName = credit.name;
        }
        creditWorst = Math.min(creditWorst, weight);
    }
    const credit = creditBest + creditWorst;
    const family = Math.max(0, taste.families.get(familyKey(track, parsed)) ?? 0);
    const marker = average([...new Set(parsed.version.map((item) => item.split(':')[0]))], taste.markers).value;
    // Плюс тегов насыщается до единицы: любимый жанр копит во вкусе десятки, и без насыщения он ставил больше половины
    // выдачи на потолок оценки, где порядок уже случаен. Минус нелюбимого жанра действует полностью (В2.8)
    const tag = tags.value > 0 ? tags.value / (1 + tags.value) : tags.value;
    // Язык против самого любимого языка, насыщенно и половинной долей (П6): любимый даёт 0, нелюбимый до -1.
    // Сравнение, а не сам вес: за год оба привычных языка копят десятки, и разницу даёт только соотношение
    let lang = 0;
    if (taste.langs.size) {
        const saturate = (value: number): number => value / (1 + Math.abs(value));
        const best = Math.max(0, ...taste.langs.values());
        lang = 0.5 * (saturate(taste.langs.get(trackLang(track)) ?? 0) - saturate(best));
    }
    return {
        score: own + artist + credit + family + marker + tag + lang,
        track: own,
        artist,
        credit,
        creditName,
        creditBest,
        family,
        marker,
        tag,
        lang,
        tagKey: tags.key,
        tagBest: tags.best,
        known: taste.artists.has(artistId) || creditKnown,
    };
}

// Порядок подборки по вкусу вместо перемешивания: взвешенная случайная выборка (чем выше оценка, тем раньше),
// треки с сильным минусом не берутся, не меньше 30% артистов без истории, чтобы волна не кормила сама себя.
// adjust: поправка сессии (пропуски и лайки в этой волне). Лайки трека на сайте идут слабым членом: при равном вкусе
// вперёд то, что понравилось многим (В2.12)
export function tasteOrder<T extends { track: WaveTrack }>(list: T[], taste: TasteMaps, random: () => number = Math.random, adjust?: (item: T) => number): T[] {
    const keyed: Array<{ item: T; known: boolean; key: number }> = [];
    for (const item of list) {
        const score = tasteScore(item.track, taste);
        if (score.track <= -1) continue;
        const likes = item.track.likes_count;
        const popular = typeof likes === 'number' && likes > 0 ? 0.05 * Math.log10(1 + likes) : 0;
        const weight = Math.exp(Math.max(-3, Math.min(3, score.score + popular + (adjust ? adjust(item) : 0))));
        keyed.push({ item, known: score.known, key: Math.log(Math.max(random(), 1e-12)) / weight });
    }
    keyed.sort((a, b) => b.key - a.key);
    const fresh = keyed.filter((entry) => !entry.known);
    const familiar = keyed.filter((entry) => entry.known);
    const ordered: T[] = [];
    let freshTaken = 0;
    while (fresh.length || familiar.length) {
        const needFresh = fresh.length > 0 && freshTaken < Math.floor(0.3 * (ordered.length + 1));
        const takeFresh = needFresh || !familiar.length || (fresh.length > 0 && fresh[0].key >= familiar[0].key);
        const next = takeFresh ? fresh.shift() : familiar.shift();
        if (!next) break;
        if (takeFresh) freshTaken++;
        ordered.push(next.item);
    }
    return ordered;
}

// Причина, когда трек поставила оценка: любимый артист или любимый тег. Похожее на зерно без явного вкуса не трогается
export function tasteReason(candidate: WaveCandidate, taste: TasteMaps): WaveReason | null {
    if (candidate.reason.kind !== 'similar' && candidate.reason.kind !== 'fresh') return null;
    const score = tasteScore(candidate.track, taste);
    const name = (candidate.track.user?.username ?? '').trim();
    // Любимый исполнитель из названия важнее канала, который его выложил
    if (score.creditName && score.creditBest >= 1 && score.creditBest > score.artist && score.creditBest >= score.tag) return { kind: 'tasteArtist', artist: score.creditName };
    if (name && score.artist >= 1 && score.artist >= score.tag) return { kind: 'tasteArtist', artist: name };
    if (!score.tagKey || score.tagBest < 1 || Math.max(score.artist, score.creditBest) >= 0.3) return null;
    // Ключ склеен genreCanon: написание ищется так же, среди жанра целиком, его частей и меток
    const genre = candidate.track.genre ?? '';
    const labels = [genre, ...genre.split(/\s+-\s+|[/,;|]+/), ...Array.from((candidate.track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2] ?? '')];
    const label = labels.find((item) => genreCanon(normalizeTag(item)) === score.tagKey);
    return label ? { kind: 'tasteTag', genre: label.trim().toLowerCase() } : null;
}

// Причина по вкусу только у заметной трети подборки: иначе с ростом журнала строка «почему» у всех одна и та же.
// Порог 0.5 это единица сырого веса тегов после насыщения
export function applyTasteReasons(list: WaveCandidate[], taste: TasteMaps): void {
    const scored = list
        .map((candidate) => ({ candidate, score: tasteScore(candidate.track, taste).score }))
        .filter((entry) => entry.score >= 0.5)
        .sort((a, b) => b.score - a.score);
    for (const { candidate } of scored.slice(0, Math.ceil(list.length * 0.3))) {
        const reason = tasteReason(candidate, taste);
        if (reason) candidate.reason = reason;
    }
}

// Отдельные вкусы: теги, которые встречаются у одних и тех же треков, склеиваются в группы по среднему сходству,
// трек уходит в группу, где у его тегов больше веса, трек без тегов идёт за своим артистом.
// Группа меньше minSize не живёт, остаются limit самых весомых.
// Один жанр в разных написаниях (Hip Hop/Rap, Hip-hop & Rap) это один ключ (genreCanon), составной жанр сайта
// («Hip Hop/Rap - Trap») даёт ключи своих частей; ники артистов в тегах, числа и обрывки короче трёх знаков вкус не описывают.
// Группа больше 40 треков делится вторым проходом: поджанр, который у треков стоит жанром, от minSize треков идёт своей группой
export function tasteGroups(items: Array<{ track: WaveTrack; weight: number }>, limit: number, minSize: number): TasteGroup[] {
    const names = new Set(items.map((item) => normalizeTag(item.track.user?.username ?? '')).filter(Boolean));
    const canon = genreCanon;
    const usable = (key: string): boolean => key.length >= 3 && !/^\d+$/.test(key) && !names.has(key);
    const genreOf = items.map((item) => genreParts(item.track.genre).filter(usable));
    const keysOf = items.map((item, i) => [...new Set([...genreOf[i], ...tagKeys(null, item.track.tag_list).map(canon)])].filter(usable));
    // Сколько треков несут ключ жанром, а не тегом: поджанром группы становится только настоящий жанр
    const asGenre = new Map<string, number>();
    for (const keys of genreOf) for (const key of keys) asGenre.set(key, (asGenre.get(key) ?? 0) + 1);
    const tagWeight = new Map<string, number>();
    const tagCount = new Map<string, number>();
    keysOf.forEach((keys, i) => {
        for (const key of keys) {
            tagWeight.set(key, (tagWeight.get(key) ?? 0) + items[i].weight);
            tagCount.set(key, (tagCount.get(key) ?? 0) + 1);
        }
    });
    const top = [...tagWeight].filter(([key]) => (tagCount.get(key) ?? 0) >= 3).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([key]) => key);
    const position = new Map(top.map((key, i) => [key, i]));
    const together = top.map(() => top.map(() => 0));
    for (const keys of keysOf) {
        const present = keys.map((key) => position.get(key)).filter((i): i is number => i !== undefined);
        for (const a of present) for (const b of present) if (a !== b) together[a][b]++;
    }
    const similarity = (a: number, b: number): number => together[a][b] / Math.sqrt((tagCount.get(top[a]) ?? 1) * (tagCount.get(top[b]) ?? 1));
    const clusters = top.map((_, i) => [i]);
    for (;;) {
        let best = 0.18;
        let pair: [number, number] | null = null;
        for (let x = 0; x < clusters.length; x++)
            for (let y = x + 1; y < clusters.length; y++) {
                let sum = 0;
                for (const a of clusters[x]) for (const b of clusters[y]) sum += similarity(a, b);
                const link = sum / (clusters[x].length * clusters[y].length);
                if (link > best) {
                    best = link;
                    pair = [x, y];
                }
            }
        if (!pair) break;
        clusters[pair[0]] = clusters[pair[0]].concat(clusters[pair[1]]);
        clusters.splice(pair[1], 1);
    }
    const clusterOf = new Map<string, number>();
    clusters.forEach((members, c) => {
        for (const i of members) clusterOf.set(top[i], c);
    });
    const assigned = items.map(() => -1);
    const artistVotes = new Map<number, Map<number, number>>();
    // Сборный канал выкладывает чужие песни разных жанров: трек, где в названии другой исполнитель, группу
    // аккаунта не наследует и за неё не голосует (раздел 7 плана)
    const own = items.map((item) => {
        const uploader = nameKey(item.track.user?.username);
        return !parseTrackTitle(item.track.title).credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    });
    const bestCluster = (keys: string[]): number => {
        const score = new Map<number, number>();
        for (const key of keys) {
            const c = clusterOf.get(key);
            if (c !== undefined) score.set(c, (score.get(c) ?? 0) + (tagWeight.get(key) ?? 0));
        }
        let best = -1;
        let bestScore = 0;
        for (const [c, value] of score)
            if (value > bestScore) {
                bestScore = value;
                best = c;
            }
        return best;
    };
    // Группу решает жанр трека: загрузчик ставит его один, а меток часто пишет пачку на все жанры сразу
    // (Alternative, Hip Hop, Ambient у каждого трека). Метки решают, только если жанра нет или по жанру группа не набирается
    const byGenre = genreOf.map(bestCluster);
    const genreSize = new Map<number, number>();
    for (const c of byGenre) if (c >= 0) genreSize.set(c, (genreSize.get(c) ?? 0) + 1);
    keysOf.forEach((keys, i) => {
        const c = byGenre[i];
        assigned[i] = c >= 0 && (genreSize.get(c) ?? 0) >= minSize ? c : bestCluster(keys);
        if (assigned[i] < 0 || !own[i]) return;
        const artist = trackArtist(items[i].track);
        const votes = artistVotes.get(artist) ?? new Map<number, number>();
        votes.set(assigned[i], (votes.get(assigned[i]) ?? 0) + 1);
        artistVotes.set(artist, votes);
    });
    items.forEach((item, i) => {
        const votes = assigned[i] < 0 && own[i] ? artistVotes.get(trackArtist(item.track)) : undefined;
        if (votes) assigned[i] = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    });
    // Написание тега: самое частое в поле жанра (целиком, иначе его часть), теги трека только если жанром ключ не встречался.
    // С одного трека один голос на ключ: «Hip Hop/Rap» не голосует ещё и за «Rap»
    const genreSpell = new Map<string, Map<string, number>>();
    const tagSpell = new Map<string, Map<string, number>>();
    const vote = (target: Map<string, Map<string, number>>, labels: string[]): void => {
        const seen = new Set<string>();
        for (const label of labels) {
            const key = canon(normalizeTag(label));
            if (!label || key.length < 3 || seen.has(key)) continue;
            seen.add(key);
            const counts = target.get(key) ?? new Map<string, number>();
            counts.set(label, (counts.get(label) ?? 0) + 1);
            target.set(key, counts);
        }
    };
    for (const item of items) {
        const genre = (item.track.genre ?? '').trim();
        vote(genreSpell, [genre, ...genre.split(/\s+-\s+|[/,;|]+/).map((part) => part.trim())]);
        vote(tagSpell, [...(item.track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)].map((match) => (match[1] ?? match[2] ?? '').trim()));
    }
    const spelling = (key: string): string => {
        const counts = genreSpell.get(key) ?? tagSpell.get(key);
        return counts ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : key;
    };
    type Draft = { keys: Map<string, number>; tracks: Array<{ track: WaveTrack; weight: number }>; weight: number };
    const groups: Draft[] = clusters.map(() => ({ keys: new Map<string, number>(), tracks: [], weight: 0 }));
    const members: number[][] = clusters.map(() => []);
    items.forEach((item, i) => {
        const group = groups[assigned[i]];
        if (!group) return;
        members[assigned[i]].push(i);
        group.tracks.push(item);
        group.weight += item.weight;
        for (const key of keysOf[i]) if (clusterOf.get(key) === assigned[i]) group.keys.set(key, (group.keys.get(key) ?? 0) + item.weight);
    });
    // Второй проход: большая группа отдаёт поджанры. Кандидат это ключ-жанр (не главный ключ группы), который у треков
    // этой группы встречается от minSize раз; трек уходит в первый по размеру кандидат из своих ключей
    const split: Draft[] = [];
    groups.forEach((group, c) => {
        if (members[c].length <= 40) return;
        const head = [...group.keys].sort((a, b) => b[1] - a[1])[0]?.[0];
        // Поджанр тоже по жанру трека, метки только у трека без жанра
        const own = (i: number): string[] => (genreOf[i].length ? genreOf[i] : keysOf[i]);
        const counts = new Map<string, number>();
        for (const i of members[c]) for (const key of own(i)) if (key !== head && (asGenre.get(key) ?? 0) >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
        const candidates = [...counts].filter(([, count]) => count >= minSize).sort((a, b) => b[1] - a[1]).map(([key]) => key);
        if (!candidates.length) return;
        const parts = new Map<string, number[]>(candidates.map((key) => [key, []]));
        for (const i of members[c]) {
            const key = candidates.find((candidate) => own(i).includes(candidate));
            if (key) parts.get(key)?.push(i);
        }
        const moved = new Set<number>();
        const movedKeys = new Set<string>();
        for (const [key, list] of parts) {
            if (list.length < minSize) continue;
            const draft: Draft = { keys: new Map(), tracks: [], weight: 0 };
            for (const i of list) {
                moved.add(i);
                draft.tracks.push(items[i]);
                draft.weight += items[i].weight;
                draft.keys.set(key, (draft.keys.get(key) ?? 0) + items[i].weight);
            }
            movedKeys.add(key);
            split.push(draft);
        }
        if (!moved.size) return;
        // Остаток большой группы собирается заново: без ушедших треков и без ключей поджанров
        const rest = members[c].filter((i) => !moved.has(i));
        group.tracks = rest.map((i) => items[i]);
        group.weight = group.tracks.reduce((sum, entry) => sum + entry.weight, 0);
        group.keys = new Map();
        for (const i of rest) for (const key of keysOf[i]) if (clusterOf.get(key) === c && !movedKeys.has(key)) group.keys.set(key, (group.keys.get(key) ?? 0) + items[i].weight);
    });
    // Поджанр одной группы бывает главным ключом другой (Alternative внутри Alternative Rock): такие склеиваются в одну
    const byHead = new Map<string, Draft>();
    const merged: Draft[] = [];
    for (const group of [...groups, ...split]) {
        const head = [...group.keys].sort((a, b) => b[1] - a[1])[0]?.[0];
        const same = head === undefined ? undefined : byHead.get(head);
        if (!same) {
            if (head !== undefined) byHead.set(head, group);
            merged.push(group);
            continue;
        }
        same.tracks.push(...group.tracks);
        same.weight += group.weight;
        for (const [key, weight] of group.keys) same.keys.set(key, (same.keys.get(key) ?? 0) + weight);
    }
    return merged
        .filter((group) => group.tracks.length >= minSize)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit)
        .map((group) => {
            const ranked = [...group.keys].sort((a, b) => b[1] - a[1]).slice(0, 6);
            const keys = ranked.map(([key]) => key);
            // В название идут теги не слабее 40% главного: редкий попутный тег группу не описывает
            const strong = ranked.filter(([, weight]) => weight >= 0.4 * (ranked[0]?.[1] ?? 0)).map(([key]) => key);
            return {
                keys,
                labels: strong.map(spelling),
                tracks: group.tracks.sort((a, b) => b.weight - a.weight).map((entry) => entry.track),
                weight: group.weight,
            };
        });
}

// Находки дня: неслышанные записи из похожих на любимое. Знакомый аккаунт не исключается и может дать несколько
// треков (раздел 7 плана, A01, A03); из вероятных копий одной версии остаётся лучшая по вкусу, а не пришедшая первой.
// Порядок по вкусу со случайностью, без профиля вкуса перемешиванием; один аккаунт не идёт подряд, если есть другие
export function pickFinds(
    candidates: WaveTrack[], blocked: (track: WaveTrack) => boolean, taste: TasteMaps | null, limit: number, random: () => number = Math.random,
): WaveTrack[] {
    const best = new Map<string, { track: WaveTrack; score: number }>();
    for (const track of candidates) {
        if (!isWaveEligible(track) || blocked(track)) continue;
        const key = copyKey(track);
        const score = taste ? tasteScore(track, taste).score : 0;
        const known = copyKeys(track).map((item) => best.get(item)).find((entry) => entry !== undefined);
        if (known && (known.score > score || (known.score === score && known.track.id <= track.id))) continue;
        if (known) best.delete(copyKey(known.track));
        best.set(key, { track, score });
    }
    const fresh = [...best.values()].sort((a, b) => a.track.id - b.track.id).map((entry) => ({ track: entry.track }));
    const ordered = taste ? tasteOrder(fresh, taste, random) : shuffleInPlace(fresh);
    // Не больше трёх треков аккаунта, пока есть чем заменить: похожие у маленьких артистов часто замкнуты на каталог
    // любимого, и он забирал бы находки. Кандидатов мало - добор остатком (A01: знакомый аккаунт может дать несколько)
    const tracks = ordered.map((entry) => entry.track);
    const capped = capPerArtist(tracks, 3);
    return spreadBy([...capped, ...tracks.filter((track) => !capped.includes(track))].slice(0, limit), trackArtist, 1);
}

// Настроение зёрен для запасного пути волны: их жанр и теги, а если их нет, самые весомые жанры и теги
// среди похожих (включая отсеянные) в том написании, что встречается чаще. Вес как во вкусе (tagShares): жанр 1,
// метки вместе 0.5, ник исполнителя и числа не в счёт. Среди похожих аккаунт голосует за метку один раз:
// загрузчик, который ставит одну метку-спам на все свои треки, настроение не перетягивает
export function moodTags(seeds: WaveTrack[], around: WaveTrack[], limit: number): string[] {
    const count = (tracks: WaveTrack[], onePerAccount: boolean): string[] => {
        const found = new Map<string, { weight: number; spellings: Map<string, number> }>();
        const voted = new Set<string>();
        for (const track of tracks) {
            // Написание каждого ключа в этом треке: жанр целиком, его части и метки
            const genre = (track.genre ?? '').trim();
            const labels = [genre, ...genre.split(/\s+-\s+|[/,;|]+/)];
            for (const match of (track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)) labels.push(match[1] ?? match[2] ?? '');
            const spelled = new Map<string, string>();
            for (const label of labels) {
                const text = label.trim().toLowerCase();
                const key = genreCanon(normalizeTag(text));
                if (key && !spelled.has(key)) spelled.set(key, text);
            }
            const account = trackArtist(track);
            for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username, ...trackCredits(track).map((credit) => credit.name)])) {
                if (onePerAccount && account) {
                    if (voted.has(account + ' ' + key)) continue;
                    voted.add(account + ' ' + key);
                }
                const entry = found.get(key) ?? { weight: 0, spellings: new Map<string, number>() };
                entry.weight += share;
                const text = spelled.get(key) ?? key;
                entry.spellings.set(text, (entry.spellings.get(text) ?? 0) + 1);
                found.set(key, entry);
            }
        }
        return [...found.values()]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, limit)
            .map((entry) => [...entry.spellings].sort((a, b) => b[1] - a[1])[0][0]);
    };
    const own = count(seeds, false);
    return own.length ? own : count(around, true);
}
