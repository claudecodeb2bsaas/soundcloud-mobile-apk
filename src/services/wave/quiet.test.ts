/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installQuiet, openStream, parseHlsPlaylist, quietBounds, quietOptionsOf, type QuietOptions } from './quiet';
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

// 200 отсчётов на 200 с: отсчёт на секунду. Тишина 0, звук 100
const form = (intro: number, loud: number, tail: number): number[] => [...Array(intro).fill(0), ...Array(loud).fill(100), ...Array(tail).fill(0)];

it('quietBounds: тишина в начале и в конце по форме волны', () => {
    const bounds = quietBounds(form(5, 190, 5), 200000);
    expect(bounds).toEqual({ introEnd: 5000, loudEnd: 195000 });
    // Одиночный щелчок в тишине звук не начинает
    const click = form(6, 194, 0);
    click[2] = 100;
    expect(quietBounds(click, 200000)?.introEnd).toBe(6000);
    // Короткий трек, пустая форма и тишина целиком не разбираются
    expect(quietBounds(form(5, 190, 5), 20000)).toBeNull();
    expect(quietBounds([1, 2, 3], 200000)).toBeNull();
    expect(quietBounds(Array(200).fill(0), 200000)).toBeNull();
});

it('quietOptionsOf: длина перехода целая от 1 до 12 с, остальное выключает', () => {
    expect(quietOptionsOf({ edges: false, crossfade: 5 })).toEqual({ edges: false, crossfade: 5 });
    expect(quietOptionsOf({ crossfade: 30 })).toEqual({ edges: true, crossfade: 12 });
    expect(quietOptionsOf({ crossfade: 0.4 }).crossfade).toBe(0);
    expect(quietOptionsOf({ crossfade: '5' }).crossfade).toBe(0);
    expect(quietOptionsOf(null)).toEqual({ edges: true, crossfade: 0 });
});

const API = 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1/abc/stream/hls';
const streamTrack = (id: number): WaveTrack =>
    ({
        id, kind: 'track', title: 'T' + id, duration: 200000, waveform_url: 'https://wave.sndcdn.com/x.json', track_authorization: 'auth+1',
        media: { transcodings: [
            { url: API.replace('hls', 'progressive'), format: { protocol: 'progressive', mime_type: 'audio/mpeg' } },
            { url: API + '-enc', format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
            { url: API, snipped: false, format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
        ] },
    }) as WaveTrack;

it('openStream: открытый HLS AAC, без него зашифрованный для Widevine; отрывки и FairPlay не берутся', () => {
    expect(openStream(streamTrack(1))).toEqual({ url: API + '?track_authorization=auth%2B1', drm: false });
    const track = streamTrack(1) as WaveTrack & { media: { transcodings: Array<{ snipped?: boolean; format: { protocol: string } }> } };
    track.media.transcodings[2].snipped = true;
    expect(openStream(track)).toEqual({ url: API + '-enc?track_authorization=auth%2B1', drm: true });
    track.media.transcodings[1].format.protocol = 'cbc-encrypted-hls';
    expect(openStream(track)).toBeNull();
    expect(openStream({ ...streamTrack(1), track_authorization: undefined } as WaveTrack)).toBeNull();
    expect(openStream({ id: 1 })).toBeNull();
});

const CDN = 'https://playback.media-streaming.soundcloud.cloud/cenc/x/aac_160k/u/';
const PSSH = 'AAAAa3Bzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAEs=';
// Плейлист зашифрованного потока как у SoundCloud: ключ Widevine, ключ PlayReady, кусок описания, куски по 10 с
const PLAYLIST = [
    '#EXTM3U', '#EXT-X-VERSION:7',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,' + PSSH + '",IV=0x28,KEYID=0x28,KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;charset=UTF-16;base64,0AMAAAEAAQ==",KEYFORMAT="com.microsoft.playready"',
    '#EXT-X-MAP:URI="' + CDN + 'init.mp4?expires=1"', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-TARGETDURATION:11',
    ...Array.from({ length: 20 }, (_, i) => ['#EXTINF:10.0,', CDN + 'data' + String(i).padStart(3, '0') + '.m4s?expires=1']).flat(),
    '#EXT-X-ENDLIST', '',
].join('\r\n');

it('parseHlsPlaylist: кусок описания, данные Widevine и куски с началом, относительные ссылки от плейлиста', () => {
    const list = parseHlsPlaylist(PLAYLIST, CDN + 'playlist.m3u8?expires=1');
    expect(list?.init).toBe(CDN + 'init.mp4?expires=1');
    expect(list?.pssh).toBe(PSSH);
    expect(list?.segments).toHaveLength(20);
    expect(list?.segments[3]).toEqual({ url: CDN + 'data003.m4s?expires=1', start: 30, duration: 10 });
    expect(list?.duration).toBe(200);
    const relative = parseHlsPlaylist('#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.5,\ndata000.m4s\n', CDN + 'playlist.m3u8');
    expect(relative).toEqual({ init: CDN + 'init.mp4', pssh: null, segments: [{ url: CDN + 'data000.m4s', start: 0, duration: 4.5 }], duration: 4.5 });
    expect(parseHlsPlaylist('#EXTM3U\n#EXTINF:10,\n' + CDN + 'data000.m4s', CDN)).toBeNull();
    expect(parseHlsPlaylist('#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\n', CDN)).toBeNull();
});

// Поддельный Web Audio: значение регулятора сразу становится конечным значением запланированного изменения
interface FakeParam { value: number; cancelScheduledValues: () => void; setValueAtTime: (v: number) => void; linearRampToValueAtTime: (v: number) => void; setValueCurveAtTime: (c: Float32Array) => void }
const fakeParam = (value: number): FakeParam => {
    const param: FakeParam = {
        value,
        cancelScheduledValues: () => undefined,
        setValueAtTime: (v) => { param.value = v; },
        linearRampToValueAtTime: (v) => { param.value = v; },
        setValueCurveAtTime: (c) => { param.value = c[c.length - 1]; },
    };
    return param;
};
const fakeGain = () => ({ gain: fakeParam(1), connect: vi.fn(), disconnect: vi.fn() });

const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
// Громкость, которая реально стоит у элемента, мимо подмены свойства
const heard = (element: HTMLMediaElement): number => volume?.get?.call(element) as number;

let started = 0;
let from = 0;
let playing = true;
let sound: SiteSound & { attributes: WaveTrack };
let player: SitePlayer;
let options: QuietOptions;
let raw: number[] | null;
let siteAudio: HTMLAudioElement;
let siteGain: ReturnType<typeof fakeGain>;
let deck: HTMLAudioElement | null;
let deckPlaying = false;
let deckTime = 0;
type Link = { url: string; license: string | null } | null;
let resolveStream: (url: string) => Promise<Link>;
let hasNext = true;
let contextState = 'running';
let reports: Array<[string, number, number]>;
const originalPlay = HTMLMediaElement.prototype.play;
// Позиция первого трека идёт по часам, пока он играет
const firstPosition = (): number => from + (Date.now() - started);

function makeSound(id: number, position: () => number): SiteSound & { attributes: WaveTrack } {
    const context = {
        get state() { return contextState; },
        currentTime: 0, destination: {},
        createGain: fakeGain,
        createMediaElementSource: (element: HTMLAudioElement) => {
            deck = element;
            Object.defineProperties(element, {
                readyState: { configurable: true, get: () => 4 },
                duration: { configurable: true, get: () => 200 },
                seeking: { configurable: true, get: () => false },
                paused: { configurable: true, get: () => !deckPlaying },
                ended: { configurable: true, get: () => false },
                currentTime: { configurable: true, get: () => (deckPlaying ? firstPosition() / 1000 : deckTime), set: (value: number) => { deckTime = value; } },
                play: { configurable: true, value: () => { deckPlaying = true; return Promise.resolve(); } },
                setMediaKeys: { configurable: true, value: () => Promise.resolve() },
                pause: { configurable: true, value: () => { deckPlaying = false; } },
                load: { configurable: true, value: () => undefined },
            });
            return { connect: vi.fn() };
        },
    };
    const orchestration = { context, gainNodes: { glitchCoverup: siteGain }, mediaElementSource: { mediaElement: siteAudio } };
    return {
        id,
        attributes: streamTrack(id),
        seek: vi.fn((ms: number) => { from = ms; started = Date.now(); }),
        currentTime: position,
        getMediaDuration: () => 200000,
        isSnippetized: () => false,
        player: { player: { _player: { _player: { _webAudioOrchestration: orchestration } } } },
    } as SiteSound & { attributes: WaveTrack };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    started = Date.now();
    from = 0;
    playing = true;
    deck = null;
    deckPlaying = false;
    deckTime = 0;
    hasNext = true;
    contextState = 'running';
    reports = [];
    options = { edges: true, crossfade: 0 };
    raw = form(5, 190, 5);
    resolveStream = vi.fn(async (): Promise<Link> => ({ url: 'https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8', license: null }));
    // В jsdom звук не играет: запуск только отдаёт обещание
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    siteAudio = new Audio();
    siteGain = fakeGain();
    sound = makeSound(1, () => (playing ? firstPosition() : from));
    player = {
        getCurrentSound: () => sound,
        isPlaying: () => playing,
        hasNextSound: () => hasNext,
        playNext: vi.fn(() => {
            const at = Date.now();
            sound = makeSound(2, () => Math.max(0, Date.now() - at - 200));
        }),
    } as unknown as SitePlayer;
    document.body.innerHTML = '';
});
afterEach(() => {
    HTMLMediaElement.prototype.play = originalPlay;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaSession');
    vi.useRealTimers();
});

// Сведения о треке у страницы, как navigator.mediaSession в Chromium. Журнал присвоений: название или null при сбросе
class FakeMetadata {
    title: string;
    artist: string;
    album: string;
    artwork: MediaImage[];
    constructor(init: MediaMetadataInit = {}) {
        this.title = init.title ?? '';
        this.artist = init.artist ?? '';
        this.album = init.album ?? '';
        this.artwork = [...(init.artwork ?? [])];
    }
}
function fakeMediaSession(): { log: Array<string | null>; session: { metadata: FakeMetadata | null } } {
    const log: Array<string | null> = [];
    let current: FakeMetadata | null = null;
    const session = {
        get metadata(): FakeMetadata | null {
            return current;
        },
        set metadata(value: FakeMetadata | null) {
            current = value;
            log.push(value ? value.title : null);
        },
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
    vi.stubGlobal('MediaMetadata', FakeMetadata);
    return { log, session };
}

function install() {
    return installQuiet({
        player: () => player, rawSamples: () => raw, resolveStream: (url) => resolveStream(url), held: () => false, options: () => options, disposed: () => false,
        report: (stage, prepMs, leftMs) => { reports.push([stage, prepMs, leftMs]); },
    });
}

it('тишина в начале проматывается один раз, тихий хвост проматывается к концу', async () => {
    playing = false;
    const section = install();
    playing = true;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.seek).toHaveBeenCalledWith(4700);
    // Человек вернулся в начало сам: повторно не проматывается
    from = 2000;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sound.seek).toHaveBeenCalledTimes(1);
    from = 195600;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(300);
    expect(sound.seek).toHaveBeenLastCalledWith(199750);
    section.dispose();
});

it('плавный переход: хвост в своём элементе, сайт переходит дальше, громкость вступает и возвращается', async () => {
    options = { edges: true, crossfade: 5 };
    from = 179000;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    // Звук кончается на 195,5 с, переход с 190,5 с, хвост готовится с 180,5 с
    await vi.advanceTimersByTimeAsync(3000);
    expect(resolveStream).toHaveBeenCalledWith(API + '?track_authorization=auth%2B1');
    expect(deck?.getAttribute('src')).toContain('playlist.m3u8');
    expect(deckPlaying).toBe(true);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    await vi.advanceTimersByTimeAsync(8600);
    expect(player.playNext).toHaveBeenCalledTimes(1);
    expect(section.crossfaded(1)).toBe(true);
    expect(sound.id).toBe(2);
    // Новый трек заиграл через 0,2 с и за 2,5 с набрал половину пути по синусу; ползунок сайта видит свою громкость
    await vi.advanceTimersByTimeAsync(2800);
    expect(siteAudio.volume).toBe(0.8);
    expect(heard(siteAudio)).toBeGreaterThan(0.8 * 0.6);
    expect(heard(siteAudio)).toBeLessThan(0.8 * 0.8);
    expect(siteGain.gain.value).toBe(1);
    // Человек двигает ползунок во время перехода: новая громкость тоже с множителем
    siteAudio.volume = 0.5;
    expect(heard(siteAudio)).toBeLessThan(0.5);
    await vi.advanceTimersByTimeAsync(3000);
    expect(heard(siteAudio)).toBeCloseTo(0.5);
    expect(deckPlaying).toBe(false);
    expect(deck?.hasAttribute('src')).toBe(false);
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toBe('done');
    expect(reports[0][2]).toBeGreaterThan(4500);
    section.dispose();
    expect(Object.prototype.hasOwnProperty.call(siteAudio, 'volume')).toBe(false);
    expect(siteAudio.volume).toBe(0.5);
});

it('плавный переход: сведения о треке объявляются заново, когда хвост заиграл, громкость сайта прошла через ноль и хвост снят', async () => {
    // Второй играющий элемент убирает клиент из медиасессий Windows, и медиаклавиши не доходят. Возвращает сброс
    // сведений и те же сведения через 0,3 с
    const { log, session } = fakeMediaSession();
    session.metadata = new FakeMetadata({ title: 'A', artist: 'X', artwork: [{ src: 'https://i1.sndcdn.com/a.jpg', sizes: '500x500' }] });
    log.length = 0;
    options = { edges: true, crossfade: 5 };
    from = 179000;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(3000);
    expect(deckPlaying).toBe(true);
    expect(log).toEqual([null, 'A']);
    expect(session.metadata?.artist).toBe('X');
    expect(session.metadata?.artwork).toEqual([{ src: 'https://i1.sndcdn.com/a.jpg', sizes: '500x500' }]);
    // Сайт перешёл дальше и выставил сведения нового трека
    await vi.advanceTimersByTimeAsync(8600);
    expect(player.playNext).toHaveBeenCalledTimes(1);
    session.metadata = new FakeMetadata({ title: 'B' });
    const switched = log.length;
    await vi.advanceTimersByTimeAsync(5800);
    expect(deckPlaying).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    // Громкость сайта вернулась из нуля, хвост снят: сведения объявлены заново, копия старого трека новый не затёрла
    expect(log.slice(switched)).toContain(null);
    expect(log.slice(switched)).not.toContain('A');
    expect(log[log.length - 1]).toBe('B');
    expect(session.metadata?.title).toBe('B');
    section.dispose();
});

it('снятие во время сброса сведений возвращает их сразу, а без сведений у страницы сбрасывать нечего', async () => {
    const { log, session } = fakeMediaSession();
    session.metadata = new FakeMetadata({ title: 'A' });
    log.length = 0;
    options = { edges: true, crossfade: 5 };
    from = 179000;
    const section = install();
    void siteAudio.play();
    for (let i = 0; i < 300 && log[log.length - 1] !== null; i++) await vi.advanceTimersByTimeAsync(10);
    expect(log).toEqual([null]);
    section.dispose();
    expect(session.metadata?.title).toBe('A');
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual([null, 'A']);
    // Сайт ещё не выставил сведения: хвост заиграл, а сбрасывать нечего
    const empty = fakeMediaSession();
    deckPlaying = false;
    from = 179000;
    started = Date.now();
    const next = install();
    await vi.advanceTimersByTimeAsync(3000);
    expect(deckPlaying).toBe(true);
    expect(empty.log).toEqual([]);
    next.dispose();
});

it('перемотка к концу: хвост успевает, переход короче, до передачи громкость полная', async () => {
    options = { edges: true, crossfade: 12 };
    // Звук кончается на 195,5 с, переход с 183,5 с. Первый шаг на 186 с: до конца 9,5 с, хвост ещё готовится
    from = 185500;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(800);
    expect(resolveStream).toHaveBeenCalledOnce();
    expect(player.playNext).not.toHaveBeenCalled();
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    await vi.advanceTimersByTimeAsync(1500);
    expect(player.playNext).toHaveBeenCalledOnce();
    expect(reports).toHaveLength(1);
    const [stage, , left] = reports[0];
    expect(stage).toBe('done');
    expect(left).toBeGreaterThan(7000);
    expect(left).toBeLessThan(9500);
    // Новый трек набирает громкость за оставшиеся секунды, а не за все двенадцать
    await vi.advanceTimersByTimeAsync(left + 600);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    section.dispose();
});

it('перемотка в самый конец: хвост не готовится, трек затихает от этого места без скачка', async () => {
    options = { edges: true, crossfade: 12 };
    // Первый шаг на 190 с: до конца звука 5,5 с, на хвост не хватает
    from = 189500;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(520);
    expect(heard(siteAudio)).toBeCloseTo(0.8, 2);
    await vi.advanceTimersByTimeAsync(2750);
    expect(heard(siteAudio)).toBeCloseTo(0.8 * Math.SQRT1_2, 1);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(player.playNext).not.toHaveBeenCalled();
    expect(reports).toEqual([['late', 0, 5500]]);
    section.dispose();
});

it('звук сайта ещё спит после паузы: хвост готовится, как только проснётся', async () => {
    options = { edges: true, crossfade: 5 };
    contextState = 'suspended';
    from = 181000;
    const section = install();
    void siteAudio.play();
    await vi.advanceTimersByTimeAsync(1500);
    expect(resolveStream).not.toHaveBeenCalled();
    contextState = 'running';
    await vi.advanceTimersByTimeAsync(1500);
    expect(resolveStream).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000);
    expect(player.playNext).toHaveBeenCalledOnce();
    expect(reports[0][0]).toBe('done');
    section.dispose();
});

it('хвост не успел к переходу: громкость полная, потом затихание от этого места', async () => {
    options = { edges: true, crossfade: 5 };
    // Ссылка на поток не приходит: до конца звука 2,5 с хвост ждут, дальше трек затихает
    resolveStream = vi.fn(() => new Promise<Link>(() => undefined));
    from = 188500;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(4380);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    await vi.advanceTimersByTimeAsync(170);
    expect(heard(siteAudio)).toBeCloseTo(0.8, 1);
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toBe('resolve');
    expect(reports[0][1]).toBeGreaterThan(3500);
    await vi.advanceTimersByTimeAsync(1250);
    expect(heard(siteAudio)).toBeCloseTo(0.8 * Math.SQRT1_2, 1);
    expect(player.playNext).not.toHaveBeenCalled();
    section.dispose();
});

it('зашифрованный поток: своя сессия Widevine, лицензия по токену, куски до конца звука, переход как у открытого', async () => {
    options = { edges: true, crossfade: 5 };
    // Открытого AAC нет, только ctr-encrypted-hls
    const track = streamTrack(1) as WaveTrack & { media: { transcodings: Array<{ snipped?: boolean }> } };
    track.media.transcodings[2].snipped = true;
    sound.attributes = track;
    resolveStream = vi.fn(async (): Promise<Link> => ({ url: CDN + 'playlist.m3u8?expires=1', license: 'tok/1' }));
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, method: init?.method ?? 'GET' });
        return { ok: true, status: 200, text: async () => PLAYLIST, arrayBuffer: async () => new ArrayBuffer(8) };
    }));
    const appended: number[] = [];
    let ended = false;
    class FakeSourceBuffer extends EventTarget {
        appendBuffer(data: ArrayBuffer): void {
            appended.push(data.byteLength);
            setTimeout(() => this.dispatchEvent(new Event('updateend')), 5);
        }
    }
    class FakeMediaSource extends EventTarget {
        readyState = 'open';
        duration = NaN;
        constructor() {
            super();
            setTimeout(() => this.dispatchEvent(new Event('sourceopen')), 5);
        }
        addSourceBuffer(): FakeSourceBuffer { return new FakeSourceBuffer(); }
        endOfStream(): void { ended = true; }
    }
    vi.stubGlobal('MediaSource', FakeMediaSource);
    const closed: number[] = [];
    let sessions = 0;
    const keys = {
        createSession: () => {
            const index = ++sessions;
            const statuses = new Map<string, string>();
            const session = Object.assign(new EventTarget(), {
                keyStatuses: statuses,
                generateRequest: async () => {
                    setTimeout(() => session.dispatchEvent(Object.assign(new Event('message'), { message: new ArrayBuffer(2), messageType: 'license-request' })), 5);
                },
                update: async () => {
                    statuses.set('k', 'usable');
                    session.dispatchEvent(new Event('keystatuseschange'));
                },
                close: async () => { closed.push(index); },
            });
            return session;
        },
    };
    Object.defineProperty(navigator, 'requestMediaKeySystemAccess', { configurable: true, value: vi.fn(async () => ({ createMediaKeys: async () => keys })) });
    const createObjectURL = vi.fn(() => 'blob:tail');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
        from = 179000;
        const section = install();
        void siteAudio.play();
        await vi.advanceTimersByTimeAsync(3000);
        expect(resolveStream).toHaveBeenCalledWith(API + '-enc?track_authorization=auth%2B1');
        expect(requests[0]).toEqual({ url: CDN + 'playlist.m3u8?expires=1', method: 'GET' });
        expect(requests.filter((request) => request.method === 'POST').map((request) => request.url)).toEqual(['https://license.media-streaming.soundcloud.cloud/playback/widevine?license_token=tok%2F1']);
        // Хвост готовится с 180,5 с, звук кончается на 195,5 с: кусок описания и куски 18 и 19, последний с концом потока
        expect(requests.filter((request) => request.method === 'GET').map((request) => request.url.replace(CDN, '').replace(/\?.*/, ''))).toEqual(['playlist.m3u8', 'init.mp4', 'data018.m4s', 'data019.m4s']);
        expect(appended).toHaveLength(3);
        expect(ended).toBe(true);
        expect(deck?.getAttribute('src')).toBe('blob:tail');
        expect(deckPlaying).toBe(true);
        await vi.advanceTimersByTimeAsync(8600);
        expect(player.playNext).toHaveBeenCalledOnce();
        expect(reports[0][0]).toBe('done');
        // Хвост догорел: сессия ключей закрыта, MediaSource отпущен
        await vi.advanceTimersByTimeAsync(6000);
        expect(deckPlaying).toBe(false);
        expect(closed).toEqual([1]);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:tail');
        section.dispose();
    } finally {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(navigator, 'requestMediaKeySystemAccess');
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
});

it('зашифрованный поток без лицензии: хвоста нет, трек затихает, в журнале шаг license', async () => {
    options = { edges: true, crossfade: 5 };
    const track = streamTrack(1) as WaveTrack & { media: { transcodings: Array<{ snipped?: boolean }> } };
    track.media.transcodings[2].snipped = true;
    sound.attributes = track;
    resolveStream = vi.fn(async (): Promise<Link> => ({ url: CDN + 'playlist.m3u8', license: 'tok' }));
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? { ok: false, status: 403 } : { ok: true, status: 200, text: async () => PLAYLIST, arrayBuffer: async () => new ArrayBuffer(8) }));
    class FakeSourceBuffer extends EventTarget {
        appendBuffer(): void { setTimeout(() => this.dispatchEvent(new Event('updateend')), 5); }
    }
    vi.stubGlobal('MediaSource', class extends EventTarget {
        readyState = 'open';
        constructor() {
            super();
            setTimeout(() => this.dispatchEvent(new Event('sourceopen')), 5);
        }
        addSourceBuffer(): FakeSourceBuffer { return new FakeSourceBuffer(); }
        endOfStream(): void { /* конец потока не нужен */ }
    });
    const session = Object.assign(new EventTarget(), {
        keyStatuses: new Map<string, string>(),
        generateRequest: async () => { setTimeout(() => session.dispatchEvent(Object.assign(new Event('message'), { message: new ArrayBuffer(2) })), 5); },
        update: async () => undefined,
        close: async () => undefined,
    });
    Object.defineProperty(navigator, 'requestMediaKeySystemAccess', { configurable: true, value: async () => ({ createMediaKeys: async () => ({ createSession: () => session }) }) });
    Object.assign(URL, { createObjectURL: () => 'blob:tail', revokeObjectURL: () => undefined });
    try {
        from = 185000;
        const section = install();
        void siteAudio.play();
        await vi.advanceTimersByTimeAsync(8000);
        expect(player.playNext).not.toHaveBeenCalled();
        expect(heard(siteAudio)).toBeLessThan(0.8);
        expect(reports.map(([stage]) => stage)).toEqual(['license']);
        section.dispose();
    } finally {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(navigator, 'requestMediaKeySystemAccess');
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
});

it('потока нет: трек просто затихает к концу звука, новый трек звучит в полную громкость', async () => {
    options = { edges: true, crossfade: 5 };
    resolveStream = vi.fn(async () => null);
    from = 185000;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(8000);
    expect(heard(siteAudio)).toBeLessThan(0.8 * 0.75);
    expect(player.playNext).not.toHaveBeenCalled();
    sound = makeSound(3, () => 1000);
    await vi.advanceTimersByTimeAsync(300);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    expect(section.crossfaded(1)).toBe(false);
    expect(reports.map(([stage, prepMs]) => [stage, prepMs])).toEqual([['resolve', 0]]);
    section.dispose();
});

it('открытого потока нет: хвост не готовится, трек затихает с начала перехода', async () => {
    options = { edges: true, crossfade: 5 };
    sound.attributes = { ...streamTrack(1), track_authorization: undefined } as WaveTrack;
    from = 185000;
    const section = install();
    void siteAudio.play();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(deck).toBeNull();
    expect(heard(siteAudio)).toBeCloseTo(Math.SQRT1_2, 1);
    expect(reports.map(([stage, prepMs]) => [stage, prepMs])).toEqual([['no-stream', 0]]);
    section.dispose();
});

it('на повторе трека, без следующего трека и с выключенной настройкой перехода нет', async () => {
    options = { edges: true, crossfade: 5 };
    from = 185000;
    document.body.innerHTML = '<button class="repeatControl m-one"></button>';
    let section = install();
    void siteAudio.play();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(heard(siteAudio)).toBe(1);
    section.dispose();
    document.body.innerHTML = '';
    hasNext = false;
    from = 185000;
    started = Date.now();
    section = install();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    section.dispose();
    hasNext = true;
    options = { edges: false, crossfade: 0 };
    from = 185000;
    started = Date.now();
    const stub = HTMLMediaElement.prototype.play;
    section = install();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(sound.seek).not.toHaveBeenCalled();
    expect(player.playNext).not.toHaveBeenCalled();
    section.dispose();
    expect(HTMLMediaElement.prototype.play).toBe(stub);
});
