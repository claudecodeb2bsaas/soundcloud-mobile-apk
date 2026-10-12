// Версии треков: разбор названия, роли участников и ключи совпадений (раздел 4.2 плана радара).
// Загрузка, запись, версия и композиция разные вещи: совпавший id это та же публикация, подтверждённая связь
// та же запись, совпадение названия и длительности только вероятная копия.
// Функции уходят на страницу текстом вместе с волной (identityHelpers), поэтому не ссылаются на импорты
// и константы модуля, только друг на друга по имени.
import type { WaveTrack } from './waveTypes';

/** Версия разбора: хранилище помнит, каким разбором посчитаны ключи загрузки. Только для Node, на страницу не уходит */
export const IDENTITY_VERSION = 1;

/** Автор версии (ремикс, эдит, флип, кавер) идёт ролью remixer, автор песни из метаданных ролью writer */
export type CreditRole = 'artist' | 'featured' | 'remixer' | 'producer' | 'writer';
export interface TrackCredit {
    name: string;
    key: string;
    role: CreditRole;
    /** Название трека или метаданные издателя: и то и другое гипотеза, а не подтверждение */
    source: 'title' | 'metadata';
}
export interface TitleSegment {
    version: string[];
    credits: TrackCredit[];
}
export interface ParsedTitle {
    raw: string;
    /** Название без пометок версии, участников и мусора; бывает пустым */
    base: string;
    baseKey: string;
    /** Пометки версии без повторов по алфавиту: reverb, remix:altare, slowed, version:guitar. У оригинала пусто */
    version: string[];
    credits: TrackCredit[];
    /** Ремикс, эдит или кавер без имени автора: такую версию отличает загрузчик */
    anonymous: boolean;
}
/** Уровень совпадения двух загрузок: запрет и «уже слышано» переносятся только при confirmed */
export type MatchLevel = 'same-upload' | 'confirmed' | 'probable' | 'version' | 'none';
/** Связь записей по ключам загрузок. same=false отменяет прежнее объединение этой пары */
export interface RecordingLink {
    a: string;
    b: string;
    same: boolean;
    source: 'user' | 'catalog';
    at: number;
}
export interface SearchQuery {
    /** exact: эта версия; versions: другие версии песни; songs: другие песни участников */
    purpose: 'exact' | 'versions' | 'songs';
    q: string;
}

// Юникод, тире, кавычки и пробелы к одному виду; регистр остаётся для показа и поиска
export function identityText(text: string): string {
    return text
        .normalize('NFKC')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
        .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

// Ключ сравнения: без регистра, диакритики, пробелов и знаков, & как and
export function identityKey(text: string): string {
    return identityText(text).toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// Имя аккаунта или участника до первой вертикальной черты: дальше обычно теги канала
export function nameKey(name: string | null | undefined): string {
    return identityKey(identityText(name ?? '').split('|')[0]);
}

// «A, B & C x D» по одному имени
export function splitNames(text: string): string[] {
    return identityText(text)
        .split(/\s*(?:,|&|\+|\/|;)\s*|\s+(?:x|and|и|vs\.?|feat\.?|ft\.?|featuring|with)\s+/i)
        .map((name) => name.replace(/^[\s\-:.'"]+|[\s\-:.'"]+$/g, ''))
        .filter((name) => identityKey(name).length > 0);
}

// Одна пометка версии целиком: «super slowed», «sped up», «live at wembley», «2011 remaster». null, если не пометка
export function simpleMarker(token: string): string[] | null {
    const text = identityText(token).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    const table: Array<[RegExp, string]> = [
        [/^(?:super|hyper|ultra|extra|very|mega) ?slowed(?: down)?$/, 'superslowed'],
        [/^slowed(?: down)?$|^замедл\S*$/, 'slowed'],
        [/^reverb(?:ed)?$|^ревер\S*$/, 'reverb'],
        [/^(?:super|hyper|ultra|extra) ?(?:sped|speed) ?up$/, 'supersped'],
        [/^(?:sped|speed) ?up$|^sped$|^ускор\S*$/, 'sped'],
        [/^nightcore$/, 'nightcore'],
        [/^daycore$/, 'daycore'],
        [/^bass ?boost(?:ed)?$/, 'bassboost'],
        [/^8d(?: audio)?$/, '8d'],
        [/^(?:instrumental|inst|инструментал\S*|минус)$/, 'instrumental'],
        [/^(?:a ?)?cap+el+a$|^vocals? only$|^акапелл\S*$/, 'acapella'],
        [/^(?:live|лайв)(?: (?:at|in|from|on|session|version|на|в)(?: .*)?)?$/, 'live'],
        [/^(?:acoustic|акустик\S*)(?: version)?$/, 'acoustic'],
        [/^(?:\d{4} )?remaster(?:ed)?(?: \d{4})?(?: version)?$|^ремастер\S*$/, 'remaster'],
        [/^(?:demo|демо)(?: version)?$/, 'demo'],
        [/^loop(?:ed)?$|^\d+ ?(?:hours?|hrs?|час\S*) (?:loop(?:ed)?|version)$/, 'loop'],
        [/^extended(?: version| mix| edit)?$/, 'extended'],
        [/^clean(?: version)?$/, 'clean'],
        [/^(?:chopped|screwed)(?: (?:and|n) screwed)?$/, 'chopped'],
        [/^vip(?: mix)?$/, 'vip'],
        [/^(?:remix|rmx|ремикс)$/, 'remix'],
    ];
    for (const [pattern, marker] of table) if (pattern.test(text)) return [marker];
    return null;
}

// Пометки в конце текста без скобок: «Song slowed + reverb», «Song hyper slowed», «SONG SUPER SLOWED VERSION».
// Снимаются с конца по одной; соединители и слово version только между пометками, чтобы «Rock and» уцелел
export function stripTailMarkers(text: string): { rest: string; version: string[] } {
    const tail = /(?:^|[\s(+&,/-])((?:super|hyper|ultra|extra|very|mega)[\s-]*slowed(?:[\s-]*down)?|slowed(?:[\s-]*down)?|reverb(?:ed)?|(?:super|hyper|ultra|extra)[\s-]*(?:sped|speed)[\s-]*up|(?:sped|speed)[\s-]*up|nightcore|daycore|bass[\s-]*boost(?:ed)?|8d(?:[\s-]*audio)?|instrumental|a[\s-]*cappella|acapella|remix|rmx|замедл\S*|ускор\S*|ремикс|\d+[\s-]*(?:hours?|hrs?)[\s-]*loop(?:ed)?|looped)[\s+&,/)-]*$/i;
    const glue = /^(.*\S)[\s-]+(?:and|n|и|version|ver|версия|audio)$/i;
    const version: string[] = [];
    let rest = identityText(text);
    for (;;) {
        const match = tail.exec(rest);
        if (match) {
            const marker = simpleMarker(match[1]);
            if (!marker) break;
            version.unshift(...marker);
            rest = rest.slice(0, match.index).replace(/[\s(+&,/-]+$/, '');
            continue;
        }
        const joined = glue.exec(rest);
        if (!joined || !tail.test(joined[1])) break;
        rest = joined[1];
    }
    return { rest: rest.trim(), version };
}

// Содержимое скобок или хвост после дефиса: пометки версии, участники, мусор («Official Audio») или null,
// если это часть названия («Part 2»). Вне скобок строже: «Under Cover», «New», «Clean», «Free», «10 Hours» бывают названиями
export function classifySegment(text: string, bracket: boolean): TitleSegment | null {
    const clean = identityText(text).replace(/^[\s\-:.,]+|[\s\-:.,]+$/g, '');
    const lower = clean.toLowerCase();
    const nothing: TitleSegment = { version: [], credits: [] };
    if (!identityKey(clean)) return nothing;
    if (/^(?:official(?: (?:music|lyric))?(?: (?:audio|video|visuali[sz]er))?|(?:music|lyric) video|lyrics?|visuali[sz]er|hq|hd|4k|free (?:dl|download)|out now|premiere|exclusive|клип|премьера|original(?: (?:mix|version|audio))?|(?:album|single) version|\d{4})$/.test(lower)) return nothing;
    if (bracket && /^(?:audio|video|free|new|explicit|clip|текст)$/.test(lower)) return nothing;
    if (bracket && /^\d+\s*(?:hours?|hrs?|час\S*)$/.test(lower)) return { version: ['loop'], credits: [] };
    const people = (names: string, role: CreditRole): TrackCredit[] =>
        splitNames(names).map((name) => ({ name, key: nameKey(name), role, source: 'title' as const }));
    const feat = /^(?:feat\.?|ft\.?|featuring|with|w\/)\s*(.+)$/i.exec(clean);
    if (feat) return { version: [], credits: people(feat[1], 'featured') };
    const prod = /^(?:prod\.?(?:\s*by)?|produced\s+by)\s*(.+)$/i.exec(clean);
    if (prod) return { version: [], credits: people(prod[1], 'producer') };
    const single = simpleMarker(clean);
    if (single && (bracket || single[0] !== 'clean')) return { version: single, credits: [] };
    const markers = stripTailMarkers(clean);
    if (markers.version.length && !identityKey(markers.rest)) return { version: markers.version, credits: [] };
    const by = /^(remix|rmx|ремикс|edit|flip|bootleg|rework|mashup|cover|кавер)\s+by\s+(.+)$/i.exec(clean);
    const named = by ? null : /^(?:(.*?)\s+)?(remix|rmx|ремикс|edit|эдит|flip|bootleg|rework|mashup|cover|кавер|vip|mix|микс|version|ver|версия)$/i.exec(clean);
    if (!by && !named) return null;
    const raw = (by ? by[1] : named?.[2] ?? '').toLowerCase();
    const kind = ({ rmx: 'remix', ремикс: 'remix', эдит: 'edit', кавер: 'cover', микс: 'mix', ver: 'version', версия: 'version' } as Record<string, string>)[raw] ?? raw;
    const name = ((by ? by[2] : named?.[1]) ?? '').trim();
    if (!bracket && (kind === 'cover' || kind === 'mashup')) return null;
    if (kind === 'vip') return { version: ['vip'], credits: [] };
    const inner = name ? stripTailMarkers(name) : null;
    // «Slowed Mix», «Sped Up Remix»: пометки и безымянная переделка
    if (inner && inner.version.length && !identityKey(inner.rest)) {
        return { version: kind === 'version' || kind === 'mix' ? inner.version : [...inner.version, kind], credits: [] };
    }
    const key = identityKey(name);
    if (kind === 'version' || kind === 'mix') {
        if (!key) return null;
        if (['original', 'orig', 'og', 'album', 'single', 'full', 'main'].includes(key)) return nothing;
        return { version: [key === 'radio' ? 'edit:radio' : kind + ':' + key], credits: [] };
    }
    if (!key) return { version: [kind], credits: [] };
    // «Radio Edit», «Club Edit» описывают версию, а не человека
    if (kind === 'edit' && ['radio', 'club', 'short', 'clean', 'tiktok', 'festival', 'intro', 'outro', 'dj', 'vocal', 'dub', 'single', 'album', 'quick', 'fast', 'slow'].includes(key)) {
        return { version: ['edit:' + key], credits: [] };
    }
    const credits = people(name, 'remixer');
    return { version: [kind + ':' + credits.map((credit) => credit.key).sort().join(',')], credits };
}

// Разбор названия: «Artist - Song (X Remix) [Slowed + Reverb] | теги». Исходная строка сохраняется,
// исполнитель из «Artist - Song» только гипотеза. «Song (X Remix) - Artist» узнаётся по ремиксу в первой части
export function parseTrackTitle(raw: string | null | undefined): ParsedTitle {
    const text = identityText(raw ?? '');
    const version: string[] = [];
    const credits: TrackCredit[] = [];
    const take = (segment: TitleSegment): void => {
        version.push(...segment.version);
        credits.push(...segment.credits);
    };
    const [first, ...tails] = text.split(/\s*\|\s*/);
    // Приставка промо-каналов «PREMIERE: Artist - Song» к исполнителю не относится
    const head = (first ?? '').replace(/^(?:premiere|exclusive|free\s+(?:dl|download)|out\s+now|new)\s*[:-]\s*/i, '');
    // После вертикальной черты пометки и теги канала: пометки берутся, остальное в название не входит
    for (const tail of tails) {
        const segment = classifySegment(tail, false);
        if (segment) take(segment);
        else version.push(...stripTailMarkers(tail).version);
    }
    // Скобки: известное снимается (переделка оставляет метку \u0001 для выбора порядка частей), неизвестное остаётся словами
    const keep = (inner: string): string => {
        const segment = classifySegment(inner, true);
        if (!segment) return ' ' + inner + ' ';
        take(segment);
        const rework = segment.credits.some((credit) => credit.role === 'remixer') || segment.version.some((item) => /^(?:remix|edit|flip|bootleg|rework|mashup|cover)(?::|$)/.test(item));
        return rework ? ' \u0001 ' : ' ';
    };
    const marked = head
        .replace(/[([{\u3010]([^()[\]{}\u3010\u3011]*)[)\]}\u3011]/g, (_whole: string, inner: string) => keep(inner))
        .replace(/[([{\u3010]([^()[\]{}\u3010\u3011]*)$/, (_whole: string, inner: string) => keep(inner));
    const parts = marked
        .split(/\s+-\s*|\s*-\s+/)
        .map((part) => ({ text: part.split('\u0001').join(' ').replace(/\s+/g, ' ').trim(), rework: part.includes('\u0001') }))
        .filter((part) => identityKey(part.text));
    // Хвостовые части из одних пометок: «Song - Slowed & Reverb», «Song - X Remix», «Song - Official Video»
    while (parts.length > 1) {
        const segment = classifySegment(parts[parts.length - 1].text, false);
        if (!segment) break;
        take(segment);
        parts.pop();
    }
    let title = parts.length ? parts[parts.length - 1].text : '';
    let artists = '';
    if (parts.length > 1) {
        const reversed = parts[0].rework && !parts[parts.length - 1].rework;
        title = reversed ? parts[0].text : parts.slice(1).map((part) => part.text).join(' - ');
        artists = reversed ? parts.slice(1).map((part) => part.text).join(', ') : parts[0].text;
    }
    const strip = (): void => {
        const tail = stripTailMarkers(title);
        if (!tail.version.length || !identityKey(tail.rest)) return;
        title = tail.rest;
        version.push(...tail.version);
    };
    strip();
    const inline = /\s+(feat\.?|ft\.?|featuring|w\/|prod\.?(?:\s+by)?|produced\s+by)\s+((?:(?!\s(?:feat\.?|ft\.?|featuring|w\/|prod\.?|produced)\s).)+)$/i;
    for (let match = inline.exec(title); match && identityKey(title.slice(0, match.index)); match = inline.exec(title)) {
        const segment = classifySegment(match[1] + ' ' + match[2], true);
        if (segment) take(segment);
        title = title.slice(0, match.index);
        strip();
    }
    if (artists) {
        const [main, ...featured] = artists.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i);
        for (const name of splitNames(main)) credits.push({ name, key: nameKey(name), role: 'artist', source: 'title' });
        for (const name of featured.flatMap((part) => splitNames(part))) credits.push({ name, key: nameKey(name), role: 'featured', source: 'title' });
    }
    const base = title.replace(/[()[\]{}\u3010\u3011"]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-:.,'*~]+|[\s\-:.,'*~]+$/g, '');
    const sorted = [...new Set(version)].sort();
    const seen = new Set<string>();
    return {
        raw: raw ?? '',
        base,
        baseKey: identityKey(base),
        version: sorted,
        credits: credits.filter((credit) => {
            const id = credit.role + ':' + credit.key;
            if (!credit.key || seen.has(id)) return false;
            seen.add(id);
            return true;
        }),
        anonymous: sorted.some((item) => /^(?:remix|edit|flip|bootleg|rework|mashup|cover)$/.test(item)),
    };
}

export function uploaderId(track: WaveTrack): number {
    return track.user_id ?? track.user?.id ?? 0;
}

// Ключ конкретной публикации: тип и провайдер в строке, числовой id плеера не меняется
export function uploadKey(track: WaveTrack): string {
    return 'sc:track:' + track.id;
}

export function trackDuration(track: WaveTrack): number {
    const value = track.full_duration || track.duration || 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
}

// Исполнитель для семьи версий: из названия, иначе имя загрузившего аккаунта. Гипотеза, не личность
export function artistHint(track: WaveTrack, parsed: ParsedTitle = parseTrackTitle(track.title)): string {
    const credit = parsed.credits.find((item) => item.role === 'artist' && item.source === 'title');
    const uploader = uploaderId(track);
    return credit?.key || nameKey(track.user?.username) || (uploader ? 'u' + uploader : '');
}

// Предполагаемая композиция: название без пометок и исполнитель. Пусто, если название не разобрать
export function familyKey(track: WaveTrack, parsed: ParsedTitle = parseTrackTitle(track.title)): string {
    const artist = artistHint(track, parsed);
    return parsed.baseKey && artist ? parsed.baseKey + '|' + artist : '';
}

// Предполагаемая версия: семья и пометки, безымянную переделку отличает загрузчик. Пусто, если семьи нет:
// такой трек сравнивается только своим id
export function versionKey(track: WaveTrack, parsed: ParsedTitle = parseTrackTitle(track.title)): string {
    const family = familyKey(track, parsed);
    if (!family) return '';
    return family + '|' + parsed.version.join('+') + (parsed.anonymous ? '|u' + uploaderId(track) : '');
}

// Ключи вероятной копии для множеств в пределах сессии: версия и длительность шагом 2 секунды, с соседними
// шагами, чтобы перекодировка на секунду не мешала. Без длительности копией считается только загрузка того же аккаунта
export function copyKeys(track: WaveTrack): string[] {
    const version = versionKey(track);
    if (!version) return [uploadKey(track)];
    const duration = trackDuration(track);
    if (!duration) return [version + '|u' + uploaderId(track)];
    const step = Math.round(duration / 2000);
    return [step - 1, step, step + 1].map((value) => version + '|' + value);
}

// Ключ для проверки по множеству, заполненному copyKeys
export function copyKey(track: WaveTrack): string {
    const keys = copyKeys(track);
    return keys.length === 3 ? keys[1] : keys[0];
}

// Вероятная копия: та же разобранная версия той же семьи и длительность рядом. Только мягкая группировка:
// запрет и «уже слышано» так не переносятся
export function probableCopy(a: WaveTrack, b: WaveTrack): boolean {
    if (a.id === b.id) return false;
    const keys = copyKeys(a);
    return keys[0] !== uploadKey(a) && keys.includes(copyKey(b));
}

export function isrcOf(track: WaveTrack): string {
    const value = track.publisher_metadata?.isrc;
    const code = typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : '';
}

// Совпадение двух загрузок. Решение пользователя (links, source 'user') главнее всего; ISRC подтверждает
// только при той же версии по названию и длительности в пределах двух секунд; остальное не подтверждение
export function matchLevel(a: WaveTrack, b: WaveTrack, links: RecordingLink[] = []): MatchLevel {
    if (a.id === b.id) return 'same-upload';
    const ka = uploadKey(a);
    const kb = uploadKey(b);
    let decision: RecordingLink | null = null;
    for (const link of links) {
        const pair = (link.a === ka && link.b === kb) || (link.a === kb && link.b === ka);
        if (pair && link.source === 'user' && (!decision || link.at >= decision.at)) decision = link;
    }
    const pa = parseTrackTitle(a.title);
    const pb = parseTrackTitle(b.title);
    const family = familyKey(a, pa);
    const related: MatchLevel = family && family === familyKey(b, pb) ? 'version' : 'none';
    if (decision) return decision.same ? 'confirmed' : related;
    const da = trackDuration(a);
    const db = trackDuration(b);
    const code = isrcOf(a);
    if (code && code === isrcOf(b) && pa.version.join('+') === pb.version.join('+') && da && db && Math.abs(da - db) <= 2000) return 'confirmed';
    if (probableCopy(a, b)) return 'probable';
    return related;
}

// Группы подтверждённых записей: по каждой паре последнее решение, пользователь главнее каталога,
// объединяют только same=true. Вероятные копии сюда не попадают и цепочек не образуют
export function confirmedGroups(links: RecordingLink[]): Map<string, string> {
    const latest = new Map<string, RecordingLink>();
    for (const link of links) {
        if (!link.a || !link.b || link.a === link.b) continue;
        const pair = link.a < link.b ? link.a + ' ' + link.b : link.b + ' ' + link.a;
        const known = latest.get(pair);
        const wins = !known || (link.source === 'user' && known.source !== 'user') || (link.source === known.source && link.at >= known.at);
        if (wins) latest.set(pair, link);
    }
    const parent = new Map<string, string>();
    const find = (key: string): string => {
        let current = key;
        for (let next = parent.get(current); next !== undefined && next !== current; next = parent.get(current)) current = next;
        return current;
    };
    for (const link of latest.values()) {
        if (!link.same) continue;
        const a = find(link.a);
        const b = find(link.b);
        if (a === b) continue;
        if (a < b) parent.set(b, a);
        else parent.set(a, b);
    }
    const groups = new Map<string, string>();
    for (const key of parent.keys()) groups.set(key, find(key));
    for (const root of [...groups.values()]) groups.set(root, root);
    return groups;
}

// Загрузки ids вместе с их подтверждёнными копиями из confirmedGroups. Вероятные копии сюда не входят:
// запрет и «уже слышано» по ним не переносятся
export function confirmedCopies(ids: Iterable<number>, groups: Map<string, string>): Set<number> {
    const result = new Set<number>(ids);
    if (!groups.size) return result;
    const members = new Map<string, number[]>();
    for (const [key, root] of groups) {
        const id = Number(key.slice('sc:track:'.length));
        if (!key.startsWith('sc:track:') || !Number.isSafeInteger(id) || id <= 0) continue;
        const list = members.get(root) ?? [];
        list.push(id);
        members.set(root, list);
    }
    for (const id of [...result]) {
        const root = groups.get('sc:track:' + id);
        if (root) for (const mate of members.get(root) ?? []) result.add(mate);
    }
    return result;
}

// Связи каталога: один ISRC, та же версия по названию и длительность в пределах двух секунд
export function catalogLinks(tracks: WaveTrack[], at: number): RecordingLink[] {
    const byCode = new Map<string, WaveTrack[]>();
    for (const track of tracks) {
        const code = isrcOf(track);
        if (code) byCode.set(code, [...(byCode.get(code) ?? []), track]);
    }
    const links: RecordingLink[] = [];
    for (const list of byCode.values()) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (matchLevel(list[i], list[j]) === 'confirmed') links.push({ a: uploadKey(list[i]), b: uploadKey(list[j]), same: true, source: 'catalog', at });
            }
        }
    }
    return links;
}

// Участники по названию и метаданным издателя. Загрузчик сюда не входит: это отдельная роль аккаунта.
// Метаданные часто пусты или повторяют загрузчика, поэтому его имя отсеивается
export function trackCredits(track: WaveTrack, parsed: ParsedTitle = parseTrackTitle(track.title)): TrackCredit[] {
    const list = parsed.credits.slice();
    const seen = new Set(list.map((credit) => credit.role + ':' + credit.key));
    const uploader = nameKey(track.user?.username);
    const add = (value: unknown, role: CreditRole): void => {
        if (typeof value !== 'string') return;
        for (const name of splitNames(identityText(value).split('|')[0])) {
            const key = nameKey(name);
            if (!key || key.length > 60 || key === uploader || seen.has(role + ':' + key) || seen.has('artist:' + key)) continue;
            seen.add(role + ':' + key);
            list.push({ name, key, role, source: 'metadata' });
        }
    };
    add(track.publisher_metadata?.artist, 'artist');
    add(track.publisher_metadata?.writer_composer, 'writer');
    return list;
}

// Исполнитель записи для группы радара: свой аккаунт (исполнителя в названии нет, загрузчик среди исполнителей или это
// его переделка) это сам загрузчик, у сборного канала первый исполнитель из названия или метаданных. То же правило, что
// у свежести в radar.ts: чужой исполнитель без загрузчика среди участников делает канал сборным
export function performerKey(uploader: number, uploaderName: string | null | undefined, credits: TrackCredit[]): string {
    const own = nameKey(uploaderName);
    const artists = credits.filter((credit) => credit.role === 'artist' && credit.key);
    const mine = !artists.length || artists.some((credit) => credit.key === own) || credits.some((credit) => credit.role === 'remixer' && credit.key === own);
    return mine ? 'u:' + uploader : 'a:' + artists[0].key;
}

// До трёх текстовых запросов по треку: эта версия, другие версии, другие песни участников.
// Без кавычек и операторов: поиск сайта их не поддерживает (приложение А плана)
export function searchQueries(track: WaveTrack, parsed: ParsedTitle = parseTrackTitle(track.title)): SearchQuery[] {
    const credits = trackCredits(track, parsed);
    const artist = credits.find((credit) => credit.role === 'artist')?.name ?? '';
    const label = (item: string): string => {
        const [kind, name = ''] = item.split(':');
        if (!name) return ({ superslowed: 'super slowed', sped: 'sped up', supersped: 'super sped up', bassboost: 'bass boosted' } as Record<string, string>)[kind] ?? kind;
        if (/^(?:remix|edit|flip|bootleg|rework|mashup|cover)$/.test(kind)) {
            const keys = name.split(',');
            const people = credits.filter((credit) => credit.role === 'remixer' && keys.includes(credit.key)).map((credit) => credit.name);
            return (people.length ? people.join(' ') : name) + ' ' + kind;
        }
        return name + ' ' + kind;
    };
    const tidy = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 120);
    const list: SearchQuery[] = [];
    const push = (purpose: SearchQuery['purpose'], q: string): void => {
        const key = identityKey(q);
        if (key && !list.some((item) => identityKey(item.q) === key)) list.push({ purpose, q });
    };
    const song = tidy(artist + ' ' + parsed.base);
    if (parsed.baseKey) {
        push('exact', tidy(song + ' ' + parsed.version.map(label).join(' ')));
        push('versions', song);
    }
    const people = [...credits.filter((credit) => credit.role === 'artist'), ...credits.filter((credit) => credit.role === 'remixer')].map((credit) => credit.name);
    if (people.length) push('songs', tidy(people.slice(0, 2).join(' ')));
    return list;
}

// Всё, что уходит на страницу: waveScript кладёт объявления рядом с волной
export const identityHelpers = [
    identityText, identityKey, nameKey, splitNames, simpleMarker, stripTailMarkers, classifySegment, parseTrackTitle, uploaderId, uploadKey,
    trackDuration, artistHint, familyKey, versionKey, copyKeys, copyKey, probableCopy, isrcOf, matchLevel, confirmedGroups, confirmedCopies, catalogLinks,
    trackCredits, searchQueries, performerKey,
];
