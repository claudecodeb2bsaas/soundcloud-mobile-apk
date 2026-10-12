import type { WaveTrack } from '../core/waveTypes';
import { isWebhookUrl, type SettingsStore } from '../settings/settings';
import type { PlayRecord } from '../store/history';

// Вебхук: POST с описанием трека, когда прослушана заданная доля. Тело то же, что у desktop (`webhookService`).
// ponytail: шлётся при закрытии прослушивания (смена трека, остановка), а не в момент порога, как на desktop;
// для «сейчас играет» нужен таймер по плееру, добавить, если понадобится.

export interface WebhookDeps {
    settings: Pick<SettingsStore, 'getSnapshot'>;
    fetch?: typeof fetch;
    now?(): number;
}

export interface Webhook {
    /** Прослушивание закрыто; шлёт запрос, если вебхук включён, доля набрана и этот трек недавно не отправлялся */
    onPlay(play: Pick<PlayRecord, 'dur' | 'heard'>, track: WaveTrack): Promise<void>;
}

const TIMEOUT_MS = 10000;

export function createWebhook(deps: WebhookDeps): Webhook {
    const fetcher = deps.fetch ?? fetch;
    const now = deps.now ?? (() => Date.now());
    // Разрыв прослушивания (приложение ушло в фон) режет трек на части: второй кусок не должен слать повторно
    let last = { id: 0, at: 0 };
    return {
        async onPlay(play, track) {
            const { webhookEnabled, webhookUrl, webhookPercent, incognito } = deps.settings.getSnapshot();
            if (!webhookEnabled || incognito || !isWebhookUrl(webhookUrl) || play.dur <= 0) return;
            if (play.heard < (play.dur * webhookPercent) / 100) return;
            const at = now();
            if (last.id === track.id && at - last.at < play.dur + 60000) return;
            last = { id: track.id, at };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            try {
                const response = await fetcher(webhookUrl, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        timestamp: new Date(at).toISOString(),
                        artist: track.user?.username ?? '',
                        track: track.title ?? '',
                        duration: Math.round(play.dur / 1000),
                        originUrl: track.permalink_url ?? '',
                        trackArt: track.artwork_url ?? '',
                    }),
                });
                if (!response.ok) console.warn('Вебхук: адрес ответил HTTP', response.status);
            } catch (error) {
                // Адрес не пишем: в нём бывают ключи
                console.warn('Вебхук: запрос не отправлен', error instanceof Error ? error.name : 'Error');
            } finally {
                clearTimeout(timer);
            }
        },
    };
}
