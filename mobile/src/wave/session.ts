import { reasonText } from '../core/waveTexts';
import type { WaveCandidate, WaveMode, WaveTexts } from '../core/waveTypes';
import type { PlayerController } from '../player/controller';
import { currentItem, makeItem, type QueueItem } from '../player/queue';
import type { TextStore } from './marks';
import type { Wave, WaveSeed } from './engine';

// «Моя волна» как режим плеера: первая пачка заменяет очередь, дальше сессия сама дописывает пачки, пока впереди
// осталось мало. Если человек включил своё (очередь стала не из волны), волна выходит.

export type WaveStatus = 'idle' | 'loading' | 'running' | 'empty' | 'error';

export interface WaveSettings {
    mode: WaveMode;
    /** Жанры через запятую или слэш; пусто: любой */
    genre: string;
}

export interface WaveSessionState extends WaveSettings {
    status: WaveStatus;
    /** Подпись волны от трека или артиста; пусто у обычной */
    seedLabel: string;
}

export interface WaveSession {
    getState(): WaveSessionState;
    subscribe(listener: () => void): () => void;
    /** Запускает волну с текущими настройками; seed: от трека или артиста. Настройки в хранилище не пишет */
    start(seed?: WaveSeed): Promise<void>;
    stop(): void;
    /** Меняет настройки (хранятся) и, если волна идёт, запускает её заново */
    configure(patch: Partial<WaveSettings>): void;
}

export interface WaveSessionDeps {
    player: Pick<PlayerController, 'getState' | 'subscribe' | 'playItems' | 'appendItems' | 'next'>;
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
        const raw = JSON.parse(text ?? 'null') as { mode?: unknown; genre?: unknown } | null;
        return { mode: raw?.mode === 'fresh' ? 'fresh' : 'similar', genre: typeof raw?.genre === 'string' ? raw.genre.slice(0, 100) : '' };
    } catch {
        return { mode: 'similar', genre: '' };
    }
}

export function createWaveSession(deps: WaveSessionDeps): WaveSession {
    const { player, texts } = deps;
    const now = deps.now ?? (() => Date.now());
    let settings = parseSettings(deps.settings.get());
    let state: WaveSessionState = { ...settings, status: 'idle', seedLabel: '' };
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

    function itemsOf(list: WaveCandidate[]): QueueItem[] {
        return list.map((candidate) => {
            const item = makeItem(candidate.track, reasonText(candidate.reason, texts));
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
        if (state.status !== 'idle') set({ status: 'idle', seedLabel: '' });
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
        const label = next ? (next.kind === 'track' ? next.track.title ?? '' : next.name) : '';
        set({ ...settings, status: 'loading', seedLabel: label });
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
            const item = makeItem(next.track, reasonText({ kind: 'seedTrack' }, texts));
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
        configure(patch) {
            const next = { ...settings, ...patch };
            if (next.mode === settings.mode && next.genre === settings.genre) return;
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
