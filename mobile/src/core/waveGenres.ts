// Жанры и метки: свободный текст сайта в ключи для вкуса, полки, фильтра по жанру и топа жанров.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовут друг друга по голому имени
import type { WaveTrack } from './waveTypes';

// Жанр и теги на SoundCloud свободный текст: сравниваются без регистра, пробелов и знаков
export function normalizeTag(text: string): string {
    return text.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// Ключи жанра и тегов трека для модели вкуса: одни и те же в main и на странице, не больше шести
export function tagKeys(genre: string | null | undefined, tagList: string | null | undefined): string[] {
    const keys: string[] = [];
    const add = (label: string): void => {
        const key = normalizeTag(label);
        if (key.length >= 2 && keys.length < 6 && !keys.includes(key)) keys.push(key);
    };
    add(genre ?? '');
    for (const match of (tagList ?? '').matchAll(/"([^"]+)"|(\S+)/g)) add(match[1] ?? match[2] ?? '');
    return keys;
}

// Жанр и метки трека с долями для модели вкуса: одинаково в main, на странице и в радаре. Жанр весит 1 на все свои части
// («Hip Hop/Rap - Trap» это hiphop и trap по 0.5), метки вместе 0.5 поровну, не больше пяти; у трека без жанра метки весят 1.
// Раньше каждая из шести меток весила как жанр, и артист, который пишет к каждому треку Alternative, Hip Hop, Ambient, Dark,
// раздувал эти метки во вкусе. Написания склеиваются genreCanon. Имя исполнителя (names) и числа вкус не описывают:
// свой ник в метках у каждого трека артиста копил бы «жанр» из ника
export function tagShares(genre: string | null | undefined, tagList: string | null | undefined, names: Array<string | null | undefined> = []): Array<[string, number]> {
    const skip = new Set(names.map((name) => normalizeTag(name ?? '')).filter((key) => key.length >= 2));
    const usable = (key: string): boolean => key.length >= 2 && !/^\d+$/.test(key) && !skip.has(key);
    const genres = genreParts(genre).filter(usable);
    const tags: string[] = [];
    for (const match of (tagList ?? '').matchAll(/"([^"]+)"|(\S+)/g)) {
        const key = genreCanon(normalizeTag(match[1] ?? match[2] ?? ''));
        if (usable(key) && !genres.includes(key) && !tags.includes(key) && tags.length < 5) tags.push(key);
    }
    const tagTotal = genres.length ? 0.5 : 1;
    return [...genres.map((key): [string, number] => [key, 1 / genres.length]), ...tags.map((key): [string, number] => [key, tagTotal / tags.length])];
}

// Язык трека для вкуса (П6): инструментал по пометке в названии, кириллица в названии или имени, иначе латиница.
// Жанр и метки «beat», «instrumental» делают трек инструменталом, только если в названии и имени нет кириллицы:
// метку beat русский рэп ставит часто, а пометку в названии нет
export function trackLang(track: WaveTrack): 'cyr' | 'inst' | 'lat' {
    const title = track.title ?? '';
    if (/\b(?:type\s*beat|instrumental|instr\.?)\b|инструментал|минусовка|[([]\s*(?:beat|минус)\s*[)\]]/iu.test(title)) return 'inst';
    if (/\p{Script=Cyrillic}/u.test(title + ' ' + (track.user?.username ?? ''))) return 'cyr';
    const marked = ['instrumental', 'instrumentals', 'beat', 'beats', 'typebeat', 'инструментал', 'минусовка'];
    const genre = normalizeTag(track.genre ?? '');
    if (marked.includes(genre) || Array.from((track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g), (match) => normalizeTag(match[1] ?? match[2] ?? '')).some((key) => marked.includes(key))) return 'inst';
    return 'lat';
}

// Ключ жанра из ввода в том же написании, что у склейки: «hip hop», «rap» и «рэп» это hiphop
export function genreKeys(genre: string): string[] {
    const key = genreCanon(normalizeTag(genre));
    return key ? [key] : [];
}

// Русские названия основных жанров по-английски: для поиска SoundCloud и склейки. Незнакомое возвращается как есть
export function genreEnglish(label: string): string {
    const ru: Record<string, string> = {
        рэп: 'rap', реп: 'rap', хипхоп: 'hip hop', трэп: 'trap', треп: 'trap', фонк: 'phonk', дрилл: 'drill', дрил: 'drill',
        электроника: 'electronic', электронная: 'electronic', электроннаямузыка: 'electronic', электро: 'electro', хаус: 'house', дипхаус: 'deep house',
        техно: 'techno', транс: 'trance', дабстеп: 'dubstep', драмнбейс: 'drum & bass', драмнбэйс: 'drum & bass', драмэндбейс: 'drum & bass', днб: 'drum & bass',
        рок: 'rock', альтернатива: 'alternative', альтрок: 'alternative rock', альтернативныйрок: 'alternative rock', инди: 'indie', поп: 'pop',
        метал: 'metal', металл: 'metal', панк: 'punk', джаз: 'jazz', блюз: 'blues', соул: 'soul', фанк: 'funk', диско: 'disco', рнб: 'r&b',
        эмбиент: 'ambient', амбиент: 'ambient', лоуфай: 'lofi', лофай: 'lofi', классика: 'classical', классическая: 'classical', кантри: 'country',
        регги: 'reggae', реггетон: 'reggaeton', шугейз: 'shoegaze', синтвейв: 'synthwave', витчхаус: 'witch house', гараж: 'uk garage', укгараж: 'uk garage',
        эдм: 'edm', танцевальная: 'dance', саундтрек: 'soundtrack', чилл: 'chill', чиллаут: 'chillout', гиперпоп: 'hyperpop',
    };
    return ru[normalizeTag(label)] ?? label;
}

// Одно написание жанра для полки, истории и фильтра по жанру: «Hip-hop & Rap», «hiphoprap», «rap» и «рэп» это hiphop.
// Таблица внутри функции: на страницу функция уходит текстом
export function genreCanon(key: string): string {
    const same: Record<string, string> = {
        hiphoprap: 'hiphop', hiphopandrap: 'hiphop', raphiphop: 'hiphop', rapandhiphop: 'hiphop', rap: 'hiphop', rockalternative: 'alternativerock', altrock: 'alternativerock',
        dnb: 'drumandbass', drumnbass: 'drumandbass', dandb: 'drumandbass', randb: 'rnb', rhythmandblues: 'rnb', randbandsoul: 'rnb', rnbandsoul: 'rnb', lowfi: 'lofi',
        ukg: 'ukgarage', edm: 'danceandedm', wtchhs: 'witchhouse', witchhaus: 'witchhouse', fonk: 'phonk',
    };
    // Русское название проверяется, только если в ключе есть не латиница: таблица строится на каждый вызов
    const base = /[^a-z0-9]/.test(key) ? normalizeTag(genreEnglish(key)) : key;
    return same[base] ?? base;
}

// Части жанра для фильтра: режется по « - », /, запятой, ;, | и +, по & только известные пары сайта
// («Hip-hop & Rap», «Dance & EDM», «R&B & Soul»), иначе bass нашёлся бы в Drum & Bass
export function genrePhrases(label: string): string[] {
    const pairs = ['hiphopandrap', 'danceandedm', 'randbandsoul', 'jazzandblues', 'folkandsingersongwriter'];
    const phrases: string[] = [];
    for (const part of label.split(/\s+-\s+|[/,;|+]+/)) {
        const text = part.trim();
        if (!text) continue;
        phrases.push(text);
        if (!pairs.includes(normalizeTag(text))) continue;
        const halves = text.split(/\s+&\s+/);
        for (const half of halves.length > 1 ? halves : text.split('&')) if (half.trim()) phrases.push(half.trim());
    }
    return phrases;
}

// Ключи жанра для группировки. Составной жанр сайта («Hip Hop/Rap - Trap») режется по « - », /, запятой, ; и |,
// но не по &: иначе развалятся drum & bass и R&B. Вся строка остаётся ключом, только если это известное написание
export function genreParts(label: string | null | undefined): string[] {
    const text = (label ?? '').trim();
    const keys: string[] = [];
    const add = (part: string): void => {
        const key = genreCanon(normalizeTag(part));
        if (key.length >= 2 && !keys.includes(key)) keys.push(key);
    };
    const parts = text.split(/\s+-\s+|[/,;|]+/).filter((part) => part.trim());
    const whole = normalizeTag(text);
    if (parts.length < 2 || genreCanon(whole) !== whole) add(text);
    if (parts.length > 1) for (const part of parts) add(part);
    return keys;
}

// Главный жанр строки для топов: ключ склейки и подпись. У составного жанра главный это поджанр после « - »
// («Hip Hop/Rap - Trap» это trap), иначе первая часть («Phonk/Fonk» это phonk)
export function genreMain(label: string | null | undefined): { key: string; label: string } {
    const text = (label ?? '').replace(/\s+/g, ' ').trim();
    const whole = normalizeTag(text);
    if (!whole) return { key: '', label: '' };
    const canon = genreCanon(whole);
    if (canon !== whole) return { key: canon, label: text };
    const sub = text.split(/\s+-\s+/);
    const first = (sub.length > 1 ? sub[sub.length - 1] : text).split(/[/,;|]+/)[0].trim();
    const key = genreCanon(normalizeTag(first));
    return key.length >= 2 ? { key, label: first } : { key: whole, label: text };
}

// Несколько жанров через запятую, слэш, точку с запятой или черту: «techno / dark techno, industrial».
// & не разделитель, иначе развалятся drum & bass и r&b
export function parseGenres(input: string): string[] {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const part of input.toLowerCase().split(/[/,;|]+/)) {
        const genre = part.replace(/\s+/g, ' ').trim().slice(0, 40);
        const key = normalizeTag(genre);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push(genre);
        if (list.length >= 4) break;
    }
    return list;
}

export function formatGenres(list: string[]): string {
    return list.join(' / ');
}

export function genreKeysFor(genre: string | null): string[] {
    return genre ? [...new Set(parseGenres(genre).flatMap(genreKeys))] : [];
}

// strict: только поле жанра, метки лишь у трека без жанра. Так выбираются зёрна: артист с пачкой меток на все жанры
// иначе засевал бы волну Hip-hop своими роковыми треками. Кандидатов из поиска по жанру проверяют и метки:
// у нишевых жанров (witch house, phonk) в поле жанра часто стоит просто Electronic
export function trackMatchesGenre(track: WaveTrack, keys: string[], strict = false): boolean {
    if (!keys.length) return true;
    const wanted = [...new Set(keys.map((key) => genreCanon(normalizeTag(key))).filter(Boolean))];
    const phrases = genrePhrases(track.genre ?? '');
    if (!strict || !phrases.length) for (const match of (track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)) phrases.push(...genrePhrases(match[1] ?? match[2] ?? ''));
    // Ключ и часть сравниваются в одном написании (hip hop находит Rap, phonk находит Fonk). Короткий ключ совпадает с частью
    // целиком или с её словом (rock в Alternative Rock, но rap не в Trap), длинный ищется и внутри (darkwitchhouse это witch house).
    // У части с & слов нет, и жанры, которые только звучат похоже, не совпадают: witch house не house, drum and bass не bass
    const unlike: Record<string, string[]> = { house: ['witchhouse'], bass: ['drumandbass'] };
    return phrases.some((phrase) => {
        const whole = genreCanon(normalizeTag(phrase));
        if (!whole) return false;
        const words = phrase.includes('&') ? [] : phrase.split(/\s+/).map(normalizeTag).filter(Boolean);
        const pieces = [...words, ...words.slice(1).map((word, i) => words[i] + word)].map(genreCanon);
        return wanted.some((key) => {
            if (whole === key) return true;
            if ((unlike[key] ?? []).some((other) => whole.includes(other))) return false;
            return (key.length >= 5 && whole.includes(key)) || pieces.includes(key);
        });
    });
}

// Самые частые жанры лайков для выпадающего списка, в том написании, что встречается чаще
// Написания одного жанра склеены той же таблицей, что у полки и истории («Hip-hop & Rap», «Hip Hop», «rap» одна строка),
// подпись это самое частое написание
export function topGenres(tracks: WaveTrack[], limit: number): string[] {
    const counts = new Map<string, { count: number; labels: Map<string, number> }>();
    for (const track of tracks) {
        const main = genreMain(track.genre);
        if (main.key.length < 2) continue;
        const label = main.label.toLowerCase();
        const entry = counts.get(main.key) ?? { count: 0, labels: new Map<string, number>() };
        entry.count++;
        entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
        counts.set(main.key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => [...entry.labels].sort((a, b) => b[1] - a[1])[0][0]);
}
