import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './session';

// Токен лежит в хранилище ключей Android (Keystore), а не в обычных файлах приложения
export const secureStore: KeyValueStore = {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
};
