import type { WaveTrack } from '../core/waveTypes';
import type { WaveSeed } from './engine';

// Набор из меню трека (до 5 треков): волна идёт по похожему на все сразу, сами треки набора не играют. Как и на desktop,
// набор очищается после запуска. В памяти приложения: после перезапуска набор пуст (desktop хранит его до закрытия клиента)

export const PICKS_MAX = 5;

export interface Picks {
    getSnapshot(): readonly WaveTrack[];
    subscribe(listener: () => void): () => void;
    has(id: number): boolean;
    /** 'full', если набор уже из PICKS_MAX */
    toggle(track: WaveTrack): 'added' | 'removed' | 'full';
    clear(): void;
    /** Волна по набору; набор после этого пуст. null, если набор пуст */
    take(): Extract<WaveSeed, { kind: 'library' }> | null;
}

export function createPicks(): Picks {
    let list: readonly WaveTrack[] = [];
    const listeners = new Set<() => void>();
    const set = (next: readonly WaveTrack[]): void => {
        list = next;
        for (const listener of [...listeners]) listener();
    };
    return {
        getSnapshot: () => list,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        has: (id) => list.some((track) => track.id === id),
        toggle(track) {
            if (list.some((item) => item.id === track.id)) {
                set(list.filter((item) => item.id !== track.id));
                return 'removed';
            }
            if (list.length >= PICKS_MAX) return 'full';
            set([...list, track]);
            return 'added';
        },
        clear: () => set([]),
        take() {
            if (!list.length) return null;
            const tracks = list;
            set([]);
            const titles = tracks.map((track) => (track.title ?? '').trim()).filter(Boolean);
            const title = titles.length > 2 ? titles.slice(0, 2).join(', ') + ' +' + (titles.length - 2) : titles.join(', ');
            return { kind: 'library', title: title || '…', order: 'fixed', own: [], seeds: tracks.slice() };
        },
    };
}
