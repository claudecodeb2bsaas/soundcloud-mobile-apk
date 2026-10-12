import { describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import type { KeyValueStore } from './session';

const TOKEN = '2-293950-123456-AbCdEf';
const CID = 'AbCdEfGh12345678AbCdEfGh12345678';
const PAGE = `{"hydratable":"apiClient","data":{"id":"${CID}","isExpiring":false}}`;

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};

/** Поддельный сайт: страница с client_id и /me, который признаёт только TOKEN */
function site(options: { me?: number } = {}) {
  const log: string[] = [];
  const fake = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    log.push(url.host + url.pathname);
    if (url.host === 'soundcloud.com') return new Response(PAGE, { status: 200 });
    const headers = init?.headers as Record<string, string>;
    if (url.pathname === '/me') {
      if (options.me) return new Response('', { status: options.me });
      return headers.Authorization === `OAuth ${TOKEN}` && url.searchParams.get('client_id') === CID
        ? new Response(JSON.stringify({ id: 77, username: 'dj', permalink: 'dj', avatar_url: null }), { status: 200 })
        : new Response('', { status: 401 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fake, log };
}

describe('вход', () => {
  it('без сохранённой сессии состояние «вышел»', async () => {
    const auth = createAuth({ store: memory(), fetch: site().fake });
    expect(auth.getState().status).toBe('loading');
    await auth.init();
    expect(auth.getState()).toEqual({ status: 'out', session: null });
  });

  it('вход по токену ищет client_id, проверяет /me и сохраняет сессию', async () => {
    const store = memory();
    const { fake, log } = site();
    const auth = createAuth({ store, fetch: fake, now: () => 1000 });
    let notified = 0;
    auth.subscribe(() => notified++);
    await auth.signInWithToken(TOKEN);
    const state = auth.getState();
    expect(state.status).toBe('in');
    expect(state.session).toMatchObject({ token: TOKEN, clientId: CID, savedAt: 1000, user: { id: 77, username: 'dj' } });
    expect(log).toEqual(['soundcloud.com/', 'api-v2.soundcloud.com/me']);
    expect(notified).toBeGreaterThan(0);

    // Новый запуск приложения: сессия читается без сети
    const again = createAuth({ store, fetch: (async () => { throw new Error('сеть не нужна'); }) as unknown as typeof fetch });
    await again.init();
    expect(again.getState().session?.user.id).toBe(77);
  });

  it('client_id от страницы входа не ищется заново', async () => {
    const { fake, log } = site();
    const auth = createAuth({ store: memory(), fetch: fake });
    await auth.signInWithToken(TOKEN, CID);
    expect(log).toEqual(['api-v2.soundcloud.com/me']);
  });

  it('негодный токен: ошибка, состояние и хранилище не меняются', async () => {
    const store = memory();
    const auth = createAuth({ store, fetch: site().fake });
    await auth.init();
    await expect(auth.signInWithToken('2-000000-000000-WrongToken')).rejects.toThrow(/не принял/);
    expect(auth.getState().status).toBe('out');
    expect(await store.get('sc.session.v1')).toBeNull();
    await expect(auth.signInWithToken('x')).rejects.toThrow(/неверно/);
  });

  it('сбой сервера на /me не выдаётся за негодный токен', async () => {
    const auth = createAuth({ store: memory(), fetch: site({ me: 500 }).fake });
    await expect(auth.signInWithToken(TOKEN, CID)).rejects.toMatchObject({ status: 500 });
    expect(auth.getState().status).not.toBe('in');
  });

  it('выход стирает сессию', async () => {
    const store = memory();
    const auth = createAuth({ store, fetch: site().fake });
    await auth.signInWithToken(TOKEN);
    await auth.signOut();
    expect(auth.getState()).toEqual({ status: 'out', session: null });
    expect(await store.get('sc.session.v1')).toBeNull();
  });
});
