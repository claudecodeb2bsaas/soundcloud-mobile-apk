import * as SQLite from 'expo-sqlite';
import type { Db } from './history';

// База приложения на expo-sqlite. Открывается лениво один раз; прослушивания и отметки живут в wave.db
let opened: Promise<SQLite.SQLiteDatabase> | null = null;
const open = (): Promise<SQLite.SQLiteDatabase> => (opened ??= SQLite.openDatabaseAsync('wave.db'));

export const expoDb: Db = {
    exec: async (sql) => (await open()).execAsync(sql),
    run: async (sql, params = []) => void (await (await open()).runAsync(sql, params)),
    all: async (sql, params = []) => (await open()).getAllAsync<Record<string, unknown>>(sql, params),
};
