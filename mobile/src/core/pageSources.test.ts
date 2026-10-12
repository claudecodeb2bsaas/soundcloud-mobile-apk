import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    classifyFailure, createDispatcher, createSearchCache, entityItems, likeItems, sourceHelpers, syncSource, type SyncBridge, type SyncPlan,
} from './pageSources';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 25, 12));
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
const dispatcher = () => createDispatcher({ now: () => Date.now(), later: (run, ms) => setTimeout(run, ms), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
};

it('отказы сайта: вход, 429 с Retry-After секундами и датой, тайм-аут', () => {
    const now = Date.now();
    expect(classifyFailure({ status: 401, body: null, headers: {} }, now)).toEqual({ kind: 'auth', status: 401, retryAfterMs: 0 });
    expect(classifyFailure({ status: 429, headers: { 'retry-after': '120' } }, now)).toEqual({ kind: 'rate', status: 429, retryAfterMs: 120000 });
    expect(classifyFailure({ status: 429, headers: new Headers({ 'Retry-After': new Date(now + 5000).toUTCString() }) }, now).retryAfterMs).toBeGreaterThan(3000);
    expect(classifyFailure({ status: 429, headers: {} }, now)).toEqual({ kind: 'rate', status: 429, retryAfterMs: 0 });
    expect(classifyFailure({ status: 404 }, now).kind).toBe('missing');
    expect(classifyFailure({ status: 503 }, now).kind).toBe('server');
    expect(classifyFailure(new Error('Тайм-аут userTrackLikes'), now).kind).toBe('timeout');
    expect(classifyFailure('странное', now).kind).toBe('other');
});

it('фон: не больше двух вместе, шаг в секунду, пользовательский запрос идёт первым', async () => {
    const net = dispatcher();
    const started: string[] = [];
    const jobs = new Map<string, ReturnType<typeof deferred<string>>>();
    const job = (name: string) => () => {
        started.push(name);
        const item = deferred<string>();
        jobs.set(name, item);
        return item.promise;
    };
    void net.background(job('a'));
    void net.background(job('b'));
    void net.background(job('c'));
    expect(started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(5000);
    // Два места заняты: третий ждёт освобождения
    expect(started).toEqual(['a', 'b']);
    const user = net.user(job('user'));
    expect(started).toEqual(['a', 'b', 'user']);
    jobs.get('a')?.resolve('a');
    await vi.advanceTimersByTimeAsync(2000);
    // Пока идёт запрос пользователя, фон стоит
    expect(started).toEqual(['a', 'b', 'user']);
    jobs.get('user')?.resolve('u');
    await expect(user).resolves.toBe('u');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b', 'user', 'c']);
    net.dispose();
});

it('429 ставит фон на паузу по Retry-After, без заголовка с ростом до 10 минут, повторов сам не делает', async () => {
    const net = dispatcher();
    const calls: number[] = [];
    const limited = (retry?: string) => () => {
        calls.push(Date.now());
        return Promise.reject({ status: 429, headers: retry ? { 'retry-after': retry } : {} });
    };
    await expect(net.background(limited('90'))).rejects.toMatchObject({ status: 429 });
    expect(net.pausedUntil()).toBe(Date.now() + 90000);
    const next = net.background(() => Promise.resolve('ok'));
    await vi.advanceTimersByTimeAsync(89000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toBe('ok');
    // Без заголовка пауза растёт: 30 с, 60 с
    await vi.advanceTimersByTimeAsync(1000);
    const second = expect(net.background(limited())).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(net.pausedUntil() - calls[1]).toBe(30000);
    const third = expect(net.background(limited())).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(40000);
    await third;
    expect(calls[2] - calls[1]).toBe(30000);
    expect(net.pausedUntil() - calls[2]).toBe(60000);
    expect(calls).toHaveLength(3);
    // Отказ входа ставит фон на полчаса, остановка отклоняет очередь
    await expect(net.user(() => Promise.reject({ status: 401 }))).rejects.toBeTruthy();
    expect(net.pausedUntil() - Date.now()).toBeGreaterThanOrEqual(1800000 - 1);
    const waiting = net.background(() => Promise.resolve('never'));
    net.dispose();
    await expect(waiting).rejects.toThrow('Диспетчер остановлен');
});

it('кэш поиска: сутки для найденного, десять минут для пустого', () => {
    const cache = createSearchCache<number>({ now: () => Date.now(), limit: 2 });
    cache.set('a', [1]);
    cache.set('empty', []);
    vi.advanceTimersByTime(11 * 60000);
    expect(cache.get('empty')).toBeNull();
    expect(cache.get('a')).toEqual([1]);
    vi.advanceTimersByTime(24 * 3600000);
    expect(cache.get('a')).toBeNull();
    cache.set('x', [1]);
    cache.set('y', [2]);
    cache.set('z', [3]);
    expect(cache.get('x')).toBeNull();
    expect(cache.get('z')).toEqual([3]);
});

it('даты лайков: массовый импорт с одной секундой считается неизвестной датой на весь обход', () => {
    const bulk = new Set<string>();
    const same = '2026-05-13T07:52:10Z';
    const page = { collection: [
        { created_at: '2026-09-20T10:00:00Z', track: { id: 1 } },
        ...Array.from({ length: 12 }, (_, i) => ({ created_at: same, track: { id: 10 + i } })),
        { created_at: '2026-01-01T00:00:00Z', track: { id: 'x' } },
    ] };
    const items = likeItems(page, bulk);
    expect(items[0]).toEqual({ key: 'sc:track:1', added: Date.parse('2026-09-20T10:00:00Z'), track: { id: 1 } });
    expect(items.slice(1).every((item) => item.added === 0)).toBe(true);
    expect(items).toHaveLength(13);
    // Хвост той же секунды на следующей странице тоже без даты
    expect(likeItems({ collection: [{ created_at: same, track: { id: 99 } }] }, bulk)[0].added).toBe(0);
    expect(entityItems({ collection: [5, 'x', -1, { id: 7, created_at: '2026-09-01T00:00:00Z' }] }, 'user')).toEqual([
        { key: 'sc:user:5', added: 0 }, { key: 'sc:user:7', added: Date.parse('2026-09-01T00:00:00Z') },
    ]);
});

function bridgeMock(run = 1, cursor: Record<string, string | number> | null = null) {
    const calls: Array<[string, ...unknown[]]> = [];
    let current = run;
    const bridge: SyncBridge = {
        syncStart: async (...args) => { calls.push(['start', ...args]); return { run: current, cursor }; },
        syncPage: async (...args) => { calls.push(['page', ...args]); return args[2] === current; },
        syncFinish: async (...args) => { calls.push(['finish', ...args]); return {}; },
        recordUploads: async (...args) => { calls.push(['uploads', ...args]); return 1; },
    };
    return { bridge, calls, bump: () => { current++; } };
}
const next = (body: unknown): Record<string, string | number> | null => (body as { next?: Record<string, string | number> | null }).next ?? null;
const likesPlan = (pages: Array<unknown | Error>): SyncPlan & { asked: unknown[] } => {
    const asked: unknown[] = [];
    return {
        asked, source: 'likes', first: { limit: 200 },
        fetch: async (query) => {
            asked.push(query);
            const page = pages[asked.length - 1];
            if (page instanceof Error || (page && typeof page === 'object' && 'status' in page)) throw page;
            return page;
        },
        items: (body) => likeItems(body, new Set()),
    };
};
const options = (plan: SyncPlan, bridge: SyncBridge, owner = true) => ({
    user: 77, plan, bridge, nextQuery: next, stillOwner: async () => owner, stopped: () => false, maxPages: 100, now: () => Date.now(),
});

it('обход до конца: страницы, загрузки с датами, complete после сверки аккаунта', async () => {
    const { bridge, calls } = bridgeMock();
    const plan = likesPlan([
        { collection: [{ created_at: '2026-09-20T10:00:00Z', track: { id: 1, title: 'A' } }], next: { offset: 'x1', limit: 200 } },
        { collection: [{ created_at: '2026-09-19T10:00:00Z', track: { id: 2, title: 'B' } }], next: null },
    ]);
    expect(await syncSource(options(plan, bridge))).toEqual({ status: 'complete', pages: 2, error: '' });
    expect(plan.asked).toEqual([{ limit: 200 }, { offset: 'x1', limit: 200 }]);
    expect(calls.map((call) => call[0])).toEqual(['start', 'uploads', 'page', 'uploads', 'page', 'finish']);
    expect(calls[2]).toEqual(['page', 77, 'likes', 1, [{ key: 'sc:track:1', added: Date.parse('2026-09-20T10:00:00Z') }], { offset: 'x1', limit: 200 }]);
    expect(calls[calls.length - 1]).toEqual(['finish', 77, 'likes', 1, 'complete', '']);
});

it('A16: 429 посреди обхода даёт partial без повторов, продолжение идёт с курсора', async () => {
    const { bridge, calls } = bridgeMock();
    const plan = likesPlan([
        { collection: [{ created_at: '2026-09-20T10:00:00Z', track: { id: 1 } }], next: { offset: 'x1' } },
        { status: 429, headers: {} },
    ]);
    expect(await syncSource(options(plan, bridge))).toEqual({ status: 'partial', pages: 1, error: 'rate 429' });
    expect(plan.asked).toHaveLength(2);
    expect(calls[calls.length - 1]).toEqual(['finish', 77, 'likes', 1, 'partial', 'rate 429']);
    const resumed = bridgeMock(1, { offset: 'x1' });
    const again = likesPlan([{ collection: [], next: null }]);
    expect((await syncSource(options(again, resumed.bridge))).status).toBe('complete');
    expect(again.asked).toEqual([{ offset: 'x1' }]);
});

it('A15: смена аккаунта и чужой прогон не завершают обход полным', async () => {
    const changed = bridgeMock();
    expect(await syncSource(options(likesPlan([{ collection: [], next: null }]), changed.bridge, false))).toMatchObject({ status: 'failed', error: 'account-changed' });
    expect(changed.calls[changed.calls.length - 1]).toEqual(['finish', 77, 'likes', 1, 'failed', 'account-changed']);
    const stale = bridgeMock();
    const plan = likesPlan([{ collection: [], next: { offset: 'a' } }, { collection: [], next: null }]);
    const running = syncSource(options({ ...plan, fetch: async (query) => { stale.bump(); return plan.fetch(query); } }, stale.bridge));
    expect(await running).toEqual({ status: 'failed', pages: 0, error: 'stale-run' });
    expect(stale.calls.some((call) => call[0] === 'finish')).toBe(false);
    const auth = bridgeMock();
    expect(await syncSource(options(likesPlan([{ status: 403 }]), auth.bridge))).toMatchObject({ status: 'failed', error: 'auth 403' });
    const shape = bridgeMock();
    expect(await syncSource(options(likesPlan([{ error: 'maintenance' }]), shape.bridge))).toMatchObject({ status: 'failed', error: 'shape' });
    expect(shape.calls.some((call) => call[0] === 'page')).toBe(false);
    const loop = bridgeMock();
    expect(await syncSource(options(likesPlan([{ collection: [], next: { offset: 'a' } }, { collection: [], next: { offset: 'a' } }]), loop.bridge))).toMatchObject({ status: 'failed', error: 'loop' });
});

it('помощники работают текстом на странице', async () => {
    const source = sourceHelpers.map((helper) => helper.toString()).join('\n');
    expect(source).not.toMatch(/require\(|__vi_import|_1\.|import\(/);
    const page = new Function(source + '\nreturn { likeItems, syncSource, createDispatcher };')() as {
        likeItems: typeof likeItems; syncSource: typeof syncSource; createDispatcher: typeof createDispatcher;
    };
    expect(page.likeItems({ collection: [{ created_at: '2026-09-20T10:00:00Z', track: { id: 3 } }] }, new Set())).toHaveLength(1);
    const { bridge } = bridgeMock();
    expect((await page.syncSource(options(likesPlan([{ status: 429, headers: {} }]), bridge))).status).toBe('partial');
});
