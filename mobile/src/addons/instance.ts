import Storage from 'expo-sqlite/kv-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { settings } from '../settings/instance';
import { freezeKv, history, taste, userId } from '../wave/data';
import { createMarks } from '../wave/marks';
import { BACKUP_KV_KEYS, createBackup, parseBackup, type BackupReason } from './backup';
import { createDiagnostics } from './diagnostics';

// Диагностика и резервная копия с привязкой к телефону: kv-store, SQLite, Share

export const diagnostics = createDiagnostics({
    get: () => Storage.getItemSync('app.diag.v1'),
    set: (value) => Storage.setItemSync('app.diag.v1', value),
});

export function diagnosticsText(): string {
    return diagnostics.exportText({
        app: 'SoundCloud Wave ' + (Constants.expoConfig?.version ?? '?'),
        system: `${Platform.OS} ${String(Platform.Version)}`,
        language: settings.getSnapshot().language,
    });
}

export function exportBackup(): string {
    return createBackup({ settings: settings.getSnapshot(), read: (key) => Storage.getItemSync(key) });
}

/** Восстанавливает копию. Настройки встают сразу, остальное после перезапуска (модули держат свои значения в памяти) */
export async function importBackup(text: string): Promise<'ok' | BackupReason> {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed.reason;
    const { content } = parsed;
    for (const key of BACKUP_KV_KEYS) {
        if (content.kv[key]) Storage.setItemSync(key, content.kv[key]);
    }
    freezeKv();
    settings.replace(content.settings);
    // Отметки живут и в SQLite (вкус читает оттуда): приводим к восстановленным
    const user = userId();
    if (user) {
        try {
            const next = createMarks({ get: () => content.kv['wave.marks.v1'] ?? null, set: () => undefined }).getSnapshot();
            const had = await history.marks(user);
            const now = Date.now();
            for (const mark of had) if (mark.kind && !(mark.id in (mark.kind === 'artist' ? next.artists : next.tracks))) await history.removeMark(user, mark.kind, mark.id);
            const blank = { at: now, genre: '', tags: '' };
            for (const [id, name] of Object.entries(next.artists)) await history.setMark(user, { ...blank, kind: 'artist', id: Number(id), artist: Number(id), name });
            for (const [id, title] of Object.entries(next.tracks)) {
                if (!had.some((mark) => mark.kind === 'track' && mark.id === Number(id))) await history.setMark(user, { ...blank, kind: 'track', id: Number(id), artist: 0, title, name: '' });
            }
            taste.invalidate(user);
        } catch (error) {
            console.warn('Копия: отметки не перенесены в журнал вкуса', error);
        }
    }
    diagnostics.record('backup', 'Копия восстановлена');
    return 'ok';
}
