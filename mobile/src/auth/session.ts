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
