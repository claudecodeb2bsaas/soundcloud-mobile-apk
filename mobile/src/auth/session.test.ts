import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import { cleanToken, clearSession, loadSession, parseLoginMessage, parseSession, saveSession, validToken, verifyToken, type KeyValueStore, type Session } from './session';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};

const session: Session = { token: '2-293950-123456-AbCdEf', clientId: 'AbCdEfGh12345678', user: { id: 1, username: 'u', permalink: 'u', avatarUrl: null }, savedAt: 5 };

describe('токен', () => {
  it('validToken и cleanToken', () => {
    expect(validToken('2-293950-123456-AbCdEf')).toBe(true);
    expect(validToken('short')).toBe(false);
    expect(validToken('с пробелом 1234567890')).toBe(false);
    expect(validToken(5)).toBe(false);
    expect(cleanToken('  OAuth 2-293950-123456-AbCdEf ')).toBe('2-293950-123456-AbCdEf');
    expect(cleanToken('"2-293950-123456-AbCdEf"')).toBe('2-293950-123456-AbCdEf');
    expect(cleanToken('oauth')).toBeNull();
  });
});

describe('сообщение страницы входа', () => {
  it('принимает токен и client_id нужной формы', () => {
    expect(parseLoginMessage(JSON.stringify({ type: 'auth', token: '2-293950-123456-AbCdEf', clientId: 'AbCdEfGh12345678' }))).toEqual({ token: '2-293950-123456-AbCdEf', clientId: 'AbCdEfGh12345678' });
    expect(parseLoginMessage(JSON.stringify({ type: 'auth', token: '2-293950-123456-AbCdEf', clientId: '<script>' }))?.clientId).toBeNull();
  });

  it('отбрасывает чужое', () => {
    expect(parseLoginMessage('не json')).toBeNull();
    expect(parseLoginMessage(JSON.stringify({ type: 'other', token: '2-293950-123456-AbCdEf' }))).toBeNull();
    expect(parseLoginMessage(JSON.stringify({ type: 'auth', token: 'x' }))).toBeNull();
    expect(parseLoginMessage('null')).toBeNull();
  });
});

describe('хранение сессии', () => {
  it('сохраняет, читает и стирает', async () => {
    const store = memory();
    expect(await loadSession(store)).toBeNull();
    await saveSession(store, session);
    expect(await loadSession(store)).toEqual(session);
    await clearSession(store);
    expect(await loadSession(store)).toBeNull();
  });

  it('испорченная запись читается как её отсутствие', () => {
    expect(parseSession('{')).toBeNull();
    expect(parseSession(JSON.stringify({ token: 'x', user: { id: 1 } }))).toBeNull();
    expect(parseSession(JSON.stringify({ token: session.token, user: {} }))).toBeNull();
  });
});

describe('verifyToken', () => {
  const apiWith = (result: () => Promise<unknown>) => ({ call: result, callUrl: result, dispose: () => undefined }) as unknown as ApiClient;

  it('возвращает пользователя', async () => {
    expect(await verifyToken(apiWith(async () => ({ status: 200, body: { id: 3, username: 'x' } })))).toMatchObject({ id: 3, username: 'x' });
  });

  it('401 и 403 это негодный токен', async () => {
    expect(await verifyToken(apiWith(async () => { throw new ApiError(401, null, null); }))).toBeNull();
    expect(await verifyToken(apiWith(async () => { throw new ApiError(403, null, null); }))).toBeNull();
  });

  it('прочие сбои пробрасываются', async () => {
    await expect(verifyToken(apiWith(async () => { throw new ApiError(500, null, null); }))).rejects.toThrow();
    await expect(verifyToken(apiWith(async () => { throw new TypeError('offline'); }))).rejects.toThrow('offline');
  });
});
