import { describe, expect, it } from 'vitest';
import { tasteMaps } from '../core/waveTaste';
import type { ScMix } from '../core/wave/sources';
import type { TasteMaps, WaveTrack } from '../core/waveTypes';
import { createWave, type WaveApi } from './engine';

const names = ['Aurora', 'Basalt', 'Cinder', 'Delta', 'Ember', 'Fjord', 'Garnet', 'Harbor', 'Indigo', 'Jasper', 'Kestrel', 'Lantern', 'Meridian', 'Nebula', 'Obsidian', 'Prism', 'Quartz', 'Rift', 'Solstice', 'Tundra'];
// У каждого трека своё название и свой аккаунт: правила копий и версий не должны вмешиваться
const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
  id, kind: 'track', title: `${names[id % names.length]} ${id}`, duration: 200000, user_id: 1000 + id, user: { id: 1000 + id, username: `artist${id}` }, ...extra,
});

function fakeApi(overrides: Partial<WaveApi> = {}): WaveApi & { calls: string[] } {
  const calls: string[] = [];
  const api: WaveApi = {
    history: async () => [track(1), track(2)],
    likes: async () => ({ ids: [3, 4], tracks: [track(3), track(4)] }),
    related: async (id) => { calls.push('related:' + id); return Array.from({ length: 8 }, (_, i) => track(id * 100 + i)); },
    artistTop: async (id) => { calls.push('top:' + id); return [track(900 + id), track(910 + id)]; },
    genrePage: async (source, tag, query) => {
      calls.push(`genre:${source}:${tag}:${query ? 'next' : 'first'}`);
      const base = (source === 'recent' ? 5000 : 6000) + (query ? 10 : 0);
      return { items: [track(base), track(base + 1)], next: query ? null : { offset: '1' } };
    },
    ...overrides,
  };
  return Object.assign(api, { calls });
}

const ids = (list: Array<{ track: WaveTrack }>) => list.map((c) => c.track.id);

describe('обычная волна', () => {
  it('берёт похожее на зёрна из истории и лайков, без повторов и без уже слышанного', async () => {
    const api = fakeApi();
    const wave = createWave(api, { mode: 'similar' });
    const batch = await wave.next(10);
    expect(batch.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ids(batch)).size).toBe(batch.length);
    for (const candidate of batch) {
      expect([1, 2, 3, 4]).not.toContain(candidate.track.id);
      expect(candidate.reason.kind).toBe('similar');
    }
    const second = await wave.next(5);
    expect(ids(second).filter((id) => ids(batch).includes(id))).toEqual([]);
  });

  it('«Новое»: лайкнутое и слышанное не попадает, знакомый артист не «новый»', async () => {
    const api = fakeApi({
      related: async () => [track(1), track(3), track(50), track(51, { user_id: 1001, user: { id: 1001, username: 'artist1' } })],
    });
    const batch = await createWave(api, { mode: 'fresh' }).next(10);
    expect(Object.fromEntries(batch.map((c) => [c.track.id, c.reason.kind]))).toEqual({ 50: 'newArtist', 51: 'fresh' });
  });

  it('«Не нравится» и скрытые артисты не попадают, у зёрен тоже', async () => {
    const api = fakeApi({ related: async (id) => (id === 3 || id === 4 ? [track(60), track(61), track(62)] : []) });
    const batch = await createWave(api, {
      mode: 'similar',
      excluded: () => ({ tracks: new Set([60]), artists: new Set([1061]) }),
    }).next(10);
    expect(ids(batch)).toEqual([62]);
  });

  it('без истории и лайков волна пуста, без обоих источников ошибка', async () => {
    const empty = fakeApi({ history: async () => [], likes: async () => ({ ids: [], tracks: [] }) });
    expect(await createWave(empty, { mode: 'similar' }).next(5)).toEqual([]);
    const broken = fakeApi({ history: async () => { throw new Error('h'); }, likes: async () => { throw new Error('l'); } });
    await expect(createWave(broken, { mode: 'similar' }).next(5)).rejects.toThrow('h');
  });

  it('один источник профиля может упасть', async () => {
    const api = fakeApi({ history: async () => { throw new Error('h'); } });
    expect((await createWave(api, { mode: 'similar' }).next(5)).length).toBeGreaterThan(0);
  });

  it('все запросы похожих упали: ошибка, а если часть пачки есть, она отдаётся', async () => {
    const down = fakeApi({ related: async () => { throw new Error('net'); } });
    await expect(createWave(down, { mode: 'similar' }).next(5)).rejects.toThrow('Источники');
    let calls = 0;
    const flaky = fakeApi({
      related: async (id) => { if (calls++ >= 3) throw new Error('net'); return [track(id * 100), track(id * 100 + 1), track(id * 100 + 2)]; },
    });
    expect((await createWave(flaky, { mode: 'similar' }).next(50)).length).toBeGreaterThan(0);
  });

  it('жанр: страницы жанра идут по курсору и попадают в пул с причиной', async () => {
    const api = fakeApi({ related: async () => [] });
    const wave = createWave(api, { mode: 'similar', genre: 'phonk' });
    const batch = await wave.next(10);
    expect(api.calls).toContain('genre:recent:phonk:first');
    expect(api.calls).toContain('genre:search:phonk:next');
    expect(batch.map((c) => c.reason.kind).sort()).toContain('genreFresh');
    expect(batch.map((c) => c.reason.kind)).toContain('genrePopular');
  });
});

describe('волна от трека и артиста', () => {
  it('от трека: сам трек не возвращается, похожие находятся от него', async () => {
    const seed = track(77);
    const api = fakeApi({ related: async (id) => [track(id), track(78), track(79), track(80), track(81)] });
    const batch = await createWave(api, { mode: 'similar', seed: { kind: 'track', track: seed } }).next(4);
    expect(ids(batch).sort()).toEqual([78, 79, 80, 81]);
    expect(api.calls).not.toContain('top:1077');
  });

  it('от трека без похожих берёт другие треки артиста', async () => {
    const seed = track(77);
    const api = fakeApi({ related: async () => [] });
    const batch = await createWave(api, { mode: 'similar', seed: { kind: 'track', track: seed } }).next(5);
    expect(api.calls).toContain('top:1077');
    expect(batch.every((c) => c.reason.kind === 'artistTrack')).toBe(true);
  });

  it('от артиста: его лучшее первым, даже если слышано, потом похожее', async () => {
    const api = fakeApi({
      history: async () => [track(905)],
      related: async (id) => [track(id * 10 + 1), track(id * 10 + 2)],
    });
    const batch = await createWave(api, { mode: 'similar', seed: { kind: 'artist', id: 5, name: 'Five' } }).next(6);
    expect(ids(batch).slice(0, 2).sort()).toEqual([905, 915]);
    expect(batch[0].reason).toEqual({ kind: 'artistTrack', artist: 'Five' });
    expect(batch.length).toBeGreaterThan(2);
  });

  it('параллельные вызовы next не отдают один трек дважды', async () => {
    const api = fakeApi();
    const wave = createWave(api, { mode: 'similar' });
    const [a, b] = await Promise.all([wave.next(4), wave.next(4)]);
    const all = [...ids(a), ...ids(b)];
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---- полные алгоритмы: вкус, станция, подборки, соседи, настроение, «Моя музыка» ----
const maps = (input: object) => tasteMaps({ version: 7, artists: [], credits: [], families: [], tags: [], markers: [], tracks: [], langs: [], contexts: [], sources: [], ...input }) as TasteMaps;
const mix = (ids: number[]): ScMix => ({ kind: 'mix', title: 'Your Mix 1', urn: 'soundcloud:system-playlists:your-moods:1', ids, owner: 0 });
const sourcesApi = (extra: Partial<NonNullable<WaveApi['sources']>> = {}): NonNullable<WaveApi['sources']> => ({
  relatedArtists: async () => [],
  topTracks: async () => [],
  scMixes: async () => [],
  tracksByIds: async (list) => list.map((id) => track(id)),
  neighbors: async () => [],
  ...extra,
});

describe('вкус в подборе', () => {
  it('любимый артист получает причину по вкусу, трек с сильным минусом не берётся', async () => {
    const api = fakeApi({
      related: async () => [track(10), track(11), track(12), track(13), track(14), track(15)],
      taste: async () => maps({ artists: [[1010, 6]], tracks: [[11, -2]] }),
    });
    const batch = await createWave(api, { mode: 'similar' }).next(10);
    expect(ids(batch)).not.toContain(11);
    expect(batch.find((c) => c.track.id === 10)?.reason).toEqual({ kind: 'tasteArtist', artist: 'artist10' });
  });

  it('вкус не загрузился: подбор идёт перемешиванием', async () => {
    const api = fakeApi({ taste: async () => { throw new Error('db'); } });
    expect((await createWave(api, { mode: 'similar' }).next(5)).length).toBe(5);
  });

  it('кириллица от неизвестного артиста не проходит, от знакомого проходит', async () => {
    const cyr = (id: number, user: number): WaveTrack => track(id, { title: 'Привет мир ' + id, user_id: user, user: { id: user, username: 'u' + user } });
    const api = fakeApi({ related: async () => [cyr(20, 5000), cyr(21, 1001), track(22)], taste: async () => maps({ artists: [[1001, 2]] }) });
    const batch = await createWave(api, { mode: 'similar' }).next(10);
    expect(ids(batch).sort()).toEqual([21, 22]);
  });

  it('feedback учитывает отданные треки и не падает на чужих', async () => {
    const wave = createWave(fakeApi(), { mode: 'similar' });
    const batch = await wave.next(6);
    wave.feedback(batch[0].track, -1);
    wave.feedback(track(99999), -1);
    expect((await wave.next(3)).length).toBeGreaterThan(0);
  });
});

describe('источники', () => {
  it('станция трека берётся, когда похожих мало, и идёт со своим происхождением', async () => {
    const stations: number[] = [];
    const api = fakeApi({
      related: async () => [],
      station: async (id) => { stations.push(id); return [track(70), track(71), track(72)]; },
    });
    const batch = await createWave(api, { mode: 'similar', seed: { kind: 'track', track: track(77) } }).next(3);
    expect(stations).toEqual([77]);
    expect(ids(batch).sort()).toEqual([70, 71, 72]);
    expect(batch.every((c) => c.trace?.origin === 'station' && c.reason.kind === 'similar')).toBe(true);
  });

  it('подборки SoundCloud: по десять за проход, причина с названием подборки', async () => {
    const api = fakeApi({ related: async () => [], sources: sourcesApi({ scMixes: async () => [mix(Array.from({ length: 25 }, (_, i) => 300 + i))] }) });
    const batch = await createWave(api, { mode: 'similar' }).next(12);
    expect(batch.length).toBe(12);
    expect(batch.every((c) => c.reason.kind === 'scMix' && c.reason.name === 'Your Mix 1')).toBe(true);
  });

  it('соседи по вкусу: находки без уже лайкнутого, причина neighbors', async () => {
    const api = fakeApi({
      related: async () => [],
      sources: sourcesApi({ neighbors: async () => [{ id: 3, count: 4 }, { id: 400, count: 3 }, { id: 401, count: 2 }] }),
    });
    const batch = await createWave(api, { mode: 'similar' }).next(5);
    expect(Object.fromEntries(batch.map((c) => [c.track.id, c.reason.kind]))).toEqual({ 400: 'neighbors', 401: 'neighbors' });
  });

  it('начало волны: последнее дослушанное зерном и лучший трек похожего артиста его автора', async () => {
    const asked: number[] = [];
    const api = fakeApi({
      related: async (id) => { asked.push(id); return []; },
      recentDone: async () => [track(55)],
      sources: sourcesApi({ relatedArtists: async () => [{ id: 900, username: 'Near', tracks: 5, followers: 5 }], topTracks: async () => [track(901), track(902)] }),
    });
    const batch = await createWave(api, { mode: 'similar' }).next(3);
    expect(asked[0]).toBe(55);
    expect(asked).toContain(901);
    expect(batch.find((c) => c.track.id === 901)?.reason).toEqual({ kind: 'relatedArtist', artist: 'artist55' });
  });

  it('волна от артиста берёт лучшее восьми его похожих артистов', async () => {
    const api = fakeApi({
      related: async () => [],
      sources: sourcesApi({
        relatedArtists: async () => Array.from({ length: 10 }, (_, i) => ({ id: 800 + i, username: 'n' + i, tracks: 3, followers: 3 })),
        topTracks: async (id) => [track(id * 10), track(id * 10 + 1), track(id * 10 + 2), track(id * 10 + 3)],
      }),
    });
    const batch = await createWave(api, { mode: 'similar', seed: { kind: 'artist', id: 5, name: 'Five' } }).next(40);
    const near = batch.filter((c) => c.reason.kind === 'relatedArtist');
    expect(near).toHaveLength(24);
    expect(near.every((c) => c.reason.kind === 'relatedArtist' && c.reason.artist === 'Five')).toBe(true);
  });
});

describe('настроение', () => {
  it('в первую очередь идёт подходящее настроению, метки настроения ищутся на сайте', async () => {
    const mood = (id: number, genre: string) => track(id, { genre });
    const api = fakeApi({
      related: async () => [mood(10, 'phonk'), mood(11, 'ambient'), mood(12, 'drill'), mood(13, 'ambient'), mood(14, 'metal'), mood(15, 'jazz')],
    });
    const batch = await createWave(api, { mode: 'similar', preset: 'aggressive' }).next(3);
    expect(batch).toHaveLength(3);
    expect(batch.every((c) => ['phonk', 'drill', 'metal'].includes(c.track.genre ?? ''))).toBe(true);
    expect(api.calls.filter((call) => call.startsWith('genre:')).map((call) => call.split(':')[2]).sort()).toEqual(['aggressive', 'aggressive', 'phonk', 'rage']);
  });

  it('подходящего мало: после двух проходов добиваются ближайшие по настроению', async () => {
    const api = fakeApi({ related: async () => [track(10, { genre: 'phonk' }), track(11, { genre: 'ambient' }), track(12, { genre: 'jazz' })] });
    const batch = await createWave(api, { mode: 'similar', preset: 'aggressive' }).next(6);
    expect(batch.length).toBeGreaterThan(1);
    expect(batch[0].track.id).toBe(10);
  });

  it('у волны от трека пресет не действует', async () => {
    const api = fakeApi({ related: async () => [track(10, { genre: 'ambient' }), track(11, { genre: 'jazz' }), track(12), track(13)] });
    const batch = await createWave(api, { mode: 'similar', preset: 'aggressive', seed: { kind: 'track', track: track(77) } }).next(4);
    expect(batch).toHaveLength(4);
    expect(api.calls.some((call) => call.startsWith('genre:'))).toBe(false);
  });
});

describe('«Моя музыка»', () => {
  const entries = (n: number, from = 'Chill') => Array.from({ length: n }, (_, i) => ({ track: track(500 + i), from }));

  it('по порядку: свой пул целиком впереди, без обращений за похожим, потом найденное', async () => {
    const api = fakeApi();
    const wave = createWave(api, { mode: 'similar', seed: { kind: 'library', title: 'Chill', own: entries(15), order: 'fixed', seeds: [track(500)] } });
    const first = await wave.next(10);
    expect(ids(first)).toEqual(Array.from({ length: 10 }, (_, i) => 500 + i));
    expect(first[0].reason).toEqual({ kind: 'library', name: 'Chill' });
    expect(api.calls.filter((call) => call.startsWith('related'))).toEqual([]);
    const second = await wave.next(10);
    expect(ids(second).slice(0, 5)).toEqual([510, 511, 512, 513, 514]);
    expect(second.length).toBeGreaterThan(5);
    expect(second[5].reason.kind).toBe('similar');
  });

  it('умное: три своих, один найденный; лайкнутое среди найденного не берётся', async () => {
    const api = fakeApi({ related: async () => [track(3), track(60), track(61), track(62), track(63)] });
    const wave = createWave(api, { mode: 'similar', seed: { kind: 'library', title: 'Mix', own: entries(12), order: 'smart', seeds: [track(500), track(501)] } });
    const batch = await wave.next(8);
    expect(batch.map((c) => (c.reason.kind === 'library' ? 'own' : 'found'))).toEqual(['own', 'own', 'own', 'found', 'own', 'own', 'own', 'found']);
    expect(ids(batch)).not.toContain(3);
  });
});