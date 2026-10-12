import { useSyncExternalStore } from 'react';
import { createAuth, type AuthState } from './auth';
import { secureStore } from './secureStore';

// Один вход на приложение. Экраны читают его через useAuth, запросы идут через auth.api и auth.sc
export const auth = createAuth({ store: secureStore });

export function useAuth(): AuthState {
    return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}
