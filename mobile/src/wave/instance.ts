import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { Query } from '../api/client';
import type { EndpointName, PathParams } from '../api/endpoints';
import { playlistOf, tracksOf } from '../api/soundcloud';
import { auth } from '../auth/instance';
import { installSources } from '../core/wave/sources';
import { WAVE_TEXTS } from '../core/waveTexts';
import type { WaveTrack } from '../core/waveTypes';
import { player } from '../player/instance';
import { expoDb } from '../store/db';
import { createHistory } from '../store/history';
import { createWave, type WaveApi } from './engine';
import { createLibrary, type LibraryView } from './library';
import { createLikes } from './likes';
import { createMarks } from './marks';
import { createWaveSession, type WaveSessionState } from './session';
import { createTaste, tasteLibraryOf } from './taste';
import { createTracker } from './tracker';

// Один набор на приложение: история в SQLite, вкус, отметки, лайки, волна, «Моя музыка», запись прослушиваний

const DAY = 86400000;
const kv = (key: string) => ({
    get: () => Storage.getItemSync(key),
    set: (value: string) => Storage.setItemSync(key, value),
});
const userId = (): number | null => auth.getState().session?.user.id ?? null;

// Раздел подборок SoundCloud и соседей хранит кэш в localStorage, которого в Hermes нет
const shim = globalThis as unknown as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
shim.localStorage ??= { getItem: (key) => Storage.getItemSync(key), setItem: (key, value) => Storage.setItemSync(key, value) };

export const history = createHistory(expoDb);

export const taste = createTaste({
    history,
    library: (user) => tasteLibraryOf(auth.sc, user),
});

export const marks = createMarks(kv('wave.marks.v1'), (change) => {
    const user = userId();
    if (!user) return;
    const at = Date.now();
    const kind = change.kind;
    const done = change.on
        ? history.setMark(user, {
            kind, id: change.id, at, artist: kind === 'artist' ? change.id : change.track?.user_id ?? change.track?.user?.id ?? 0,
            genre: change.track?.genre ?? '', tags: change.track?.tag_list ?? '', title: change.track?.title ?? '', name: change.name,
        })
        : history.removeMark(user, kind, change.id);
    void done.then(() => taste.invalidate(user), (error: unknown) => console.warn('Отметка не записана', error));
});

export const likes = createLikes({ sc: auth.sc, userId });

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

const excluded = () => {
    const data = marks.getSnapshot();
    return { tracks: new Set(Object.keys(data.tracks).map(Number)), artists: new Set(Object.keys(data.artists).map(Number)) };
};

export const wave = createWaveSession({
    player,
    texts: WAVE_TEXTS.ru,
    settings: kv('wave.settings.v1'),
    createWave: (settings, seed) =>
        createWave(api, { mode: settings.mode, genre: settings.genre, preset: settings.preset || null, seed, excluded }),
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

// Запись прослушиваний: ранние пропуски учат идущую волну, всё остальное идёт во вкус через журнал
const tracker = createTracker({
    player,
    user: userId,
    record: (user, play) => history.add(user, play),
    onPlay: (play, item) => {
        if (item.meta?.source.startsWith('wave:') && play.end === 'skip' && play.endedBy === 'user' && play.heard < 30000) wave.feedback(item.track, -1);
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

// Выход из аккаунта останавливает волну и забывает лайки; вход подгружает лайки для сердечек
let signedIn = false;
auth.subscribe(() => {
    const now = auth.getState().status === 'in';
    if (signedIn && !now) {
        wave.stop();
        likes.reset();
        taste.invalidate();
    }
    if (!signedIn && now) void likes.load().catch(() => undefined);
    signedIn = now;
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
