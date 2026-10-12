import type { WaveTrack } from '../core/waveTypes';

// Очередь воспроизведения: чистые функции над состоянием. Один и тот же трек может стоять в очереди дважды,
// поэтому у записи свой ключ.

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueItem {
    key: string;
    track: WaveTrack;
    /** Почему трек в очереди (подпись волны); пусто у обычной очереди */
    reason?: string;
}

export interface QueueState {
    items: QueueItem[];
    /** Номер играющего трека; при пустой очереди 0 */
    index: number;
    repeat: RepeatMode;
}

let sequence = 0;
export function makeItem(track: WaveTrack, reason?: string): QueueItem {
    sequence += 1;
    return reason ? { key: `q${sequence}`, track, reason } : { key: `q${sequence}`, track };
}

export const emptyQueue = (repeat: RepeatMode = 'off'): QueueState => ({ items: [], index: 0, repeat });

export function replaceQueue(state: QueueState, items: QueueItem[], index = 0): QueueState {
    return { ...state, items, index: items.length ? Math.min(Math.max(0, index), items.length - 1) : 0 };
}

export function currentItem(state: QueueState): QueueItem | null {
    return state.items[state.index] ?? null;
}

/** Номер следующего трека или null, если дальше играть нечего. auto: трек доиграл сам, «повтор одного» тогда держит его */
export function nextIndex(state: QueueState, auto: boolean): number | null {
    const { items, index, repeat } = state;
    if (!items.length) return null;
    if (auto && repeat === 'one') return index;
    if (index + 1 < items.length) return index + 1;
    return repeat === 'all' ? 0 : null;
}

/** Номер предыдущего трека. В начале очереди без повтора остаётся тот же трек (он начнётся заново) */
export function previousIndex(state: QueueState): number {
    const { items, index, repeat } = state;
    if (index > 0) return index - 1;
    return repeat === 'all' && items.length > 1 ? items.length - 1 : 0;
}

export function jump(state: QueueState, index: number): QueueState {
    return state.items.length ? { ...state, index: Math.min(Math.max(0, index), state.items.length - 1) } : state;
}

/** Вставка после играющего трека; в пустую очередь становится единственным */
export function insertNext(state: QueueState, item: QueueItem): QueueState {
    if (!state.items.length) return { ...state, items: [item], index: 0 };
    const at = state.index + 1;
    return { ...state, items: [...state.items.slice(0, at), item, ...state.items.slice(at)] };
}

export function insertLast(state: QueueState, item: QueueItem): QueueState {
    return state.items.length ? { ...state, items: [...state.items, item] } : { ...state, items: [item], index: 0 };
}

export interface Removal {
    state: QueueState;
    /** Удалён играющий трек: на его месте теперь следующий (или очередь опустела) */
    removedCurrent: boolean;
}

export function removeAt(state: QueueState, at: number): Removal {
    if (at < 0 || at >= state.items.length) return { state, removedCurrent: false };
    const items = state.items.filter((_, i) => i !== at);
    if (at < state.index) return { state: { ...state, items, index: state.index - 1 }, removedCurrent: false };
    if (at > state.index) return { state: { ...state, items }, removedCurrent: false };
    const index = items.length ? Math.min(state.index, items.length - 1) : 0;
    return { state: { ...state, items, index }, removedCurrent: true };
}

/** Перенос записи; играющий трек остаётся тем же, номер подстраивается */
export function moveItem(state: QueueState, from: number, to: number): QueueState {
    const { items } = state;
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return state;
    const playing = items[state.index];
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...state, items: next, index: Math.max(0, next.indexOf(playing)) };
}

export function upcoming(state: QueueState): QueueItem[] {
    return state.items.slice(state.index + 1);
}

export function nextRepeat(mode: RepeatMode): RepeatMode {
    return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}
