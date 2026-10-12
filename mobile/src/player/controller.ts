import type { WaveTrack } from '../core/waveTypes';
import {
    currentItem, emptyQueue, insertLast as queueInsertLast, insertNext as queueInsertNext, jump, makeItem, moveItem as queueMove,
    nextIndex, nextRepeat, previousIndex, removeAt as queueRemove, replaceQueue, type QueueItem, type QueueState, type RepeatMode,
} from './queue';
import { makeSnapshot, parseSnapshot, queueOf, type SessionStore } from './session';
import { StreamUnavailableError, type ResolvedStream, type StreamResolver, type UnavailableReason } from './stream';

// Контроллер плеера: очередь, переходы между треками, запрос потоков и сохранение сессии. Звук играет «движок»
// (expo-audio на телефоне), контроллер о нём знает только через AudioEngine, поэтому проверяется в тестах без устройства.

export interface TrackMeta {
    title: string;
    artist: string;
    artworkUrl?: string;
}

export interface EngineStatus {
    playing: boolean;
    buffering: boolean;
    loaded: boolean;
    /** Секунды */
    position: number;
    duration: number;
    /** Трек доиграл до конца: приходит один раз после load, остальное движок отфильтровал */
    finished: boolean;
    error: string | null;
}

/** Кнопки шторки Android */
export type MediaAction = 'previous' | 'next' | 'like' | 'dislike';

export interface AudioEngine {
    /** Нажатия кнопок шторки; нет у движков без системного уведомления */
    onControl?(listener: (action: MediaAction) => void): () => void;
    load(url: string, meta: TrackMeta, options: { autoplay: boolean; startAt: number }): void;
    play(): void;
    pause(): void;
    seekTo(seconds: number): void;
    subscribe(listener: (status: EngineStatus) => void): () => void;
    release(): void;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type PlayerError = 'network' | 'unavailable' | 'playback';

export interface PlayerState {
    queue: QueueState;
    status: PlayerStatus;
    error: PlayerError | null;
    /** Играет отрывок Go+, а не весь трек */
    preview: boolean;
    /** Очередь доиграна до конца */
    ended: boolean;
}

export interface Progress {
    position: number;
    duration: number;
}

export interface ControllerOptions {
    engine: AudioEngine;
    resolver: StreamResolver;
    session?: SessionStore;
    now?(): number;
    later?(run: () => void, ms: number): unknown;
    cancel?(handle: unknown): void;
    /** Трек не играет и пропущен: недоступен в стране, закрыт лейблом, нет потока */
    onUnavailable?(track: WaveTrack, reason: UnavailableReason): void;
}

export interface PlayerController {
    getState(): PlayerState;
    subscribe(listener: () => void): () => void;
    getProgress(): Progress;
    subscribeProgress(listener: () => void): () => void;
    playTracks(tracks: WaveTrack[], index?: number): void;
    playItems(items: QueueItem[], index?: number): void;
    play(): void;
    pause(): void;
    toggle(): void;
    next(): void;
    previous(): void;
    jumpTo(index: number): void;
    seek(seconds: number): void;
    /** Дописывает записи в конец очереди; в пустую очередь ставит и запускает */
    appendItems(items: QueueItem[]): void;
    insertNext(track: WaveTrack, reason?: string): void;
    insertLast(track: WaveTrack, reason?: string): void;
    removeAt(index: number): void;
    move(from: number, to: number): void;
    cycleRepeat(): void;
    setRepeat(mode: RepeatMode): void;
    clear(): void;
    /** Читает сохранённую сессию: очередь встаёт на паузу, звук не стартует, пока не нажмут play */
    restore(): Promise<boolean>;
    dispose(): void;
}

const MAX_FAILURES = 5;
const CACHE_MS = 10 * 60000;
const SAVE_DELAY_MS = 500;
const SAVE_EVERY_MS = 15000;
const RESTART_AFTER_S = 3;

function durationOf(track: WaveTrack): number {
    return ((track.full_duration ?? track.duration) || 0) / 1000;
}

function metaOf(track: WaveTrack): TrackMeta {
    return {
        title: track.title || 'Трек',
        artist: track.user?.username ?? '',
        // large (100x100) мутно для экрана блокировки
        artworkUrl: track.artwork_url ? track.artwork_url.replace('-large.', '-t500x500.') : undefined,
    };
}

export function createPlayerController(options: ControllerOptions): PlayerController {
    const { engine, resolver } = options;
    const now = options.now ?? (() => Date.now());
    const later = options.later ?? ((run, ms) => setTimeout(run, ms));
    const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    let state: PlayerState = { queue: emptyQueue(), status: 'idle', error: null, preview: false, ended: false };
    let progress: Progress = { position: 0, duration: 0 };
    const listeners = new Set<() => void>();
    const progressListeners = new Set<() => void>();

    // gen растёт с каждым запуском трека: ответы и события прошлых запусков отбрасываются
    let gen = 0;
    let failures = 0;
    let finishedGen = -1;
    let retriedGen = -1;
    let engineLoaded = false;
    let playIntent = false;
    let prefetchedGen = -1;
    let saveTimer: unknown = null;
    let lastSave = 0;
    let disposed = false;
    const cache = new Map<number, { at: number; stream: ResolvedStream }>();

    const emit = (): void => { for (const listener of [...listeners]) listener(); };
    const emitProgress = (): void => { for (const listener of [...progressListeners]) listener(); };

    function setState(patch: Partial<PlayerState>): void {
        state = { ...state, ...patch };
        emit();
        scheduleSave();
    }

    function setProgress(position: number, duration: number): void {
        if (progress.position === position && progress.duration === duration) return;
        progress = { position, duration };
        emitProgress();
    }

    // ---- сохранение сессии ----
    function scheduleSave(): void {
        if (!options.session || disposed || saveTimer !== null) return;
        saveTimer = later(() => {
            saveTimer = null;
            void saveNow();
        }, SAVE_DELAY_MS);
    }

    async function saveNow(): Promise<void> {
        if (!options.session || disposed || !state.queue.items.length) return;
        lastSave = now();
        try {
            await options.session.save(makeSnapshot(state.queue, progress.position, lastSave));
        } catch (error) {
            console.warn('Сессия плеера не сохранена', error);
        }
    }

    // ---- потоки ----
    async function resolveCached(track: WaveTrack): Promise<ResolvedStream> {
        const hit = cache.get(track.id);
        if (hit && now() - hit.at < CACHE_MS) return hit.stream;
        const stream = await resolver.resolve(track);
        cache.set(track.id, { at: now(), stream });
        if (cache.size > 20) cache.delete(cache.keys().next().value as number);
        return stream;
    }

    function prefetchNext(): void {
        if (prefetchedGen === gen) return;
        prefetchedGen = gen;
        const index = nextIndex(state.queue, false);
        const item = index === null ? null : state.queue.items[index];
        if (item) void resolveCached(item.track).catch(() => undefined);
    }

    // ---- запуск трека ----
    async function start(index: number, startAt = 0): Promise<void> {
        const queue = jump(state.queue, index);
        const item = currentItem(queue);
        if (!item) return;
        const mine = ++gen;
        engineLoaded = false;
        setState({ queue, status: 'loading', error: null, ended: false, preview: false });
        setProgress(startAt, durationOf(item.track));
        try {
            const stream = await resolveCached(item.track);
            if (mine !== gen || disposed) return;
            engine.load(stream.url, metaOf(item.track), { autoplay: playIntent, startAt });
            engineLoaded = true;
            setState({ preview: stream.preview });
        } catch (error) {
            if (mine !== gen || disposed) return;
            fail(error, item);
        }
    }

    function fail(error: unknown, item: QueueItem): void {
        if (error instanceof StreamUnavailableError) {
            options.onUnavailable?.(item.track, error.reason);
            failures += 1;
            const next = nextIndex(state.queue, false);
            if (failures < MAX_FAILURES && next !== null && next !== state.queue.index) {
                void start(next);
                return;
            }
            setState({ status: 'error', error: 'unavailable' });
            return;
        }
        setState({ status: 'error', error: 'network' });
    }

    function advanceAfterFinish(): void {
        const next = nextIndex(state.queue, true);
        if (next === null) {
            playIntent = false;
            setState({ status: 'paused', ended: true });
            setProgress(progress.duration, progress.duration);
            return;
        }
        void start(next);
    }

    function recover(): void {
        // Подписанный адрес мог протухнуть посреди трека: один раз берём новый и продолжаем с того же места
        const item = currentItem(state.queue);
        if (!item || retriedGen === gen) {
            setState({ status: 'error', error: 'playback' });
            return;
        }
        const position = progress.position;
        cache.delete(item.track.id);
        // start сразу, до первого await, увеличивает gen: повтор помечается за новым запуском
        void start(state.queue.index, position);
        retriedGen = gen;
    }

    // ---- события движка ----
    const stopEngineEvents = engine.subscribe((status) => {
        if (disposed || !state.queue.items.length || !engineLoaded) return;
        if (status.error) {
            if (state.status !== 'error') recover();
            return;
        }
        const item = currentItem(state.queue);
        const duration = status.duration > 0 ? status.duration : item ? durationOf(item.track) : 0;
        if (state.status !== 'loading' || status.loaded) setProgress(status.position, duration);

        if (status.playing) {
            failures = 0;
            playIntent = true;
            if (state.status !== 'playing') setState({ status: 'playing', error: null });
            prefetchNext();
            if (now() - lastSave >= SAVE_EVERY_MS) void saveNow();
        } else if (state.status === 'loading' && status.loaded && !playIntent) {
            setState({ status: 'paused' });
        } else if (state.status === 'playing' && status.loaded && !status.buffering && !status.finished) {
            // Пауза снаружи: кнопка в шторке или потеря фокуса
            playIntent = false;
            setState({ status: 'paused' });
        }

        if (status.finished && finishedGen !== gen && state.status !== 'loading') {
            finishedGen = gen;
            advanceAfterFinish();
        }
    });

    // ---- команды ----
    function playItems(items: QueueItem[], index = 0): void {
        if (!items.length) return;
        playIntent = true;
        failures = 0;
        state = { ...state, queue: replaceQueue(state.queue, items, index) };
        void start(index);
    }

    function play(): void {
        if (!state.queue.items.length) return;
        playIntent = true;
        if (state.status === 'loading') return;
        if (state.ended) { failures = 0; void start(0); return; }
        if (!engineLoaded || state.status === 'error') { failures = 0; void start(state.queue.index, progress.position); return; }
        engine.play();
    }

    function pause(): void {
        playIntent = false;
        if (engineLoaded && state.status !== 'loading') engine.pause();
    }

    function clear(): void {
        gen += 1;
        playIntent = false;
        if (engineLoaded) engine.pause();
        engineLoaded = false;
        setProgress(0, 0);
        setState({ queue: emptyQueue(state.queue.repeat), status: 'idle', error: null, preview: false, ended: false });
    }

    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getProgress: () => progress,
        subscribeProgress(listener) { progressListeners.add(listener); return () => progressListeners.delete(listener); },

        playTracks(tracks, index = 0) { playItems(tracks.map((track) => makeItem(track)), index); },
        playItems,
        play,
        pause,
        toggle() {
            if (state.status === 'playing' || (state.status === 'loading' && playIntent)) pause();
            else play();
        },

        next() {
            const index = nextIndex(state.queue, false);
            if (index === null) return;
            playIntent = true;
            failures = 0;
            void start(index);
        },
        previous() {
            if (!state.queue.items.length) return;
            const index = previousIndex(state.queue);
            if (progress.position > RESTART_AFTER_S || index === state.queue.index) {
                if (engineLoaded) { engine.seekTo(0); setProgress(0, progress.duration); }
                return;
            }
            playIntent = true;
            failures = 0;
            void start(index);
        },
        jumpTo(index) {
            if (index < 0 || index >= state.queue.items.length) return;
            playIntent = true;
            failures = 0;
            void start(index);
        },
        seek(seconds) {
            if (!engineLoaded) { setProgress(Math.max(0, seconds), progress.duration); return; }
            const to = Math.max(0, progress.duration > 0 ? Math.min(seconds, progress.duration) : seconds);
            engine.seekTo(to);
            setProgress(to, progress.duration);
        },

        appendItems(items) {
            if (!items.length) return;
            if (!state.queue.items.length) { playItems(items); return; }
            setState({ queue: { ...state.queue, items: [...state.queue.items, ...items] } });
        },
        insertNext(track, reason) {
            if (!state.queue.items.length) { playItems([makeItem(track, reason)]); return; }
            setState({ queue: queueInsertNext(state.queue, makeItem(track, reason)) });
        },
        insertLast(track, reason) {
            if (!state.queue.items.length) { playItems([makeItem(track, reason)]); return; }
            setState({ queue: queueInsertLast(state.queue, makeItem(track, reason)) });
        },
        removeAt(index) {
            const removal = queueRemove(state.queue, index);
            if (removal.state === state.queue) return;
            if (!removal.removedCurrent) { setState({ queue: removal.state }); return; }
            if (!removal.state.items.length) { clear(); return; }
            state = { ...state, queue: removal.state };
            void start(removal.state.index);
        },
        move(from, to) { setState({ queue: queueMove(state.queue, from, to) }); },
        cycleRepeat() { setState({ queue: { ...state.queue, repeat: nextRepeat(state.queue.repeat) } }); },
        setRepeat(mode) { setState({ queue: { ...state.queue, repeat: mode } }); },

        clear,

        async restore() {
            if (!options.session || state.queue.items.length) return false;
            const snapshot = parseSnapshot(await options.session.load().catch(() => null));
            // Пока читали, человек мог уже включить своё
            if (!snapshot || state.queue.items.length || disposed) return false;
            const queue = queueOf(snapshot);
            const item = currentItem(queue);
            gen += 1;
            engineLoaded = false;
            playIntent = false;
            state = { queue, status: 'paused', error: null, preview: false, ended: false };
            setProgress(snapshot.position, item ? durationOf(item.track) : 0);
            emit();
            return true;
        },

        dispose() {
            disposed = true;
            gen += 1;
            if (saveTimer !== null) cancel(saveTimer);
            stopEngineEvents();
            engine.release();
            listeners.clear();
            progressListeners.clear();
        },
    };
}
