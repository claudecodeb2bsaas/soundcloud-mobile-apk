import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { auth } from '../auth/instance';
import { createPlayerController, type PlayerState, type Progress } from './controller';
import { createExpoEngine } from './expoEngine';
import type { SessionStore } from './session';
import { createStreamResolver } from './stream';

const SESSION_KEY = 'player.session.v1';

const session: SessionStore = {
    load: () => Storage.getItem(SESSION_KEY),
    save: (snapshot) => Storage.setItem(SESSION_KEY, JSON.stringify(snapshot)),
};

// Один плеер на приложение
export const player = createPlayerController({
    engine: createExpoEngine(),
    resolver: createStreamResolver(auth.api, auth.sc),
    session,
});

// Выход из аккаунта останавливает звук и стирает сохранённую очередь
let signedIn = false;
auth.subscribe(() => {
    const now = auth.getState().status === 'in';
    if (signedIn && !now) {
        player.clear();
        void Storage.removeItem(SESSION_KEY);
    }
    signedIn = now;
});

export function usePlayerState(): PlayerState {
    return useSyncExternalStore(player.subscribe, player.getState, player.getState);
}

export function useProgress(): Progress {
    return useSyncExternalStore(player.subscribeProgress, player.getProgress, player.getProgress);
}
