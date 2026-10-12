import { COUNTED_MS, HEARD_MIN_MS, type TasteMark, type TastePlay, type WaveSlice } from '../core/historyTypes';
import type { WaveTrack } from '../core/waveTypes';

// История прослушиваний и отметки вкуса в SQLite (на desktop это historyIndex на node:sqlite). Одна таблица plays
// с описанием трека прямо в строке, без отдельной таблицы треков. База приходит снаружи (Db), поэтому проверяется
// в тестах на node:sqlite, а в приложении идёт через expo-sqlite.

export interface Db {
    exec(sql: string): Promise<void>;
    run(sql: string, params?: Array<string | number | null>): Promise<void>;
    all(sql: string, params?: Array<string | number | null>): Promise<Array<Record<string, unknown>>>;
}

/** Завершённое прослушивание. at: когда началось, мс */
export interface PlayRecord {
    at: number;
    id: number;
    artist: number;
    dur: number;
    heard: number;
    covered?: number | null;
    end: 'done' | 'skip' | 'stop';
    endedBy?: 'user' | 'auto';
    /** 'wave:similar', 'wave:track', 'wave:library', ... или 'app' для обычной очереди */
    source: string;
    /** Видимая причина (вид WaveReason) и исходная причина до подмены вкусом */
    why?: string;
    origin?: string;
    preset?: string;
    likedNow?: boolean;
    picked?: boolean;
    looped?: boolean;
    genre?: string;
    tags?: string;
    title?: string;
    artistName?: string;
    path?: string;
    artwork?: string;
}

export interface History {
    add(user: number, play: PlayRecord): Promise<void>;
    /** С момента since, старые сверху */
    tastePlays(user: number, since: number): Promise<TastePlay[]>;
    /** Исход треков волны за [from, to) по исходной причине (поправка источников вкуса) */
    waveOrigins(user: number, from: number, to: number): Promise<WaveSlice[]>;
    /** Id треков, слышанных от 30 секунд с момента since */
    heardIds(user: number, since: number): Promise<number[]>;
    /** Дослушанное с момента since, новые первыми, без повторов */
    recentDone(user: number, since: number, limit?: number): Promise<WaveTrack[]>;
    setMark(user: number, mark: TasteMark & { kind: NonNullable<TasteMark['kind']> }): Promise<void>;
    removeMark(user: number, kind: string, id: number): Promise<void>;
    marks(user: number): Promise<TasteMark[]>;
    /** Стирает историю и отметки аккаунта */
    clear(user: number): Promise<void>;
}

/** Тот же трек сразу после своего дослушивания, с запасом на паузу */
const LOOP_GAP_MS = 15000;

const SCHEMA = `
create table if not exists plays (
    user integer not null, at integer not null, id integer not null,
    artist integer not null default 0, dur integer not null, heard integer not null, covered integer,
    end text not null, ended_by text, source text not null, why text, origin text, preset text,
    liked_now integer not null default 0, picked integer not null default 0, looped integer not null default 0, away integer not null default 0,
    genre text, tags text, title text, artist_name text, path text, artwork text,
    primary key (user, at, id)) without rowid;
create table if not exists marks (
    user integer not null, kind text not null, id integer not null, artist integer not null default 0,
    genre text, tags text, title text, name text, at integer not null,
    primary key (user, kind, id)) without rowid;
`;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Таблицы создаются при первом обращении; каждый метод ждёт их */
export function createHistory(db: Db): History {
    const ready = db.exec(SCHEMA);
    // Сбой схемы всплывёт в первом же методе; без этого он остался бы необработанным отказом
    ready.catch(() => undefined);
    const impl = build(db);
    return Object.fromEntries(
        Object.entries(impl).map(([name, method]) => [name, async (...args: unknown[]) => { await ready; return (method as (...a: unknown[]) => unknown)(...args); }]),
    ) as unknown as History;
}

function build(db: Db): History {
    return {
        async add(user, play) {
            const [previous] = await db.all('select id, end, dur, heard, at from plays where user = ? order by at desc limit 1', [user]);
            const after =
                !!previous && num(previous.id) === play.id && previous.end === 'done' &&
                play.at - num(previous.at) <= Math.max(num(previous.dur), num(previous.heard)) + LOOP_GAP_MS;
            await db.run(
                'insert or replace into plays (user, at, id, artist, dur, heard, covered, end, ended_by, source, why, origin, preset, liked_now, picked, looped, away, ' +
                    'genre, tags, title, artist_name, path, artwork) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)',
                [
                    user, Math.round(play.at), play.id, play.artist, Math.round(play.dur), Math.round(play.heard), play.covered ?? null, play.end, play.endedBy ?? null,
                    play.source, play.why ?? null, play.origin ?? null, play.preset ?? null, play.likedNow ? 1 : 0, play.picked ? 1 : 0, play.looped || after ? 1 : 0,
                    play.genre ?? '', play.tags ?? '', play.title ?? '', play.artistName ?? '', play.path ?? '', play.artwork ?? '',
                ],
            );
        },

        async tastePlays(user, since) {
            const rows = await db.all(
                "select at, id, artist, heard, dur, end, source, liked_now, away, covered, coalesce(ended_by, '') as ended_by, picked, looped, genre, tags, title, artist_name, artwork, path " +
                    'from plays where user = ? and at >= ? order by at',
                [user, since],
            );
            return rows.map((row): TastePlay => {
                const endedBy = str(row.ended_by);
                return {
                    at: num(row.at), id: num(row.id), artist: num(row.artist), heard: num(row.heard), dur: num(row.dur), end: str(row.end), source: str(row.source),
                    likedNow: num(row.liked_now) === 1, away: num(row.away) === 1, covered: row.covered === null || row.covered === undefined ? null : num(row.covered),
                    endedBy: endedBy === 'user' || endedBy === 'auto' ? endedBy : '', picked: num(row.picked) === 1, looped: num(row.looped) === 1,
                    genre: str(row.genre), tags: str(row.tags), title: str(row.title), artistName: str(row.artist_name), artwork: str(row.artwork), path: str(row.path),
                };
            });
        },

        async waveOrigins(user, from, to) {
            // Оцениваются треки, по которым человек решил сам: не простой, не закрытие, не смена самим плеером, не круг повтора
            const rows = await db.all(
                "select coalesce(origin, case when why in ('tasteArtist', 'tasteTag') then '' else coalesce(why, '') end) as key, heard, dur, covered, end, ended_by from plays " +
                    "where user = ? and source like 'wave:%' and source not in ('wave:library', 'wave:forgotten', 'wave:radar', 'wave:artistAll') " +
                    "and ended_by is not null and away = 0 and end != 'stop' and not (end = 'skip' and ended_by = 'auto') and looped = 0 and at >= ? and at < ?",
                [user, from, to],
            );
            const slices = new Map<string, WaveSlice>();
            for (const row of rows) {
                const key = str(row.key);
                const slice = slices.get(key) ?? { key, done: 0, early: 0 };
                const heard = num(row.heard);
                const dur = num(row.dur);
                const covered = row.covered === null || row.covered === undefined ? heard : num(row.covered);
                if ((dur > 0 && Math.min(heard, covered) >= dur * 0.8) || (dur <= 0 && row.end === 'done')) slice.done++;
                else if (row.end === 'skip' && row.ended_by === 'user' && heard >= HEARD_MIN_MS && heard < COUNTED_MS) slice.early++;
                slices.set(key, slice);
            }
            return [...slices.values()].sort((a, b) => b.done + b.early - (a.done + a.early) || a.key.localeCompare(b.key));
        },

        async heardIds(user, since) {
            const rows = await db.all('select distinct id from plays where user = ? and at >= ? and heard >= ?', [user, since, COUNTED_MS]);
            return rows.map((row) => num(row.id));
        },

        async recentDone(user, since, limit = 20) {
            const rows = await db.all(
                "select id, artist, dur, genre, tags, title, artist_name, path, max(at) as at from plays where user = ? and at >= ? and end = 'done' and away = 0 group by id order by at desc limit ?",
                [user, since, limit],
            );
            return rows.map((row): WaveTrack => {
                const artist = num(row.artist) || undefined;
                return {
                    id: num(row.id), kind: 'track', title: str(row.title), duration: num(row.dur), genre: str(row.genre), tag_list: str(row.tags),
                    user_id: artist, user: { id: artist, username: str(row.artist_name) }, permalink_url: str(row.path) ? 'https://soundcloud.com' + str(row.path) : '',
                };
            });
        },

        async setMark(user, mark) {
            await db.run(
                'insert or replace into marks (user, kind, id, artist, genre, tags, title, name, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [user, mark.kind, mark.id, mark.artist, mark.genre, mark.tags, mark.title ?? '', mark.name ?? '', mark.at],
            );
        },

        async removeMark(user, kind, id) {
            await db.run('delete from marks where user = ? and kind = ? and id = ?', [user, kind, id]);
        },

        async marks(user) {
            const rows = await db.all('select kind, id, artist, genre, tags, title, name, at from marks where user = ?', [user]);
            return rows.map((row): TasteMark => ({
                id: num(row.id), artist: num(row.artist), genre: str(row.genre), tags: str(row.tags), at: num(row.at),
                kind: str(row.kind) as TasteMark['kind'], title: str(row.title), name: str(row.name),
            }));
        },

        async clear(user) {
            await db.run('delete from plays where user = ?', [user]);
            await db.run('delete from marks where user = ?', [user]);
        },
    };
}
