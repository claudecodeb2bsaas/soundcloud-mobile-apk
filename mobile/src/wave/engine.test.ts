import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
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
