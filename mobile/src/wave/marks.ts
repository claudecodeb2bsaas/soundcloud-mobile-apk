import type { WaveTrack } from '../core/waveTypes';

// Отметки волны: «Не нравится» (трек) и «Скрыть артиста». Хранятся только на телефоне: у SoundCloud дизлайка нет,
// как и на desktop, это местный запрет для подбора. Мини-хранилище строкой, чтобы проверять без устройства.

export interface TextStore {
    get(): string | null;
    set(value: string): void;
}

/** id → подпись для списка в настройках (этап 8) */
export interface MarksData {
    tracks: Record<number, string>;
    artists: Record<number, string>;
}

export interface Marks {
    /** Снимок меняется при каждой правке: для useSyncExternalStore */
    getSnapshot(): MarksData;
    subscribe(listener: () => void): () => void;
    /** true, если после вызова трек в «Не нравится» */
    toggleTrack(track: WaveTrack): boolean;
    toggleArtist(id: number, name: string): boolean;
    hasTrack(id: number): boolean;
    hasArtist(id: number): boolean;
}

function parse(text: string | null): MarksData {
    const empty: MarksData = { tracks: {}, artists: {} };
    if (!text) return empty;
    try {
        const raw = JSON.parse(text) as Partial<Record<keyof MarksData, unknown>> | null;
        const clean = (value: unknown): Record<number, string> => {
            const out: Record<number, string> = {};
            if (value && typeof value === 'object')
                for (const [key, label] of Object.entries(value)) if (Number(key) > 0 && typeof label === 'string') out[Number(key)] = label.slice(0, 200);
            return out;
        };
        return { tracks: clean(raw?.tracks), artists: clean(raw?.artists) };
    } catch {
        return empty;
    }
}

export function createMarks(store: TextStore): Marks {
    let data = parse(store.get());
    const listeners = new Set<() => void>();

    function change(next: MarksData): void {
        data = next;
        try {
            store.set(JSON.stringify(data));
        } catch (error) {
            console.warn('Отметки волны не сохранены', error);
        }
        for (const listener of [...listeners]) listener();
    }

    function toggle(kind: keyof MarksData, id: number, label: string): boolean {
        const map = { ...data[kind] };
        const on = !(id in map);
        if (on) map[id] = label;
        else delete map[id];
        change({ ...data, [kind]: map });
        return on;
    }

    return {
        getSnapshot: () => data,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        toggleTrack: (track) => toggle('tracks', track.id, `${track.user?.username ?? ''} — ${track.title ?? ''}`.trim()),
        toggleArtist: (id, name) => toggle('artists', id, name),
        hasTrack: (id) => id in data.tracks,
        hasArtist: (id) => id in data.artists,
    };
}
