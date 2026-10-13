import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LOGIN_SCRIPT } from './loginScript';
import { parseLoginMessage } from './session';

const TOKEN = '2-293950-123456-AbCdEf';
const CID = 'AbCdEfGh12345678AbCdEfGh12345678';

/** Минимальная страница: fetch, XHR, cookie, hydration и один «таймер», который тест дёргает руками */
function page(options: { cookie?: string; hydration?: unknown } = {}) {
  const posted: string[] = [];
  const timers: Array<() => void> = [];
  const xhrHeaders: Array<[string, string]> = [];
  class XHR {
    open(_method: string, _url: string) {}
    setRequestHeader(name: string, value: string) {
      xhrHeaders.push([name, value]);
    }
  }
  const sandbox: Record<string, unknown> = {
    document: { cookie: options.cookie ?? '' },
    XMLHttpRequest: XHR,
    setInterval: (fn: () => void) => void timers.push(fn),
    fetch: async () => new Response('{}'),
    __sc_hydration: options.hydration,
  };
  sandbox.window = sandbox;
  sandbox.ReactNativeWebView = { postMessage: (value: string) => posted.push(value) };
  vm.createContext(sandbox);
  const result = vm.runInContext(LOGIN_SCRIPT, sandbox);
  return { sandbox, posted, tick: () => timers.forEach((fn) => fn()), XHR, result };
}

describe('скрипт страницы входа', () => {
  it('возвращает true, чтобы WebView не ругался на результат', () => {
    expect(page().result).toBe(true);
  });

  it('ловит токен из заголовка fetch к api-mobile', async () => {
    const { sandbox, posted } = page();
    await (sandbox.fetch as (u: string, i: object) => Promise<unknown>)(`https://api-mobile.soundcloud.com/me?client_id=${CID}`, { headers: { Authorization: `OAuth ${TOKEN}` } });
    expect(parseLoginMessage(posted[0])).toEqual({ token: TOKEN, clientId: CID });
  });

  it('ловит токен из заголовка fetch к api-v2 и client_id из адреса', async () => {
    const { sandbox, posted } = page();
    await (sandbox.fetch as (u: string, i: object) => Promise<unknown>)(`https://api-v2.soundcloud.com/me?client_id=${CID}`, { headers: { Authorization: `OAuth ${TOKEN}` } });
    expect(posted).toHaveLength(1);
    expect(parseLoginMessage(posted[0])).toEqual({ token: TOKEN, clientId: CID });
  });

  it('понимает Headers и повторно то же не шлёт', async () => {
    const { sandbox, posted } = page();
    const call = sandbox.fetch as (u: string, i: object) => Promise<unknown>;
    const init = { headers: new Headers({ Authorization: `OAuth ${TOKEN}` }) };
    await call(`https://api-v2.soundcloud.com/me?client_id=${CID}`, init);
    await call(`https://api-v2.soundcloud.com/me?client_id=${CID}`, init);
    expect(posted).toHaveLength(1);
  });

  it('чужие адреса не читает', async () => {
    const { sandbox, posted } = page();
    await (sandbox.fetch as (u: string, i: object) => Promise<unknown>)('https://example.com/x', { headers: { Authorization: `OAuth ${TOKEN}` } });
    expect(posted).toEqual([]);
  });

  it('ловит токен из XHR', () => {
    const { sandbox, posted, XHR } = page();
    const xhr = new (sandbox.XMLHttpRequest as typeof XHR)();
    xhr.open('GET', `https://api-v2.soundcloud.com/me?client_id=${CID}`);
    xhr.setRequestHeader('Authorization', `OAuth ${TOKEN}`);
    expect(parseLoginMessage(posted[0])).toEqual({ token: TOKEN, clientId: CID });
  });

  it('ловит токен из cookie и client_id из hydration', () => {
    const { posted, tick } = page({
      cookie: `a=1; oauth_token=${TOKEN}; b=2`,
      hydration: [{ hydratable: 'apiClient', data: { id: CID } }],
    });
    tick();
    expect(parseLoginMessage(posted[0])).toEqual({ token: TOKEN, clientId: CID });
  });

  it('без токена молчит', () => {
    const { posted, tick } = page({ cookie: 'a=1' });
    tick();
    expect(posted).toEqual([]);
  });
});
