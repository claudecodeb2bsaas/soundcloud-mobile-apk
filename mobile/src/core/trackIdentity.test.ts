import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WaveTrack } from './wave';
import {
    catalogLinks, confirmedCopies, confirmedGroups, copyKey, copyKeys, familyKey, identityHelpers, matchLevel, parseTrackTitle, performerKey, searchQueries, trackCredits,
    versionKey, type RecordingLink,
} from './trackIdentity';

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'src/core/fixtures/search-titles.json'), 'utf8')) as { tracks: WaveTrack[] };
const real = (title: string): WaveTrack => {
    const found = fixture.tracks.find((entry) => entry.title === title);
    if (!found) throw new Error('Нет в фикстуре: ' + title);
    return found;
};
let next = 1;
const upload = (title: string, uploader: number, extra: Partial<WaveTrack> = {}): WaveTrack =>
    ({ id: next++, kind: 'track', title, user_id: uploader, user: { id: uploader, username: 'user' + uploader }, duration: 180000, ...extra });

describe('разбор названия', () => {
    it('реальные названия из поиска: пометки, исполнитель, ремиксер, теги канала', () => {
        const cases: Array<[string, string, string[], string[]]> = [
            ['LUZ ROJA - Slowed & Reverb', 'LUZ ROJA', ['reverb', 'slowed'], []],
            ['Wind Waker -  Great Fairy Fountain slowed + reverb', 'Great Fairy Fountain', ['reverb', 'slowed'], ['artist:Wind Waker']],
            ['Masha – Золото (slowed+reverb)', 'Золото', ['reverb', 'slowed'], ['artist:Masha']],
            ['bye (Altare remix) - Ariana Grande (slowed + reverb)', 'bye', ['remix:altare', 'reverb', 'slowed'], ['remixer:Altare', 'artist:Ariana Grande']],
            ['SamiLone - Man [Guitar Version] (Slowed + Reverb)', 'Man', ['reverb', 'slowed', 'version:guitar'], ['artist:SamiLone']],
            ['Khat - Navjot  Ahuja ｜ Slowed Reverb ｜ Lofi ｜ Bass Bhaiya ｜', 'Navjot Ahuja', ['reverb', 'slowed'], ['artist:Khat']],
            ['TUL8TE - Seneen I تووليت - سنين  Slowed Reverb', 'Seneen I تووليت - سنين', ['reverb', 'slowed'], ['artist:TUL8TE']],
            ['Sem Tempo (Super Slowed)', 'Sem Tempo', ['superslowed'], []],
            ['Montagem Pegadora hyper slowed', 'Montagem Pegadora', ['superslowed'], []],
            ['MY SUMMER FUNK (SUPER SLOWED VERSION)', 'MY SUMMER FUNK', ['superslowed'], []],
            ['MY SUMMER FUNK (SPED UP VERSION)', 'MY SUMMER FUNK', ['sped'], []],
            ['NEMIGA - Рукава( slowed+reverb)', 'Рукава', ['reverb', 'slowed'], ['artist:NEMIGA']],
            ['Mattyeux, Princess Chelsea - Sometimes (Slowed + Reverb)', 'Sometimes', ['reverb', 'slowed'], ['artist:Mattyeux', 'artist:Princess Chelsea']],
            ['Afterglow', 'Afterglow', [], []],
        ];
        for (const [title, base, version, credits] of cases) {
            const parsed = parseTrackTitle(real(title).title);
            expect({ title, base: parsed.base, version: parsed.version, credits: parsed.credits.map((credit) => credit.role + ':' + credit.name) })
                .toEqual({ title, base, version, credits });
        }
    });

    it('каждое реальное название даёт непустое название, slowed в названии узнаётся', () => {
        for (const track of fixture.tracks) {
            const parsed = parseTrackTitle(track.title);
            expect(parsed.baseKey, track.title).not.toBe('');
            if (/slowed/i.test(track.title ?? '')) expect(parsed.version.some((item) => item === 'slowed' || item === 'superslowed'), track.title).toBe(true);
        }
    });

    it('участники, мусор и неизвестные скобки', () => {
        const parsed = parseTrackTitle('PREMIERE: Artist A x Artist B - Song ft. Guest prod. Maker [Official Audio] (Free DL)');
        expect(parsed.base).toBe('Song');
        expect(parsed.version).toEqual([]);
        expect(parsed.credits.map((credit) => credit.role + ':' + credit.name)).toEqual(['producer:Maker', 'featured:Guest', 'artist:Artist A', 'artist:Artist B']);
        // «Part 2» и «Интро» часть названия: другая песня, не версия
        expect(parseTrackTitle('Song (Part 2)').baseKey).not.toBe(parseTrackTitle('Song').baseKey);
        expect(parseTrackTitle('Песня (Интро)').base).toBe('Песня Интро');
        // Вне скобок кавер, новое и часы могут быть названием
        expect(parseTrackTitle('Artist - Under Cover').base).toBe('Under Cover');
        expect(parseTrackTitle('Artist - 24 Hours').base).toBe('24 Hours');
        expect(parseTrackTitle('Artist - Clean').base).toBe('Clean');
        expect(parseTrackTitle('Take It Slow').base).toBe('Take It Slow');
        expect(parseTrackTitle('Rock and').base).toBe('Rock and');
        expect(parseTrackTitle('Song (10 Hours)').version).toEqual(['loop']);
        expect(parseTrackTitle('Song (Original Mix)').version).toEqual([]);
        expect(parseTrackTitle('Song (Radio Edit)').version).toEqual(['edit:radio']);
        expect(parseTrackTitle('Song (Extended Mix)').version).toEqual(['extended']);
        expect(parseTrackTitle('Song (Live at Wembley)').version).toEqual(['live']);
        expect(parseTrackTitle('Live Forever').version).toEqual([]);
        expect(parseTrackTitle('Song (Remix by X & Y)').credits.map((credit) => credit.name)).toEqual(['X', 'Y']);
    });
});

describe('версии (A02, A04, A06)', () => {
    it('A02: оригинал, slowed, sped up, ремиксы двух авторов и безымянные ремиксы остаются разными версиями одной семьи', () => {
        const titles = [
            'Artist - Song', 'Artist - Song (Slowed + Reverb)', 'Artist - Song (Slowed)', 'Artist - Song (Sped Up)', 'Artist - Song (Sped Up + Looped)',
            'Artist - Song (Altare Remix)', 'Artist - Song (Kosmo Remix)', 'Artist - Song (Live)', 'Artist - Song (Instrumental)', 'Artist - Song slowed',
        ];
        const tracks = titles.map((title) => upload(title, 7));
        const anonymous = [upload('Artist - Song (Remix)', 8), upload('Artist - Song (Remix)', 9)];
        const all = [...tracks, ...anonymous];
        const versions = new Set(all.map((track) => versionKey(track)));
        // «Song (Slowed)» и «Song slowed» одна пометка, остальные различаются
        expect(versions.size).toBe(all.length - 1);
        expect(new Set(all.map((track) => familyKey(track))).size).toBe(1);
        for (const a of all) for (const b of all) {
            if (a === b || versionKey(a) === versionKey(b)) continue;
            expect(matchLevel(a, b), a.title + ' / ' + b.title).toBe('version');
            expect(copyKey(a)).not.toBe(copyKey(b));
        }
    });

    it('A04: одинаковое короткое название у разных авторов не сливается', () => {
        const home = [upload('Home', 1), upload('Home', 2), upload('Intro', 3), upload('Intro', 4)];
        expect(matchLevel(home[0], home[1])).toBe('none');
        expect(matchLevel(home[2], home[3])).toBe('none');
        expect(copyKeys(home[0])).not.toContain(copyKey(home[1]));
        // Один аккаунт, одно название, разная длина: разные песни
        expect(matchLevel(upload('Home', 5), upload('Home', 5, { duration: 240000 }))).toBe('version');
    });

    it('A06: совпадение названия и длительности только вероятная копия, ISRC подтверждает лишь ту же версию', () => {
        const original = upload('Artist - Song', 1, { publisher_metadata: { isrc: 'QZ-MHP-25-05378' } });
        const reupload = upload('Artist - Song', 2, { duration: 181500 });
        expect(matchLevel(original, reupload)).toBe('probable');
        expect(matchLevel(original, upload('Artist - Song', 3, { duration: 186000 }))).toBe('version');
        const sameCode = upload('Artist - Song', 4, { duration: 181000, publisher_metadata: { isrc: 'QZMHP2505378' } });
        expect(matchLevel(original, sameCode)).toBe('confirmed');
        // Один ISRC, но slowed: противоречие, подтверждения нет
        const slowed = upload('Artist - Song (Slowed)', 5, { publisher_metadata: { isrc: 'QZMHP2505378' } });
        expect(matchLevel(original, slowed)).toBe('version');
        expect(catalogLinks([original, sameCode, slowed], 42)).toEqual([{ a: 'sc:track:' + original.id, b: 'sc:track:' + sameCode.id, same: true, source: 'catalog', at: 42 }]);
        // Решение пользователя главнее: «не та же запись» снимает и вероятную копию
        const no: RecordingLink = { a: 'sc:track:' + reupload.id, b: 'sc:track:' + original.id, same: false, source: 'user', at: 1 };
        expect(matchLevel(original, reupload, [no])).toBe('version');
        expect(matchLevel(original, reupload, [no, { ...no, same: true, at: 2 }])).toBe('confirmed');
    });

    it('без названия и без длительности общего ключа нет', () => {
        const blank = [upload('', 1), upload('', 2), upload('???', 3), upload('', 1)];
        expect(new Set(blank.map((track) => copyKey(track))).size).toBe(4);
        expect(versionKey(blank[0])).toBe('');
        expect(matchLevel(blank[0], blank[3])).toBe('none');
        const bare = [upload('Artist - Song', 1, { duration: 0 }), upload('Artist - Song', 1, { duration: 0 }), upload('Artist - Song', 2, { duration: 0 })];
        expect(matchLevel(bare[0], bare[1])).toBe('probable');
        expect(matchLevel(bare[0], bare[2])).toBe('version');
    });
});

it('подтверждённые группы: последнее решение по паре, пользователь главнее каталога', () => {
    const links: RecordingLink[] = [
        { a: 'sc:track:1', b: 'sc:track:2', same: true, source: 'user', at: 1 },
        { a: 'sc:track:3', b: 'sc:track:2', same: true, source: 'catalog', at: 1 },
        { a: 'sc:track:4', b: 'sc:track:5', same: true, source: 'user', at: 1 },
        { a: 'sc:track:5', b: 'sc:track:4', same: true, source: 'catalog', at: 9 },
    ];
    const groups = confirmedGroups(links);
    expect(new Set(['sc:track:1', 'sc:track:2', 'sc:track:3'].map((key) => groups.get(key)))).toEqual(new Set(['sc:track:1']));
    const undone = confirmedGroups([...links, { a: 'sc:track:2', b: 'sc:track:1', same: false, source: 'user', at: 5 }, { a: 'sc:track:4', b: 'sc:track:5', same: false, source: 'user', at: 2 }]);
    expect(undone.get('sc:track:1')).toBeUndefined();
    expect(undone.get('sc:track:3')).toBe(undone.get('sc:track:2'));
    // Каталог позже, но решение пользователя «разные» остаётся
    expect(undone.get('sc:track:4')).toBeUndefined();
    // Запрет и «уже слышано» переходят на подтверждённые копии и только на них
    expect([...confirmedCopies([2, 9], groups)].sort((a, b) => a - b)).toEqual([1, 2, 3, 9]);
    expect([...confirmedCopies([1], undone)]).toEqual([1]);
    expect([...confirmedCopies([7], new Map())]).toEqual([7]);
});

it('участники из метаданных и поисковые запросы без кавычек', () => {
    const wind = real('Wind Waker -  Great Fairy Fountain slowed + reverb');
    expect(trackCredits(wind).map((credit) => credit.role + ':' + credit.name + ':' + credit.source)).toEqual(['artist:Wind Waker:title', 'artist:koji konto:metadata']);
    // Метаданные повторяют исполнителя из названия или загрузчика: не дублируются
    expect(trackCredits(real('SamiLone - Man [Guitar Version] (Slowed + Reverb)')).map((credit) => credit.name)).toEqual(['SamiLone']);
    expect(trackCredits(real('do i clench my fists? (slowed + reverb)')).map((credit) => credit.role + ':' + credit.name)).toEqual(['writer:Abhinav Subramani']);
    const queries = searchQueries(real('bye (Altare remix) - Ariana Grande (slowed + reverb)'));
    expect(queries).toEqual([
        { purpose: 'exact', q: 'Ariana Grande bye Altare remix reverb slowed' },
        { purpose: 'versions', q: 'Ariana Grande bye' },
        { purpose: 'songs', q: 'Ariana Grande Altare' },
    ]);
    expect(searchQueries(upload('Song', 1)).map((query) => query.purpose)).toEqual(['exact']);
    for (const track of fixture.tracks) for (const query of searchQueries(track)) expect(query.q).not.toMatch(/["|]/);
});

it('помощники работают текстом на странице так же, как в Node', () => {
    const source = identityHelpers.map((helper) => helper.toString()).join('\n');
    expect(source).not.toMatch(/require\(|__vi_import|_1\.|import\(/);
    const page = new Function(source + '\nreturn { parseTrackTitle, versionKey, copyKeys, searchQueries, trackCredits, matchLevel };')() as Record<string, (...args: unknown[]) => unknown>;
    for (const track of fixture.tracks) {
        expect(page.parseTrackTitle(track.title)).toEqual(parseTrackTitle(track.title));
        expect(page.versionKey(track)).toBe(versionKey(track));
        expect(page.copyKeys(track)).toEqual(copyKeys(track));
        expect(page.searchQueries(track)).toEqual(searchQueries(track));
        expect(page.trackCredits(track)).toEqual(trackCredits(track));
    }
    const [a, b] = fixture.tracks;
    expect(page.matchLevel(a, b)).toBe(matchLevel(a, b));
});

it('исполнитель для группы радара: свой аккаунт с коллабом и своим ремиксом это загрузчик, сборный канал отдаёт исполнителя из названия', () => {
    const of = (title: string, uploader: string, id = 7): string => {
        const track: WaveTrack = { id: 1, title, user_id: id, user: { id, username: uploader } };
        return performerKey(id, uploader, trackCredits(track));
    };
    expect(of('Night Drive', 'Alpha')).toBe('u:7');
    expect(of('Alpha x Beta - Song', 'Alpha')).toBe('u:7');
    expect(of('Old Star - Classic (Alpha Remix)', 'Alpha')).toBe('u:7');
    expect(of('Beta - Song', 'Vibes Channel')).toBe('a:beta');
    expect(of('Beta feat. Alpha - Song', 'Vibes Channel')).toBe('a:beta');
});
