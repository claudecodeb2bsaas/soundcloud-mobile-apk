import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createHistory, type Db, type PlayRecord } from './history';

// Тот же SQL, что идёт в expo-sqlite, проверяется на встроенном в Node SQLite
function memoryDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => sqlite.exec(sql),
    run: async (sql, params = []) => void sqlite.prepare(sql).run(...params),
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>,
  };
}

const play = (extra: Partial<PlayRecord> & { id: number; at: number }): PlayRecord => ({
  artist: 7, dur: 200000, heard: 200000, end: 'done', endedBy: 'auto', source: 'wave:similar', why: 'similar', ...extra,
});

describe('история прослушиваний', () => {
  it('пишет и читает прослушивания для вкуса, старые сверху, по аккаунтам', async () => {
    const history = createHistory(memoryDb());
    await history.add(1, play({ id: 10, at: 2000, genre: 'phonk', tags: 'drift', title: 'T', artistName: 'A', path: '/a/t', artwork: 'x' }));
    await history.add(1, play({ id: 11, at: 1000, end: 'skip', endedBy: 'user', heard: 5000, source: 'app', picked: true, likedNow: true }));
    await history.add(2, play({ id: 12, at: 1500 }));
    const plays = await history.tastePlays(1, 0);
    expect(plays.map((p) => p.id)).toEqual([11, 10]);
    expect(plays[0]).toMatchObject({ end: 'skip', endedBy: 'user', picked: true, likedNow: true, covered: null, source: 'app' });
    expect(plays[1]).toMatchObject({ genre: 'phonk', tags: 'drift', title: 'T', artistName: 'A', path: '/a/t', looped: false, away: false });
    expect((await history.tastePlays(1, 1500)).map((p) => p.id)).toEqual([10]);
  });

  it('тот же трек сразу после дослушивания это круг повтора', async () => {
    const history = createHistory(memoryDb());
    await history.add(1, play({ id: 10, at: 1000 }));
    await history.add(1, play({ id: 10, at: 201000 }));
    await history.add(1, play({ id: 10, at: 9000000 }));
    expect((await history.tastePlays(1, 0)).map((p) => p.looped)).toEqual([false, true, false]);
  });

  it('waveOrigins считает дослушанное и ранние пропуски только по решениям человека', async () => {
    const history = createHistory(memoryDb());
    const wave = (id: number, at: number, extra: Partial<PlayRecord>) => history.add(1, play({ id, at, ...extra }));
    await wave(1, 1000, { origin: 'similar' });
    await wave(2, 300000, { origin: 'similar', end: 'skip', endedBy: 'user', heard: 5000 });
    await wave(3, 600000, { origin: 'similar', end: 'skip', endedBy: 'auto', heard: 5000 });
    await wave(4, 900000, { origin: 'similar', end: 'stop', heard: 5000 });
    await wave(5, 1200000, { origin: 'scMix', why: 'scMix' });
    await wave(6, 1500000, { why: 'tasteArtist', origin: undefined });
    await wave(7, 1800000, { source: 'wave:library', origin: 'library' });
    await wave(8, 2100000, { source: 'app', origin: undefined });
    const slices = await history.waveOrigins(1, 0, 10000000);
    expect(slices).toEqual(expect.arrayContaining([{ key: 'similar', done: 1, early: 1 }, { key: 'scMix', done: 1, early: 0 }, { key: '', done: 1, early: 0 }]));
    expect(slices).toHaveLength(3);
  });

  it('heardIds берёт от 30 секунд, recentDone дослушанное без повторов, новые первыми', async () => {
    const history = createHistory(memoryDb());
    await history.add(1, play({ id: 1, at: 1000, heard: 29000, end: 'skip', endedBy: 'user' }));
    await history.add(1, play({ id: 2, at: 2000, title: 'Two', artistName: 'B', artist: 9, path: '/b/two' }));
    await history.add(1, play({ id: 3, at: 3000 }));
    await history.add(1, play({ id: 2, at: 400000, title: 'Two', artistName: 'B', artist: 9, path: '/b/two' }));
    expect((await history.heardIds(1, 0)).sort()).toEqual([2, 3]);
    const done = await history.recentDone(1, 0);
    expect(done.map((t) => t.id)).toEqual([2, 3]);
    expect(done[0]).toMatchObject({ user_id: 9, user: { username: 'B' }, kind: 'track' });
    expect(await history.recentDone(1, 500000)).toEqual([]);
  });

  it('отметки вкуса: запись, замена, снятие и стирание аккаунта', async () => {
    const history = createHistory(memoryDb());
    await history.setMark(1, { kind: 'track', id: 5, artist: 7, genre: 'g', tags: 't', title: 'Song', name: 'Ann', at: 100 });
    await history.setMark(1, { kind: 'artist', id: 7, artist: 7, genre: '', tags: '', name: 'Ann', at: 200 });
    await history.setMark(1, { kind: 'track', id: 5, artist: 7, genre: 'g2', tags: 't', title: 'Song', name: 'Ann', at: 300 });
    const marks = await history.marks(1);
    expect(marks).toHaveLength(2);
    expect(marks.find((m) => m.kind === 'track')).toMatchObject({ genre: 'g2', at: 300, title: 'Song' });
    await history.removeMark(1, 'artist', 7);
    expect((await history.marks(1)).map((m) => m.kind)).toEqual(['track']);
    await history.add(1, play({ id: 1, at: 1 }));
    await history.clear(1);
    expect(await history.marks(1)).toEqual([]);
    expect(await history.tastePlays(1, 0)).toEqual([]);
  });
});
