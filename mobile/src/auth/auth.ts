import { createApiClient, type ApiClient } from '../api/client';
import { fetchClientId } from '../api/clientId';
import { createSoundCloud, type SoundCloud } from '../api/soundcloud';
import { clearSession, loadAccounts, loadSession, removeAccount, saveAccount, saveSession, validToken, verifyToken, type KeyValueStore, type Session } from './session';

export type AuthState =
    | { status: 'loading'; session: null }
    | { status: 'out'; session: null }
    | { status: 'in'; session: Session };

export interface AuthOptions {
    store: KeyValueStore;
    fetch?: typeof fetch;
    now?(): number;
}

export interface Auth {
    api: ApiClient;
    sc: SoundCloud;
    getState(): AuthState;
    subscribe(listener: () => void): () => void;
    /** Читает сохранённый вход при запуске приложения; сеть не трогает, кроме поиска client_id, если его нет */
    init(): Promise<void>;
    /** Вход по токену, найденному страницей входа или вставленному вручную. Негодный токен даёт ошибку, вход не меняется */
    signInWithToken(token: string, clientId?: string | null): Promise<void>;
    /** Выход из текущего аккаунта: он забывается и в списке; остальные остаются для переключения */
    signOut(): Promise<void>;
    /** Сохранённые аккаунты (до 5), в порядке добавления */
    accounts(): Promise<Session[]>;
    /** Переход на сохранённый аккаунт; токен проверяется запросом /me. Негодный токен даёт ошибку, вход не меняется */
    switchTo(userId: number): Promise<void>;
}

export function createAuth(options: AuthOptions): Auth {
    const now = options.now ?? (() => Date.now());
    let state: AuthState = { status: 'loading', session: null };
    // Пока вход не подтверждён /me, токен живёт здесь, а не в сессии
    let current: { token: string | null; clientId: string | null } = { token: null, clientId: null };
    let refreshing: Promise<string | null> | null = null;
    const listeners = new Set<() => void>();

    const set = (next: AuthState): void => {
        state = next;
        for (const listener of [...listeners]) listener();
    };

    async function refreshClientId(): Promise<string | null> {
        // Параллельные 401 ждут один и тот же запрос страницы
        refreshing ??= fetchClientId(options.fetch)
            .then(async (id) => {
                if (id) {
                    current = { ...current, clientId: id };
                    if (state.status === 'in') {
                        const session = { ...state.session, clientId: id };
                        set({ status: 'in', session });
                        await saveSession(options.store, session);
                    }
                }
                return id;
            })
            .finally(() => {
                refreshing = null;
            });
        return refreshing;
    }

    const api = createApiClient({ auth: () => current, refreshClientId, fetch: options.fetch });
    const sc = createSoundCloud(api);

    const self: Auth = {
        api,
        sc,
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        async init() {
            const session = await loadSession(options.store);
            if (!session) {
                set({ status: 'out', session: null });
                return;
            }
            current = { token: session.token, clientId: session.clientId };
            set({ status: 'in', session });
            // Вход, сохранённый до появления списка аккаунтов, попадает в него
            await saveAccount(options.store, session).catch(() => undefined);
            if (!session.clientId) await refreshClientId().catch(() => null);
        },

        accounts: () => loadAccounts(options.store),

        async switchTo(userId) {
            const saved = (await loadAccounts(options.store)).find((account) => account.user.id === userId);
            if (!saved) throw new Error('Аккаунт не найден');
            if (state.session?.user.id === userId) return;
            await self.signInWithToken(saved.token, saved.clientId);
        },

        async signInWithToken(token, clientId = null) {
            if (!validToken(token)) throw new Error('Токен выглядит неверно');
            const previous = current;
            current = { token, clientId: clientId ?? previous.clientId };
            try {
                if (!current.clientId) await refreshClientId();
                if (!current.clientId) throw new Error('Не удалось получить ключ клиента SoundCloud. Проверь соединение.');
                const user = await verifyToken(api);
                if (!user) throw new Error('SoundCloud не принял токен');
                const session: Session = { token, clientId: current.clientId, user, savedAt: now() };
                await saveAccount(options.store, session);
                await saveSession(options.store, session);
                set({ status: 'in', session });
            } catch (error) {
                current = previous;
                throw error;
            }
        },

        async signOut() {
            const user = state.session?.user.id;
            current = { token: null, clientId: current.clientId };
            await clearSession(options.store);
            if (user) await removeAccount(options.store, user);
            set({ status: 'out', session: null });
        },
    };
    return self;
}
