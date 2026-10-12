import { fillText, reasonText } from '../core/waveTexts';
import { moodList, type WaveMood } from '../core/waveMood';
import { artwork } from '../player/format';
import type { SeriesTrait, WaveCandidate, WaveMode, WaveTexts, WaveTrack } from '../core/waveTypes';
import type { PlayerController } from '../player/controller';
import { currentItem, makeItem, type QueueItem } from '../player/queue';
import type { TextStore } from './marks';
import type { ForkOption, Wave, WaveSeed, WaveSignal } from './engine';

// «Моя волна» как режим плеера: первая пачка заменяет очередь, дальше сессия сама дописывает пачки, пока впереди
// осталось мало. Если человек включил своё (очередь стала не из волны), волна выходит.

export type WaveStatus = 'idle' | 'loading' | 'running' | 'empty' | 'error';

export interface WaveSettings {
    mode: WaveMode;
    /** Жанры через запятую или слэш; пусто: любой */
    genre: string;
    /** Настроение; пусто: любое */
    preset: WaveMood | '';
}

export interface WaveSessionState extends WaveSettings {
    status: WaveStatus;
    /** Подпись волны от трека или артиста; пусто у обычной */
    seedLabel: string;
    /** «Куда дальше?» после трёх быстрых пропусков подряд (П8); null, пока развилки нет */
    fork: ForkView | null;
    /** Подсказка о прижатом признаке серии пропусков (П7) с кнопкой «Отменить»; null, пока нечего показать */
    notice: WaveNotice | null;
}

export interface ForkView {
    options: Array<{ id: number; title: string; artist: string; artwork: string | null; label: string }>;
}
export interface WaveNotice {
    text: string;
    /** kind:key прижатого признака: по нему «Отменить» снимает прижим */
    trait: string;
}

export interface WaveSession {
    getState(): WaveSessionState;
    subscribe(listener: () => void): () => void;
    /** Запускает волну с текущими настройками; seed: от трека или артиста. Настройки в хранилище не пишет */
    start(seed?: WaveSeed): Promise<void>;
    stop(): void;
    /** Меняет настройки (хранятся) и, если волна идёт, запускает её заново */
    configure(patch: Partial<WaveSettings>): void;
    /** Трек волны пропущен рано (-1) или лайкнут (1): волна учитывает это до конца сессии. Чужие треки игнорируются */
    feedback(track: WaveTrack, sign: 1 | -1, heard?: number): void;
    /** Трек волны слушали от 30 секунд: серия пропусков прервана */
    listened(track: WaveTrack): void;
    /** Выбор варианта развилки: трек встаёт следующим и играет */
    pickFork(id: number): void;
    closeFork(): void;
    /** «Отменить» у подсказки о прижатом признаке */
    undoNotice(): void;
    dismissNotice(): void;
}

export interface WaveSessionDeps {
    player: Pick<PlayerController, 'getState' | 'subscribe' | 'playItems' | 'appendItems' | 'next' | 'removeAt' | 'move'>;
    createWave(settings: WaveSettings, seed: WaveSeed | undefined): Wave;
    texts: WaveTexts;
    settings: TextStore;
    now?(): number;
}

const BATCH = 10;
/** Дописываем, когда впереди осталось не больше стольких треков */
const REFILL_AT = 3;
const RETRY_MS = 15000;

export function parseSettings(text: string | null): WaveSettings {
    try {
        const raw = JSON.parse(text ?? 'null') as { mode?: unknown; genre?: unknown; preset?: unknown } | null;
        return {
            mode: raw?.mode === 'fresh' ? 'fresh' : 'similar',
            genre: typeof raw?.genre === 'string' ? raw.genre.slice(0, 100) : '',
            preset: moodList().find((mood) => mood === raw?.preset) ?? '',
        };
    } catch {
        return { mode: 'similar', genre: '', preset: '' };
    }
}

export function createWaveSession(deps: WaveSessionDeps): WaveSession {
    const { player, texts } = deps;
    const now = deps.now ?? (() => Date.now());
    let settings = parseSettings(deps.settings.get());
    let state: WaveSessionState = { ...settings, status: 'idle', seedLabel: '', fork: null, notice: null };
    const listeners = new Set<() => void>();

    // gen растёт при каждом запуске и остановке: ответы старой волны отбрасываются
    let gen = 0;
    let wave: Wave | null = null;
    let seed: WaveSeed | undefined;
    let owned = new Set<string>();
    let refilling = false;
    let drained = false;
    let failedAt = -Infinity;

    const set = (patch: Partial<WaveSessionState>): void => {
        state = { ...state, ...patch };
        for (const listener of [...listeners]) listener();
    };

    // Источник для журнала: 'wave:similar', 'wave:track', 'wave:library'; причина и исходная причина (до подмены вкусом)
    function itemsOf(list: WaveCandidate[]): QueueItem[] {
        const source = 'wave:' + (seed ? seed.kind : settings.mode);
        return list.map((candidate) => {
            const item = makeItem(candidate.track, reasonText(candidate.reason, texts), {
                source, why: candidate.reason.kind, origin: candidate.trace?.origin, preset: seed ? undefined : settings.preset || undefined,
            });
            owned.add(item.key);
            return item;
        });
    }

    function stop(): void {
        gen += 1;
        wave = null;
        seed = undefined;
        owned = new Set();
        refilling = false;
        clearTimeout(forkTimer);
        if (state.status !== 'idle' || state.fork || state.notice) set({ status: 'idle', seedLabel: '', fork: null, notice: null });
    }

    // Развилка «Куда дальше?» живёт две минуты: без выбора варианты возвращаются в пул, музыка идёт как шла
    let forkTimer: ReturnType<typeof setTimeout> | undefined;
    const FORK_MS = 120000;

    const forkView = (options: ForkOption[]): ForkView => ({
        options: options.map(({ candidate, label }) => ({
            id: candidate.track.id,
            title: candidate.track.title ?? '',
            artist: candidate.track.user?.username ?? '',
            artwork: artwork(candidate.track.artwork_url),
            label: label.kind === 'artist' ? fillText(texts.whyTasteArtist, { artist: label.name })
                : label.kind === 'calm' ? texts.forkCalm
                : label.kind === 'newArtist' ? texts.whyNewArtist
                : reasonText(candidate.reason, texts),
        })),
    });

    // П7: что именно ушло из волны, одной строкой
    function traitText(trait: SeriesTrait): string {
        if (trait.kind === 'lang') return trait.key === 'cyr' ? texts.traitLessCyr : texts.traitLessInst;
        if (trait.kind === 'genre') return fillText(texts.traitLessGenre, { genre: trait.label });
        if (trait.kind === 'marker') return fillText(texts.traitLessMarker, { marker: trait.label });
        return texts.traitLessForeign;
    }

    // Впереди стоящее из волны возвращается в пул и берётся заново по вкусу с поправками сессии. Старое убирается из
    // очереди, когда новое найдено: очередь не пустеет. Поставленное руками остаётся
    async function rebuildAhead(fresh: boolean): Promise<void> {
        const mine = gen;
        const current = wave;
        if (!current || refilling) return;
        const { queue } = player.getState();
        const ahead = queue.items.slice(queue.index + 1).filter((item) => owned.has(item.key));
        if (!ahead.length) return;
        const count = current.reclaim(ahead.map((item) => item.track), fresh);
        if (!count) return;
        refilling = true;
        try {
            const list = await current.next(count);
            if (mine !== gen || !list.length) return;
            const after = player.getState().queue;
            const old = new Set(ahead.map((item) => item.key));
            for (let i = after.items.length - 1; i > after.index; i--) if (old.has(after.items[i].key)) player.removeAt(i);
            player.appendItems(itemsOf(list));
        } catch (error) {
            if (mine !== gen) return;
            failedAt = now();
            console.warn('Волна: очередь впереди не пересобрана', error);
        } finally {
            if (mine === gen) refilling = false;
        }
    }

    function handle(signals: WaveSignal[]): void {
        let rebuild: { fresh: boolean } | null = null;
        for (const signal of signals) {
            if (signal.kind === 'trait') set({ notice: { text: traitText(signal.trait), trait: signal.trait.kind + ':' + signal.trait.key } });
            else if (signal.kind === 'fork') {
                set({ fork: forkView(signal.options) });
                clearTimeout(forkTimer);
                forkTimer = setTimeout(closeFork, FORK_MS);
            } else rebuild = signal;
        }
        if (rebuild) void rebuildAhead(rebuild.fresh);
    }

    function closeFork(): void {
        clearTimeout(forkTimer);
        if (!state.fork) return;
        wave?.closeFork();
        set({ fork: null });
    }

    async function refill(): Promise<void> {
        const mine = gen;
        const current = wave;
        if (!current) return;
        refilling = true;
        try {
            const list = await current.next(BATCH);
            if (mine !== gen) return;
            if (!list.length) {
                drained = true;
                return;
            }
            player.appendItems(itemsOf(list));
            // Очередь успела доиграть, пока искали: продолжаем с первого нового
            if (player.getState().ended) player.next();
        } catch (error) {
            if (mine !== gen) return;
            failedAt = now();
            console.warn('Волна: догрузка не удалась', error);
        } finally {
            if (mine === gen) refilling = false;
        }
    }

    // На каждое изменение плеера: выйти, если очередь уже не волны, и догрузить, если впереди мало
    player.subscribe(() => {
        if (!wave || state.status !== 'running') return;
        const { queue } = player.getState();
        const item = currentItem(queue);
        if (!item || !owned.has(item.key)) {
            stop();
            return;
        }
        if (refilling || drained || now() - failedAt < RETRY_MS) return;
        if (queue.items.length - 1 - queue.index <= REFILL_AT) void refill();
    });

    async function start(next?: WaveSeed): Promise<void> {
        stop();
        const mine = gen;
        const created = deps.createWave(settings, next);
        wave = created;
        seed = next;
        drained = false;
        failedAt = -Infinity;
        const label = next ? (next.kind === 'track' ? next.track.title ?? '' : next.kind === 'artist' ? next.name : next.title) : '';
        set({ ...settings, status: 'loading', seedLabel: label, fork: null, notice: null });
        let list: WaveCandidate[];
        try {
            list = await created.next(BATCH);
        } catch (error) {
            if (mine !== gen) return;
            console.warn('Волна: не удалось подобрать треки', error);
            wave = null;
            set({ status: 'error' });
            return;
        }
        if (mine !== gen) return;
        // Без найденного это не волна: очередь не трогаем
        if (!list.length) {
            wave = null;
            set({ status: 'empty' });
            return;
        }
        const items = itemsOf(list);
        // От трека сам трек играет первым
        if (next?.kind === 'track') {
            const item = makeItem(next.track, reasonText({ kind: 'seedTrack' }, texts), { source: 'wave:track', why: 'seedTrack' });
            owned.add(item.key);
            items.unshift(item);
        }
        set({ status: 'running' });
        player.playItems(items, 0);
    }

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start,
        stop,
        feedback(track, sign, heard) {
            if (wave && state.status === 'running') handle(wave.feedback(track, sign, heard));
        },
        listened(track) {
            if (wave && state.status === 'running') wave.listened(track);
        },
        pickFork(id) {
            const candidate = wave?.pickFork(id);
            clearTimeout(forkTimer);
            set({ fork: null });
            if (!candidate) return;
            const [item] = itemsOf([candidate]);
            const before = player.getState().queue;
            // Трек встаёт следующим после играющего и сразу начинает играть
            player.appendItems([item]);
            player.move(before.items.length, before.index + 1);
            player.next();
        },
        closeFork,
        undoNotice() {
            const key = state.notice?.trait;
            set({ notice: null });
            if (!key || !wave) return;
            wave.releaseTrait(key);
            void rebuildAhead(false);
        },
        dismissNotice() {
            if (state.notice) set({ notice: null });
        },
        configure(patch) {
            const next = { ...settings, ...patch };
            if (next.mode === settings.mode && next.genre === settings.genre && next.preset === settings.preset) return;
            settings = next;
            try {
                deps.settings.set(JSON.stringify(settings));
            } catch (error) {
                console.warn('Настройки волны не сохранены', error);
            }
            if (state.status === 'idle' || state.status === 'empty' || state.status === 'error') set({ ...settings });
            else void start(seed);
        },
    };
}
