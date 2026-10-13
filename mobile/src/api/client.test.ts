import { describe, expect, it } from 'vitest';
import { classifyFailure } from '../core/pageSources';
import { ApiError, createApiClient, type ApiAuth } from './client';

interface Call {
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

function setup(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>, auth: ApiAuth, refresh?: () => Promise<string | null>) {
  const calls: Call[] = [];
  let i = 0;
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url: new URL(url), headers: init?.headers as Record<string, string>, body: typeof init?.body === 'string' ? init.body : undefined });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as unknown as typeof fetch;
  const state = { ...auth };
  const api = createApiClient({ auth: () => state, fetch: fake, refreshClientId: refresh && (async () => {
    const id = await refresh();
    if (id) state.clientId = id;
    return id;
  }) });
  return { api, calls, state };
}

describe('клиент api-v2', () => {
  it('подставляет client_id, токен и запрос', async () => {
    const { api, calls } = setup([{ status: 200, body: { id: 1 } }], { token: 'tok-1234567890', clientId: 'CID' });
    const response = await api.call('trackBatch', {}, { ids: '1,2', skip: undefined });
    expect(response).toEqual({ status: 200, body: { id: 1 } });
    expect(calls[0].url.origin + calls[0].url.pathname).toBe('https://api-v2.soundcloud.com/tracks');
    expect(calls[0].url.searchParams.get('ids')).toBe('1,2');
    expect(calls[0].url.searchParams.get('client_id')).toBe('CID');
    expect(calls[0].url.searchParams.has('skip')).toBe(false);
    expect(calls[0].headers.Authorization).toBe('OAuth tok-1234567890');
  });

  it('method уходит в запрос и сохраняется при повторе после 401', async () => {
    const methods: Array<string | undefined> = [];
    const responses = [401, 200];
    const fake = (async (_url: string, init?: RequestInit) => {
      methods.push(init?.method);
      return new Response('', { status: responses.shift() });
    }) as unknown as typeof fetch;
    const state = { token: 'tok-1234567890', clientId: 'OLD' };
    const api = createApiClient({ auth: () => state, fetch: fake, refreshClientId: async () => (state.clientId = 'NEW') });
    await api.call('trackLike', { user_id: 1, track_id: 2 }, {}, { method: 'DELETE' });
    expect(methods).toEqual(['DELETE', 'DELETE']);
    await api.call('me');
    expect(methods[2]).toBe('GET');
  });

  it('без входа не шлёт Authorization', async () => {
    const { api, calls } = setup([{ status: 200, body: [] }], { token: null, clientId: 'CID' });
    await api.call('searchCategory', { category: 'tracks' }, { q: 'a' });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('отказ сервера разбирается classifyFailure как у сайта', async () => {
    const { api } = setup([{ status: 429, body: { error: 'slow' }, headers: { 'Retry-After': '7' } }], { token: null, clientId: 'CID' });
    const error = await api.call('me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(classifyFailure(error, 0)).toEqual({ kind: 'rate', status: 429, retryAfterMs: 7000 });
  });

  it('401 обновляет client_id один раз и повторяет', async () => {
    let refreshed = 0;
    const { api, calls } = setup([{ status: 401 }, { status: 200, body: { id: 5 } }], { token: null, clientId: 'OLD' }, async () => {
      refreshed++;
      return 'NEW';
    });
    expect((await api.call('me')).body).toEqual({ id: 5 });
    expect(refreshed).toBe(1);
    expect(calls.map((call) => call.url.searchParams.get('client_id'))).toEqual(['OLD', 'NEW']);
  });

  it('лайк шлёт Origin и Referer сайта и после 403 повторяется с новым ключом; чтение при 403 не повторяется', async () => {
    const put = setup([{ status: 403 }, { status: 200 }], { token: 'tok-1234567890', clientId: 'OLD' }, async () => 'NEW');
    await put.api.call('trackLike', { user_id: 1, track_id: 2 }, {}, { method: 'PUT' });
    expect(put.calls.map((call) => call.url.searchParams.get('client_id'))).toEqual(['OLD', 'NEW']);
    expect(put.calls[0].headers.Origin).toBe('https://soundcloud.com');
    expect(put.calls[0].headers['Content-Type']).toBe('application/json');
    expect(put.calls[0].headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(put.calls[0].body).toBe('{}');
    const read = setup([{ status: 403 }], { token: 'tok-1234567890', clientId: 'OLD' }, async () => 'NEW');
    await expect(read.api.call('me')).rejects.toBeInstanceOf(ApiError);
    expect(read.calls).toHaveLength(1);
    expect(read.calls[0].headers.Origin).toBeUndefined();
  });

  it('401 с тем же ключом после обновления остаётся отказом входа', async () => {
    const { api, calls } = setup([{ status: 401 }], { token: 'tok-1234567890', clientId: 'SAME' }, async () => 'SAME');
    const error = await api.call('me').catch((e: unknown) => e);
    expect(classifyFailure(error, 0).kind).toBe('auth');
    expect(calls).toHaveLength(1);
  });

  it('ответ не JSON возвращается текстом, пустой ответ null', async () => {
    const plain = setup([{ status: 200 }], { token: null, clientId: 'CID' });
    expect((await plain.api.call('me')).body).toBeNull();
  });

  it('callUrl принимает только ссылки api-v2', async () => {
    const { api, calls } = setup([{ status: 200, body: {} }], { token: null, clientId: 'CID' });
    await api.callUrl('https://api-v2.soundcloud.com/me/track_likes/ids?offset=5&client_id=STALE');
    expect(calls[0].url.searchParams.get('offset')).toBe('5');
    expect(calls[0].url.searchParams.get('client_id')).toBe('CID');
    await expect(api.callUrl('https://evil.example/x')).rejects.toThrow(/api-v2/);
  });

  it('сетевой сбой пробрасывается', async () => {
    const { api } = setup([new TypeError('Network request failed')], { token: null, clientId: 'CID' });
    await expect(api.call('me')).rejects.toThrow('Network request failed');
  });
});
