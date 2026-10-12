// Сеть страницы для подбора: общий диспетчер фоновых запросов, разбор отказов сайта, кэш текстового поиска
// и обход источника библиотеки по страницам (раздел 5.2 плана радара). Числа диспетчера это стартовые
// настройки клиента, а не официальный предел SoundCloud.
// Функции уходят на страницу текстом вместе с волной (sourceHelpers), поэтому не ссылаются на импорты
// и константы модуля, только друг на друга по имени.

export type FailureKind = 'auth' | 'rate' | 'missing' | 'timeout' | 'server' | 'other';
export interface Failure {
    kind: FailureKind;
    status: number;
    /** Сколько ждать по заголовку Retry-After, мс; 0 если заголовка нет */
    retryAfterMs: number;
}
export interface Dispatcher {
    /** Действия пользователя и сама волна: идут сразу, фон ждёт их конца */
    user<T>(task: () => Promise<T>): Promise<T>;
    /** Фон: не больше concurrency запросов вместе с пользовательскими, не чаще раза в gapMs, после 429 и отказа входа пауза */
    background<T>(task: () => Promise<T>): Promise<T>;
    pausedUntil(): number;
    dispose(): void;
}
export interface SearchCache<T> {
    get(key: string): T[] | null;
    set(key: string, list: T[]): void;
}
export interface SyncItem {
    key: string;
    /** Когда добавлено, мс; 0 если сайт не знает или дата подозрительная */
    added: number;
    track?: object;
}
export interface SyncPlan {
    source: string;
    first: Record<string, string | number>;
    fetch(query: Record<string, string | number>): Promise<unknown>;
    items(body: unknown): SyncItem[];
}
export interface SyncBridge {
    syncStart(user: number, source: string, resume: boolean): Promise<unknown>;
    syncPage(user: number, source: string, run: number, items: Array<{ key: string; added: number }>, cursor: Record<string, string | number> | null): Promise<unknown>;
    syncFinish(user: number, source: string, run: number, status: string, error: string): Promise<unknown>;
    recordUploads?(user: number, tracks: object[]): Promise<unknown>;
}
export interface SyncResult {
    status: 'complete' | 'partial' | 'failed' | 'skipped';
    pages: number;
    error: string;
}

// Отказ внутреннего клиента сайта приходит объектом {status, body, headers}, наш тайм-аут это Error «Тайм-аут …».
// Retry-After бывает секундами или датой, headers бывает объектом Headers или простым объектом
export function classifyFailure(error: unknown, now: number): Failure {
    const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const status = typeof value.status === 'number' ? value.status : 0;
    const headers = value.headers && typeof value.headers === 'object' ? (value.headers as { get?: unknown } & Record<string, unknown>) : {};
    const raw = typeof headers.get === 'function' ? (headers.get as (name: string) => unknown)('retry-after') : headers['retry-after'] ?? headers['Retry-After'];
    let retry = 0;
    if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim())) {
        const seconds = Number(raw);
        const at = Date.parse(String(raw));
        if (Number.isFinite(seconds) && seconds >= 0) retry = seconds * 1000;
        else if (Number.isFinite(at)) retry = Math.max(0, at - now);
    }
    retry = Math.min(retry, 3600000);
    const message = error instanceof Error ? error.message : typeof value.message === 'string' ? value.message : '';
    if (status === 401 || status === 403) return { kind: 'auth', status, retryAfterMs: 0 };
    if (status === 429) return { kind: 'rate', status, retryAfterMs: retry };
    if (status === 404 || status === 410) return { kind: 'missing', status, retryAfterMs: 0 };
    if (status >= 500) return { kind: 'server', status, retryAfterMs: retry };
    if (/тайм-аут|timeout/i.test(message)) return { kind: 'timeout', status, retryAfterMs: 0 };
    return { kind: 'other', status, retryAfterMs: 0 };
}

// Общий диспетчер: пользовательские запросы идут сразу и занимают места, фоновые ждут их конца, свободного места
// и шага gapMs. 429 ставит фон на паузу по Retry-After, без него 30 с, 60 с и дальше вдвое до 10 минут;
// отказ входа ставит паузу на полчаса. Упавший запрос диспетчер не повторяет: это решает вызывающий
export function createDispatcher(options: {
    now(): number;
    later(run: () => void, ms: number): unknown;
    cancel(handle: unknown): void;
    concurrency?: number;
    gapMs?: number;
}): Dispatcher {
    const concurrency = options.concurrency ?? 2;
    const gap = options.gapMs ?? 1000;
    const queue: Array<{ task: () => Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void }> = [];
    let active = 0;
    let users = 0;
    let lastStart = -Infinity;
    let paused = 0;
    let strikes = 0;
    let timer: unknown = null;
    let disposed = false;
    const note = (error: unknown): void => {
        const failure = classifyFailure(error, options.now());
        if (failure.kind === 'rate') {
            strikes++;
            paused = Math.max(paused, options.now() + Math.max(failure.retryAfterMs, Math.min(30000 * 2 ** (strikes - 1), 600000)));
        } else if (failure.kind === 'auth') paused = Math.max(paused, options.now() + 1800000);
    };
    const pump = (): void => {
        while (!disposed && queue.length && !users && active < concurrency) {
            const now = options.now();
            const wait = Math.max(paused - now, lastStart + gap - now);
            if (wait > 0) {
                if (timer === null) timer = options.later(() => { timer = null; pump(); }, wait);
                return;
            }
            const job = queue.shift();
            if (!job) return;
            active++;
            lastStart = now;
            let started: Promise<unknown>;
            try {
                started = job.task();
            } catch (error) {
                started = Promise.reject(error);
            }
            started.then((value) => {
                strikes = 0;
                job.resolve(value);
            }, (error: unknown) => {
                note(error);
                job.reject(error);
            }).finally(() => {
                active--;
                pump();
            });
        }
    };
    return {
        user<T>(task: () => Promise<T>): Promise<T> {
            users++;
            active++;
            let run: Promise<T>;
            try {
                run = task();
            } catch (error) {
                run = Promise.reject(error);
            }
            return run.catch((error: unknown) => {
                note(error);
                throw error;
            }).finally(() => {
                users--;
                active--;
                pump();
            });
        },
        background<T>(task: () => Promise<T>): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                if (disposed) {
                    reject(new Error('Диспетчер остановлен'));
                    return;
                }
                queue.push({ task, resolve: (value) => resolve(value as T), reject });
                pump();
            });
        },
        pausedUntil: () => paused,
        dispose(): void {
            disposed = true;
            if (timer !== null) options.cancel(timer);
            timer = null;
            for (const job of queue.splice(0)) job.reject(new Error('Диспетчер остановлен'));
        },
    };
}

// Кэш текстового поиска: найденное живёт сутки, пустой успешный ответ десять минут, ошибка не кэшируется вовсе
export function createSearchCache<T>(options: { now(): number; ttlMs?: number; emptyTtlMs?: number; limit?: number }): SearchCache<T> {
    const ttl = options.ttlMs ?? 86400000;
    const emptyTtl = options.emptyTtlMs ?? 600000;
    const limit = options.limit ?? 300;
    const entries = new Map<string, { at: number; list: T[] }>();
    return {
        get(key: string): T[] | null {
            const entry = entries.get(key);
            if (!entry) return null;
            if (options.now() - entry.at > (entry.list.length ? ttl : emptyTtl)) {
                entries.delete(key);
                return null;
            }
            return entry.list;
        },
        set(key: string, list: T[]): void {
            entries.delete(key);
            entries.set(key, { at: options.now(), list });
            for (const oldest of entries.keys()) {
                if (entries.size <= limit) break;
                entries.delete(oldest);
            }
        },
    };
}

// Лайки с датами: {created_at, track}. Массовый импорт ставит сотням лайков одну секунду (замер P0), такая дата
// не дата лайка: от десяти одинаковых на странице она считается неизвестной и помнится на весь обход
export function likeItems(body: unknown, bulk: Set<string>): SyncItem[] {
    const list = (body as { collection?: unknown } | null)?.collection;
    if (!Array.isArray(list)) return [];
    const counts = new Map<string, number>();
    for (const entry of list) {
        const at = (entry as { created_at?: unknown } | null)?.created_at;
        if (typeof at === 'string') counts.set(at, (counts.get(at) ?? 0) + 1);
    }
    for (const [at, count] of counts) if (count >= 10) bulk.add(at);
    const items: SyncItem[] = [];
    for (const entry of list) {
        const value = entry as { created_at?: unknown; track?: unknown } | null;
        const track = value?.track as { id?: unknown } | undefined;
        if (!track || typeof track.id !== 'number' || !Number.isSafeInteger(track.id) || track.id <= 0) continue;
        const at = typeof value?.created_at === 'string' && !bulk.has(value.created_at) ? Date.parse(value.created_at) : 0;
        items.push({ key: 'sc:track:' + track.id, added: Number.isFinite(at) && at > 0 ? at : 0, track: track as object });
    }
    return items;
}

// Список id или объектов с id (подписки, плейлисты) в ключи хранилища
export function entityItems(body: unknown, kind: 'user' | 'playlist'): SyncItem[] {
    const list = (body as { collection?: unknown } | null)?.collection;
    const source = Array.isArray(list) ? list : Array.isArray(body) ? body : [];
    const items: SyncItem[] = [];
    for (const entry of source) {
        const value = typeof entry === 'number' ? { id: entry } : (entry as { id?: unknown; created_at?: unknown } | null);
        if (!value || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) continue;
        const at = typeof value.created_at === 'string' ? Date.parse(value.created_at) : 0;
        items.push({ key: 'sc:' + kind + ':' + value.id, added: Number.isFinite(at) && at > 0 ? at : 0 });
    }
    return items;
}

// Обход источника до конца со сдачей страниц в хранилище. Прерванный прогон продолжается с сохранённого курсора.
// Перед complete stillOwner сверяет вошедший аккаунт: ответы после смены входа в библиотеку не попадают (A15).
// 429, тайм-аут и сбой сервера дают partial (курсор остаётся), отказ входа и прочее failed; повторов внутри нет
export async function syncSource(options: {
    user: number;
    plan: SyncPlan;
    bridge: SyncBridge;
    nextQuery(body: unknown): Record<string, string | number> | null;
    stillOwner(): Promise<boolean>;
    stopped(): boolean;
    maxPages: number;
    now(): number;
}): Promise<SyncResult> {
    const { user, plan, bridge } = options;
    const started = (await bridge.syncStart(user, plan.source, true)) as { run?: unknown; cursor?: unknown } | null;
    const run = typeof started?.run === 'number' ? started.run : 0;
    if (!run) return { status: 'skipped', pages: 0, error: '' };
    const finish = async (status: 'complete' | 'partial' | 'failed', error: string, pages: number): Promise<SyncResult> => {
        await bridge.syncFinish(user, plan.source, run, status, error);
        return { status, pages, error };
    };
    const saved = started?.cursor && typeof started.cursor === 'object' ? (started.cursor as Record<string, string | number>) : null;
    let query: Record<string, string | number> | null = saved ?? plan.first;
    let pages = 0;
    const visited = new Set<string>();
    try {
        while (query) {
            if (options.stopped()) return await finish('partial', 'stopped', pages);
            const key = JSON.stringify(query);
            if (visited.has(key) || pages >= options.maxPages) return await finish('failed', 'loop', pages);
            visited.add(key);
            const body = await plan.fetch(query);
            // Ответ без списка не пустая библиотека: иначе полный обход снял бы из неё всё
            if (!Array.isArray((body as { collection?: unknown } | null)?.collection) && !Array.isArray(body)) return await finish('failed', 'shape', pages);
            const items = plan.items(body);
            const tracks = items.flatMap((item) => (item.track ? [item.track] : []));
            if (tracks.length && bridge.recordUploads) await bridge.recordUploads(user, tracks);
            const next = options.nextQuery(body);
            const accepted = await bridge.syncPage(user, plan.source, run, items.map((item) => ({ key: item.key, added: item.added })), next);
            // Прогон уже не наш (начат новый или завершён): закрывать его не нам
            if (accepted !== true) return { status: 'failed', pages, error: 'stale-run' };
            pages++;
            query = next;
        }
        if (!(await options.stillOwner())) return await finish('failed', 'account-changed', pages);
        return await finish('complete', '', pages);
    } catch (error) {
        // Страницу закрыли посреди обхода: продолжить можно с курсора
        if (options.stopped()) return await finish('partial', 'stopped', pages);
        const failure = classifyFailure(error, options.now());
        const status = failure.kind === 'rate' || failure.kind === 'timeout' || failure.kind === 'server' ? 'partial' : 'failed';
        return await finish(status, failure.kind + (failure.status ? ' ' + failure.status : ''), pages);
    }
}

// Всё, что уходит на страницу: waveScript кладёт объявления рядом с волной
export const sourceHelpers = [classifyFailure, createDispatcher, createSearchCache, likeItems, entityItems, syncSource];
