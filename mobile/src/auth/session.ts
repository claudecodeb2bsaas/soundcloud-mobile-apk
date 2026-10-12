import type { ApiClient } from '../api/client';
import { createSoundCloud, type Me } from '../api/soundcloud';

export interface Session {
    token: string;
    clientId: string | null;
    user: Me;
    savedAt: number;
}

export interface KeyValueStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

const KEY = 'sc.session.v1';
// Токены вида 2-293950-123456-AbCdEf: буквы, цифры и пара знаков
const TOKEN = /^[A-Za-z0-9._~-]{10,200}$/;
const CLIENT_ID = /^[A-Za-z0-9]{16,64}$/;

export function validToken(value: unknown): value is string {
    return typeof value === 'string' && TOKEN.test(value);
}

/** Токен из текста, который вставил человек: с приставкой «OAuth » или без, в кавычках или без */
export function cleanToken(raw: string): string | null {
    const value = raw.trim().replace(/^["']|["']$/g, '').replace(/^OAuth\s+/i, '').trim();
    return validToken(value) ? value : null;
}

export interface LoginMessage {
    token: string;
    clientId: string | null;
}

/** Сообщение страницы входа недоверенное: берём только токен и client_id нужной формы */
export function parseLoginMessage(raw: string): LoginMessage | null {
    try {
        const value = JSON.parse(raw) as { type?: unknown; token?: unknown; clientId?: unknown } | null;
        if (!value || value.type !== 'auth' || !validToken(value.token)) return null;
        const clientId = typeof value.clientId === 'string' && CLIENT_ID.test(value.clientId) ? value.clientId : null;
        return { token: value.token, clientId };
    } catch {
        return null;
    }
}

export function parseSession(raw: string | null): Session | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<Session> | null;
        const user = value?.user;
        if (!value || !validToken(value.token) || !user || typeof user.id !== 'number') return null;
        return {
            token: value.token,
            clientId: typeof value.clientId === 'string' && CLIENT_ID.test(value.clientId) ? value.clientId : null,
            user: { id: user.id, username: user.username ?? '', permalink: user.permalink ?? '', avatarUrl: user.avatarUrl ?? null },
            savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
        };
    } catch {
        return null;
    }
}

export async function loadSession(store: KeyValueStore): Promise<Session | null> {
    return parseSession(await store.get(KEY));
}

export async function saveSession(store: KeyValueStore, session: Session): Promise<void> {
    await store.set(KEY, JSON.stringify(session));
}

export async function clearSession(store: KeyValueStore): Promise<void> {
    await store.remove(KEY);
}

// Сохранённые аккаунты: у каждого своя запись (значения SecureStore небольшие), номера лежат в списке. Активный
// вход по-прежнему в KEY, список нужен только для переключения.
export const MAX_ACCOUNTS = 5;
const INDEX = 'sc.accounts.v1';
const accountKey = (id: number): string => `sc.account.${id}`;

async function accountIds(store: KeyValueStore): Promise<number[]> {
    try {
        const raw = JSON.parse((await store.get(INDEX)) ?? '[]') as unknown;
        return Array.isArray(raw) ? raw.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, MAX_ACCOUNTS) : [];
    } catch {
        return [];
    }
}

export async function loadAccounts(store: KeyValueStore): Promise<Session[]> {
    const found: Session[] = [];
    for (const id of await accountIds(store)) {
        const session = parseSession(await store.get(accountKey(id)));
        if (session && session.user.id === id) found.push(session);
    }
    return found;
}

/** Новый аккаунт сверх предела не сохраняется: ошибка, список не меняется */
export async function saveAccount(store: KeyValueStore, session: Session): Promise<void> {
    const ids = await accountIds(store);
    const id = session.user.id;
    if (!ids.includes(id)) {
        if (ids.length >= MAX_ACCOUNTS) throw new Error(`Не больше ${MAX_ACCOUNTS} аккаунтов: выйди из одного из них`);
        await store.set(INDEX, JSON.stringify([...ids, id]));
    }
    await store.set(accountKey(id), JSON.stringify(session));
}

export async function removeAccount(store: KeyValueStore, id: number): Promise<void> {
    await store.set(INDEX, JSON.stringify((await accountIds(store)).filter((item) => item !== id)));
    await store.remove(accountKey(id));
}

/**
 * Проверка токена запросом /me. Отказ входа (401, 403) значит, что токен негодный: возвращается null.
 * Прочие сбои (сеть, 429, сервер) пробрасываются: токен мог быть хорошим, решать вызывающему.
 * api уже должен отдавать этот токен в auth().
 */
export async function verifyToken(api: ApiClient): Promise<Me | null> {
    try {
        return await createSoundCloud(api).me();
    } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        if (status === 401 || status === 403) return null;
        throw error;
    }
}
