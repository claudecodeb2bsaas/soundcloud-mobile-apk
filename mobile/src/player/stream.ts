import type { ApiClient } from '../api/client';
import type { SoundCloud } from '../api/soundcloud';
import type { WaveTrack } from '../core/waveTypes';

// Выбор потока трека. Сверено 12.10.2026 на живом API: у обычных треков есть progressive mp3, hls mp3 и hls AAC, всё с
// Range и подписанными адресами cf-media.sndcdn.com. У треков с шифрованным AAC (cbc/ctr-encrypted-hls, обычно лейблы)
// открытые mp3 из списка отдают 404, играть их можно только через Widevine: такие треки помечаются недоступными.

export interface Transcoding {
    url?: string;
    snipped?: boolean;
    format?: { protocol?: string; mime_type?: string };
}

export interface StreamTrack extends WaveTrack {
    track_authorization?: string;
    media?: { transcodings?: Array<Transcoding | null> } | null;
}

export type StreamKind = 'progressive' | 'hls-mp3' | 'hls-aac';

export interface StreamCandidate {
    kind: StreamKind;
    /** Ссылка API на выдачу потока, без ключей: ключи подставит клиент */
    url: string;
    /** Отрывок Go+ (30 секунд), а не весь трек */
    preview: boolean;
}

export interface ResolvedStream {
    url: string;
    kind: StreamKind;
    preview: boolean;
}

export type UnavailableReason = 'blocked' | 'protected' | 'no-stream';

export class StreamUnavailableError extends Error {
    readonly reason: UnavailableReason;
    constructor(reason: UnavailableReason) {
        super(`Трек недоступен: ${reason}`);
        this.name = 'StreamUnavailableError';
        this.reason = reason;
    }
}

const MEDIA_URL = /^https:\/\/api-v2\.soundcloud\.com\/media\//;
const ENCRYPTED = /^(?:cbc|ctr)-encrypted-hls$/;
const RANK: Record<StreamKind, number> = { progressive: 0, 'hls-mp3': 1, 'hls-aac': 2 };

function transcodings(track: StreamTrack): Transcoding[] {
    const list = track.media?.transcodings;
    return Array.isArray(list) ? list.filter((item): item is Transcoding => !!item && typeof item === 'object') : [];
}

function kindOf(item: Transcoding): StreamKind | null {
    const protocol = item.format?.protocol;
    const mime = item.format?.mime_type ?? '';
    if (protocol === 'progressive' && /^audio\/mpeg/.test(mime)) return 'progressive';
    if (protocol === 'hls' && /^audio\/mpeg(?!url)/.test(mime)) return 'hls-mp3';
    if (protocol === 'hls' && /mp4a/.test(mime)) return 'hls-aac';
    return null;
}

/** У трека есть зашифрованный AAC: скорее всего, открытые потоки у него не отдаются */
export function isProtected(track: StreamTrack): boolean {
    return transcodings(track).some((item) => ENCRYPTED.test(item.format?.protocol ?? ''));
}

export function hasMedia(track: StreamTrack): boolean {
    return transcodings(track).length > 0 && typeof track.track_authorization === 'string' && track.track_authorization !== '';
}

/** Кандидаты по порядку предпочтения: целые треки (progressive, hls mp3, hls AAC), затем отрывки */
export function streamCandidates(track: StreamTrack): StreamCandidate[] {
    const out: StreamCandidate[] = [];
    for (const item of transcodings(track)) {
        const kind = kindOf(item);
        if (!kind || typeof item.url !== 'string' || !MEDIA_URL.test(item.url)) continue;
        out.push({ kind, url: item.url, preview: item.snipped === true });
    }
    return out.sort((a, b) => Number(a.preview) - Number(b.preview) || RANK[a.kind] - RANK[b.kind]);
}

function statusOf(error: unknown): number {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : 0;
}

/**
 * Выдача потока по кандидатам. 404, 410 и 403 уводят к следующему кандидату (адрес протух, формат закрыт, страна),
 * 401, 429, тайм-аут и сеть пробрасываются как есть: это не вина трека. Без рабочего потока StreamUnavailableError.
 */
export async function resolveStream(api: ApiClient, track: StreamTrack): Promise<ResolvedStream> {
    if (track.policy === 'BLOCK') throw new StreamUnavailableError('blocked');
    const auth = track.track_authorization;
    if (typeof auth !== 'string' || !auth) throw new StreamUnavailableError('no-stream');
    for (const candidate of streamCandidates(track)) {
        const link = candidate.url + (candidate.url.includes('?') ? '&' : '?') + 'track_authorization=' + encodeURIComponent(auth);
        try {
            const { body } = await api.callUrl<{ url?: unknown }>(link);
            const url = typeof body?.url === 'string' ? body.url : '';
            if (url.startsWith('https://')) return { url, kind: candidate.kind, preview: candidate.preview };
        } catch (error) {
            const status = statusOf(error);
            if (status !== 404 && status !== 410 && status !== 403) throw error;
        }
    }
    throw new StreamUnavailableError(isProtected(track) ? 'protected' : 'no-stream');
}

export interface StreamResolver {
    /** Поток для проигрывания. Трек без данных о потоке (из сохранённой очереди) сначала догружается целиком */
    resolve(track: WaveTrack): Promise<ResolvedStream>;
}

export function createStreamResolver(api: ApiClient, sc: Pick<SoundCloud, 'tracksByIds'>): StreamResolver {
    return {
        async resolve(track) {
            let full = track as StreamTrack;
            if (!hasMedia(full)) {
                const [fresh] = await sc.tracksByIds([track.id]);
                if (!fresh) throw new StreamUnavailableError('no-stream');
                full = fresh as StreamTrack;
            }
            return resolveStream(api, full);
        },
    };
}
