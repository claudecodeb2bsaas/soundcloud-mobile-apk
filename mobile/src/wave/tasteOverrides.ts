import { cleanTasteOverrides, type TasteOverrides } from '../core/tasteModel';
import type { TextStore } from './marks';
import type { TasteOverridesStore } from './taste';

// «Убрать из вкуса»: артисты и теги, которые модель вкуса не учитывает. На desktop это файл на пользователя
// (taste-overrides-<id>.json), здесь одна запись в kv-store: аккаунт → убранное. Помнит не больше 20 аккаунтов.

const USERS_MAX = 20;

export function createTasteOverrides(store: TextStore): TasteOverridesStore {
    let all: Record<string, TasteOverrides> | null = null;

    function read(): Record<string, TasteOverrides> {
        if (all) return all;
        all = {};
        try {
            const raw: unknown = JSON.parse(store.get() ?? 'null');
            if (raw && typeof raw === 'object') for (const [user, value] of Object.entries(raw)) all[user] = cleanTasteOverrides(value);
        } catch (error) {
            console.warn('Вкус волны: убранное из вкуса не прочитано', error);
        }
        return all;
    }

    return {
        get: (user) => read()[String(user)] ?? { artists: [], tags: [] },

        set(user, kind, key, removed) {
            // Годится ли ключ, решает та же проверка, что и у файла: id аккаунта или нормализованный тег
            const valid = cleanTasteOverrides(kind === 'artist' ? { artists: [key] } : { tags: [key] });
            if (!(kind === 'artist' ? valid.artists.length : valid.tags.length)) return false;
            const current = read()[String(user)] ?? { artists: [], tags: [] };
            const next = kind === 'artist'
                ? { ...current, artists: removed ? [key as number, ...current.artists.filter((id) => id !== key)] : current.artists.filter((id) => id !== key) }
                : { ...current, tags: removed ? [key as string, ...current.tags.filter((tag) => tag !== key)] : current.tags.filter((tag) => tag !== key) };
            const users = Object.entries({ ...read(), [String(user)]: cleanTasteOverrides(next) }).slice(-USERS_MAX);
            try {
                store.set(JSON.stringify(Object.fromEntries(users)));
            } catch (error) {
                console.warn('Вкус волны: убранное из вкуса не записано', error);
                return false;
            }
            all = Object.fromEntries(users);
            return true;
        },
    };
}
