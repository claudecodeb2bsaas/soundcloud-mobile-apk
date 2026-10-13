// client_id для api-v2: страница сайта кладёт его в window.__sc_hydration как {"hydratable":"apiClient","data":{"id":...}}.
// Сверено 12.10.2026: обычный GET https://soundcloud.com/ с User-Agent настольного браузера отдаёт эту запись без входа.
// Мобильный User-Agent получает другой сайт (Next.js, api-mobi) без неё.

export const DESKTOP_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Chrome на телефоне без «wv»: страница входа выглядит как мобильная, Google не режет WebView */
export const MOBILE_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const CLIENT_ID = /"hydratable"\s*:\s*"apiClient"\s*,\s*"data"\s*:\s*\{[^}]*?"id"\s*:\s*"([A-Za-z0-9]{16,64})"/;

export function parseClientId(html: string): string | null {
    return CLIENT_ID.exec(html)?.[1] ?? null;
}

export async function fetchClientId(fetchImpl: typeof fetch = fetch): Promise<string | null> {
    const response = await fetchImpl('https://soundcloud.com/', { headers: { 'User-Agent': DESKTOP_USER_AGENT, Accept: 'text/html' } });
    if (!response.ok) return null;
    return parseClientId(await response.text());
}
