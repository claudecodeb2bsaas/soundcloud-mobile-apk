import type { WaveTrack } from '../core/waveTypes';
import { trackArtist } from '../core/wavePicks';
import type { PlayerController } from '../player/controller';
import { currentItem, type QueueItem } from '../player/queue';
import { HEARD_MIN_MS } from '../core/historyTypes';
import type { PlayRecord } from '../store/history';

// Журнал прослушиваний: следит за плеером и пишет, сколько каждого трека слышали и чем оно кончилось. На desktop то же
// делает страница сайта (beginPlay/finishPlay), здесь вывод из состояния плеера: смена играющей записи закрывает
// прошлую. «Дослушал» это конец в последние 3 секунды трека, остальное смена человеком (пропуск).

export interface TrackerDeps {
    player: Pick<PlayerController, 'getState' | 'subscribe' | 'getProgress'>;
    user(): number | null;
    record(user: number, play: PlayRecord): void | Promise<void>;
    /** Прослушивание записано: волна учится на ранних пропусках и дослушиваниях */
    onPlay?(play: PlayRecord, item: QueueItem): void;
    now?(): number;
}

export interface Tracker {
    /** Лайк поставлен во время прослушивания: сигнал вкуса сильнее обычного дослушивания */
    noteLike(trackId: number): void;
    /** Закрывает играющую запись как «остановлена» (приложение уходит в фон) и продолжает считать дальше */
    flush(): void;
}

const END_WINDOW_S = 3;

const durationMs = (track: WaveTrack): number => (track.full_duration ?? track.duration) || 0;

export function createTracker(deps: TrackerDeps): Tracker {
    const now = deps.now ?? (() => Date.now());
    let cur: { item: QueueItem; startedAt: number; heard: number; since: number | null; liked: boolean } | null = null;

    function finish(end: PlayRecord['end'], endedBy?: PlayRecord['endedBy']): void {
        if (!cur) return;
        const { item } = cur;
        const at = now();
        const heard = cur.heard + (cur.since === null ? 0 : at - cur.since);
        const play = cur;
        cur = null;
        const user = deps.user();
        // Меньше секунды звука (смена с порога, недоступный трек) не сигнал и в журнал не идёт
        if (!user || heard < HEARD_MIN_MS) return;
        const track = item.track;
        const record: PlayRecord = {
            at: play.startedAt, id: track.id, artist: trackArtist(track), dur: durationMs(track), heard, covered: null, end, endedBy,
            source: item.meta?.source ?? 'app', why: item.meta?.why, origin: item.meta?.origin, preset: item.meta?.preset,
            likedNow: play.liked, picked: !item.meta?.source.startsWith('wave:'),
            genre: track.genre ?? '', tags: track.tag_list ?? '', title: track.title ?? '', artistName: track.user?.username ?? '',
            path: track.permalink_url?.replace('https://soundcloud.com', '') ?? '', artwork: track.artwork_url ?? '',
        };
        try {
            void Promise.resolve(deps.record(user, record)).catch((error: unknown) => console.warn('Прослушивание не записано', error));
        } catch (error) {
            console.warn('Прослушивание не записано', error);
        }
        deps.onPlay?.(record, item);
    }

    const nearEnd = (item: QueueItem): boolean => {
        const { position, duration } = deps.player.getProgress();
        const total = duration > 0 ? duration : durationMs(item.track) / 1000;
        return total > 0 && position >= total - END_WINDOW_S;
    };

    deps.player.subscribe(() => {
        const state = deps.player.getState();
        const item = currentItem(state.queue);
        const playing = state.status === 'playing';
        if (cur && (!item || item.key !== cur.item.key)) {
            // Смена записи: сам конец трека (плеер перешёл дальше сам) или пропуск; пустая очередь это остановка
            if (cur.since !== null) { cur.heard += now() - cur.since; cur.since = null; }
            if (nearEnd(cur.item)) finish('done', 'auto');
            else finish(item ? 'skip' : 'stop', item ? 'user' : undefined);
        } else if (cur && state.ended) {
            // Очередь доиграна: последняя запись дослушана, повтор начнёт новую
            if (cur.since !== null) { cur.heard += now() - cur.since; cur.since = null; }
            finish('done', 'auto');
        }
        if (item && !cur && !state.ended) cur = { item, startedAt: now(), heard: 0, since: null, liked: false };
        if (!cur) return;
        if (playing && cur.since === null) cur.since = now();
        else if (!playing && cur.since !== null) { cur.heard += now() - cur.since; cur.since = null; }
    });

    return {
        noteLike(trackId) {
            if (cur && cur.item.track.id === trackId) cur.liked = true;
        },
        flush() {
            if (!cur) return;
            const { item } = cur;
            const playing = cur.since !== null;
            finish('stop');
            // Играющая запись продолжает считаться с нуля, остальное начнётся при следующей смене
            if (playing) cur = { item, startedAt: now(), heard: 0, since: now(), liked: false };
        },
    };
}
