// Тихие края и плавный переход между треками. По форме волны тишина в начале трека перематывается, тишина в конце
// перематывается к самому концу (дальше сайт сам решает: следующий трек, повтор или автоплей). Плавный переход: за
// несколько секунд до конца звука хвост трека подхватывает свой звуковой элемент и гаснет, а сайт уже играет следующий
// трек, и тот набирает громкость. Действует на всё, что играет в клиенте, не только на волну.
// Раздел страницы волны: installQuiet уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// quietBounds, openStream и parseHlsPlaylist по голому имени.
// Устройство сайта (проверено 02.10.2026 и 10.10.2026 в dev-клиенте): один звуковой элемент вне документа на все треки,
// на новом треке сайт сам ставит ему свою громкость. Элемент идёт через Web Audio плеера maestro: источник, регуляторы
// pausePlay, seek, glitchCoverup и выход контекста. Позиция трека у плеера сайта не равна currentTime элемента (у MSE
// своя шкала), поэтому свой элемент сверяется с sound.currentTime(). Свой элемент подключается в тот же контекст: задержка
// вывода у обоих одна, и равные позиции дают совпадение звука до миллисекунд (сверено взаимной корреляцией сигналов).
// Поток трека это HLS AAC, ссылку отдаёт API сайта, Chromium 148 играет открытый поток сам. У части треков AAC только
// зашифрованный (ctr-encrypted-hls, обычно треки лейблов), открытые mp3 из списка API у них отдают 404, а сайт играет их
// через MSE и Widevine. Свой элемент делает так же (проверено 10.10.2026 в подписанной сборке): плейлист с данными
// Widevine, своя сессия ключей, лицензия на сервере SoundCloud по токену из ответа API, куски потока в MediaSource.
// Совпадение с сайтом по звуку то же, около 2 мс
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

/** Где кончается тишина в начале и начинается в конце, мс */
export interface QuietBounds { introEnd: number; loudEnd: number }
/** edges: тишина в начале и конце проматывается; crossfade: длина плавного перехода, с, 0 выключает */
export interface QuietOptions { edges: boolean; crossfade: number }
/** Чем кончился переход для журнала диагностики: done прошёл, остальное причина, по которой трек просто затих.
 *  late: перемотали слишком близко к концу; no-stream: потока AAC нет; no-audio: звук сайта не найден или спит;
 *  resolve, load, license, length, seek, start: шаг подготовки хвоста, на котором она сорвалась; sync: хвост не сошёлся */
export const CROSSFADE_STAGES = ['done', 'late', 'no-stream', 'no-audio', 'resolve', 'load', 'license', 'length', 'seek', 'start', 'sync'] as const;
export type CrossfadeStage = (typeof CROSSFADE_STAGES)[number];

/** Настройки с main: длина перехода целая от 1 до 12 с, всё прочее значит выключено */
export function quietOptionsOf(value: unknown): QuietOptions {
    const next = value && typeof value === 'object' ? (value as Partial<Record<keyof QuietOptions, unknown>>) : {};
    const seconds = typeof next.crossfade === 'number' && Number.isFinite(next.crossfade) ? Math.round(next.crossfade) : 0;
    return { edges: next.edges !== false, crossfade: seconds >= 1 ? Math.min(12, seconds) : 0 };
}

/** Тишина по сырым отсчётам формы волны: ниже 4% от 90-го перцентиля. Звук считается начавшимся с трёх отсчётов подряд
 *  выше порога, одиночный щелчок тишину не прерывает. Треки короче 30 секунд и почти пустая форма не разбираются */
export function quietBounds(raw: number[], duration: number): QuietBounds | null {
    if (raw.length < 100 || !(duration >= 30000)) return null;
    const sorted = raw.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    if (!(p90 > 0)) return null;
    const floor = Math.max(1, p90 * 0.04);
    const loud = (i: number): boolean => raw[i] > floor;
    let first = -1;
    for (let i = 0; i + 2 < raw.length; i++) if (loud(i) && loud(i + 1) && loud(i + 2)) { first = i; break; }
    let last = -1;
    for (let i = raw.length - 1; i >= 2; i--) if (loud(i) && loud(i - 1) && loud(i - 2)) { last = i; break; }
    if (first < 0 || last <= first) return null;
    const step = duration / raw.length;
    return { introEnd: first * step, loudEnd: (last + 1) * step };
}

interface StreamTrack extends WaveTrack {
    track_authorization?: string;
    media?: { transcodings?: Array<{ url?: string; snipped?: boolean; format?: { protocol?: string; mime_type?: string } } | null> } | null;
}
/** Поток AAC трека для своего элемента: ссылка API вместе с track_authorization. drm: поток зашифрован для Widevine */
export interface TailStream { url: string; drm: boolean }
/** Открытый HLS AAC, а без него зашифрованный для Widevine (ctr-encrypted-hls). Отрывки не берутся, cbc-encrypted-hls
 *  тоже: это схема FairPlay */
export function openStream(track: WaveTrack): TailStream | null {
    const { media, track_authorization: auth } = track as StreamTrack;
    if (typeof auth !== 'string' || !auth) return null;
    const list = Array.isArray(media?.transcodings) ? media.transcodings : [];
    for (const protocol of ['hls', 'ctr-encrypted-hls']) {
        for (const item of list) {
            const url = item?.url;
            if (item?.format?.protocol !== protocol || !/mp4a/.test(item.format.mime_type ?? '') || item.snipped === true) continue;
            if (typeof url !== 'string' || !/^https:\/\/api-v2\.soundcloud\.com\/media\//.test(url)) continue;
            return { url: url + (url.includes('?') ? '&' : '?') + 'track_authorization=' + encodeURIComponent(auth), drm: protocol !== 'hls' };
        }
    }
    return null;
}

/** Плейлист HLS из кусков fMP4: кусок с описанием потока, данные Widevine (pssh в base64) и куски с началом и длиной, с */
export interface HlsPlaylist { init: string; pssh: string | null; segments: Array<{ url: string; start: number; duration: number }>; duration: number }
/** Разбор плейлиста потока: только то, что нужно своему элементу. Без куска описания или без кусков null */
export function parseHlsPlaylist(text: string, base: string): HlsPlaylist | null {
    // Системный идентификатор Widevine в KEYFORMAT; функция уходит на страницу текстом, поэтому всё своё внутри
    const WIDEVINE = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
    const absolute = (value: string): string | null => {
        try {
            return new URL(value, base).href;
        } catch {
            return null;
        }
    };
    let init: string | null = null;
    let pssh: string | null = null;
    let length = NaN;
    let start = 0;
    const segments: HlsPlaylist['segments'] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('#EXT-X-KEY:') && line.toLowerCase().includes(WIDEVINE)) pssh = /URI="data:[^",]*base64,([A-Za-z0-9+/=]+)"/.exec(line)?.[1] ?? pssh;
        else if (line.startsWith('#EXT-X-MAP:')) {
            const uri = /URI="([^"]+)"/.exec(line)?.[1];
            init = uri ? absolute(uri) : null;
        } else if (line.startsWith('#EXTINF:')) length = parseFloat(line.slice(8));
        else if (line && !line.startsWith('#')) {
            const url = absolute(line);
            if (!url || !(length > 0)) return null;
            segments.push({ url, start, duration: length });
            start += length;
            length = NaN;
        }
    }
    if (!init || !segments.length) return null;
    return { init, pssh, segments, duration: start };
}

export interface QuietCore {
    player(): SitePlayer | null;
    /** Сырые отсчёты формы волны трека; null, пока грузятся или их нет. Вызов сам запускает загрузку */
    rawSamples(track: WaveTrack): number[] | null;
    /** Ссылка на плейлист потока по ссылке API трека и токен лицензии зашифрованного потока. Запрос идёт через API сайта:
     *  ключ и вход подставляет он */
    resolveStream(url: string): Promise<{ url: string; license: string | null } | null>;
    /** Треки сейчас сменяет разведка: переход не нужен */
    held(): boolean;
    options(): QuietOptions;
    disposed(): boolean;
    /** Исход перехода, раз на трек: сколько готовился хвост и сколько оставалось до конца звука, мс */
    report(stage: CrossfadeStage, prepMs: number, leftMs: number): void;
}
export interface QuietSection {
    /** Трек сменился плавным переходом за секунды до конца: для журнала он дослушан */
    crossfaded(id: number): boolean;
    dispose(): void;
}

export function installQuiet(core: QuietCore): QuietSection {
    // Тишина в начале перематывается от 2,5 с, в конце от 3 с
    const INTRO_MIN = 2500;
    const TAIL_MIN = 3000;
    // Хвост готовится за 10 с до перехода и передаётся своему элементу плавно за 30 мс. Сайт отвечает новым треком за
    // 0,2 с (замер 10.10), ждём его до 8 с
    const PREPARE = 10000;
    const SWAP = 0.03;
    const WAIT_NEXT = 8000;
    // Свой элемент начинает играть на 60 мс позже вызова play (замер 10.10). Разница с треком сайта сошлась, когда медиана
    // последних замеров не больше 8 мс: при передаче за 30 мс такой сдвиг не слышен
    const START_LAG = 0.06;
    const SYNCED = 0.008;
    // Хвост готовится 2-4 с (замер 10.10, с задержкой сети 400 мс 4,4 с). После перемотки близко к концу переход
    // короче, но не короче половины своей длины и полутора секунд: подготовка начинается, пока до конца звука есть
    // такой переход и ещё 3 с
    const MIN_MIX = 1500;
    const PREP_TIME = 3000;
    // Сервер лицензий Widevine, куда ходит и сайт (запрос сайта снят 10.10.2026): тело это сообщение сессии ключей,
    // токен в адресе
    const LICENSE = 'https://license.media-streaming.soundcloud.cloud/playback/widevine';
    // Второй играющий элемент на странице убирает клиент из медиасессий Windows, и медиаклавиши никуда не доходят, пока
    // сайт сам не выставит сведения о треке на обычной смене трека. Возвращает клиент сброс сведений и те же сведения
    // через 0,3 с, без паузы он иногда пропадает снова (проверено 12.10.2026 в dev-клиенте). Объявление идёт через
    // 0,15 с после последнего из событий подряд
    const ANNOUNCE_DELAY = 150;
    const ANNOUNCE_GAP = 300;

    interface SiteAudio { context: AudioContext; gain: GainNode; element: HTMLMediaElement | null }
    // keys: MediaKeys элемента, ставятся один раз; session и objectUrl: сессия ключей и MediaSource зашифрованного хвоста;
    // license: ответ на неё; played: элемент запускали после прошлого снятия, его остановка тоже прячет клиент от Windows
    interface Deck {
        context: AudioContext; element: HTMLAudioElement; gain: GainNode; busy: boolean;
        keys: MediaKeys | null; session: MediaKeySession | null; license: 'wait' | 'usable' | 'failed'; objectUrl: string; played: boolean;
    }
    // load: поток грузится; sync: свой элемент играет без звука и подгоняется; ready: сошёлся; out: хвост после передачи
    // readings: последние расхождения с треком сайта, с; stable: шагов подряд в допуске; calm: шагов подряд со скоростью 1
    // stage: шаг подготовки для журнала; begun и ready: начало подготовки и первая готовность, performance.now()
    interface Tail {
        deck: Deck; site: SiteAudio; end: number; phase: 'load' | 'sync' | 'ready' | 'out'; readings: number[]; stable: number; calm: number; until: number;
        stage: CrossfadeStage; begun: number; ready: number;
    }
    interface Incoming { from: number; to: number; at: number; started: number; length: number; tail: Tail }

    const own = new WeakSet<HTMLMediaElement>();
    const decks: Deck[] = [];
    const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    let media: HTMLAudioElement | null = null;
    // Громкость, которую ставят сайт и человек, и свой множитель к ней: звучит их произведение
    let base = 1;
    let level = 1;
    let tail: Tail | null = null;
    let fading: Tail[] = [];
    let swapping: { item: Tail; at: number; length: number } | null = null;
    let incoming: Incoming | null = null;
    const crossfadedIds: number[] = [];
    let soundId = 0;
    let lastPosition = 0;
    let introDone = false;
    let tailDone = false;
    let tried = false;
    // Позиция, с которой трек затихает без хвоста, 0 пока не затихает. Причина для журнала и отметка, что исход записан
    let fadeFrom = 0;
    let miss: CrossfadeStage | null = null;
    let reported = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Объявление сведений о треке и копия сведений на время их сброса
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    let heldMetadata: MediaMetadataInit | null = null;
    const originalPlay = HTMLMediaElement.prototype.play;
    // Элемент сайта живёт вне документа, поэтому ловится при запуске. Свои элементы хвоста не в счёт
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
        if (this instanceof HTMLAudioElement && this !== media && !own.has(this)) watch(this);
        return originalPlay.apply(this, args);
    };
    function apply(): void {
        if (!media || !volume?.get || !volume.set) return;
        const before = volume.get.call(media) as number;
        const next = Math.max(0, Math.min(1, base * level));
        volume.set.call(media, next);
        // Громкость сайта из нуля, пока играет свой элемент: клиент пропал из медиасессий сразу после этого (замер
        // 12.10.2026). Уход в ноль, похоже, действует так же
        if ((before === 0) !== (next === 0) && decks.some((deck) => !deck.element.paused)) announce();
    }
    function announce(): void {
        if (typeof MediaMetadata !== 'function' || !navigator.mediaSession) return;
        if (announceTimer !== undefined) clearTimeout(announceTimer);
        announceTimer = setTimeout(dropMetadata, ANNOUNCE_DELAY);
    }
    function dropMetadata(): void {
        announceTimer = undefined;
        if (core.disposed()) return;
        const session = navigator.mediaSession;
        const metadata = session.metadata;
        // Во время прошлого сброса сведений нет, тогда в ход идёт снятая в тот раз копия
        if (metadata) heldMetadata = { title: metadata.title, artist: metadata.artist, album: metadata.album, artwork: metadata.artwork.map((image) => ({ ...image })) };
        if (!heldMetadata) return;
        session.metadata = null;
        announceTimer = setTimeout(restoreMetadata, ANNOUNCE_GAP);
    }
    function restoreMetadata(): void {
        announceTimer = undefined;
        const held = heldMetadata;
        heldMetadata = null;
        // Сайт за это время выставил сведения нового трека: они и так объявлены заново
        if (held && navigator.mediaSession.metadata === null) navigator.mediaSession.metadata = new MediaMetadata(held);
    }
    function setLevel(value: number): void {
        if (Math.abs(value - level) < 0.0005) return;
        level = value;
        apply();
    }
    // Сайт и ползунок пишут громкость как обычно и читают её же, а звучит она с множителем
    function watch(element: HTMLAudioElement): void {
        if (media) unwatch();
        if (!volume?.get || !volume.set) return;
        media = element;
        base = volume.get.call(element) as number;
        Object.defineProperty(element, 'volume', {
            configurable: true,
            enumerable: true,
            get: () => base,
            set: (value: number) => {
                base = Math.max(0, Math.min(1, Number(value) || 0));
                apply();
            },
        });
        apply();
    }
    function unwatch(): void {
        if (!media) return;
        Reflect.deleteProperty(media, 'volume');
        if (volume?.set) volume.set.call(media, base);
        media = null;
    }
    const positionOf = (sound: SiteSound): number => (typeof sound.currentTime === 'function' ? sound.currentTime() || 0 : 0);
    const durationOf = (sound: SiteSound): number => (typeof sound.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0);
    const repeatOne = (): boolean => document.querySelector('.repeatControl')?.classList.contains('m-one') === true;
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    // Цепочка Web Audio трека лежит у плеера maestro в _webAudioOrchestration, сейчас это sound.player.player._player._player.
    // Имена внутренние, поэтому ищется обходом от sound.player, не глубже пяти уровней и не больше 200 объектов
    function siteAudioOf(sound: SiteSound): SiteAudio | null {
        const queue: Array<{ value: unknown; depth: number }> = [{ value: (sound as unknown as { player?: unknown }).player, depth: 0 }];
        const seen = new Set<object>();
        while (queue.length && seen.size < 200) {
            const next = queue.shift();
            if (!next) break;
            const { value, depth } = next;
            if (!value || typeof value !== 'object' || seen.has(value) || value instanceof Node || value === window) continue;
            seen.add(value);
            const record = value as Record<string, unknown>;
            const found = asSiteAudio(record._webAudioOrchestration);
            if (found) return found;
            if (depth >= 5) continue;
            for (const key of Object.keys(record)) {
                let child: unknown;
                try {
                    child = record[key];
                } catch {
                    continue;
                }
                if (child && typeof child === 'object' && !Array.isArray(child)) queue.push({ value: child, depth: depth + 1 });
            }
        }
        return null;
    }
    function asSiteAudio(value: unknown): SiteAudio | null {
        const orchestration = value as { context?: unknown; gainNodes?: { glitchCoverup?: unknown } | null; mediaElementSource?: { mediaElement?: unknown } | null } | null | undefined;
        const context = orchestration?.context as AudioContext | undefined;
        const gain = orchestration?.gainNodes?.glitchCoverup as GainNode | undefined;
        if (!context || typeof context.createMediaElementSource !== 'function' || typeof context.createGain !== 'function') return null;
        if (!gain || typeof gain.gain?.linearRampToValueAtTime !== 'function') return null;
        const element = orchestration?.mediaElementSource?.mediaElement;
        return { context, gain, element: element instanceof HTMLMediaElement ? element : null };
    }

    // Свои элементы хвоста: источник Web Audio у элемента создаётся один раз, поэтому их держим. Два на контекст: хвост
    // прошлого перехода может ещё звучать, когда готовится следующий
    function deckFor(context: AudioContext): Deck | null {
        const free = decks.find((deck) => deck.context === context && !deck.busy);
        if (free) {
            free.busy = true;
            return free;
        }
        if (decks.filter((deck) => deck.context === context).length >= 2) return null;
        const element = document.createElement('audio');
        // Без CORS Web Audio получает от чужого потока тишину
        element.crossOrigin = 'anonymous';
        element.preload = 'auto';
        // Подгонка идёт без звука: скорость меняется как у пластинки, ровно. С сохранением высоты тона Chromium режет звук
        // кусками, и сдвиг по звуку скачет на 10-25 мс (замер 10.10)
        element.preservesPitch = false;
        own.add(element);
        const source = context.createMediaElementSource(element);
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(context.destination);
        const deck: Deck = { context, element, gain, busy: true, keys: null, session: null, license: 'wait', objectUrl: '', played: false };
        decks.push(deck);
        return deck;
    }
    function restoreSite(site: SiteAudio): void {
        // Регулятор сайта уходящего трека: если сайт трек не сменил, без этого он остался бы без звука
        const param = site.gain.gain;
        param.cancelScheduledValues(0);
        param.value = 1;
    }
    function release(item: Tail): void {
        const { deck } = item;
        deck.gain.gain.cancelScheduledValues(0);
        deck.gain.gain.value = 0;
        deck.element.pause();
        deck.element.removeAttribute('src');
        deck.element.load();
        deck.element.playbackRate = 1;
        if (deck.objectUrl) {
            URL.revokeObjectURL(deck.objectUrl);
            deck.objectUrl = '';
        }
        const session = deck.session;
        deck.session = null;
        if (session) session.close().catch((error: unknown) => console.warn('Плавный переход: сессия ключей не закрылась', error));
        deck.busy = false;
        if (item.phase === 'out') restoreSite(item.site);
        if (deck.played) {
            deck.played = false;
            announce();
        }
    }
    function dropTail(): void {
        if (!tail) return;
        release(tail);
        tail = null;
    }
    function finishIncoming(): void {
        if (!incoming) return;
        const { tail: item } = incoming;
        release(item);
        fading = fading.filter((entry) => entry !== item);
        incoming = null;
        setLevel(1);
    }
    function remember(id: number): void {
        crossfadedIds.push(id);
        if (crossfadedIds.length > 20) crossfadedIds.shift();
    }
    function outcome(stage: CrossfadeStage, prepMs: number, leftMs: number): void {
        if (reported) return;
        reported = true;
        try {
            core.report(stage, Math.max(0, Math.round(prepMs)), Math.max(0, Math.round(leftMs)));
        } catch (error) {
            console.warn('Плавный переход: исход не записан', error);
        }
    }

    function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
        return Promise.race([promise, sleep(ms).then((): T => { throw new Error('Тайм-аут: ' + what); })]);
    }
    async function until(check: () => boolean, ms: number, what: string): Promise<void> {
        const deadline = performance.now() + ms;
        while (!check()) {
            if (performance.now() > deadline) throw new Error('Тайм-аут: ' + what);
            await sleep(10);
        }
    }
    // Зашифрованный поток: плейлист, сессия ключей Widevine и куски от позиции from до конца звука хвоста в MediaSource, мс.
    // Лицензию сервер SoundCloud выдаёт по токену из ответа API, как сайту; ответ виден в deck.license
    async function loadProtected(deck: Deck, link: { url: string; license: string | null }, from: number, end: number, stale: () => boolean): Promise<void> {
        const token = link.license;
        if (!token) throw new Error('API не дал токен лицензии');
        const playlist = await withTimeout(fetch(link.url), 8000, 'плейлист');
        if (!playlist.ok) throw new Error('плейлист: ' + playlist.status);
        const list = parseHlsPlaylist(await playlist.text(), link.url);
        const pssh = list?.pssh;
        if (!list || !pssh) throw new Error('в плейлисте нет данных Widevine');
        const first = list.segments.findIndex((segment) => segment.start + segment.duration > from / 1000);
        if (first < 0) throw new Error('позиция за концом плейлиста');
        const wanted = list.segments.slice(first).filter((segment) => segment.start < end / 1000);
        const element = deck.element;
        if (!deck.keys) {
            const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
                initDataTypes: ['cenc'], persistentState: 'optional', distinctiveIdentifier: 'optional', sessionTypes: ['temporary'],
                audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }],
            }]);
            const keys = await access.createMediaKeys();
            await element.setMediaKeys(keys);
            deck.keys = keys;
        }
        // После каждого ожидания: хвост могли снять, а элемент отдать следующему. Сессию и MediaSource снятого хвоста
        // закрывает release, дальше этот вызов элемент не трогает
        if (stale()) return;
        const session = deck.keys.createSession('temporary');
        deck.session = session;
        deck.license = 'wait';
        session.addEventListener('keystatuseschange', () => {
            if (deck.session !== session) return;
            session.keyStatuses.forEach((status) => {
                if (status === 'usable') deck.license = 'usable';
                else if (status === 'internal-error' || status === 'output-restricted' || status === 'expired') deck.license = 'failed';
            });
        });
        // Два сообщения подряд: запрос сертификата сервера и сам запрос лицензии (так же у сайта)
        session.addEventListener('message', (event) => {
            fetch(LICENSE + '?license_token=' + encodeURIComponent(token), { method: 'POST', body: event.message, headers: { 'Content-Type': 'application/octet-stream' } })
                .then((response) => {
                    if (!response.ok) throw new Error('сервер лицензий: ' + response.status);
                    return response.arrayBuffer();
                })
                .then((answer) => session.update(answer))
                .catch((error: unknown) => {
                    if (deck.session !== session) return;
                    deck.license = 'failed';
                    console.warn('Плавный переход: лицензия не получена', error);
                });
        });
        await session.generateRequest('cenc', Uint8Array.from(atob(pssh), (char) => char.charCodeAt(0)));
        if (stale()) return;
        const source = new MediaSource();
        deck.objectUrl = URL.createObjectURL(source);
        element.src = deck.objectUrl;
        await withTimeout(new Promise<void>((resolve) => source.addEventListener('sourceopen', () => resolve(), { once: true })), 5000, 'MediaSource');
        if (stale()) return;
        source.duration = list.duration;
        const buffer = source.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
        const bytes = async (url: string): Promise<ArrayBuffer> => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('кусок потока: ' + response.status);
            return response.arrayBuffer();
        };
        const parts = await withTimeout(Promise.all([list.init, ...wanted.map((segment) => segment.url)].map(bytes)), 8000, 'куски потока');
        for (const part of parts) {
            if (stale()) return;
            await new Promise<void>((resolve, reject) => {
                buffer.addEventListener('updateend', () => resolve(), { once: true });
                buffer.addEventListener('error', () => reject(new Error('кусок не лёг в буфер')), { once: true });
                buffer.appendBuffer(part);
            });
        }
        // Последний кусок трека в буфере: элемент доиграет до конца, а не встанет в ожидании данных
        if (first + wanted.length >= list.segments.length && source.readyState === 'open') source.endOfStream();
    }
    // Откуда брать хвост: поток трека и цепочка Web Audio сайта, которая сейчас звучит. null значит не сейчас, и следующий
    // шаг спросит снова: после паузы контекст сайта просыпается не сразу (замер 10.10: трек уже играет, а контекст ещё
    // 20 мс suspended)
    function tailSource(sound: SiteSound): { site: SiteAudio; api: TailStream } | null {
        const track = sound.attributes;
        const api = track ? openStream(track) : null;
        if (!api) {
            miss = 'no-stream';
            return null;
        }
        const site = siteAudioOf(sound);
        if (!site || site.context.state !== 'running') {
            miss = 'no-audio';
            return null;
        }
        return { site, api };
    }
    // Хвост играющего трека: поток грузится в свой элемент, встаёт на позицию чуть впереди и запускается без звука, когда
    // трек у сайта до неё дойдёт. Дальше его подгоняет скоростью syncTail
    async function prepare(sound: SiteSound, end: number, source: { site: SiteAudio; api: TailStream }): Promise<void> {
        const { site, api } = source;
        if (!media && site.element instanceof HTMLAudioElement) watch(site.element);
        let deck: Deck | null;
        try {
            deck = deckFor(site.context);
        } catch (error) {
            miss = 'no-audio';
            console.warn('Плавный переход: свой элемент не подключился к звуку сайта', error);
            return;
        }
        if (!deck) {
            miss = 'no-audio';
            return;
        }
        const current: Tail = { deck, site, end, phase: 'load', readings: [], stable: 0, calm: 0, until: 0, stage: 'resolve', begun: performance.now(), ready: 0 };
        tail = current;
        const stale = (): boolean => tail !== current || core.disposed();
        try {
            const link = await withTimeout(core.resolveStream(api.url), 8000, 'ссылка на поток');
            if (stale()) return;
            if (!link) throw new Error('API не дал ссылку на поток');
            const element = deck.element;
            current.stage = 'load';
            if (api.drm) await loadProtected(deck, link, positionOf(sound), end, stale);
            else element.src = link.url;
            if (stale()) return;
            await until(() => element.readyState >= 1 || element.error !== null, 8000, 'данные потока');
            if (stale()) return;
            if (element.error) throw new Error('поток не играет: ' + element.error.message);
            if (api.drm) {
                current.stage = 'license';
                await until(() => deck.license !== 'wait', 8000, 'лицензия');
                if (stale()) return;
                if (deck.license === 'failed') throw new Error('лицензия не получена');
            }
            // Поток не тот, что играет сайт (например, отрывок вместо целого трека)
            current.stage = 'length';
            if (Math.abs(element.duration * 1000 - durationOf(sound)) > 1500) throw new Error('длина потока ' + element.duration + ' с');
            // Перемотка шла дольше запаса, и трек у сайта уже прошёл это место: ещё раз с запасом побольше, кусок потока
            // к этому времени уже скачан. Иначе хвост стартует позади и догоняет на 4% скорости дольше, чем есть времени
            current.stage = 'seek';
            let lead = 0.6;
            let target = 0;
            for (let attempt = 0; ; attempt++) {
                const began = performance.now();
                target = positionOf(sound) / 1000 + lead;
                element.currentTime = target;
                await until(() => element.readyState >= 3 && !element.seeking, 5000, 'перемотка потока');
                if (stale()) return;
                if (positionOf(sound) / 1000 < target - START_LAG - 0.02 || attempt >= 2) break;
                lead = Math.max(lead, ((performance.now() - began) / 1000) * 2 + 0.3);
            }
            current.stage = 'start';
            const left = (target - START_LAG - positionOf(sound) / 1000) * 1000;
            if (left > 20) await sleep(left - 15);
            await until(() => positionOf(sound) / 1000 >= target - START_LAG, 2000, 'позиция сайта');
            if (stale()) return;
            deck.gain.gain.cancelScheduledValues(0);
            deck.gain.gain.value = 0;
            element.playbackRate = 1;
            deck.played = true;
            await element.play();
            if (stale()) return;
            announce();
            current.stage = 'sync';
            current.phase = 'sync';
        } catch (error) {
            if (stale()) return;
            miss = current.stage;
            dropTail();
            console.warn('Плавный переход: хвост не готов, трек просто затихнет', error);
        }
    }
    // Подгонка скоростью по медиане девяти замеров: позиции читаются с шумом до 10-20 мс, резкий регулятор на нём
    // раскачивается (замер 10.10: при усилении 4 сдвиг по звуку гулял до 15 мс)
    function syncTail(item: Tail, position: number): void {
        const element = item.deck.element;
        if (volume?.set) volume.set.call(element, base);
        element.muted = media?.muted === true;
        if (item.phase !== 'sync' && item.phase !== 'ready') return;
        const gap = element.currentTime - position / 1000;
        item.readings.push(gap);
        if (item.readings.length > 9) item.readings.shift();
        const middle = item.readings.slice().sort((a, b) => a - b)[Math.floor(item.readings.length / 2)];
        // Перемотка человеком или поток встал: хвост этого места больше не годится
        if (Math.abs(middle) > 1 || element.paused || element.ended) {
            miss = 'sync';
            dropTail();
            tried = false;
            return;
        }
        // Внутри допуска скорость ровно 1: передача берёт хвост, который уже не догоняет
        const rate = Math.abs(middle) < SYNCED ? 1 : 1 - Math.max(-0.04, Math.min(0.04, middle * 2));
        element.playbackRate = rate;
        item.calm = rate === 1 ? item.calm + 1 : 0;
        // Один из потоков изредка разом сдвигается на кадр AAC, 23 мс (замер 10.10): медиана замечает это не сразу, поэтому
        // готовность снимается и по среднему трёх последних замеров. Готов хвост, который треть секунды идёт со скоростью 1
        const recent = item.readings.slice(-3).reduce((sum, value) => sum + value, 0) / Math.min(3, item.readings.length);
        const settled = item.readings.length >= 5 && Math.abs(middle) <= SYNCED && Math.abs(recent) <= SYNCED * 2 && item.calm >= 10;
        item.stable = settled ? item.stable + 1 : 0;
        if (item.stable >= 6) {
            item.phase = 'ready';
            if (!item.ready) item.ready = performance.now();
        } else if (!settled) item.phase = 'sync';
    }
    // Передача хвоста: регулятор сайта уходит в ноль, свой поднимается, оба на звуковом потоке за 30 мс. Следующий трек
    // включается на следующем шаге, когда передача закончится
    function handoff(item: Tail, length: number): void {
        const { context, gain, element } = item.deck;
        const site = item.site.gain.gain;
        const at = context.currentTime + 0.01;
        element.playbackRate = 1;
        site.cancelScheduledValues(at);
        site.setValueAtTime(site.value, at);
        site.linearRampToValueAtTime(0, at + SWAP);
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(1, at + SWAP);
        item.phase = 'out';
        tail = null;
        fading.push(item);
        swapping = { item, at: performance.now(), length };
    }
    // Хвост гаснет по косинусу, пока следующий трек вступает по синусу: сумма мощностей ровная
    function fadeOut(item: Tail, length: number): void {
        const { context, gain, element } = item.deck;
        const seconds = Math.max(0.3, Math.min(length / 1000, item.end / 1000 - element.currentTime));
        const curve = new Float32Array(32).map((_, i) => Math.cos((i / 31) * (Math.PI / 2)));
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(1, now);
        try {
            gain.gain.setValueCurveAtTime(curve, now + 0.005, seconds);
        } catch (error) {
            gain.gain.linearRampToValueAtTime(0, now + seconds);
            console.warn('Плавный переход: кривая затухания не встала, хвост гаснет прямой', error);
        }
        item.until = performance.now() + seconds * 1000 + 200;
        restoreSite(item.site);
    }
    // Вступление следующего трека после передачи. Сайт ещё на старом треке, человек переключил дальше или поставил
    // паузу: переход заканчивается, громкость обычная
    function follow(player: SitePlayer, sound: SiteSound, position: number): void {
        const current = incoming;
        if (!current) return;
        const now = performance.now();
        if (sound.id === current.from) {
            if (now - current.at > WAIT_NEXT) finishIncoming();
            return;
        }
        if (!current.to) current.to = sound.id;
        if (sound.id !== current.to) {
            finishIncoming();
            return;
        }
        if (!current.started) {
            if (!player.isPlaying() || position <= 0) {
                if (now - current.at > WAIT_NEXT) finishIncoming();
                return;
            }
            current.started = now;
            fadeOut(current.tail, current.length);
        } else if (!player.isPlaying()) {
            finishIncoming();
            return;
        }
        const k = Math.min(1, (now - current.started) / current.length);
        setLevel(Math.sin(k * (Math.PI / 2)));
        if (k >= 1) incoming = null;
    }

    // Один шаг: смена трека, перемотка тишины, подготовка и передача хвоста. Возвращает, через сколько следующий
    function step(): number {
        const now = performance.now();
        fading = fading.filter((item) => {
            if (item.until && now > item.until) {
                release(item);
                return false;
            }
            syncTail(item, 0);
            return true;
        });
        const player = core.player();
        const sound = player?.getCurrentSound();
        if (!player || !sound) {
            dropTail();
            if (!incoming && !swapping) setLevel(1);
            return 500;
        }
        if (swapping) {
            if (now - swapping.at < 35) return 10;
            const { item, length } = swapping;
            swapping = null;
            // Человек успел переключить сам: второй раз дальше не идём, звук сайту возвращается
            if (sound.id !== soundId) {
                release(item);
                fading = fading.filter((entry) => entry !== item);
                return 40;
            }
            setLevel(0);
            remember(soundId);
            incoming = { from: soundId, to: 0, at: now, started: 0, length, tail: item };
            try {
                player.playNext?.();
            } catch (error) {
                console.warn('Плавный переход: сайт не переключил трек', error);
                finishIncoming();
            }
            return 40;
        }
        const position = positionOf(sound);
        follow(player, sound, position);
        // Новый трек или тот же с начала (повтор, перемотка в начало): разбор заново
        if (sound.id !== soundId || (position < 1500 && lastPosition > position + 5000)) {
            soundId = sound.id;
            introDone = false;
            tailDone = false;
            tried = false;
            fadeFrom = 0;
            miss = null;
            reported = false;
            dropTail();
            if (!incoming) setLevel(1);
        }
        lastPosition = position;
        const options = core.options();
        const duration = durationOf(sound);
        const track = sound.attributes;
        if (!track || !player.isPlaying() || sound.isSnippetized?.()) {
            dropTail();
            tried = false;
            return incoming ? 40 : 250;
        }
        const raw = options.edges ? core.rawSamples(track) : null;
        const bounds = raw ? quietBounds(raw, duration) : null;
        // Тишина в начале: только у трека, который только что начался, а не после перемотки человеком
        if (bounds && !introDone) {
            introDone = true;
            if (position < 1500 && bounds.introEnd >= INTRO_MIN) {
                sound.seek(Math.max(0, bounds.introEnd - 300));
                return 250;
            }
        }
        const silentTail = bounds !== null && duration - bounds.loudEnd >= TAIL_MIN;
        const end = bounds && silentTail ? bounds.loudEnd + 500 : duration;
        const length = options.crossfade * 1000;
        const from = end - length;
        const crossfade = length > 0 && duration >= 30000 && from >= 10000 && typeof player.playNext === 'function' && player.hasNextSound?.() === true && !repeatOne() && !core.held();
        if (crossfade && !incoming) {
            const left = end - position;
            const shortest = Math.min(length, Math.max(MIN_MIX, length / 2));
            // Перемотка назад, раньше окна подготовки: на подходе к концу хвост готовится заново
            if (position < from - PREPARE) {
                dropTail();
                tried = false;
                miss = null;
                reported = false;
            }
            if (!tail && !tried && position >= from - PREPARE && position < end) {
                const source = tailSource(sound);
                if (source && left >= shortest + PREP_TIME) {
                    tried = true;
                    void prepare(sound, end, source);
                } else if (source) miss = 'late';
            }
            if (tail) syncTail(tail, position);
            if (position >= from && position < end) {
                // Хвост сошёлся: передача. После поздней перемотки переход короче, на сколько осталось до конца звука
                if (tail?.phase === 'ready' && left >= shortest) {
                    outcome('done', tail.ready - tail.begun, left);
                    handoff(tail, Math.min(length, left));
                    return 10;
                }
                // Хвост ещё готовится: громкость полная, пока до конца звука хватает на короткий переход
                if (tail && !fadeFrom && left > shortest) return 30;
                // Хвоста не будет: трек затихает к концу звука от начала перехода, а если хвост сорвался позже, то от этого места
                tried = true;
                if (!fadeFrom) {
                    fadeFrom = position < from + 300 ? from : position;
                    outcome(tail?.stage ?? miss ?? 'late', tail ? performance.now() - tail.begun : 0, left);
                }
                dropTail();
                setLevel(Math.cos(Math.min(1, (position - fadeFrom) / Math.max(1, end - fadeFrom)) * (Math.PI / 2)));
                return 40;
            }
            if (position < from) {
                fadeFrom = 0;
                setLevel(1);
            }
        } else {
            dropTail();
            if (!incoming) setLevel(1);
        }
        if (silentTail && !tailDone && position >= end && position < duration - 1000) {
            tailDone = true;
            sound.seek(duration - 250);
            return 250;
        }
        if (incoming || tail) return 30;
        // Хвост после перехода ещё звучит: громкость за ползунком и снятие в срок
        if (fading.length) return 100;
        // Перемотку к концу шаг замечает не позже чем через полсекунды: каждая доля секунды идёт на подготовку хвоста
        if (crossfade && position < from - PREPARE) return Math.max(250, Math.min(500, from - PREPARE - position));
        // Хвоста нет: шаг к началу перехода, затихание начинается вовремя
        if (crossfade && position < from) return Math.max(30, Math.min(250, from - position));
        return silentTail && end - position > 1000 ? Math.min(1000, end - position - 500) : 250;
    }
    // Всё своё снимается, звук сайту возвращается целиком
    function reset(): void {
        swapping = null;
        finishIncoming();
        dropTail();
        for (const item of fading) release(item);
        fading = [];
        setLevel(1);
    }
    function loop(): void {
        timer = undefined;
        if (core.disposed()) return;
        let delay = 500;
        try {
            delay = step();
        } catch (error) {
            reset();
            console.warn('Тихие края: шаг не удался', error);
        }
        timer = setTimeout(loop, delay);
    }
    // Первый шаг после того, как волна объявит всё своё: форма волны и плеер появляются позже
    timer = setTimeout(loop, 500);
    return {
        crossfaded: (id) => crossfadedIds.includes(id),
        dispose: () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            reset();
            for (const deck of decks) deck.gain.disconnect();
            decks.length = 0;
            unwatch();
            HTMLMediaElement.prototype.play = originalPlay;
            // Сведения о треке не остаются сброшенными
            if (announceTimer !== undefined) clearTimeout(announceTimer);
            if (heldMetadata) restoreMetadata();
            announceTimer = undefined;
        },
    };
}
