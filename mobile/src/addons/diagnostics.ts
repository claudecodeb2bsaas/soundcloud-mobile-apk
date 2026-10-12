import type { TextStore } from '../wave/marks';

// Журнал диагностики: последние события приложения (запуск, предупреждения и ошибки консоли, радар, копия) кольцом в
// kv-store, чтобы показать и отправить разработчику. На desktop то же делает diagnosticJournal (файлы на диске, белый
// список полей). Здесь текст сообщений нужен для разбора, поэтому из него вырезаются адреса и всё, похожее на ключи.

export interface DiagEntry {
    at: number;
    /** start, warn, error, radar, backup, ... */
    event: string;
    message: string;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE = 240;
const SAVE_DELAY_MS = 1000;

/** Адреса и длинные последовательности из букв и цифр (токены, client_id) заменяются; текст обрезается */
export function scrub(text: string): string {
    return text
        .replace(/\bhttps?:\/\/\S+/gi, '<url>')
        .replace(/\b(?:OAuth|Bearer)\s+\S+/gi, '<auth>')
        .replace(/[A-Za-z0-9._~-]{24,}/g, '<key>')
        .slice(0, MAX_MESSAGE);
}

export const messageOf = (args: unknown[]): string =>
    scrub(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg) ?? String(arg); } catch { return String(arg); } })())).join(' '));

export interface Diagnostics {
    record(event: string, message: string): void;
    entries(): readonly DiagEntry[];
    clear(): void;
    /** Текст для отправки: шапка (версия, система) и записи по строке */
    exportText(header: Record<string, string>): string;
    /** Подписывается на console.warn и console.error; возвращает отмену */
    captureConsole(target?: Pick<Console, 'warn' | 'error'>): () => void;
    /** Немедленно пишет в хранилище (приложение уходит в фон) */
    flush(): void;
}

export function createDiagnostics(store: TextStore, now: () => number = Date.now): Diagnostics {
    const read = (): DiagEntry[] => {
        try {
            const raw = JSON.parse(store.get() ?? '[]') as unknown;
            return Array.isArray(raw)
                ? raw.flatMap((item: Partial<DiagEntry> | null) => (item && typeof item.at === 'number' && typeof item.event === 'string' && typeof item.message === 'string' ? [{ at: item.at, event: item.event.slice(0, 40), message: scrub(item.message) }] : [])).slice(-MAX_ENTRIES)
                : [];
        } catch {
            return [];
        }
    };
    let list = read();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
        clearTimeout(timer);
        timer = undefined;
        try {
            store.set(JSON.stringify(list));
        } catch {
            // Журнал не должен ронять приложение и писать в консоль, иначе круг через captureConsole
        }
    };

    const api: Diagnostics = {
        record(event, message) {
            list = [...list, { at: now(), event: event.slice(0, 40), message: scrub(message) }].slice(-MAX_ENTRIES);
            timer ??= setTimeout(flush, SAVE_DELAY_MS);
        },
        entries: () => list,
        clear() {
            list = [];
            flush();
        },
        flush,
        exportText(header) {
            const lines = Object.entries(header).map(([key, value]) => `${key}: ${scrub(value)}`);
            return [...lines, '', ...list.map((entry) => `${new Date(entry.at).toISOString()} ${entry.event} ${entry.message}`)].join('\n');
        },
        captureConsole(target = console) {
            const { warn, error } = target;
            const wrap = (event: string, original: typeof warn) => (...args: unknown[]): void => {
                api.record(event, messageOf(args));
                original.apply(target, args);
            };
            target.warn = wrap('warn', warn);
            target.error = wrap('error', error);
            return () => {
                target.warn = warn;
                target.error = error;
            };
        },
    };
    return api;
}
