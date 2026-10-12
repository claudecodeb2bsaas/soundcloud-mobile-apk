import { cleanSettings, type Settings } from '../settings/settings';

// Резервная копия одним JSON-текстом: настройки и то, что человек настроил руками (отметки, убранное из вкуса,
// отметки настроений, режим волны, «Моя музыка»). Отдаётся через «Поделиться», возвращается вставкой текста.
// ponytail: журнал прослушиваний (SQLite, до года) не входит, вкус после переустановки строится заново по лайкам;
// файл для всего журнала нужен expo-file-system и выбора файла, добавить, если журнал станет нужен в копии.

export const BACKUP_APP = 'soundcloud-wave';
export const BACKUP_FORMAT = 1;
export const BACKUP_KV_KEYS = ['wave.marks.v1', 'wave.taste-overrides.v1', 'wave.moods.v1', 'wave.settings.v1', 'wave.library.v1'] as const;
const MAX_VALUE = 500_000;
const MAX_TEXT = 2_000_000;

export interface BackupDeps {
    settings: Settings;
    read(key: string): string | null;
    now?(): number;
}

export function createBackup(deps: BackupDeps): string {
    const kv: Record<string, string> = {};
    for (const key of BACKUP_KV_KEYS) {
        const value = deps.read(key);
        if (value) kv[key] = value;
    }
    return JSON.stringify({ app: BACKUP_APP, format: BACKUP_FORMAT, at: (deps.now ?? Date.now)(), settings: deps.settings, kv });
}

export type BackupReason = 'not-backup' | 'newer-format' | 'damaged' | 'too-big';
export interface BackupContent {
    settings: Settings;
    /** Только известные ключи с текстом, который читается как JSON */
    kv: Record<string, string>;
}

/** Текст копии недоверенный: берём только известные поля формы, остальное отбрасываем */
export function parseBackup(text: string): { ok: true; content: BackupContent } | { ok: false; reason: BackupReason } {
    if (text.length > MAX_TEXT) return { ok: false, reason: 'too-big' };
    let raw: { app?: unknown; format?: unknown; settings?: unknown; kv?: unknown } | null;
    try {
        raw = JSON.parse(text.trim()) as typeof raw;
    } catch {
        return { ok: false, reason: 'not-backup' };
    }
    if (!raw || typeof raw !== 'object' || raw.app !== BACKUP_APP) return { ok: false, reason: 'not-backup' };
    if (typeof raw.format !== 'number' || raw.format > BACKUP_FORMAT) return { ok: false, reason: 'newer-format' };
    const kv: Record<string, string> = {};
    const source = raw.kv && typeof raw.kv === 'object' ? (raw.kv as Record<string, unknown>) : {};
    for (const key of BACKUP_KV_KEYS) {
        const value = source[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.length > MAX_VALUE) return { ok: false, reason: 'damaged' };
        try {
            JSON.parse(value);
        } catch {
            return { ok: false, reason: 'damaged' };
        }
        kv[key] = value;
    }
    return { ok: true, content: { settings: cleanSettings(raw.settings), kv } };
}
