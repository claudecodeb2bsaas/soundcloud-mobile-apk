import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { auth } from '../auth/instance';
import { createPlayerController, type MediaAction, type PlayerState, type Progress } from './controller';
import { createExpoEngine } from './expoEngine';
import type { SessionStore } from './session';
import { createStreamResolver } from './stream';

const SESSION_KEY = 'player.session.v1';

const session: SessionStore = {
    load: () => Storage.getItem(SESSION_KEY),
    save: (snapshot) => Storage.setItem(SESSION_KEY, JSON.stringify(snapshot)),
};

const engine = createExpoEngine();

/** Кнопки шторки Android: назад, вперёд, лайк, дизлайк */
export const onMediaControl = (listener: (action: MediaAction) => void): (() => void) => engine.onControl?.(listener) ?? (() => undefined);

// Один плеер на приложение
export const player = createPlayerController({
    engine,
    resolver: createStreamResolver(auth.api, auth.sc),
    session,
});

// Выход из аккаунта останавливает звук и стирает сохранённую очередь
let signedAs: number | null = null;
auth.subscribe(() => {
    const now = auth.getState().session?.user.id ?? null;
    if (now === signedAs) return;
    // Выход или переключение на другой аккаунт: очередь прежнего не остаётся
    if (signedAs !== null) {
        player.clear();
        void Storage.removeItem(SESSION_KEY);
    }
    signedAs = now;
});

export function usePlayerState(): PlayerState {
    return useSyncExternalStore(player.subscribe, player.getState, player.getState);
}

export function useProgress(): Progress {
    return useSyncExternalStore(player.subscribeProgress, player.getProgress, player.getProgress);
}
