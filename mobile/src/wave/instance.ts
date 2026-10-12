import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { Query } from '../api/client';
import type { EndpointName, PathParams } from '../api/endpoints';
import { playlistOf, tracksOf } from '../api/soundcloud';
import { auth } from '../auth/instance';
import { COUNTED_MS } from '../core/historyTypes';
import { installSources } from '../core/wave/sources';
import type { WaveTrack } from '../core/waveTypes';
import { player } from '../player/instance';
import { settings } from '../settings/instance';
import { createWebhook } from '../addons/webhook';
import { createWave, type WaveApi } from './engine';
import { createLibrary, type LibraryView } from './library';
import { texts } from '../settings/texts';
import { DAY, excluded, history, kv, likes, marks, radar, taste, userId } from './data';
import { createPicks } from './picks';
import { parsePresetMarks } from './presetMarks';
import { createShelf, shelfInputsOf } from './shelf';
import { createWaveSession, type WaveSessionState } from './session';
import { createTracker } from './tracker';

// Один набор на приложение: история в SQLite, вкус, отметки, лайки, волна, «Моя музыка», запись прослушиваний.
// Данные без плеера лежат в data.ts (их же берёт фоновый радар), здесь они только реэкспортируются.
export { history, likes, marks, radar, taste };

const sources = installSources({
    call: async (name, path, query) => (await auth.api.call(name as EndpointName, path as PathParams, query as Query)).body,
    backgroundCall: async (name, path, query) => (await auth.api.call(name as EndpointName, path as PathParams, query as Query, { background: true })).body,
    ensureUser: async () => userId() ?? 0,
    tracksOf,
});

/** Станция трека: системный плейлист, из него сайт берёт свой автоплей */
async function station(id: number): Promise<WaveTrack[]> {
    const info = playlistOf(await auth.sc.resolve('https://soundcloud.com/discover/sets/track-stations:' + id));
    if (!info) return [];
    const ids = info.ids.slice(0, 50);
    const full = new Map(info.tracks.map((track) => [track.id, track]));
    const missing = ids.filter((trackId) => !full.has(trackId));
    for (const track of missing.length ? await auth.sc.tracksByIds(missing) : []) full.set(track.id, track);
    return ids.flatMap((trackId) => full.get(trackId) ?? []);
}

const api: WaveApi = {
    history: () => auth.sc.history(200),
    likes: async () => {
        const page = await auth.sc.likedIds({ limit: 200 });
        return { ids: page.items, tracks: await auth.sc.tracksByIds(page.items.slice(0, 50)) };
    },
    related: (id) => auth.sc.relatedTracks(id),
    artistTop: (id) => auth.sc.userToptracks(id),
    genrePage: (source, tag, query) => auth.sc.genrePage(source, tag, query),
    taste: async () => {
        const user = userId();
        return user ? taste.maps(user) : null;
    },
    station,
    recentDone: async () => {
        const user = userId();
        return user ? history.recentDone(user, Date.now() - DAY / 24) : [];
    },
    sources,
};

// Отметки пресетов: ранние пропуски внутри настроения, переживают перезапуск
const moods = kv('wave.moods.v1');
let presetMarks = parsePresetMarks(moods.get());

export const wave = createWaveSession({
    player,
    texts,
    settings: kv('wave.settings.v1'),
    createWave: (settings, seed) =>
        createWave(api, {
            mode: settings.mode, genre: settings.genre, preset: settings.preset || null, seed, excluded, presetMarks,
            onPresetMarks: (next) => {
                presetMarks = next;
                try {
                    moods.set(JSON.stringify(next));
                } catch (error) {
                    console.warn('Волна: отметка пресета не сохранена', error);
                }
            },
        }),
});

export const library = createLibrary({
    sc: auth.sc,
    userId,
    excluded,
    settings: kv('wave.library.v1'),
    // Слышанное за 3 дня: журнал телефона и история сайта (туда попадает и звук с других устройств)
    heard: async () => {
        const user = userId();
        const ids = new Set<number>();
        if (user) for (const id of await history.heardIds(user, Date.now() - 3 * DAY).catch(() => [])) ids.add(id);
        for (const track of await auth.sc.history(200).catch(() => [] as WaveTrack[])) ids.add(track.id);
        return ids;
    },
});

// Подборки дня и набор из меню трека
export const shelf = createShelf({
    userId,
    likedTracks: () => auth.sc.likedTracks(1000),
    history: () => auth.sc.history(200),
    inputs: async (user) => shelfInputsOf(await history.tastePlays(user, Date.now() - 365 * DAY), Date.now()),
    taste: async () => {
        const user = userId();
        return user ? taste.maps(user) : null;
    },
    related: (id) => auth.sc.relatedTracks(id),
    sources,
    excluded,
    store: kv('wave.shelf.v1'),
    texts,
});

export const picks = createPicks();

export function usePicks(): readonly WaveTrack[] {
    return useSyncExternalStore(picks.subscribe, picks.getSnapshot, picks.getSnapshot);
}

const webhook = createWebhook({ settings });

// Запись прослушиваний: ранние пропуски учат идущую волну, всё остальное идёт во вкус через журнал.
// Инкогнито: журнал и вкус не трогаются, волна учится в рамках сессии как обычно.
const tracker = createTracker({
    player,
    user: userId,
    incognito: () => settings.getSnapshot().incognito,
    record: (user, play) => history.add(user, play),
    onPlay: (play, item) => {
        webhook.onPlay(play, item.track);
        if (!item.meta?.source.startsWith('wave:')) return;
        // Ранний пропуск человеком учит волну (признак серии, развилка, пресет); от 30 секунд серия пропусков прервана
        if (play.end === 'skip' && play.endedBy === 'user' && play.heard < COUNTED_MS) wave.feedback(item.track, -1, play.heard);
        else if (play.heard >= COUNTED_MS) wave.listened(item.track);
    },
});
AppState.addEventListener('change', (next) => { if (next !== 'active') tracker.flush(); });

/** Лайк поставлен: сигнал вкуса, волна выше ставит похожее */
export function noteLiked(track: WaveTrack): void {
    tracker.noteLike(track.id);
    wave.feedback(track, 1);
    const user = userId();
    if (user) taste.invalidate(user);
}

// Выход и смена аккаунта останавливают волну и забывают лайки; вход подгружает лайки для сердечек
let signedAs: number | null = null;
auth.subscribe(() => {
    const now = auth.getState().session?.user.id ?? null;
    if (now === signedAs) return;
    if (signedAs !== null) {
        wave.stop();
        likes.reset();
        taste.invalidate();
    }
    if (now !== null) void likes.load().catch(() => undefined);
    signedAs = now;
});

export function useWave(): WaveSessionState {
    return useSyncExternalStore(wave.subscribe, wave.getState, wave.getState);
}

export function useLikes(): ReadonlySet<number> {
    return useSyncExternalStore(likes.subscribe, likes.getSnapshot, likes.getSnapshot);
}

export function useMarks() {
    return useSyncExternalStore(marks.subscribe, marks.getSnapshot, marks.getSnapshot);
}

export function useLibrary(): LibraryView {
    return useSyncExternalStore(library.subscribe, library.getView, library.getView);
}
