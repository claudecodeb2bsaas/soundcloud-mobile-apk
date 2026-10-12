import { describe, expect, it } from 'vitest';
import {
    WAVE_TEXTS, acceptCandidate, artworkUrl, canonicalUrl, classifyLink, formatGenres, genreKeys, genreKeysFor, isWaveEligible,
    moodTags, normalizeTag, trackPath, parseGenres, pickSpaced, spacingKeys, spacingGap, freshEnough, reasonText, shapeSamples, topGenres, trackMatchesGenre,
    applyTasteReasons, tagKeys, tasteMaps, tasteOrder, tasteReason, tasteScore, type TasteMaps, type WaveCandidate, type WaveFilter, type WaveTrack,
    countText, forgottenPicks, localDay, pickFinds, tasteGroups, capPerArtist, artistNames, isNewArtist, spreadBy, genreCanon, genreParts, genreMain,
    rememberRecent, retryDelay, genreEnglish, tagShares, performerNames, sharedPerformer,
    trackLang, tasteSlot, tasteForTime, sourceBias, trackTraits, seriesTrait,
} from './wave';
import { copyKeys, familyKey, versionKey } from './trackIdentity';

describe('вкус волны', () => {
    const taste = (artists: Array<[number, number]>, tags: Array<[string, number]> = [], tracks: Array<[number, number]> = [], extra: object = {}): TasteMaps =>
        tasteMaps({ artists, tags, tracks, ...extra }) ?? { version: 0, artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), tracks: new Map(), langs: new Map(), contexts: new Map(), sources: new Map() };
    const item = (id: number, artist: number, extra: Partial<WaveTrack> = {}): WaveCandidate => ({
        track: { id, kind: 'track', user_id: artist, duration: 180000, title: 'T' + id, ...extra },
        reason: { kind: 'similar', seed: 'Seed' },
    });

    it('ключи тегов как у модели в main, профиль из main проверяется', () => {
        expect(tagKeys('Drum & Bass', '"liquid dnb" chill Chill x')).toEqual(['drumandbass', 'liquiddnb', 'chill']);
        expect(tasteMaps(null)).toBeNull();
        const maps = tasteMaps({ artists: [[1, 2], [-1, 3], ['x', 1], [2, Infinity]], tags: [['techno', 1], ['', 2]], tracks: 'bad' });
        expect([...(maps?.artists ?? [])]).toEqual([[1, 2]]);
        expect([...(maps?.tags ?? [])]).toEqual([['techno', 1]]);
        expect(maps?.tracks.size).toBe(0);
        // Профиль до P4 без новых частей читается, новые части проверяются так же
        expect(maps?.credits.size).toBe(0);
        const next = tasteMaps({ credits: [['artistx', 1], [5, 1]], families: [['song|artistx', 0.5]], markers: [['slowed', 0.2], ['remix', 'x']] });
        expect([...(next?.credits ?? [])]).toEqual([['artistx', 1]]);
        expect([...(next?.families ?? [])]).toEqual([['song|artistx', 0.5]]);
        expect([...(next?.markers ?? [])]).toEqual([['slowed', 0.2]]);
    });

    it('A14: любимый исполнитель доходит до его песен на чужих каналах, имя загрузчика не считается дважды', () => {
        const profile = taste([[10, 0.4]], [], [], {
            credits: [['artistx', 1.5], ['artistz', 0.6], ['bad', -0.5]],
            families: [['song|artistx', 0.6]],
            markers: [['slowed', 0.4]],
        });
        // Ремикс любимого исполнителя на незнакомом канале: вес участника, семьи и пометки
        const repost = item(1, 99, { title: 'Artist X - Song (slowed)', user: { id: 99, username: 'Some Channel' } });
        const score = tasteScore(repost.track, profile);
        expect(score.artist).toBe(0);
        expect(score.credit).toBeCloseTo(1.5, 6);
        expect(score.creditName).toBe('Artist X');
        expect(score.family).toBeCloseTo(0.6, 6);
        expect(score.marker).toBeCloseTo(0.4, 6);
        expect(score.known).toBe(true);
        expect(tasteReason(repost, profile)).toEqual({ kind: 'tasteArtist', artist: 'Artist X' });
        // Своё у самого исполнителя: вес аккаунта, имя в участниках не добавляется
        const own = item(2, 10, { title: 'Other Song', user: { id: 10, username: 'Artist Z' } });
        expect(tasteScore(own.track, profile)).toMatchObject({ artist: 0.4, credit: 0 });
        // Минус участника и плюс другого складываются
        const mixed = item(3, 98, { title: 'Artist X, Bad - Thing', user: { id: 98, username: 'Hub' } });
        expect(tasteScore(mixed.track, profile).credit).toBeCloseTo(1, 6);
        // Безымянный ремикс без участников оценивается остальным и не выпадает: жанр с весом 1 после насыщения даёт 0.5
        const anon = item(4, 97, { title: 'Nightcall (Remix)', genre: 'phonk', user: { id: 97, username: 'anon' } });
        expect(tasteScore(anon.track, taste([], [['phonk', 1]])).score).toBeCloseTo(0.5, 6);
    });

    it('сильный минус отсеивается, любимое чаще встаёт вперёд, треть мест у новых артистов', () => {
        const list = [item(1, 10), item(2, 20), item(3, 30, { genre: 'Techno' }), item(4, 40), item(5, 50), item(6, 60), item(7, 70), item(8, 80), item(9, 90), item(10, 100)];
        const profile = taste([[10, 3], [20, 3], [30, 3], [40, 3], [50, 3], [60, 3], [70, 3]], [], [[9, -1.2]]);
        let seed = 1;
        const random = (): number => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        let loved = 0;
        for (let run = 0; run < 200; run++) {
            const ordered = tasteOrder(list, profile, random);
            expect(ordered.map((entry) => entry.track.id)).not.toContain(9);
            expect(ordered).toHaveLength(9);
            // Новые артисты 80 и 100: хотя бы один в первых четырёх
            const firstFour = ordered.slice(0, 4).map((entry) => entry.track.user_id);
            expect(firstFour.some((artist) => artist === 80 || artist === 100)).toBe(true);
            if ([10, 20, 30, 40, 50, 60, 70].includes(ordered[0].track.user_id ?? 0)) loved++;
        }
        expect(loved).toBeGreaterThan(150);
    });

    it('причина по вкусу: любимый артист, иначе любимый тег, похожее на зерно без вкуса не трогается', () => {
        const profile = taste([[10, 1.5], [30, 0.1]], [['darktechno', 2]]);
        const byArtist = item(1, 10, { user: { id: 10, username: 'Artist' } });
        const byTag = item(2, 20, { tag_list: '"Dark Techno" berlin' });
        const plain = item(3, 30, { genre: 'house' });
        expect(tasteReason(byArtist, profile)).toEqual({ kind: 'tasteArtist', artist: 'Artist' });
        expect(tasteReason(byTag, profile)).toEqual({ kind: 'tasteTag', genre: 'dark techno' });
        expect(tasteReason(plain, profile)).toBeNull();
        expect(tasteReason({ ...byArtist, reason: { kind: 'artistTrack', artist: 'X' } }, profile)).toBeNull();
        expect(reasonText({ kind: 'tasteTag', genre: 'dark techno' }, WAVE_TEXTS.ru)).toBe('Любимый жанр: dark techno');
        // Вес артиста копят прослушивания, лайки и подписка: подпись не утверждает, что его дослушивали
        expect(reasonText({ kind: 'tasteArtist', artist: 'Artist' }, WAVE_TEXTS.ru)).toBe('Ты любишь Artist');
        expect(reasonText({ kind: 'tasteArtist', artist: 'Artist' }, WAVE_TEXTS.en)).toBe('You love Artist');
    });

    it('жанр весит целиком, одна метка из пачки десятой частью и без причины «В духе»; ник загрузчика в метках не считается', () => {
        const profile = taste([], [['dark', 2], ['ivoxygen', 3]]);
        const byGenre = item(1, 10, { genre: 'Dark' });
        const byTag = item(2, 20, { genre: 'Pop', tag_list: 'dark sad love night slow' });
        const nick = item(3, 30, { genre: 'Pop', tag_list: 'ivoxygen', user: { id: 30, username: 'IVOXYGEN' } });
        // Сырые 2 и 0.2 после насыщения x / (1 + x)
        expect(tasteScore(byGenre.track, profile).tag).toBeCloseTo(2 / 3, 6);
        expect(tasteScore(byTag.track, profile).tag).toBeCloseTo(0.2 / 1.2, 6);
        expect(tasteReason(byGenre, profile)).toEqual({ kind: 'tasteTag', genre: 'dark' });
        expect(tasteReason(byTag, profile)).toBeNull();
        expect(tasteScore(nick.track, profile).tag).toBe(0);
    });

    it('В2.8: любимый жанр не ставит всё на потолок, любимый артист в нём обгоняет незнакомого и получает свою причину', () => {
        const profile = taste([[10, 2]], [['hiphop', 72]], [], { tags: [['hiphop', 72], ['darkpop', -3]] });
        const favourite = item(1, 10, { genre: 'Hip Hop', user: { id: 10, username: 'Favourite' } });
        const stranger = item(2, 20, { genre: 'Hip Hop', user: { id: 20, username: 'Stranger' } });
        const disliked = item(3, 30, { genre: 'Dark Pop' });
        expect(tasteScore(stranger.track, profile).score).toBeCloseTo(72 / 73, 6);
        expect(tasteScore(favourite.track, profile).score).toBeCloseTo(2 + 72 / 73, 6);
        // Минус нелюбимого жанра не насыщается
        expect(tasteScore(disliked.track, profile).score).toBeCloseTo(-3, 6);
        expect(tasteReason(favourite, profile)).toEqual({ kind: 'tasteArtist', artist: 'Favourite' });
        expect(tasteReason(stranger, profile)).toEqual({ kind: 'tasteTag', genre: 'hip hop' });
    });

    it('причина по вкусу достаётся только заметной трети подборки', () => {
        const profile = taste([], [['techno', 2]]);
        const list = Array.from({ length: 10 }, (_, i) => item(i + 1, 100 + i, { genre: 'techno' }));
        applyTasteReasons(list, profile);
        expect(list.filter((entry) => entry.reason.kind === 'tasteTag')).toHaveLength(3);
        expect(list.filter((entry) => entry.reason.kind === 'similar')).toHaveLength(7);
    });
});

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({ id, kind: 'track', user_id: id, duration: 180000, policy: 'ALLOW', title: 'Track ' + id, ...extra });
const filter = (extra: Partial<WaveFilter> = {}): WaveFilter => ({
    mode: 'similar', taken: new Set(), recent: new Set(), heard: new Set(), liked: new Set(), skipped: new Set(),
    excludedTracks: new Set(), excludedArtists: new Set(), excludedFamilies: new Map(), ...extra,
});

describe('жанр', () => {
    it('сравнивает без регистра, пробелов и знаков, знает синонимы', () => {
        expect(normalizeTag('Witch-House ')).toBe('witchhouse');
        expect(normalizeTag('Drum & Bass')).toBe('drumandbass');
        expect(genreKeys('witch house')).toEqual(['witchhouse']);
        expect(genreKeys('wtchhs')).toEqual(['witchhouse']);
        expect(genreKeys('  ')).toEqual([]);
    });
    it('В2.7: rock находит Alternative Rock, hip hop находит Rap, phonk находит Fonk, bass не находит Drum & Bass', () => {
        const match = (genre: string, input: string, tags = ''): boolean => trackMatchesGenre(track(1, { genre, tag_list: tags }), genreKeysFor(input));
        expect(match('Alternative Rock', 'rock')).toBe(true);
        expect(match('Hard Rock', 'rock')).toBe(true);
        expect(match('Rap', 'hip hop')).toBe(true);
        expect(match('Hip Hop', 'rap')).toBe(true);
        expect(match('Hip-hop & Rap', 'rap')).toBe(true);
        expect(match('Russian Rap', 'hip hop')).toBe(true);
        expect(match('Trap', 'rap')).toBe(false);
        expect(match('Fonk', 'phonk')).toBe(true);
        expect(match('Brazilian Phonk', 'phonk')).toBe(true);
        expect(match('Drum & Bass', 'bass')).toBe(false);
        expect(match('Drum and Bass', 'bass')).toBe(false);
        expect(match('Future Bass', 'bass')).toBe(true);
        expect(match('Drum & Bass', 'dnb')).toBe(true);
        expect(match('Dance & EDM', 'edm')).toBe(true);
        expect(match('Dance & EDM', 'dance')).toBe(true);
        expect(match('R&B & Soul', 'soul')).toBe(true);
        expect(match('R&B & Soul', 'r&b')).toBe(true);
        expect(match('Rock & Roll', 'roll')).toBe(false);
        expect(match('Electronic', 'lofi', '"lo fi" beats')).toBe(true);
        expect(match('Witch House', 'house')).toBe(false);
        expect(match('Tech House', 'house')).toBe(true);
    });
    it('В2.7: русские названия жанров сопоставляются с метками, на сайт уходят по-английски', () => {
        const match = (genre: string, input: string): boolean => trackMatchesGenre(track(1, { genre }), genreKeysFor(input));
        expect(match('Hip-hop & Rap', 'рэп')).toBe(true);
        expect(match('Phonk', 'фонк')).toBe(true);
        expect(match('Electronic', 'электроника')).toBe(true);
        expect(match('Drum & Bass', 'драм-н-бейс')).toBe(true);
        expect(match('Русский рэп', 'hip hop')).toBe(true);
        expect(match('Trap', 'рэп')).toBe(false);
        expect(genreEnglish('Рэп')).toBe('rap');
        expect(genreEnglish('драм-н-бейс')).toBe('drum & bass');
        expect(genreEnglish('witch house')).toBe('witch house');
        expect(genreCanon('рэп')).toBe('hiphop');
        expect(tagShares('Электроника', 'фонк')).toEqual([['electronic', 1], ['phonk', 0.5]]);
    });
    it('ищет в жанре и тегах, короткий ключ только целиком', () => {
        const keys = genreKeys('witch house');
        expect(trackMatchesGenre(track(1, { genre: 'Witch House' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(2, { genre: 'Electronic', tag_list: 'dark "witch house" 2024' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(3, { genre: 'darkwitchhouse / drill' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(4, { genre: 'wtchhs' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(5, { genre: 'Trap' }), genreKeys('rap'))).toBe(false);
        expect(trackMatchesGenre(track(6, { genre: 'Rap / Trap' }), genreKeys('rap'))).toBe(true);
        expect(trackMatchesGenre(track(7, {}), [])).toBe(true);
        // Witch house только звучит как house
        expect(trackMatchesGenre(track(8, { genre: 'Witch House' }), genreKeys('house'))).toBe(false);
        expect(trackMatchesGenre(track(9, { genre: 'Deep House' }), genreKeys('house'))).toBe(true);
        // Зёрна строго по полю жанра: метка Hip Hop у рокового трека не делает его зерном хип-хопа, трек без жанра идёт по меткам
        const spam = track(10, { genre: 'Alternative Rock', tag_list: '"Hip Hop" Rap Ambient' });
        expect(trackMatchesGenre(spam, genreKeys('hip hop'))).toBe(true);
        expect(trackMatchesGenre(spam, genreKeys('hip hop'), true)).toBe(false);
        expect(trackMatchesGenre(track(11, { tag_list: '"Hip Hop"' }), genreKeys('hip hop'), true)).toBe(true);
    });
    it('настроение: жанр и теги зерна, у зерна без них самые частые среди похожих', () => {
        expect(moodTags([track(1, { genre: 'Witch House', tag_list: 'dark "haunted mound"' })], [track(2, { genre: 'Rap' })], 2)).toEqual(['witch house', 'dark']);
        const around = [
            track(2, { genre: 'Phonk', tag_list: 'drift' }), track(3, { genre: 'phonk', tag_list: '"Dark Phonk" drift' }),
            track(4, { genre: 'Phonk' }), track(5, { genre: '', tag_list: 'x' }),
        ];
        expect(moodTags([track(1, {})], around, 2)).toEqual(['phonk', 'drift']);
        expect(moodTags([track(1, {})], [], 2)).toEqual([]);
    });
    it('настроение: ник, числа и метка-спам одного загрузчика его не уводят', () => {
        // Своя метка-ник и год у зерна не настроение
        const seed = track(1, { genre: 'Phonk', tag_list: 'ivoxygen 2024 drift', user: { id: 1, username: 'ivoxygen' } });
        expect(moodTags([seed], [], 2)).toEqual(['phonk', 'drift']);
        // Среди похожих один загрузчик с восемью треками и своей меткой голосует один раз
        const spam = Array.from({ length: 8 }, (_, i) => track(10 + i, { user_id: 5, user: { id: 5, username: 'Uploader' }, genre: '', tag_list: 'fyp viral' }));
        const others = [20, 21, 22].map((id) => track(id, { genre: 'Hip-hop & Rap', tag_list: 'memphis' }));
        expect(moodTags([track(1, {})], [...spam, ...others], 1)).toEqual(['hip-hop & rap']);
    });
    it('путь трека для журнала: только /user/track, секретная ссылка приватного трека не проходит', () => {
        expect(trackPath('https://soundcloud.com/Mighty_Mason/krovyu-1?in=x')).toBe('/mighty_mason/krovyu-1');
        expect(trackPath('https://soundcloud.com/user/track/s-AbCdEf')).toBe('');
        expect(trackPath('https://evil.test/user/track')).toBe('');
        expect(trackPath(undefined)).toBe('');
    });
    it('понимает несколько жанров через запятую и слэш, drum & bass остаётся целым', () => {
        expect(parseGenres(' Techno / dark  techno, industrial;techno ')).toEqual(['techno', 'dark techno', 'industrial']);
        expect(parseGenres('drum & bass | r&b')).toEqual(['drum & bass', 'r&b']);
        expect(parseGenres('a,b,c,d,e')).toHaveLength(4);
        expect(parseGenres(' / , ')).toEqual([]);
        expect(formatGenres(parseGenres('techno,dark techno'))).toBe('techno / dark techno');
        const keys = genreKeysFor('techno / witch house');
        expect(keys).toEqual(['techno', 'witchhouse']);
        expect(trackMatchesGenre(track(1, { genre: 'wtchhs' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(2, { genre: 'Techno' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(3, { genre: 'House' }), keys)).toBe(false);
        expect(genreKeysFor(null)).toEqual([]);
    });
});

describe('ссылки для меню', () => {
    const base = 'https://soundcloud.com/feed';
    it('отличает трек, артиста и плейлист, в том числе системный', () => {
        expect(classifyLink('/artist/track-name?in=x#t=1', base)).toEqual({ kind: 'track', url: 'https://soundcloud.com/artist/track-name' });
        expect(classifyLink('/artist', base)).toEqual({ kind: 'artist', url: 'https://soundcloud.com/artist' });
        expect(classifyLink('/artist/sets/mix', base)).toEqual({ kind: 'playlist', url: 'https://soundcloud.com/artist/sets/mix' });
        expect(classifyLink('/discover/sets/personalized-tracks::a:1', base)?.kind).toBe('playlist');
    });
    it('не принимает служебные страницы и чужие сайты', () => {
        for (const href of ['/you/likes', '/artist/likes', '/artist/sets', '/discover', '/search/sounds?q=x', '/artist/track/comments', 'https://evil.com/a/b', 'javascript:alert(1)', 'http://soundcloud.com/a/b'])
            expect(classifyLink(href, base)).toBeNull();
    });
    it('приводит ссылку к виду, который хранит main', () => {
        expect(canonicalUrl('https://soundcloud.com/Artist/Track/?in=x')).toBe('https://soundcloud.com/artist/track');
        expect(canonicalUrl('https://evil.com/a')).toBe('');
        expect(canonicalUrl(undefined)).toBe('');
    });
});

describe('фильтры', () => {
    it('отсекает Go+, BLOCK, длинные, короткие и не треки', () => {
        expect(isWaveEligible(track(1))).toBe(true);
        expect(isWaveEligible(track(2, { policy: 'SNIP' }))).toBe(false);
        expect(isWaveEligible(track(3, { policy: 'BLOCK' }))).toBe(false);
        expect(isWaveEligible(track(4, { full_duration: 16 * 60000 }))).toBe(false);
        expect(isWaveEligible(track(5, { duration: 20000 }))).toBe(false);
        expect(isWaveEligible(track(6, { kind: 'playlist' }))).toBe(false);
        expect(isWaveEligible(track(7, { streamable: false }))).toBe(false);
    });
    it('«Новое» не берёт слышанное и лайкнутое, «Похожее» только недавнее', () => {
        const heard = new Set([1]);
        const liked = new Set([2]);
        const recent = new Set([3]);
        expect(acceptCandidate(track(1), filter({ mode: 'fresh', heard, liked }))).toBe(false);
        expect(acceptCandidate(track(2), filter({ mode: 'fresh', heard, liked }))).toBe(false);
        expect(acceptCandidate(track(1), filter({ heard, liked, recent }))).toBe(true);
        expect(acceptCandidate(track(3), filter({ heard, liked, recent }))).toBe(false);
        expect(acceptCandidate(track(4), filter({ taken: new Set([4]) }))).toBe(false);
        expect(acceptCandidate(track(6), filter({ excludedTracks: new Set([6]) }))).toBe(false);
        expect(acceptCandidate(track(7, { user_id: 70 }), filter({ mode: 'fresh', excludedArtists: new Set([70]) }))).toBe(false);
    });

    it('A07: ранний пропуск убирает версию и её перезаливы, остальные треки того же канала проходят', () => {
        const skippedTrack = track(5, { user_id: 50, title: 'Mix Channel - Song A', user: { id: 50, username: 'Mix Channel' } });
        const skipped = new Set(copyKeys(skippedTrack));
        const reupload = track(6, { user_id: 60, title: 'Mix Channel - Song A', user: { id: 60, username: 'Reup' }, duration: 181000 });
        const sameChannel = track(7, { user_id: 50, title: 'Mix Channel - Song B', user: { id: 50, username: 'Mix Channel' } });
        const slowed = track(8, { user_id: 50, title: 'Mix Channel - Song A (Slowed)', user: { id: 50, username: 'Mix Channel' } });
        expect(acceptCandidate(reupload, filter({ skipped }))).toBe(false);
        expect(acceptCandidate(sameChannel, filter({ skipped }))).toBe(true);
        expect(acceptCandidate(slowed, filter({ skipped }))).toBe(true);
    });

    it('A08: «Скрыть другие версии» убирает остальные версии композиции, выбранную версию и другую песню того же исполнителя нет', () => {
        const chosen = track(1, { title: 'Artist - Song' });
        const hidden = new Map([[familyKey(chosen), new Set([versionKey(chosen)])]]);
        expect(acceptCandidate(track(2, { title: 'Artist - Song (Slowed)' }), filter({ excludedFamilies: hidden }))).toBe(false);
        expect(acceptCandidate(track(4, { title: 'Artist - Song' }), filter({ excludedFamilies: hidden }))).toBe(true);
        expect(acceptCandidate(track(3, { title: 'Artist - Other Song' }), filter({ excludedFamilies: hidden }))).toBe(true);
    });

    it('новый артист: у чужой песни на канале решают исполнители из названия, у своей ещё и аккаунт', () => {
        const history = [track(1, { user_id: 10, title: 'Known Artist - Hit', user: { id: 10, username: 'Big Channel' } }), track(2, { user_id: 20, title: 'Solo', user: { id: 20, username: 'Solo Act' } })];
        const names = artistNames(history);
        expect([...names].sort()).toEqual(['knownartist', 'soloact']);
        const ids = new Set([10, 20]);
        // Известный исполнитель на незнакомом канале не новый; незнакомый исполнитель на знакомом сборном канале новый
        expect(isNewArtist(track(3, { user_id: 30, title: 'Known Artist - Other', user: { id: 30, username: 'Reup' } }), ids, names)).toBe(false);
        expect(isNewArtist(track(4, { user_id: 10, title: 'Fresh Face - Debut', user: { id: 10, username: 'Big Channel' } }), ids, names)).toBe(true);
        expect(isNewArtist(track(5, { user_id: 20, title: 'Another', user: { id: 20, username: 'Solo Act' } }), ids, names)).toBe(false);
        expect(isNewArtist(track(6, { user_id: 60, title: 'Untitled', user: { id: 60, username: 'Stranger' } }), ids, names)).toBe(true);
    });
});

it('разносит артистов в окне из трёх и не трогает пул', () => {
    const pool: WaveCandidate[] = [1, 1, 1, 2, 3, 4].map((artist, index) => ({ track: track(index + 1, { user_id: artist }), reason: { kind: 'newArtist' } }));
    const picked = pickSpaced(pool, 4, [['u:2']]);
    expect(picked.map((item) => item.track.user_id)).toEqual([1, 3, 4, 2]);
    expect(pool).toHaveLength(6);
});

it('В2.6: одна песня исполнителя на разных каналах разносится по исполнителю, окно растёт с числом исполнителей', () => {
    const song = (id: number, channel: number): WaveCandidate => ({
        track: track(id, { user_id: channel, title: 'Star - Song ' + id, user: { id: channel, username: 'Channel ' + channel } }), reason: { kind: 'similar', seed: 'x' },
    });
    const other = (id: number): WaveCandidate => ({ track: track(id, { user_id: id, user: { id, username: 'Solo ' + id } }), reason: { kind: 'similar', seed: 'x' } });
    const pool = [song(1, 101), song(2, 102), song(3, 103), other(4), other(5)];
    expect(spacingKeys(pool[0].track)).toEqual(['u:101', 'a:star']);
    expect(pickSpaced(pool, 5, []).map((item) => item.track.id)).toEqual([1, 4, 5, 2, 3]);
    expect(spacingGap(pool)).toBe(2);
    expect(spacingGap(Array.from({ length: 30 }, (_, i) => other(100 + i)))).toBe(5);
});

it('П1: общий исполнитель двух записей: загрузчик своего, участники из названия, без продюсеров и чужого канала', () => {
    const by = (id: number, title: string, username: string): WaveTrack => track(id, { title, user_id: id, user: { id, username } });
    const seed = by(1, 'реквием по мечте', 'mightymason');
    expect(sharedPerformer(seed, by(2, 'кровью', 'mightymason'))).toBe('mightymason');
    expect(sharedPerformer(seed, by(3, 'mightymason - реквием по мечте (slowed)', 'Fan Channel'))).toBe('mightymason');
    // Канал выложил чужую песню без себя в титрах: это не его запись
    expect(sharedPerformer(seed, by(4, 'Моцарт - Реквием По Мечте (Dub Step Remix)', 'mightymason'))).toBe('');
    expect(sharedPerformer(seed, by(8, 'Моцарт - Реквием По Мечте (mightymason Remix)', 'Channel'))).toBe('mightymason');
    expect(sharedPerformer(seed, by(5, 'Моцарт - Реквием По Мечте', 'Channel'))).toBe('');
    expect(sharedPerformer(seed, by(6, 'Other - Beat (prod. mightymason)', 'Other'))).toBe('');
    expect([...performerNames(by(7, 'Star - Song (feat. Guest)', 'Channel')).keys()].sort()).toEqual(['guest', 'star']);
});

it('П6: язык трека по названию, имени, жанру и меткам; оценка сравнивает с любимым языком', () => {
    const by = (title: string, username = 'Someone', extra: Partial<WaveTrack> = {}): WaveTrack => track(1, { title, user: { id: 1, username }, ...extra });
    expect(trackLang(by('Кровью'))).toBe('cyr');
    expect(trackLang(by('Untitled', 'Тёмный'))).toBe('cyr');
    expect(trackLang(by('Night Drive'))).toBe('lat');
    expect(trackLang(by('Night Drive (Instrumental)'))).toBe('inst');
    expect(trackLang(by('Drake Type Beat - Lonely'))).toBe('inst');
    expect(trackLang(by('Кровью (инструментал)'))).toBe('inst');
    expect(trackLang(by('Lonely', 'Producer', { genre: 'Beats' }))).toBe('inst');
    // Метку beat ставит и русский рэп: кириллица в названии важнее метки
    expect(trackLang(by('Кровью', 'Артист', { tag_list: 'beat rap' }))).toBe('cyr');
    expect(trackLang(by('Beat It'))).toBe('lat');
    const taste = tasteMaps({ langs: [['lat', 30], ['cyr', -3]] }) as TasteMaps;
    expect(tasteScore(by('Night Drive'), taste).lang).toBe(0);
    const cyr = tasteScore(by('Кровью'), taste);
    expect(cyr.lang).toBeCloseTo(0.5 * (-3 / 4 - 30 / 31), 6);
    expect(cyr.score).toBeCloseTo(cyr.lang, 6);
    // Языка нет во вкусе: как вес ноль против любимого
    expect(tasteScore(by('Lonely (Instrumental)'), taste).lang).toBeCloseTo(-0.5 * 30 / 31, 6);
    expect(tasteScore(by('Кровью'), tasteMaps({}) as TasteMaps).lang).toBe(0);
});

it('П7: общий признак серии пропусков: самый узкий из общих, латиница не признак, прижатое и жанр волны пропускаются', () => {
    const by = (id: number, title: string, username: string, genre = ''): WaveTrack => track(id, { title, genre, user_id: id, user: { id, username } });
    const slowedA = by(1, 'Кровью (slowed)', 'Канал', 'Phonk');
    const slowedB = by(2, 'Night (Slowed + Reverb)', 'Chan', 'Phonk');
    expect(trackTraits(slowedA).map((trait) => trait.kind + ':' + trait.key)).toEqual(['marker:slowed', 'lang:cyr', 'genre:phonk']);
    expect(seriesTrait([slowedA, slowedB])).toEqual({ kind: 'marker', key: 'slowed', label: 'slowed' });
    expect(seriesTrait([slowedA, slowedB], ['marker:slowed'])).toEqual({ kind: 'genre', key: 'phonk', label: 'phonk' });
    expect(seriesTrait([slowedA, slowedB], ['marker:slowed', 'genre:phonk'])).toBeNull();
    expect(seriesTrait([by(3, 'Песня', 'Артист'), by(4, 'Другая', 'Второй')])).toMatchObject({ kind: 'lang', key: 'cyr' });
    expect(seriesTrait([by(5, 'Song', 'A'), by(6, 'Tune', 'B')])).toBeNull();
    // Чужой канал: в названии другой исполнитель
    expect(seriesTrait([by(7, 'Star - Song', 'Reupload'), by(8, 'Other - Tune', 'Fan Channel')])).toMatchObject({ kind: 'foreign' });
    expect(seriesTrait([slowedA])).toBeNull();
    expect(trackTraits(by(9, 'Song (Super Slowed)', 'A'))[0]).toEqual({ kind: 'marker', key: 'superslowed', label: 'super slowed' });
});

it('П5: вкус на сейчас прибавляет поправки текущего отрезка суток только к известным ключам', () => {
    const night = new Date(2026, 8, 23, 2, 30).getTime();
    const weekendDay = new Date(2026, 8, 26, 14, 0).getTime();
    expect(tasteSlot(night)).toBe(0);
    expect(tasteSlot(weekendDay)).toBe(5);
    const base = tasteMaps({
        artists: [[1, 2], [2, 1]], tags: [['ambient', 1]],
        contexts: [{ key: 0, artists: [[1, 0.5], [2, -0.4], [9, 3]], tags: [['ambient', 0.2], ['new', 1]] }, { key: 99, artists: [[1, 5]] }, 'мусор'],
    }) as TasteMaps;
    expect([...base.contexts.keys()]).toEqual([0]);
    const now = tasteForTime(base, night);
    expect(now.artists.get(1)).toBeCloseTo(2.5, 6);
    expect(now.artists.get(2)).toBeCloseTo(0.6, 6);
    expect(now.artists.has(9)).toBe(false);
    expect(now.tags.get('ambient')).toBeCloseTo(1.2, 6);
    expect(now.tags.has('new')).toBe(false);
    // Базовый вкус не тронут, в отрезке без поправок он и есть вкус на сейчас
    expect(base.artists.get(1)).toBe(2);
    expect(tasteForTime(base, weekendDay)).toBe(base);
});

it('П9: поправка источников по выборке из бета-распределения, с потолком, без данных источника нет', () => {
    const sources = tasteMaps({ sources: [['relatedArtist', 300, 20], ['similar', 40, 300], ['bad', -1, 2], ['scMix', 0, 0]] })?.sources ?? new Map();
    expect([...sources.keys()]).toEqual(['relatedArtist', 'similar', 'scMix']);
    let seed = 7;
    const random = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const bias = sourceBias(sources, random);
    expect(bias.get('relatedArtist') ?? 0).toBeGreaterThan(0.3);
    expect(bias.get('similar')).toBe(-1);
    expect(bias.has('bad')).toBe(false);
    for (const value of bias.values()) expect(Math.abs(value)).toBeLessThanOrEqual(1);
    expect(sourceBias(new Map(), random).size).toBe(0);
    // Много данных: выборка близка к доле дослушанного
    const draws = Array.from({ length: 200 }, () => sourceBias(new Map([['a', { done: 900, early: 100 }], ['b', { done: 100, early: 900 }]]), random).get('a') ?? 0);
    expect(Math.min(...draws)).toBeGreaterThan(0.3);
});

it('В2.12: мягкий порог свежего в жанре, лайки трека и поправка сессии в порядке по вкусу', () => {
    expect(freshEnough(track(1))).toBe(true);
    expect(freshEnough(track(2, { likes_count: 0, playback_count: 5 }))).toBe(false);
    expect(freshEnough(track(3, { likes_count: 1, playback_count: 5 }))).toBe(true);
    expect(freshEnough(track(4, { likes_count: null, playback_count: 40 }))).toBe(true);
    const empty = tasteMaps({}) as TasteMaps;
    const list: WaveCandidate[] = [1, 2, 3].map((id) => ({ track: track(id, { likes_count: id === 3 ? 5000 : 0 }), reason: { kind: 'newArtist' } }));
    // При равном случае вперёд то, что понравилось многим; поправка сессии топит трек
    expect(tasteOrder(list, empty, () => 0.5).map((item) => item.track.id)[0]).toBe(3);
    expect(tasteOrder(list, empty, () => 0.5, (item) => (item.track.id === 3 ? -2 : 0)).map((item) => item.track.id).slice(-1)[0]).toBe(3);
});

it('частые жанры лайков и подписи причин на двух языках', () => {
    expect(topGenres([track(1, { genre: 'Phonk' }), track(2, { genre: 'phonk' }), track(3, { genre: 'Rap' }), track(4, { genre: '' })], 5)).toEqual(['phonk', 'rap']);
    // Написания хип-хопа одной строкой, подпись самая частая
    expect(topGenres(['Hip-hop & Rap', 'Hip-hop & Rap', 'Hip Hop/Rap', 'rap', 'Techno'].map((genre, i) => track(10 + i, { genre })), 5)).toEqual(['hip-hop & rap', 'techno']);
    expect(reasonText({ kind: 'genreSimilar', genre: 'phonk', seed: 'X' }, WAVE_TEXTS.ru)).toBe('phonk, похоже на X');
    expect(reasonText({ kind: 'fresh', seed: 'X' }, WAVE_TEXTS.en)).toBe('New to you, similar to X');
    for (const texts of Object.values(WAVE_TEXTS)) for (const value of Object.values(texts)) expect(value).not.toMatch(/[–—]/);
});

it('растягивает динамику формы и берёт обложку нужного размера', () => {
    const shaped = shapeSamples([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 140]);
    expect(Math.min(...shaped)).toBeCloseTo(0.1);
    expect(Math.max(...shaped)).toBeCloseTo(1);
    expect(artworkUrl(track(1, { artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg' }), 't500x500')).toBe('https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
    expect(artworkUrl(track(1, { artwork_url: 'javascript:alert(1)' }), 't300x300')).toBe('');
});

describe('подборки', () => {
    it('сутки местные, число со словом по правилам языка', () => {
        expect(localDay(new Date(2026, 8, 24, 23, 59).getTime())).toBe('2026-09-24');
        expect(localDay(new Date(2026, 8, 25, 0, 0).getTime())).toBe('2026-09-25');
        const ru = WAVE_TEXTS.ru.tracksCount;
        expect([1, 3, 5, 11, 21, 22].map((count) => countText(count, ru, 'ru'))).toEqual(['1 трек', '3 трека', '5 треков', '11 треков', '21 трек', '22 трека']);
        expect([1, 5].map((count) => countText(count, WAVE_TEXTS.en.tracksCount, 'en'))).toEqual(['1 track', '5 tracks']);
        expect(reasonText({ kind: 'group', name: 'Techno' }, WAVE_TEXTS.ru)).toBe('Твой вкус: Techno');
        expect(reasonText({ kind: 'daily' }, WAVE_TEXTS.en)).toBe('Scout: not played by you yet');
    });

    it('делит лайки на вкусы по тегам, трек без тегов идёт за своим артистом, мелкое отбрасывается', () => {
        const techno = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 1 + (i % 5), genre: 'Techno', tag_list: 'industrial "hard techno"' }));
        const lofi = Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 11 + (i % 5), genre: 'Lo-Fi', tag_list: 'chill jazzhop' }));
        const polka = [track(300, { genre: 'Polka' }), track(301, { genre: 'Polka' })];
        const bare = track(400, { user_id: 1 });
        const items = [...techno, ...lofi, ...polka, bare].map((entry) => ({ track: entry, weight: entry.id === 105 ? 3 : 1 }));
        const groups = tasteGroups(items, 4, 8);
        expect(groups).toHaveLength(2);
        expect(groups[0].keys).toEqual(expect.arrayContaining(['techno', 'industrial', 'hardtechno']));
        expect(groups[0].labels[0]).toBe('Techno');
        expect(groups[0].tracks[0].id).toBe(105);
        expect(groups[0].tracks.map((entry) => entry.id)).toContain(400);
        expect(groups[1].keys).toEqual(expect.arrayContaining(['lofi', 'chill', 'jazzhop']));
        expect(groups.flatMap((group) => group.tracks).some((entry) => entry.id === 300)).toBe(false);
        expect(tasteGroups(items, 4, 11)).toHaveLength(1);
        expect(tasteGroups([], 4, 1)).toEqual([]);
    });

    it('написания жанра склеиваются, составной жанр сайта режется на части, но не по &', () => {
        expect(genreCanon('hiphopandrap')).toBe('hiphop');
        expect(genreCanon('rap')).toBe('hiphop');
        expect(genreCanon('techno')).toBe('techno');
        expect(genreParts('Hip Hop/Rap - Trap')).toEqual(['hiphop', 'trap']);
        expect(genreParts('Hip-hop & Rap')).toEqual(['hiphop']);
        expect(genreParts('Hip-hop/Rap')).toEqual(['hiphop']);
        expect(genreParts('Drum & Bass')).toEqual(['drumandbass']);
        expect(genreParts('R&B & Soul')).toEqual(['rnb']);
        expect(genreParts('Phonk/Fonk')).toEqual(['phonk']);
        expect(genreParts('')).toEqual([]);
        expect(genreMain('hip hop/rap - trap')).toEqual({ key: 'trap', label: 'trap' });
        expect(genreMain('Hip-hop & Rap')).toEqual({ key: 'hiphop', label: 'Hip-hop & Rap' });
        expect(genreMain('Phonk/Fonk')).toEqual({ key: 'phonk', label: 'Phonk' });
        expect(genreMain('  ')).toEqual({ key: '', label: '' });
    });

    it('большая группа отдаёт поджанр, который стоит у треков жанром; тег без жанра группу не делит', () => {
        const items = [
            ...Array.from({ length: 30 }, (_, i) => track(500 + i, { user: { id: 500 + i, username: 'Rapper ' + i }, genre: 'Hip-hop & Rap' })),
            ...Array.from({ length: 12 }, (_, i) => track(600 + i, { user: { id: 600 + i, username: 'Trapper ' + i }, genre: 'Hip Hop/Rap - Trap' })),
            ...Array.from({ length: 9 }, (_, i) => track(700 + i, { user: { id: 700 + i, username: 'Sadboy ' + i }, genre: 'Hip-hop & Rap', tag_list: 'sad' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const trap = groups.find((group) => group.labels[0] === 'Trap');
        const rest = groups.find((group) => group.keys.includes('hiphop'));
        expect(trap?.tracks).toHaveLength(12);
        expect(rest?.tracks).toHaveLength(39);
        expect(rest?.keys).not.toContain('trap');
        expect(groups.some((group) => group.labels[0] === 'sad')).toBe(false);
    });

    it('метка не уводит трек из жанра, который поставил загрузчик; подпись берётся из поля жанра, а не из тегов', () => {
        const user = (id: number) => ({ user: { id, username: 'User ' + id } });
        const items = [
            ...Array.from({ length: 51 }, (_, i) => track(1000 + i, { ...user(1000 + i), genre: 'Alternative' })),
            ...Array.from({ length: 45 }, (_, i) => track(2000 + i, { ...user(2000 + i), genre: 'Alternative Rock', tag_list: i < 9 ? 'grunge alternative' : 'grunge' })),
            ...Array.from({ length: 20 }, (_, i) => track(3000 + i, { ...user(3000 + i), genre: 'Hip-hop & Rap', tag_list: 'rap' })),
            ...Array.from({ length: 10 }, (_, i) => track(3100 + i, { ...user(3100 + i), tag_list: 'rap' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const alternative = groups.filter((group) => group.keys[0] === 'alternative');
        expect(alternative).toHaveLength(1);
        // Девять треков Alternative Rock с меткой alternative остаются в своём жанре
        expect(alternative[0].tracks).toHaveLength(51);
        expect(groups.find((group) => group.keys[0] === 'alternativerock')?.tracks).toHaveLength(45);
        expect(groups.find((group) => group.keys[0] === 'hiphop')?.labels[0]).toBe('Hip-hop & Rap');
    });

    it('артист с пачкой меток на все жанры не собирает свою карточку и не растекается по чужим (случай ivoxygen)', () => {
        const star = { id: 1, username: 'Star' };
        const spam = 'Alternative "Alternative Rock" "Hip Hop" Rap Ambient Dark Atmospheric';
        const items = [
            ...Array.from({ length: 12 }, (_, i) => track(100 + i, { user_id: 1, user: star, genre: 'Alternative Rock', tag_list: spam })),
            ...Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 1, user: star, genre: 'Hip-hop & Rap', tag_list: spam })),
            ...Array.from({ length: 4 }, (_, i) => track(300 + i, { user_id: 1, user: star, genre: 'Ambient', tag_list: spam })),
            ...Array.from({ length: 20 }, (_, i) => track(400 + i, { user_id: 10 + i, user: { id: 10 + i, username: 'Rock ' + i }, genre: 'Alternative Rock', tag_list: 'grunge' })),
            ...Array.from({ length: 20 }, (_, i) => track(500 + i, { user_id: 40 + i, user: { id: 40 + i, username: 'Rap ' + i }, genre: 'Hip-hop & Rap', tag_list: 'trap' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const place = (id: number): string | undefined => groups.find((group) => group.tracks.some((entry) => entry.id === id))?.keys[0];
        expect(place(100)).toBe('alternativerock');
        expect(place(200)).toBe('hiphop');
        expect(groups.some((group) => ['ambient', 'dark', 'atmospheric'].includes(group.keys[0]))).toBe(false);
        expect(groups.find((group) => group.keys[0] === 'hiphop')?.tracks).toHaveLength(30);
    });

    it('в подборке не больше заданного числа треков одного артиста, порядок сохраняется', () => {
        const list = [1, 1, 2, 1, 3, 1, 2].map((artist, i) => track(10 + i, { user_id: artist }));
        expect(capPerArtist(list, 2).map((entry) => entry.id)).toEqual([10, 11, 12, 14, 16]);
    });

    it('журнал страницы после предела забывает самые старые треки, а не перестаёт записывать', () => {
        const seen = new Set<number>();
        for (let id = 1; id <= 5000; id++) expect(rememberRecent(seen, id, 5000)).toBe(true);
        expect(rememberRecent(seen, 7, 5000)).toBe(false);
        expect(rememberRecent(seen, 5001, 5000)).toBe(true);
        expect(seen.size).toBe(5000);
        expect(seen.has(1)).toBe(false);
        expect(rememberRecent(seen, 1, 5000)).toBe(true);
        expect(seen.has(2)).toBe(false);
    });

    it('повтор полки и радара после сбоев подряд всё реже, до получаса', () => {
        expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([0, 30000, 120000, 300000, 900000, 1800000, 1800000]);
    });

    it('сборный канал не раздаёт свой жанр чужим песням без тегов, своя песня артиста наследует', () => {
        const channel = { id: 1, username: 'Techno Hub' };
        const techno = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 1, user: channel, title: 'Artist ' + i + ' - Track', genre: 'Techno', tag_list: 'industrial' }));
        const foreign = track(400, { user_id: 1, user: channel, title: 'Pop Star - Ballad' });
        const artist = { id: 2, username: 'Solo' };
        const own = Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 2, user: artist, title: 'Solo Tune ' + i, genre: 'Techno', tag_list: 'industrial' }));
        const bare = track(401, { user_id: 2, user: artist, title: 'Untagged Solo Tune' });
        const groups = tasteGroups([...techno, foreign, ...own, bare].map((entry) => ({ track: entry, weight: 1 })), 4, 8);
        const ids = groups.flatMap((group) => group.tracks.map((entry) => entry.id));
        expect(ids).not.toContain(400);
        expect(ids).toContain(401);
    });

    it('давно не слушал: без недавнего и нелюбимого, ценное вперёд, дальше старые лайки', () => {
        const liked = [track(1), track(2), track(3), track(4), track(5, { policy: 'SNIP' }), track(6)];
        const weights = new Map([[1, -1.5], [3, 2]]);
        expect(forgottenPicks(liked, new Set([2]), weights, 10).map((entry) => entry.id)).toEqual([3, 6, 4]);
        expect(forgottenPicks(liked, new Set(), null, 2).map((entry) => entry.id)).toEqual([6, 4]);
    });

    it('В7: выборка дня в «Давно не слушал»: весь день одна, завтра другая, ценное вероятнее, недавнее и нелюбимое нет', () => {
        const liked = Array.from({ length: 200 }, (_, i) => track(i + 1));
        const weights = new Map<number, number>([[1, -1.5], ...Array.from({ length: 20 }, (_, i): [number, number] => [101 + i, 4])]);
        const pick = (day: string): number[] => forgottenPicks(liked, new Set([2]), weights, 60, day).map((entry) => entry.id);
        const today = pick('2026-09-28');
        expect(today).toHaveLength(60);
        expect(pick('2026-09-28')).toEqual(today);
        // Порядок входа ничего не решает
        expect(forgottenPicks(liked.slice().reverse(), new Set([2]), weights, 60, '2026-09-28').map((entry) => entry.id)).toEqual(today);
        const tomorrow = pick('2026-09-29');
        expect(tomorrow.filter((id) => today.includes(id)).length).toBeLessThan(45);
        expect(today).not.toContain(1);
        expect(today).not.toContain(2);
        // Двадцать ценных из двухсот: в выборку из 60 их попадает заметно больше средних шести
        expect(today.filter((id) => id > 100 && id <= 120).length).toBeGreaterThan(9);
    });

    it('П11: давно не слушал по любви: дослушивания и круги вверх, пропущенный лайк без дослушиваний не берётся, любимое без лайка от трёх', () => {
        const liked = [track(1), track(2), track(3), track(4)];
        const love = new Map([
            [1, { done: 0, early: 2, loops: 0 }],
            [2, { done: 4, early: 0, loops: 3 }],
            [3, { done: 1, early: 1, loops: 0 }],
            [7, { done: 3, early: 0, loops: 0 }],
            [8, { done: 2, early: 0, loops: 5 }],
        ]);
        const heard = [track(7), track(8), track(2)];
        // 2: 1 + 4 + 6; 7: 1 + 3; 3: 1 + 1 - 2 = 0 не берётся; 4 без счётчиков 1; 8 без лайка и меньше трёх дослушиваний нет
        expect(forgottenPicks(liked, new Set(), null, 10, '', love, heard).map((entry) => entry.id)).toEqual([2, 7, 4]);
        // Вкус прибавляется к весу и по-прежнему отсекает нелюбимое
        expect(forgottenPicks(liked, new Set(), new Map([[4, 5], [2, -2]]), 10, '', love, heard).map((entry) => entry.id)).toEqual([4, 7]);
        expect(forgottenPicks(liked, new Set([7]), null, 10, '2026-10-02', love, heard).map((entry) => entry.id).sort()).toEqual([2, 4]);
    });

    it('A01: находки берут знакомый аккаунт и несколько его песен, без слышанного и недоступного', () => {
        const candidates = [
            track(1, { user_id: 50 }), track(2, { user_id: 60 }), track(3, { user_id: 60 }), track(4, { user_id: 70, title: 'Same' }),
            track(5, { user_id: 70, title: 'Other' }), track(6, { user_id: 80 }), track(7, { user_id: 90, policy: 'SNIP' }), track(8, { user_id: 95 }),
        ];
        const finds = pickFinds(candidates, (entry) => entry.id === 6, null, 10);
        expect(finds.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 8]);
        expect(pickFinds(candidates, () => false, null, 2)).toHaveLength(2);
        // Десять песен одного загрузчика все проходят, когда заменить их нечем
        const one = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 7, title: 'Song ' + i }));
        expect(pickFinds(one, () => false, null, 30)).toHaveLength(10);
        // Есть другие: не больше трёх от одного аккаунта (порядок случайный, поэтому сколько именно, не проверяется)
        const others = Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 20 + i, title: 'Tune ' + i }));
        for (let run = 0; run < 20; run++) {
            const mixed = pickFinds([...one, ...others], () => false, null, 10);
            expect(mixed).toHaveLength(10);
            expect(mixed.filter((entry) => entry.user_id === 7).length).toBeLessThanOrEqual(3);
        }
    });

    it('A03: второй трек аккаунта, который подходит лучше, не теряется из-за порядка ответа', () => {
        const worse = track(1, { user_id: 60, genre: 'house', title: 'First' });
        const better = track(2, { user_id: 60, genre: 'techno', title: 'Second' });
        const profile = tasteMaps({ tags: [['techno', 3]] });
        if (!profile) throw new Error('профиль не разобран');
        const half = (): number => 0.5;
        expect(pickFinds([worse, better], () => false, profile, 1, half).map((entry) => entry.id)).toEqual([2]);
        expect(pickFinds([better, worse], () => false, profile, 1, half).map((entry) => entry.id)).toEqual([2]);
    });

    it('находки: перезалив той же версии одной находкой, slowed и ремикс отдельными (A02); из копий остаётся лучшая', () => {
        const candidates = [
            track(1, { user_id: 10, title: 'Artist - Song' }), track(2, { user_id: 20, title: 'Artist - Song', duration: 181000 }),
            track(3, { user_id: 30, title: 'Artist - Song (Slowed + Reverb)' }), track(4, { user_id: 40, title: 'Artist - Song (Altare Remix)' }),
            track(5, { user_id: 50, title: 'Song' }),
        ];
        const finds = pickFinds(candidates, () => false, null, 10);
        expect(finds.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
        // Копия, которую вкус ценит выше, побеждает независимо от порядка
        const profile = tasteMaps({ tracks: [[2, 1]] });
        if (!profile) throw new Error('профиль не разобран');
        expect(pickFinds(candidates, () => false, profile, 10).map((entry) => entry.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
        expect(pickFinds(candidates.slice().reverse(), () => false, profile, 10).map((entry) => entry.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    });

    it('разнесение по аккаунту: один аккаунт не подряд, пока есть другие, ничего не теряется', () => {
        expect(spreadBy([1, 1, 1, 2, 3], (value) => value, 1)).toEqual([1, 2, 1, 3, 1]);
        expect(spreadBy([4, 4], (value) => value, 1)).toEqual([4, 4]);
    });
});
