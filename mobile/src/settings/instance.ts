import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { createSettings, type Settings } from './settings';

export const SETTINGS_KEY = 'app.settings.v1';

export const settings = createSettings({
    get: () => Storage.getItemSync(SETTINGS_KEY),
    set: (value) => Storage.setItemSync(SETTINGS_KEY, value),
});

export function useSettings(): Settings {
    return useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
}
