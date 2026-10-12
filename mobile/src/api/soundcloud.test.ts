import { describe, expect, it } from 'vitest';
import type { ApiClient } from './client';
import { chartsOf, createSoundCloud, idsOf, meOf, nextQueryOf, tracksOf, userOf, usersOf } from './soundcloud';

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

describe('артисты и история', () => {
  it('userOf требует id и вид user', () => {
    expect(userOf({ id: 5, kind: 'user', username: 'a', avatar_url: 'x', followers_count: 12, track_count: 3, city: 'Минск' })).toEqual({
      id: 5, username: 'a', avatarUrl: 'x', followers: 12, trackCount: 3, city: 'Минск',
    });
    expect(userOf({ id: 5 })?.followers).toBe(0);
    expect(userOf({ id: 5, kind: 'playlist' })).toBeNull();
    expect(userOf({ username: 'a' })).toBeNull();
    expect(usersOf({ collection: [{ id: 1, kind: 'user' }, { id: 2, kind: 'track' }, null] }).map((u) => u.id)).toEqual([1]);
  });

  it('методы артиста и истории обращаются к своим точкам', async () => {
    const { api, calls } = fakeApi((name) => {
      if (name === 'user') return { id: 7, kind: 'user', username: 'dj' };
      if (name === 'searchCategory') return { collection: [{ id: 7, kind: 'user' }] };
      if (name === 'playHistoryTracks') return { collection: [{ track: { id: 1 } }, { track: { id: 2 } }, { track: { id: 1 } }] };
      return { collection: [{ id: 9, kind: 'track' }] };
    });
    const sc = createSoundCloud(api);
    expect((await sc.user(7))?.username).toBe('dj');
    expect((await sc.searchUsers('dj')).map((u) => u.id)).toEqual([7]);
    expect((await sc.userTracks(7)).map((t) => t.id)).toEqual([9]);
    expect((await sc.userToptracks(7)).map((t) => t.id)).toEqual([9]);
    expect((await sc.history()).map((t) => t.id)).toEqual([1, 2]);
    expect(calls.map((call) => call.name)).toEqual(['user', 'searchCategory', 'userTracks', 'userToptracks', 'playHistoryTracks']);
    expect(calls[1].path).toEqual({ category: 'users' });
    expect(calls[2].path).toEqual({ id: 7 });
  });
});

describe('лайки и жанры', () => {
  it('setLike шлёт PUT для лайка и DELETE для снятия', async () => {
    const methods: Array<string | undefined> = [];
    const api = {
      call: async (name: string, path: object, _query: object, options?: { method?: string }) => {
        methods.push(`${name} ${JSON.stringify(path)} ${options?.method}`);
        return { status: 200, body: null };
      },
    } as unknown as ApiClient;
    const sc = createSoundCloud(api);
    await sc.setLike(7, 42, true);
    await sc.setLike(7, 42, false);
    expect(methods).toEqual(['trackLike {"user_id":7,"track_id":42} PUT', 'trackLike {"user_id":7,"track_id":42} DELETE']);
  });

  it('genrePage берёт свою точку и продолжает по next', async () => {
    const { api, calls } = fakeApi(() => ({ collection: [{ id: 1, kind: 'track' }], next_href: 'https://api-v2.soundcloud.com/x?offset=9&limit=50&client_id=K' }));
    const sc = createSoundCloud(api);
    const first = await sc.genrePage('recent', 'phonk');
    expect(first.next).toEqual({ offset: '9', limit: '50' });
    await sc.genrePage('search', 'phonk');
    await sc.genrePage('recent', 'phonk', first.next ?? undefined);
    expect(calls.map((c) => c.name)).toEqual(['recentTracks', 'searchCategory', 'recentTracks']);
    expect(calls[0].path).toEqual({ tag: 'phonk' });
    expect(calls[1].query).toMatchObject({ 'filter.genre_or_tag': 'phonk' });
    expect(calls[2].query).toEqual({ offset: '9', limit: '50' });
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

describe('чарты, плейлисты и лайки целиком', () => {
  it('chartsOf: подборки стран с плейлистами, без пустых', () => {
    const body = { collection: [
      { title: 'Music Charts US', items: { collection: [{ id: 1, kind: 'playlist', title: 'All music genres', track_count: 50, artwork_url: 'a-large.jpg', user: { username: 'Music Charts' } }, { kind: 'playlist' }] } },
      { title: 'Пусто', items: { collection: [] } },
    ] };
    expect(chartsOf(body)).toEqual([{ title: 'Music Charts US', lists: [{ id: 1, title: 'All music genres', count: 50, ids: [], tracks: [], artwork: 'a-large.jpg', owner: 'Music Charts' }] }]);
    expect(chartsOf(null)).toEqual([]);
  });

  it('charts идёт в chartSelections', async () => {
    const { api, calls } = fakeApi(() => ({ collection: [] }));
    expect(await createSoundCloud(api).charts()).toEqual([]);
    expect(calls[0].name).toBe('chartSelections');
  });

  it('playlistTracks добирает заготовки пачкой и хранит порядок сайта', async () => {
    const { api, calls } = fakeApi((name, _path, query) => {
      if (name === 'playlist') return { id: 9, title: 'Mix', track_count: 3, tracks: [{ id: 3, kind: 'track', title: 'C' }, { id: 1, kind: 'track' }, { id: 2, kind: 'track' }] };
      return (String((query as { ids: string }).ids).split(',').map((id) => ({ id: Number(id), kind: 'track', title: 'T' + id })));
    });
    const loaded = await createSoundCloud(api).playlistTracks(9);
    expect(loaded?.tracks.map((t) => t.id)).toEqual([3, 1, 2]);
    expect(calls.filter((call) => call.name === 'trackBatch').map((call) => (call.query as { ids: string }).ids)).toEqual(['1,2']);
  });

  it('likedTracks идёт по страницам id до лимита и берёт полные треки', async () => {
    const { api, calls } = fakeApi((name, _path, query) => {
      if (name === 'soundLikesIds') return (query as { offset?: string }).offset ? { collection: [4, 5], next_href: null } : { collection: [1, 2, 3], next_href: 'https://api-v2.soundcloud.com/x?offset=3' };
      return String((query as { ids: string }).ids).split(',').map((id) => ({ id: Number(id), kind: 'track' }));
    });
    expect((await createSoundCloud(api).likedTracks(4)).map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(calls.filter((call) => call.name === 'soundLikesIds')).toHaveLength(2);
  });
});
