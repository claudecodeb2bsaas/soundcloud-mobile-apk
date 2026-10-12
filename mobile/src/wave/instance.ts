import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { auth } from '../auth/instance';
import { WAVE_TEXTS } from '../core/waveTexts';
import { player } from '../player/instance';
import { createWave, type WaveApi } from './engine';
import { createLikes } from './likes';
import { createMarks } from './marks';
import { createWaveSession, type WaveSessionState } from './session';

// Одна волна, одни лайки и одни отметки на приложение

const kv = (key: string) => ({
    get: () => Storage.getItemSync(key),
    set: (value: string) => Storage.setItemSync(key, value),
});

export const marks = createMarks(kv('wave.marks.v1'));

export const likes = createLikes({
    sc: auth.sc,
    userId: () => auth.getState().session?.user.id ?? null,
});

const api: WaveApi = {
    history: () => auth.sc.history(200),
    likes: async () => {
        const page = await auth.sc.likedIds({ limit: 200 });
        return { ids: page.items, tracks: await auth.sc.tracksByIds(page.items.slice(0, 50)) };
    },
    related: (id) => auth.sc.relatedTracks(id),
    artistTop: (id) => auth.sc.userToptracks(id),
    genrePage: (source, tag, query) => auth.sc.genrePage(source, tag, query),
};

export const wave = createWaveSession({
    player,
    texts: WAVE_TEXTS.ru,
    settings: kv('wave.settings.v1'),
    createWave: (settings, seed) =>
        createWave(api, {
            mode: settings.mode,
            genre: settings.genre,
            seed,
            excluded: () => {
                const data = marks.getSnapshot();
                return { tracks: new Set(Object.keys(data.tracks).map(Number)), artists: new Set(Object.keys(data.artists).map(Number)) };
            },
        }),
});

// Выход из аккаунта останавливает волну и забывает лайки; вход подгружает лайки для сердечек
let signedIn = false;
auth.subscribe(() => {
    const now = auth.getState().status === 'in';
    if (signedIn && !now) {
        wave.stop();
        likes.reset();
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
