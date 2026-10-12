import type { WaveTrack } from '../core/waveTypes';
import { emptyQueue, makeItem, replaceQueue, type QueueItem, type QueueState, type RepeatMode } from './queue';

// Сохранённая сессия плеера: очередь, играющий трек, место в нём и повтор. Адреса потоков не хранятся: они подписаны
// и протухают, при продолжении трек догружается заново.

export interface SessionSnapshot {
    version: 1;
    at: number;
    index: number;
    /** Место в играющем треке, секунды */
    position: number;
    repeat: RepeatMode;
    items: Array<{ track: WaveTrack; reason?: string }>;
}

export interface SessionStore {
    load(): Promise<unknown>;
    save(snapshot: SessionSnapshot): Promise<void>;
}

const LIMIT = 500;

/** Поля трека, нужные экранам и волне. Без media и track_authorization: они устаревают за часы */
export function compactTrack(track: WaveTrack): WaveTrack {
    const out: WaveTrack = { id: track.id, kind: track.kind ?? 'track' };
    const keep: Array<keyof WaveTrack> = [
        'title', 'genre', 'tag_list', 'user_id', 'permalink_url', 'artwork_url', 'policy', 'streamable', 'duration', 'full_duration',
        'created_at', 'display_date', 'release_date', 'likes_count', 'playback_count', 'publisher_metadata',
    ];
    for (const key of keep) if (track[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = track[key];
    if (track.user) out.user = { id: track.user.id, username: track.user.username, avatar_url: track.user.avatar_url, permalink_url: track.user.permalink_url };
    return out;
}

export function makeSnapshot(queue: QueueState, position: number, now: number): SessionSnapshot {
    // Окно вокруг играющего трека, если очередь огромна
    const start = queue.items.length > LIMIT ? Math.max(0, Math.min(queue.index - 50, queue.items.length - LIMIT)) : 0;
    const items = queue.items.slice(start, start + LIMIT).map((item) => (item.reason ? { track: compactTrack(item.track), reason: item.reason } : { track: compactTrack(item.track) }));
    return { version: 1, at: now, index: queue.index - start, position: Math.max(0, position), repeat: queue.repeat, items };
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Запись из хранилища недоверенная: проверяем форму, лишнее отбрасываем */
export function parseSnapshot(raw: unknown): SessionSnapshot | null {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    if (!source || source.version !== 1 || !Array.isArray(source.items)) return null;
    const items: SessionSnapshot['items'] = [];
    for (const entry of source.items.slice(0, LIMIT)) {
        const item = entry && typeof entry === 'object' ? (entry as { track?: unknown; reason?: unknown }) : null;
        const track = item?.track && typeof item.track === 'object' ? (item.track as WaveTrack) : null;
        if (!track || !isId(track.id)) continue;
        items.push(typeof item?.reason === 'string' ? { track, reason: item.reason } : { track });
    }
    if (!items.length) return null;
    const repeat = source.repeat === 'all' || source.repeat === 'one' ? source.repeat : 'off';
    const index = typeof source.index === 'number' && Number.isInteger(source.index) ? Math.min(Math.max(0, source.index), items.length - 1) : 0;
    const position = typeof source.position === 'number' && Number.isFinite(source.position) && source.position > 0 ? source.position : 0;
    return { version: 1, at: typeof source.at === 'number' ? source.at : 0, index, position, repeat, items };
}

export function queueOf(snapshot: SessionSnapshot): QueueState {
    const items: QueueItem[] = snapshot.items.map((entry) => makeItem(entry.track, entry.reason));
    return replaceQueue(emptyQueue(snapshot.repeat), items, snapshot.index);
}
