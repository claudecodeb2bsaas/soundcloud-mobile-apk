import { describe, expect, it } from 'vitest';
import { tasteMaps } from '../core/waveTaste';
import type { ScMix } from '../core/wave/sources';
import type { TasteMaps, WaveTrack } from '../core/waveTypes';
import { createWave, type WaveApi, type WaveSignal } from './engine';

// П7 (признак серии пропусков), П8 (развилка «Куда дальше?») и свой вкус в пресете: сигналы волны после ранних пропусков

const names = ['Aurora', 'Basalt', 'Cinder', 'Delta', 'Ember', 'Fjord', 'Garnet', 'Harbor', 'Indigo', 'Jasper', 'Kestrel', 'Lantern', 'Meridian', 'Nebula', 'Obsidian', 'Prism'];
const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
  id, kind: 'track', title: `${names[id % names.length]} ${id}`, duration: 200000, user_id: 1000 + id, user: { id: 1000 + id, username: `artist${id}` }, ...extra,
});
const maps = (input: object) => tasteMaps({ version: 7, artists: [], credits: [], families: [], tags: [], markers: [], tracks: [], langs: [], contexts: [], sources: [], ...input }) as TasteMaps;
const mix = (ids: number[]): ScMix => ({ kind: 'mix', title: 'Your Mix 1', urn: 'soundcloud:system-playlists:your-moods:1', ids, owner: 0 });

function fakeApi(overrides: Partial<WaveApi> = {}): WaveApi {
  return {
    history: async () => [track(1), track(2)],
    likes: async () => ({ ids: [3, 4], tracks: [track(3), track(4)] }),
    related: async (id) => Array.from({ length: 8 }, (_, i) => track(id * 100 + i)),
    artistTop: async () => [],
    genrePage: async () => ({ items: [], next: null }),
    ...overrides,
  };
}

const kinds = (signals: WaveSignal[]) => signals.map((signal) => signal.kind);

describe('ранние пропуски: признак серии (П7)', () => {
  const slowed = (id: number) => track(id, { title: `${names[id % names.length]} ${id} (slowed)`, genre: 'Phonk' });

  it('первый пропуск только пересборка, второй с общим признаком серии прижимает его', async () => {
    const wave = createWave(fakeApi({ related: async (id) => Array.from({ length: 6 }, (_, i) => slowed(id * 100 + i)) }), { mode: 'similar' });
    const batch = await wave.next(6);
    expect(kinds(wave.feedback(batch[0].track, -1, 20000))).toEqual(['rebuild']);
    const second = wave.feedback(batch[1].track, -1, 20000);
    expect(kinds(second)).toEqual(['trait', 'rebuild']);
    expect(second[0]).toMatchObject({ kind: 'trait', trait: { kind: 'marker', key: 'slowed' } });
    // Прижатое не повторяется на третьем пропуске: берётся следующий общий признак (жанр)
    const third = wave.feedback(batch[2].track, -1, 20000);
    expect(third.find((signal) => signal.kind === 'trait')).toMatchObject({ trait: { kind: 'genre', key: 'phonk' } });
  });

  it('дослушанный трек обрывает серию, «Отменить» снимает прижим', async () => {
    const wave = createWave(fakeApi({ related: async (id) => Array.from({ length: 6 }, (_, i) => slowed(id * 100 + i)) }), { mode: 'similar' });
    const batch = await wave.next(6);
    wave.feedback(batch[0].track, -1, 20000);
    wave.listened(batch[1].track);
    // Серия началась заново: это снова первый пропуск
    expect(kinds(wave.feedback(batch[2].track, -1, 20000))).toEqual(['rebuild']);
    wave.feedback(batch[3].track, -1, 20000);
    wave.releaseTrait('marker:slowed');
    expect(kinds(wave.feedback(batch[4].track, -1, 20000))).toContain('trait');
  });

  it('лайк сигналов не даёт, чужой трек игнорируется', async () => {
    const wave = createWave(fakeApi(), { mode: 'similar' });
    const batch = await wave.next(4);
    expect(wave.feedback(batch[0].track, 1)).toEqual([]);
    expect(wave.feedback(track(99999), -1, 1000)).toEqual([]);
  });

  it('пропущенная версия и её копии в этой волне больше не встают', async () => {
    const wave = createWave(fakeApi({ related: async () => [track(10), track(11), track(12), track(13), track(14), track(15), track(16), track(17)] }), { mode: 'similar' });
    const first = await wave.next(2);
    wave.feedback(first[0].track, -1, 20000);
    const rest = await wave.next(20);
    expect(rest.map((item) => item.track.id)).not.toContain(first[0].track.id);
  });
});

describe('три быстрых пропуска: развилка (П8)', () => {
  function forkApi() {
    return fakeApi({
      related: async () => [track(10), track(11, { genre: 'ambient' }), track(12), track(13), track(14), track(15)],
      taste: async () => maps({ artists: [[1010, 6]] }),
      recentDone: async () => [track(55)],
      sources: {
        relatedArtists: async () => [{ id: 900, username: 'Near', tracks: 5, followers: 5 }],
        topTracks: async () => [track(901), track(902)],
        scMixes: async () => [mix(Array.from({ length: 12 }, (_, i) => 300 + i))],
        tracksByIds: async (ids) => ids.map((id) => track(id)),
        neighbors: async () => [{ id: 400, count: 3 }, { id: 401, count: 2 }],
      },
    });
  }

  it('открывает варианты разных артистов и направлений, выбор возвращает остальных в пул', async () => {
    const wave = createWave(forkApi(), { mode: 'similar' });
    const batch = await wave.next(2);
    wave.feedback(batch[0].track, -1, 1000);
    wave.feedback(batch[1].track, -1, 1000);
    const signals = wave.feedback(batch[0].track, -1, 1000);
    const fork = signals.find((signal) => signal.kind === 'fork');
    expect(fork).toBeTruthy();
    if (fork?.kind !== 'fork') return;
    expect(fork.options.length).toBeGreaterThanOrEqual(4);
    expect(fork.options.length).toBeLessThanOrEqual(5);
    expect(new Set(fork.options.map((option) => option.candidate.track.user_id)).size).toBe(fork.options.length);
    expect(kinds(signals).at(-1)).toBe('rebuild');
    expect(signals.some((signal) => signal.kind === 'rebuild' && signal.fresh)).toBe(false);
    const chosen = fork.options[1].candidate;
    expect(wave.pickFork(chosen.track.id)).toBe(chosen);
    // Выбранного в пуле уже нет, остальные варианты вернулись и снова могут встать
    const later = (await wave.next(40)).map((item) => item.track.id);
    expect(later).not.toContain(chosen.track.id);
    expect(later).toContain(fork.options[0].candidate.track.id);
    expect(wave.pickFork(12345)).toBeNull();
  });

  it('closeFork возвращает все варианты в пул', async () => {
    const wave = createWave(forkApi(), { mode: 'similar' });
    const batch = await wave.next(2);
    for (let i = 0; i < 3; i++) wave.feedback(batch[0].track, -1, 1000);
    wave.closeFork();
    expect(wave.pickFork(1)).toBeNull();
    wave.closeFork();
  });

  it('медленные пропуски развилку не открывают: пересборка со свежими зёрнами', async () => {
    const wave = createWave(forkApi(), { mode: 'similar' });
    const batch = await wave.next(2);
    const last = [wave.feedback(batch[0].track, -1, 8000), wave.feedback(batch[1].track, -1, 8000), wave.feedback(batch[0].track, -1, 8000)].at(-1) ?? [];
    expect(last.find((signal) => signal.kind === 'fork')).toBeUndefined();
    expect(last.find((signal) => signal.kind === 'rebuild')).toEqual({ kind: 'rebuild', fresh: true });
  });

  it('у подборки по порядку развилки нет', async () => {
    const own = Array.from({ length: 15 }, (_, i) => ({ track: track(500 + i), from: 'Chill' }));
    const wave = createWave(forkApi(), { mode: 'similar', seed: { kind: 'library', title: 'Chill', own, order: 'fixed', seeds: [track(500)] } });
    const batch = await wave.next(5);
    wave.feedback(batch[0].track, -1, 1000);
    wave.feedback(batch[1].track, -1, 1000);
    expect(wave.feedback(batch[2].track, -1, 1000).some((signal) => signal.kind === 'fork')).toBe(false);
  });
});

describe('пересборка впереди', () => {
  it('reclaim возвращает найденное в пул, а подборку в её очередь по порядку', async () => {
    const own = Array.from({ length: 12 }, (_, i) => ({ track: track(500 + i), from: 'Chill' }));
    const wave = createWave(fakeApi(), { mode: 'similar', seed: { kind: 'library', title: 'Chill', own, order: 'fixed', seeds: [track(500)] } });
    const first = await wave.next(10);
    const ahead = first.slice(5).map((item) => item.track);
    expect(wave.reclaim(ahead)).toBe(5);
    const again = await wave.next(5);
    expect(again.map((item) => item.track.id)).toEqual(ahead.map((item) => item.id));
    expect(wave.reclaim([track(99999)])).toBe(0);
  });
});

describe('свой вкус в пресете', () => {
  it('ранний пропуск в пресете копится по аккаунту и тегам, без пресета ничего не пишется', async () => {
    const saved: unknown[] = [];
    const api = fakeApi({ related: async () => [track(10, { genre: 'ambient', tag_list: 'calm' }), track(11, { genre: 'ambient' }), track(12, { genre: 'ambient' })] });
    const wave = createWave(api, { mode: 'similar', preset: 'calm', onPresetMarks: (marks) => saved.push(marks) });
    const batch = await wave.next(3);
    wave.feedback(batch[0].track, -1, 20000);
    expect(saved).toHaveLength(1);
    const marks = saved[0] as { calm: { a: Record<string, number>; t: Record<string, number> } };
    expect(marks.calm.a[String(batch[0].track.user_id)]).toBe(1);
    expect(marks.calm.t.ambient).toBeGreaterThan(0);
    // Лайк пресет не трогает
    wave.feedback(batch[1].track, 1);
    expect(saved).toHaveLength(1);

    const plain: unknown[] = [];
    const normal = createWave(fakeApi(), { mode: 'similar', onPresetMarks: (value) => plain.push(value) });
    const list = await normal.next(3);
    normal.feedback(list[0].track, -1, 20000);
    expect(plain).toEqual([]);
  });

  it('рано пропущенный аккаунт в пресете опускается ниже остальных', async () => {
    const calm = (id: number, user: number) => track(id, { genre: 'ambient', user_id: user, user: { id: user, username: 'u' + user } });
    const tracks = [calm(10, 7000), calm(11, 7001), calm(12, 7002), calm(13, 7003), calm(14, 7004), calm(15, 7005)];
    // Порядок взвешенно случайный: по многим волнам наказанные аккаунты в среднем стоят позже остальных
    const position = async (marks: boolean): Promise<number> => {
      let total = 0;
      for (let run = 0; run < 300; run++) {
        const wave = createWave(fakeApi({ related: async () => tracks, taste: async () => maps({}) }), {
          mode: 'similar', preset: 'calm', presetMarks: marks ? { calm: { a: { 7000: 2, 7001: 2 }, t: {} } } : {},
        });
        const order = (await wave.next(6)).map((item) => item.track.user_id);
        total += order.indexOf(7000) + order.indexOf(7001);
      }
      return total / 300 / 2;
    };
    expect(await position(true)).toBeGreaterThan((await position(false)) + 0.5);
  });
});
