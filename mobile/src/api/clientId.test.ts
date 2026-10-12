import { describe, expect, it } from 'vitest';
import { fetchClientId, parseClientId } from './clientId';

const page = (id: string) =>
  `<script>window.__sc_hydration = [{"hydratable":"anonymousId","data":"1-2"},{"hydratable":"apiClient","data":{"id":"${id}","isExpiring":false}}];</script>`;

describe('client_id сайта', () => {
  it('читается из hydration', () => {
    expect(parseClientId(page('AbCdEfGh12345678AbCdEfGh12345678'))).toBe('AbCdEfGh12345678AbCdEfGh12345678');
  });

  it('без записи или с чужой формой null', () => {
    expect(parseClientId('<html></html>')).toBeNull();
    expect(parseClientId(page('short'))).toBeNull();
  });

  it('fetchClientId просит страницу с настольным User-Agent', async () => {
    let seen: { url: string; ua: string } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, ua: String((init?.headers as Record<string, string>)['User-Agent']) };
      return new Response(page('Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz'), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchClientId(fake)).toBe('Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz9Zz');
    expect(seen).toMatchObject({ url: 'https://soundcloud.com/' });
    expect(seen!.ua).toMatch(/Windows NT/);
  });

  it('при отказе страницы null', async () => {
    const fake = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    expect(await fetchClientId(fake)).toBeNull();
  });
});
