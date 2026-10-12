import { describe, expect, it } from 'vitest';
import { WAVE_TEXTS } from '../core/waveTexts';
import type { TasteMaps, WaveTrack } from '../core/waveTypes';
import { createRadar, radarAccounts, radarReason, uploadOf, type RadarDeps } from './radar';

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();
const DAY = 86400000;
const iso = (ago: number): string => new Date(NOW - ago).toISOString();
const track = (id: number, uploader: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
  id, kind: 'track', title: `Fresh ${String.fromCharCode(65 + (id % 26))}${id}`, duration: 200000, user_id: uploader, user: { id: uploader, username: 'user' + uploader },
  genre: 'Techno', tag_list: 'techno', created_at: iso(2 * DAY), display_date: iso(2 * DAY), ...extra,
});

function setup(overrides: Partial<RadarDeps> = {}) {
  let stored: string | null = null;
  const calls: string[] = [];
  const deps: RadarDeps = {
    userId: () => 7,
    follows: async () => [11, 12],
    uploads: async (account) => {
      calls.push('uploads:' + account);
      return account === 11 ? [track(1, 11), track(2, 11, { created_at: iso(30 * DAY), display_date: iso(30 * DAY) })] : [];
    },
    tracksByIds: async (ids) => ids.map((id) => track(id, 11)),
    taste: async () => null,
    heard: async () => new Set<number>(),
    excluded: () => ({ tracks: new Set<number>(), artists: new Set<number>() }),
    store: { get: () => stored, set: (value) => { stored = value; } },
    texts: WAVE_TEXTS.ru,
    now: () => NOW,
    ...overrides,
  };
  return { radar: createRadar(deps), calls, deps, stored: () => stored };
}

describe('радар релизов', () => {
  it('загрузка берёт дату публикации и релиза; без аккаунта или негодная не годится', () => {
    const upload = uploadOf(track(5, 11, { release_date: '2026-10-14T00:00:00Z', publisher_metadata: { isrc: 'X1' } }));
    expect(upload).toMatchObject({ id: 5, uploader: 11, releaseDay: '2026-10-14', isrc: 'X1', uploaderName: 'user11' });
    expect(upload?.createdAt).toBe(Date.parse(iso(2 * DAY)));
    expect(uploadOf(track(6, 0, { user: undefined, user_id: undefined }))).toBeNull();
    expect(uploadOf(track(7, 11, { policy: 'BLOCK' }))).toBeNull();
  });

  it('аккаунты обхода: подписки и любимые по весу, скрытые не берутся, не больше 100', () => {
    const taste = { artists: new Map([[20, 0.9], [21, 0.1], [11, 0.5]]) } as unknown as TasteMaps;
    expect(radarAccounts([11, 12], taste, new Set([12]))).toEqual([11, 20]);
    expect(radarAccounts(Array.from({ length: 150 }, (_, i) => i + 1), null, new Set())).toHaveLength(100);
  });

  it('выпуск: свежий релиз подписки в списке, старая загрузка нет, причина «ты подписан»', async () => {
    const { radar } = setup();
    const view = await radar.load();
    expect(view.total).toBe(2);
    expect(view.checked).toBe(2);
    expect(view.edition.items.map((item) => item.id)).toEqual([1]);
    expect(radarReason(view.edition.items[0].reason, WAVE_TEXTS.ru)).toBe('Новое у user11, ты подписан');
  });

  it('слышанное уходит в конец, скрытый аккаунт и «Не нравится» не попадают', async () => {
    const many = [track(1, 11), track(2, 12), track(3, 13)];
    const { radar } = setup({ follows: async () => [11, 12, 13], uploads: async (account) => many.filter((item) => item.user_id === account), heard: async () => new Set([1]) });
    const view = await radar.load();
    expect(view.edition.items.map((item) => item.id)).toEqual([2, 3, 1]);
    const hidden = setup({ follows: async () => [11, 12, 13], uploads: async (account) => many.filter((item) => item.user_id === account), excluded: () => ({ tracks: new Set([3]), artists: new Set([12]) }) });
    expect((await hidden.radar.load()).edition.items.map((item) => item.id)).toEqual([1]);
  });

  it('выпуск живёт 6 часов и после перезапуска читается из хранилища; force собирает заново', async () => {
    let now = NOW;
    const ctx = setup({ now: () => now });
    await ctx.radar.load();
    await ctx.radar.load();
    expect(ctx.calls).toEqual(['uploads:11', 'uploads:12']);
    const restarted = createRadar({ ...ctx.deps, uploads: async () => { throw new Error('не должен звать'); } });
    expect((await restarted.load()).edition.items).toHaveLength(1);
    await ctx.radar.load(true);
    expect(ctx.calls).toHaveLength(4);
    now += 7 * 3600000;
    await ctx.radar.load();
    expect(ctx.calls).toHaveLength(6);
  });

  it('все каталоги не ответили: ошибка; часть ответила: выпуск с числом проверенных', async () => {
    await expect(setup({ uploads: async () => { throw new Error('сеть'); } }).radar.load()).rejects.toThrow();
    const view = await setup({ uploads: async (account) => { if (account === 12) throw new Error('сеть'); return [track(1, 11)]; } }).radar.load();
    expect(view.checked).toBe(1);
    expect(view.total).toBe(2);
  });

  it('волна по выпуску: причина радара, выбранная позиция первой', async () => {
    const many = [track(1, 11), track(2, 12), track(3, 13)];
    const { radar } = setup({ follows: async () => [11, 12, 13], uploads: async (account) => many.filter((item) => item.user_id === account), tracksByIds: async (ids) => many.filter((item) => ids.includes(item.id)) });
    const view = await radar.load();
    const seed = await radar.seed(view, 3);
    expect(seed.own[0].track.id).toBe(3);
    expect(seed.own).toHaveLength(3);
    expect(seed.own[0].reason).toEqual({ kind: 'radar', why: 'Новое у user13, ты подписан' });
  });
});
