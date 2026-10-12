import { describe, expect, it } from 'vitest';
import type { ApiClient } from './client';
import { createSoundCloud, idsOf, meOf, nextQueryOf, tracksOf } from './soundcloud';

function fakeApi(handler: (name: string, path: object, query: object) => unknown) {
  const calls: Array<{ name: string; path: object; query: object }> = [];
  const api = {
    call: async (name: string, path: object = {}, query: object = {}) => {
      calls.push({ name, path, query });
      return { status: 200, body: handler(name, path, query) };
    },
    callUrl: async () => ({ status: 200, body: null }),
    dispose: () => undefined,
  } as unknown as ApiClient;
  return { api, calls };
}

describe('разбор ответов', () => {
  it('nextQueryOf берёт параметры next_href без client_id', () => {
    expect(nextQueryOf({ next_href: 'https://api-v2.soundcloud.com/me/track_likes/ids?limit=200&offset=abc&client_id=X' })).toEqual({ limit: '200', offset: 'abc' });
    expect(nextQueryOf({ next_href: null })).toBeNull();
    expect(nextQueryOf({})).toBeNull();
    expect(nextQueryOf({ next_href: 'не ссылка' })).toBeNull();
  });

  it('tracksOf понимает массив, collection и обёртку лайков', () => {
    expect(tracksOf([{ id: 1, kind: 'track' }, { id: 2, kind: 'playlist' }, { id: 'x' }, null]).map((t) => t.id)).toEqual([1]);
    expect(tracksOf({ collection: [{ track: { id: 3, kind: 'track' } }, { id: 4 }] }).map((t) => t.id)).toEqual([3, 4]);
    expect(tracksOf(null)).toEqual([]);
  });

  it('idsOf оставляет только положительные целые', () => {
    expect(idsOf({ collection: [1, 0, -2, 1.5, '3', 4] })).toEqual([1, 4]);
  });

  it('meOf проверяет id', () => {
    expect(meOf({ id: 9, username: 'u', permalink: 'p', avatar_url: 'a' })).toEqual({ id: 9, username: 'u', permalink: 'p', avatarUrl: 'a' });
    expect(meOf({ username: 'u' })).toBeNull();
    expect(meOf(null)).toBeNull();
  });
});

describe('createSoundCloud', () => {
  it('tracksByIds бьёт на пачки по 50, хранит порядок и пропускает ненайденные', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const { api, calls } = fakeApi((_name, _path, query) => {
      const asked = String((query as { ids: string }).ids).split(',').map(Number);
      // Сайт отдаёт в произвольном порядке и теряет id кратные 10
      return asked.filter((id) => id % 10).reverse().map((id) => ({ id, kind: 'track' }));
    });
    const tracks = await createSoundCloud(api).tracksByIds([...ids, 5, 0]);
    expect(calls.map((call) => String((call.query as { ids: string }).ids).split(',').length)).toEqual([50, 50, 20]);
    expect(tracks.map((t) => t.id)).toEqual(ids.filter((id) => id % 10));
  });

  it('likedIds возвращает страницу и запрос продолжения', async () => {
    const { api, calls } = fakeApi(() => ({ collection: [3, 2, 1], next_href: 'https://api-v2.soundcloud.com/me/track_likes/ids?offset=zz' }));
    const page = await createSoundCloud(api).likedIds();
    expect(page).toEqual({ items: [3, 2, 1], next: { offset: 'zz' } });
    expect(calls[0]).toMatchObject({ name: 'soundLikesIds', query: { limit: 200 } });
  });

  it('search, related и resolve обращаются к своим точкам', async () => {
    const { api, calls } = fakeApi((name) => (name === 'resolve' ? { kind: 'user', id: 1 } : { collection: [{ id: 8, kind: 'track' }] }));
    const sc = createSoundCloud(api);
    expect((await sc.searchTracks('techno')).items.map((t) => t.id)).toEqual([8]);
    expect((await sc.relatedTracks(5)).map((t) => t.id)).toEqual([8]);
    expect(await sc.resolve('https://soundcloud.com/a')).toEqual({ kind: 'user', id: 1 });
    expect(calls.map((call) => call.name)).toEqual(['searchCategory', 'relatedSounds', 'resolve']);
    expect(calls[1].path).toEqual({ track_id: 5 });
  });
});
