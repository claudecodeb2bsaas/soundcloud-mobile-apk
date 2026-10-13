import { createDispatcher, type Dispatcher } from '../core/pageSources';
import { DESKTOP_USER_AGENT } from './clientId';
import { endpointPath, type EndpointName, type PathParams } from './endpoints';

export type Query = Record<string, string | number | boolean | undefined>;

export interface ApiAuth {
    /** OAuth-токен аккаунта; null без входа */
    token: string | null;
    clientId: string | null;
}

/** Отказ сервера. Форма {status, headers} та же, что у отказа внутреннего клиента сайта: classifyFailure разбирает её без правок */
export class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    readonly headers: Headers | null;
    constructor(status: number, body: unknown, headers: Headers | null, message?: string) {
        super(message ?? `Ошибка API ${status}`);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
        this.headers = headers;
    }
}

export interface ApiClientOptions {
    auth(): ApiAuth;
    /** Новый client_id, когда сайт сменил его: 401 с уже подставленным ключом ведёт сюда один раз на запрос */
    refreshClientId?(): Promise<string | null>;
    fetch?: typeof fetch;
    dispatcher?: Dispatcher;
    baseUrl?: string;
    timeoutMs?: number;
}

export interface CallOptions {
    /** Фоновый запрос ждёт пользовательских и подчиняется паузам после 429. По умолчанию запрос пользовательский */
    background?: boolean;
    /** Лайки меняются PUT и DELETE; по умолчанию GET */
    method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
}

export interface ApiResponse<T = unknown> {
    status: number;
    body: T;
}

export interface ApiClient {
    call<T = unknown>(name: EndpointName, path?: PathParams, query?: Query, options?: CallOptions): Promise<ApiResponse<T>>;
    /** Запрос по готовой ссылке api-v2 (next_href, ссылки потоков): ключ и вход подставляются так же */
    callUrl<T = unknown>(url: string, options?: CallOptions): Promise<ApiResponse<T>>;
    dispose(): void;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
    const base = (options.baseUrl ?? 'https://api-v2.soundcloud.com').replace(/\/$/, '');
    const doFetch: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
    const timeoutMs = options.timeoutMs ?? 20000;
    const dispatcher =
        options.dispatcher ?? createDispatcher({ now: () => Date.now(), later: (run, ms) => setTimeout(run, ms), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });

    function buildUrl(raw: string, query: Query, clientId: string | null): string {
        const url = new URL(raw);
        for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
        if (clientId) url.searchParams.set('client_id', clientId);
        else url.searchParams.delete('client_id');
        return url.toString();
    }

    async function once(raw: string, query: Query, clientId: string | null, token: string | null, method = 'GET'): Promise<ApiResponse> {
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': DESKTOP_USER_AGENT };
        if (token) headers.Authorization = `OAuth ${token}`;
        // Изменения (лайк) сайт принимает от браузера: те же Origin и Referer, что шлёт страница soundcloud.com
        if (method !== 'GET') {
            headers.Origin = 'https://soundcloud.com';
            headers.Referer = 'https://soundcloud.com/';
            headers['Accept-Language'] = 'en-US,en;q=0.9';
            headers['Content-Type'] = 'application/json';
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
            response = await doFetch(buildUrl(raw, query, clientId), {
                method,
                headers,
                signal: controller.signal,
                body: method === 'GET' ? undefined : '{}',
            });
        } catch (error) {
            if (controller.signal.aborted) throw new Error(`Тайм-аут запроса ${timeoutMs} мс`);
            throw error;
        } finally {
            clearTimeout(timer);
        }
        const text = await response.text();
        let body: unknown = null;
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
        }
        if (!response.ok) throw new ApiError(response.status, body, response.headers ?? null);
        return { status: response.status, body };
    }

    async function request(raw: string, query: Query, method?: string): Promise<ApiResponse> {
        let { token, clientId } = options.auth();
        try {
            return await once(raw, query, clientId, token, method);
        } catch (error) {
            // 401 с ключом сайта: ключ мог смениться. Обновляем один раз и повторяем; не помогло, значит отказ входа.
            // Изменение (лайк) сайт с устаревшим ключом отклоняет и кодом 403
            const stale = error instanceof ApiError && (error.status === 401 || (error.status === 403 && !!method && method !== 'GET'));
            if (stale && options.refreshClientId) {
                const fresh = await options.refreshClientId().catch(() => null);
                if (fresh && fresh !== clientId) {
                    clientId = fresh;
                    token = options.auth().token;
                    return once(raw, query, clientId, token, method);
                }
            }
            throw error;
        }
    }

    function run<T>(task: () => Promise<ApiResponse>, call?: CallOptions): Promise<ApiResponse<T>> {
        return (call?.background ? dispatcher.background(task) : dispatcher.user(task)) as Promise<ApiResponse<T>>;
    }

    return {
        call<T>(name: EndpointName, path: PathParams = {}, query: Query = {}, call?: CallOptions) {
            const raw = base + endpointPath(name, path);
            return run<T>(() => request(raw, query, call?.method), call);
        },
        callUrl<T>(url: string, call?: CallOptions) {
            if (!url.startsWith(base + '/')) return Promise.reject(new Error('Ссылка не на api-v2'));
            return run<T>(() => request(url, {}, call?.method), call);
        },
        dispose: () => dispatcher.dispose(),
    };
}
