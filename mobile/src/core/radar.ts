// Радар релизов: копия чистых частей desktop-файла services/radar.ts (свежесть конкретной версии, оценка по вкусу, отбор
// до 50 записей с мягким разнообразием, группы исполнителей, архив, пачки без дат). Правки относительно desktop:
// StoredUpload описан здесь, хранилища, запретов семей, покрытия обхода и плана источников нет (их заменяет
// src/wave/radar.ts), выпуск собирается без истории прошлых выпусков и без подтверждённых копий.
import { copyKeys, familyKey, nameKey, performerKey, trackCredits, type TrackCredit } from './trackIdentity';
import { tagShares } from './waveGenres';
import { tasteMaps, tasteScore } from './waveTaste';
import type { TasteMaps, WaveTrack } from './waveTypes';

/** Загрузка в том виде, в каком её видит радар (на desktop это строка хранилища рекомендаций) */
export interface StoredUpload {
    key: string;
    id: number;
    uploader: number;
    uploaderName: string;
    title: string;
    credits: TrackCredit[];
    isrc: string;
    duration: number;
    createdAt: number;
    displayAt: number;
    releaseDay: string;
    genre: string;
    tags: string;
}

const DAY = 86400000;

/** Параметры радара; version растёт при каждом изменении их смысла и попадает в выпуск.
 *  4: потолок аккаунта и в «Новых загрузках» (26.09.2026).
 *  5: прибавка свежести только последним трём дням окна, недобор открытий отдаётся связанным (28.09.2026).
 *  6: фанатские работы отдельной карточкой, архивные записи вниз своего списка (02.10.2026) */
export const RADAR_PARAMS = {
    version: 6,
    /** Окно свежести версии, дни до отсечки. Неделя между выпусками (решение владельца 25.09.2026, было 28) */
    windowDays: 7,
    /** Последние дни окна получают небольшую прибавку. Меньше окна: при равных днях она доставалась всем */
    recentDays: 3,
    recentBonus: 0.05,
    size: 50,
    /** Потолок одного аккаунта в основном списке (решение владельца 25.09.2026): остальное видно в «Всех найденных» */
    perUploader: 3,
    /** Пачка (решение владельца 25.09.2026): больше bulkSize записей аккаунта без даты релиза за bulkDays это выгрузка
     *  каталога, а не релизы; релизами остаются bulkKeep лучших, прочее уходит в «Новые загрузки» */
    bulkSize: 6,
    bulkDays: 7,
    bulkKeep: 2,
    /** Открытия (решение владельца 25.09.2026): записи без связи со вкусом, только по жанру, занимают в конце
     *  основного списка не больше стольких мест; остальное место у связанных */
    discoveries: 10,
    /** Аккаунт или участник связан со вкусом с этого веса: один лайк или одно прослушивание дают около 0.1 */
    linkWeight: 0.3,
    /** Сколько «Новых загрузок» показывать отдельно */
    uploadsSize: 30,
    /** Фанатские работы (перезалив, ремикс, эдит чужой песни не подписки без ISRC и даты релиза): своя карточка, до стольких */
    fansSize: 30,
    /** Архив: год в названии старше стольких лет у записи без даты релиза в окне, штраф к оценке */
    archiveYears: 5,
    archivePenalty: 0.3,
    /** «Все найденные»: не больше */
    foundSize: 300,
    /** Прибавка недопредставленному направлению не больше этой величины (раздел 6.2) */
    diversityCap: 0.1,
    /** Для разнообразия на шаге рассматриваются записи не ниже лучшей оставшейся на эту величину */
    diversityWindow: 0.15,
    /** Штраф за повтор семьи версий или аккаунта в выпуске, с пределом */
    repeatPenalty: 0.04,
    repeatCap: 0.1,
    /** Отметка «слышано»: доля уникального покрытия, у записей короче 30 секунд строже */
    heardShare: 0.7,
    heardShareShort: 0.8,
    /** Аккаунты-кураторы из вкуса в обходе: не больше и не слабее */
    curators: 100,
    curatorWeight: 0.3,
    follows: 2000,
    /** Поиск свежего по любимым участникам */
    searches: 20,
    searchWeight: 0.5,
};

export type Freshness = 'release' | 'upload' | 'old' | 'future';
/** Свежесть конкретной версии в окне [from, to]. release: дата версии доказана и в окне; upload: свежа только
 *  публикация (перезалив, чужой канал без даты релиза, старая дата релиза) и место ей в «Новых загрузках» */
export function freshness(upload: Pick<StoredUpload, 'createdAt' | 'displayAt' | 'releaseDay' | 'uploaderName' | 'credits'>, earlierCopy: boolean, from: number, to: number): { kind: Freshness; at: number } {
    const published = upload.displayAt || upload.createdAt;
    const release = /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay) ? Date.parse(upload.releaseDay + 'T00:00:00Z') : NaN;
    // К отсечке запись ещё не была опубликована: её место в следующем выпуске, какой бы ни была дата релиза
    if (published > to) return { kind: 'future', at: published };
    if (Number.isFinite(release)) {
        // Будущий релиз ждёт своей даты; заявленная старая дата делает свежую публикацию перезаливом
        if (release > to) return { kind: 'future', at: release };
        if (release >= from) return { kind: 'release', at: release };
        return published >= from && published <= to ? { kind: 'upload', at: published } : { kind: 'old', at: release };
    }
    if (!published || published < from) return { kind: 'old', at: published };
    if (earlierCopy) return { kind: 'upload', at: published };
    // Дата публикации доказывает версию, только если аккаунт выложил своё: исполнитель или автор этой переделки.
    // Сборный канал с чужой песней без даты релиза даёт лишь свежую загрузку
    const uploader = nameKey(upload.uploaderName);
    const credits: TrackCredit[] = Array.isArray(upload.credits) ? upload.credits : [];
    const foreign = credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    const ownRework = credits.some((credit) => credit.role === 'remixer' && credit.key === uploader);
    return { kind: !foreign || ownRework ? 'release' : 'upload', at: published };
}

/** Строка хранилища обратно в трек для оценки вкусом; участники из метаданных возвращаются туда же, откуда их берёт разбор */
export function uploadTrack(upload: StoredUpload): WaveTrack {
    const names = (role: TrackCredit['role']): string | null =>
        upload.credits.filter((credit) => credit.source === 'metadata' && credit.role === role).map((credit) => credit.name).join(', ') || null;
    return {
        id: upload.id, kind: 'track', title: upload.title, user_id: upload.uploader, user: { id: upload.uploader, username: upload.uploaderName },
        duration: upload.duration, genre: upload.genre, tag_list: upload.tags,
        publisher_metadata: { artist: names('artist'), writer_composer: names('writer'), isrc: upload.isrc || null },
    };
}

export type RadarReason = { kind: 'artist'; name: string } | { kind: 'follow'; name: string } | { kind: 'tag'; tag: string } | { kind: 'taste' };
/** Кандидат с оценкой: base 0..1 из вкуса, direction для разнообразия, family и uploader для штрафа повтора */
export interface RadarCandidate {
    key: string;
    id: number;
    base: number;
    direction: string;
    family: string;
    uploader: number;
    kind: Freshness;
    at: number;
    heard: boolean;
    /** Связь со вкусом: подписка, аккаунт или участник из вкуса, сама запись или другая версия любимой песни.
     *  Без неё запись это открытие по жанру */
    linked: boolean;
    reason: RadarReason;
    /** Исполнитель для группы выпуска (performerKey): свой загрузчик или исполнитель у сборного канала */
    performer: string;
    /** Фанатская работа: чужая песня у аккаунта не из подписок, без ISRC и даты релиза */
    fan: boolean;
    /** Архивная запись: в названии год старше archiveYears, даты релиза в окне нет */
    archive: boolean;
}
export interface RadarPick extends RadarCandidate {
    bonus: number;
    penalty: number;
    score: number;
}

// Оценка по вкусу в 0..1: насыщение, чтобы один огромный вес не делал остальное неразличимым
export const baseScore = (score: number): number => (score > 0 ? 1 - Math.exp(-score / 2) : 0);

/** Кандидат из загрузки или null, если вкус против неё (сильный минус трека) или связи со вкусом нет вовсе */
export function scoreUpload(upload: StoredUpload, kind: Freshness, at: number, maps: TasteMaps, follows: Set<number>, heard: boolean, to: number): RadarCandidate | null {
    const track = uploadTrack(upload);
    const score = tasteScore(track, maps);
    if (score.track <= -1) return null;
    const followed = follows.has(upload.uploader);
    // Подписка без истории всё равно слабая связь: её релиз может войти, если остальное не против
    const raw = score.score + (followed && score.artist <= 0 ? 0.5 : 0);
    if (raw <= 0) return null;
    const base = Math.min(1, baseScore(raw) + (to - at <= RADAR_PARAMS.recentDays * DAY ? RADAR_PARAMS.recentBonus : 0));
    const reason: RadarReason = score.creditName && score.creditBest >= Math.max(score.artist, score.tag, 0.3)
        ? { kind: 'artist', name: score.creditName }
        : followed
            ? { kind: 'follow', name: upload.uploaderName }
            : score.artist >= Math.max(score.tag, 0.3) && upload.uploaderName
                ? { kind: 'artist', name: upload.uploaderName }
                : score.tagKey
                    ? { kind: 'tag', tag: score.tagKey }
                    : { kind: 'taste' };
    const linked = followed || score.artist >= RADAR_PARAMS.linkWeight || score.creditBest >= RADAR_PARAMS.linkWeight || score.track > 0 || score.family > 0;
    const credits = Array.isArray(upload.credits) ? upload.credits : [];
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay);
    const archive = !(kind === 'release' && dated) && archiveTitle(upload.title, to);
    return {
        key: upload.key, id: upload.id, base: archive ? Math.max(0, base - RADAR_PARAMS.archivePenalty) : base,
        direction: score.tagKey || tagShares(upload.genre, upload.tags, [upload.uploaderName])[0]?.[0] || '', family: familyKey(track) || upload.key,
        uploader: upload.uploader, kind, at, heard, linked, reason, performer: performerKey(upload.uploader, upload.uploaderName, credits),
        fan: !followed && !upload.isrc && !dated && fanWork(upload.uploaderName, credits), archive,
    };
}

/** Чужая песня: исполнители в титрах есть, загрузчика среди них нет. Ремикс и эдит чужой песни сюда же, даже если
 *  загрузчик указан ремиксером (П10): это переделка, а не релиз исполнителя */
export function fanWork(uploaderName: string, credits: TrackCredit[]): boolean {
    const own = nameKey(uploaderName);
    const artists = credits.filter((credit) => credit.role === 'artist' && credit.key);
    return artists.length > 0 && !artists.some((credit) => credit.key === own);
}

/** Архив по названию: год 1950-2099 отдельным числом не позже чем archiveYears лет до года отсечки («1979», «(Live 2008)») */
export function archiveTitle(title: string, to: number): boolean {
    const limit = new Date(to).getUTCFullYear() - RADAR_PARAMS.archiveYears;
    return Array.from(title.matchAll(/(?<!\d)(19[5-9]\d|20\d\d)(?!\d)/g), (match) => Number(match[1])).some((year) => year <= limit);
}

/** Архивные записи вниз своего списка, порядок внутри частей прежний */
export function archiveLast<T extends { archive: boolean }>(items: T[]): T[] {
    return [...items.filter((item) => !item.archive), ...items.filter((item) => item.archive)];
}

/** Группы выпуска (решение владельца 26.09.2026): записи одного исполнителя одного вида одной строкой, как один трек
 *  артиста в Release Radar. Ведёт лучшая по оценке, в group все записи группы по дате, при равенстве по id */
export function performerGroups(candidates: RadarCandidate[]): Array<{ lead: RadarCandidate; group: RadarCandidate[] }> {
    const byPerformer = new Map<string, RadarCandidate[]>();
    for (const candidate of candidates) {
        const key = candidate.kind + '|' + candidate.performer;
        const list = byPerformer.get(key) ?? [];
        list.push(candidate);
        byPerformer.set(key, list);
    }
    return [...byPerformer.values()].map((list) => ({
        lead: list.reduce((best, item) => (item.base > best.base || (item.base === best.base && item.id < best.id) ? item : best)),
        group: list.slice().sort((a, b) => a.at - b.at || a.id - b.id),
    }));
}

/** Отбор с мягким разнообразием (раздел 6.2): на каждом шаге среди записей не ниже лучшей оставшейся на diversityWindow
 *  берётся максимум базовой оценки плюс прибавка недопредставленному направлению минус ограниченный штраф повтора.
 *  history: направления прошлых выпусков. Квот и потолков жанра нет; perUploader: потолок одного аккаунта в списке,
 *  его остаток список не добивает. Один ввод даёт один результат */
export function selectRadar(candidates: RadarCandidate[], history: string[][], size: number = RADAR_PARAMS.size, perUploader = Infinity): RadarPick[] {
    const P = RADAR_PARAMS;
    let rest = candidates.slice().sort((a, b) => b.base - a.base || a.id - b.id);
    const past = new Map<string, number>();
    for (const edition of history) for (const direction of edition) past.set(direction, (past.get(direction) ?? 0) + 1 / Math.max(1, edition.length));
    const directions = new Map<string, number>();
    const families = new Map<string, number>();
    const uploaders = new Map<number, number>();
    const picked: RadarPick[] = [];
    while (picked.length < size && rest.length) {
        const best = rest[0].base;
        let chosen = -1;
        let chosenPick: RadarPick | null = null;
        for (let i = 0; i < rest.length && rest[i].base >= best - P.diversityWindow; i++) {
            const item = rest[i];
            // Первое появление направления получает полную прибавку, дальше она убывает. Доля направления в прошлых
            // выпусках тоже уменьшает прибавку: редкое там и здесь получает её полностью
            const seen = (directions.get(item.direction) ?? 0) + 4 * (past.get(item.direction) ?? 0) / Math.max(1, history.length);
            const bonus = item.direction ? P.diversityCap / (1 + seen) : 0;
            const repeats = (families.get(item.family) ?? 0) + (uploaders.get(item.uploader) ?? 0);
            const penalty = Math.min(P.repeatCap, P.repeatPenalty * repeats);
            const score = item.base + bonus - penalty;
            if (!chosenPick || score > chosenPick.score || (score === chosenPick.score && item.id < chosenPick.id)) {
                chosen = i;
                chosenPick = { ...item, bonus, penalty, score };
            }
        }
        if (!chosenPick || chosen < 0) break;
        const pick = chosenPick;
        rest.splice(chosen, 1);
        picked.push(pick);
        directions.set(pick.direction, (directions.get(pick.direction) ?? 0) + 1);
        families.set(pick.family, (families.get(pick.family) ?? 0) + 1);
        const count = (uploaders.get(pick.uploader) ?? 0) + 1;
        uploaders.set(pick.uploader, count);
        // Аккаунт набрал свой потолок: остальные его записи в этом списке больше не рассматриваются
        if (count >= perUploader) rest = rest.filter((item) => item.uploader !== pick.uploader);
    }
    return picked;
}

/** Основной список выпуска (решение владельца 25.09.2026): сначала записи со связью со вкусом, в конце не больше
 *  discoveries открытий по жанру, которые всегда ниже связанных. Потолок аккаунта общий для обеих частей.
 *  Открытий набралось меньше отложенных под них мест (потолок аккаунта их срезал): места возвращаются связанным.
 *  Отбор жадный, поэтому первые N записей полного списка связанных совпадают с отбором на N мест */
export function selectEdition(releases: RadarCandidate[], history: string[][]): RadarPick[] {
    const P = RADAR_PARAMS;
    const open = releases.filter((candidate) => !candidate.linked);
    const reserve = Math.min(P.discoveries, open.length);
    const linkedAll = selectRadar(releases.filter((candidate) => candidate.linked), history, P.size, P.perUploader);
    const linked = linkedAll.slice(0, P.size - reserve);
    const used = new Map<number, number>();
    for (const pick of linked) used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    const discoveries = selectRadar(open.filter((candidate) => (used.get(candidate.uploader) ?? 0) < P.perUploader), history, Math.min(P.discoveries, P.size - linked.length), P.perUploader);
    for (const pick of discoveries) used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    for (const pick of linkedAll.slice(linked.length)) {
        if (linked.length + discoveries.length >= P.size) break;
        if ((used.get(pick.uploader) ?? 0) >= P.perUploader) continue;
        linked.push(pick);
        used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    }
    return [...linked, ...discoveries];
}
/** Уже слышанное и лайкнутое в конец выпуска (решение владельца 28.09.2026), порядок внутри частей прежний */
export function heardLast<T extends { heard: boolean }>(items: T[]): T[] {
    return [...items.filter((item) => !item.heard), ...items.filter((item) => item.heard)];
}

export interface RadarItem {
    key: string;
    id: number;
    title: string;
    artist: string;
    kind: 'release' | 'upload';
    at: number;
    heard: boolean;
    score: number;
    base: number;
    bonus: number;
    penalty: number;
    direction: string;
    reason: RadarReason;
    /** Только в «Всех найденных»: найдено или опубликовано после выпуска */
    after?: boolean;
    /** Все записи группы исполнителя по дате, включая эту; только если записей больше одной */
    group?: number[];
    /** Фанатская работа: в выпуске лежит в uploads и показывается карточкой «Ремиксы и эдиты» (алгоритм 6) */
    fan?: true;
}

export interface RadarEdition {
    created: number;
    cutoff: number;
    algorithm: number;
    items: RadarItem[];
    uploads: RadarItem[];
}
export interface RadarInput {
    now: number;
    cutoff: number;
    uploads: StoredUpload[];
    /** Ключи загрузок, у которых есть копия той же версии раньше хотя бы на сутки */
    reuploads: Set<string>;
    /** Вкус; без него (null) в выпуск попадают только подписки */
    maps: TasteMaps | null;
    follows: number[];
    /** Отметка «слышано» по id */
    heard: Set<number>;
    /** Запрет: «Не нравится» и скрытые аккаунты */
    excluded: (upload: StoredUpload) => boolean;
    /** Подтверждённые группы записей: копии одной записи в выпуске одной строкой */
    groups: Map<string, string>;
    history: string[][];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
const asItem = (pick: RadarPick, upload: StoredUpload, group: RadarCandidate[] = []): RadarItem => ({
    ...(pick.fan ? { fan: true as const } : {}),
    key: pick.key, id: pick.id, title: upload.title, artist: upload.uploaderName, kind: pick.kind === 'upload' ? 'upload' : 'release', at: pick.at,
    heard: pick.heard, score: round(pick.score), base: round(pick.base), bonus: round(pick.bonus), penalty: round(pick.penalty), direction: pick.direction, reason: pick.reason,
    ...(group.length > 1 ? { group: group.map((member) => member.id) } : {}),
});

/** Кандидаты окна [from, to] после запретов и склейки копий: и для выпуска, и для «Всех найденных» */
export function radarCandidates(input: RadarInput, from: number, to: number): RadarCandidate[] {
    const maps = input.maps ?? tasteMaps({});
    if (!maps) return [];
    const follows = new Set(input.follows);
    // Вероятные и подтверждённые копии одной версии в выпуске одной строкой: остаётся релиз раньше перезалива,
    // затем лучшая оценка, при равенстве меньший id. Порядок входа не решает, какая копия остаётся
    // Запись отмечается ключом подтверждённой группы и серединой ключей вероятной копии; новая ищет свои ключи
    // с соседними шагами длительности. Так копия члена группы тоже склеивается с ним
    interface Entry { candidate: RadarCandidate; centers: string[] }
    const index = new Map<string, Entry>();
    const better = (a: RadarCandidate, b: RadarCandidate): boolean =>
        a.kind !== b.kind ? a.kind === 'release' : a.base !== b.base ? a.base > b.base : a.id < b.id;
    for (const upload of input.uploads.slice().sort((a, b) => a.id - b.id)) {
        if (input.excluded(upload)) continue;
        const { kind, at } = freshness(upload, input.reuploads.has(upload.key), from, to);
        if (kind !== 'release' && kind !== 'upload') continue;
        const candidate = scoreUpload(upload, kind, at, maps, follows, input.heard.has(upload.id), to);
        if (!candidate) continue;
        const root = input.groups.get(upload.key);
        const copies = copyKeys(uploadTrack(upload));
        const lookups = root ? ['g:' + root, ...copies] : copies;
        const entry: Entry = { candidate, centers: [...(root ? ['g:' + root] : []), copies.length === 3 ? copies[1] : copies[0]] };
        const rivals = new Set<Entry>();
        for (const key of lookups) {
            const rival = index.get(key);
            if (rival) rivals.add(rival);
        }
        if ([...rivals].some((rival) => better(rival.candidate, candidate))) continue;
        for (const rival of rivals) for (const key of rival.centers) if (index.get(key) === rival) index.delete(key);
        for (const key of entry.centers) index.set(key, entry);
    }
    return demoteBulk([...new Set(index.values())].map((entry) => entry.candidate), input.uploads);
}

/** Пачка без дат релиза (решение владельца 25.09.2026): аккаунт, выложивший за bulkDays больше bulkSize записей, чья
 *  свежесть доказана только публикацией, скорее выгружает старый каталог. Релизами остаются bulkKeep лучших по оценке,
 *  остальные становятся «Новыми загрузками». Записи с датой релиза в счёт не идут и не трогаются */
export function demoteBulk(candidates: RadarCandidate[], uploads: StoredUpload[]): RadarCandidate[] {
    const P = RADAR_PARAMS;
    const dated = new Set(uploads.filter((upload) => /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay)).map((upload) => upload.key));
    const undated = new Map<number, RadarCandidate[]>();
    for (const candidate of candidates) {
        if (candidate.kind !== 'release' || dated.has(candidate.key)) continue;
        const list = undated.get(candidate.uploader) ?? [];
        list.push(candidate);
        undated.set(candidate.uploader, list);
    }
    const demoted = new Set<string>();
    for (const list of undated.values()) {
        if (list.length <= P.bulkSize) continue;
        const times = list.map((candidate) => candidate.at).sort((a, b) => a - b);
        let bulk = false;
        for (let start = 0, end = 0; end < times.length && !bulk; end++) {
            while (times[end] - times[start] > P.bulkDays * DAY) start++;
            bulk = end - start + 1 > P.bulkSize;
        }
        if (!bulk) continue;
        const ranked = list.slice().sort((a, b) => b.base - a.base || a.id - b.id);
        for (const candidate of ranked.slice(P.bulkKeep)) demoted.add(candidate.key);
    }
    return candidates.map((candidate): RadarCandidate => (demoted.has(candidate.key) ? { ...candidate, kind: 'upload' } : candidate));
}

/** Выпуск целиком: релизы окна до 50 и отдельно новые загрузки */
export function buildRadar(input: RadarInput): RadarEdition {
    const P = RADAR_PARAMS;
    const byKey = new Map(input.uploads.map((upload) => [upload.key, upload]));
    const releases: RadarCandidate[] = [];
    const fresh: RadarCandidate[] = [];
    const fans: RadarCandidate[] = [];
    for (const candidate of radarCandidates(input, input.cutoff - P.windowDays * DAY, input.cutoff)) (candidate.fan ? fans : candidate.kind === 'release' ? releases : fresh).push(candidate);
    // Отбор идёт по ведущим групп: потолок аккаунта считает группы, остальные записи исполнителя едут в group
    const releaseGroups = performerGroups(releases);
    const freshGroups = performerGroups(fresh);
    const fanGroups = performerGroups(fans);
    const groupOf = new Map([...releaseGroups, ...freshGroups, ...fanGroups].map((entry) => [entry.lead.key, entry.group]));
    const item = (pick: RadarPick): RadarItem | null => {
        const upload = byKey.get(pick.key);
        return upload ? asItem(pick, upload, groupOf.get(pick.key)) : null;
    };
    return {
        created: input.now,
        cutoff: input.cutoff,
        algorithm: P.version,
        items: archiveLast(selectEdition(releaseGroups.map((entry) => entry.lead), input.history)).map(item).filter((entry): entry is RadarItem => entry !== null),
        // Тот же потолок аккаунта, что в основном списке: сборный канал с тридцатью исполнителями иначе занимает все места.
        // Фанатские работы лежат там же с пометкой fan, без смены схемы хранилища
        uploads: [
            ...archiveLast(selectRadar(freshGroups.map((entry) => entry.lead), [], P.uploadsSize, P.perUploader)),
            ...archiveLast(selectRadar(fanGroups.map((entry) => entry.lead), [], P.fansSize, P.perUploader)),
        ].map(item).filter((entry): entry is RadarItem => entry !== null),
    };
}

