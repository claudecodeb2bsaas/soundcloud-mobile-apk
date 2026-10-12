import { describe, expect, it } from 'vitest';
import type { SoundCloud } from '../api/soundcloud';
import { createLikes } from './likes';
import { createMarks, type TextStore } from './marks';

const memory = (initial: string | null = null): TextStore & { value: string | null } => {
  const store = { value: initial, get: () => store.value, set: (v: string) => { store.value = v; } };
  return store;
};

describe('отметки волны', () => {
  it('включают и снимают отметки, сохраняют и читают обратно', () => {
    const store = memory();
    const marks = createMarks(store);
    let changes = 0;
    marks.subscribe(() => changes++);
    expect(marks.toggleTrack({ id: 5, title: 'Song', user: { username: 'Ann' } })).toBe(true);
    expect(marks.toggleArtist(9, 'Bob')).toBe(true);
    expect(marks.hasTrack(5) && marks.hasArtist(9)).toBe(true);
    expect(changes).toBe(2);

    const again = createMarks(memory(store.value));
    expect(again.getSnapshot()).toEqual({ tracks: { 5: 'Ann — Song' }, artists: { 9: 'Bob' } });
    expect(marks.toggleTrack({ id: 5 })).toBe(false);
    expect(marks.hasTrack(5)).toBe(false);
  });

  it('remove снимает отметку по номеру и сообщает об этом, чужой номер игнорирует', () => {
    const changes: string[] = [];
    const marks = createMarks(memory(), (change) => changes.push(`${change.kind}:${change.id}:${change.on}`));
    marks.toggleArtist(9, 'Bob');
    marks.remove('track', 9);
    marks.remove('artist', 9);
    expect(marks.hasArtist(9)).toBe(false);
    expect(changes).toEqual(['artist:9:true', 'artist:9:false']);
  });

  it('снимок меняется при правке, а испорченное хранилище читается пустым', () => {
    const marks = createMarks(memory('{{'));
    const before = marks.getSnapshot();
    marks.toggleArtist(1, 'x');
    expect(marks.getSnapshot()).not.toBe(before);
    expect(createMarks(memory('{"tracks":{"0":"a","7":"b","8":5},"artists":null}')).getSnapshot()).toEqual({ tracks: { 7: 'b' }, artists: {} });
  });
});

describe('лайки', () => {
  const make = (overrides: Partial<Pick<SoundCloud, 'likedIds' | 'setLike'>> = {}, user: number | null = 7) => {
    const sent: string[] = [];
    const likes = createLikes({
      userId: () => user,
      sc: {
        likedIds: async (query) => (query && 'offset' in query ? { items: [3], next: null } : { items: [1, 2], next: { offset: 'x' } }),
        setLike: async (u, t, on) => { sent.push(`${u}:${t}:${on}`); },
        ...overrides,
      },
    });
    return { likes, sent };
  };

  it('load собирает страницы и грузится один раз', async () => {
    let calls = 0;
    const { likes } = make({ likedIds: async () => { calls++; return { items: [calls], next: calls < 3 ? { offset: 'x' } : null }; } });
    await Promise.all([likes.load(), likes.load()]);
    await likes.load();
    expect([...likes.getSnapshot()]).toEqual([1, 2, 3]);
    expect(calls).toBe(3);
  });

  it('toggle мгновенно меняет снимок и шлёт PUT/DELETE через setLike', async () => {
    const { likes, sent } = make();
    await likes.load();
    let seen = 0;
    likes.subscribe(() => seen++);
    expect(await likes.toggle(10)).toBe(true);
    expect(likes.getSnapshot().has(10)).toBe(true);
    expect(await likes.toggle(1)).toBe(false);
    expect(likes.getSnapshot().has(1)).toBe(false);
    expect(sent).toEqual(['7:10:true', '7:1:false']);
    expect(seen).toBe(2);
  });

  it('при отказе сайта сердечко возвращается и ошибка летит наружу', async () => {
    const { likes } = make({ setLike: async () => { throw new Error('403'); } });
    await expect(likes.toggle(4)).rejects.toThrow('403');
    expect(likes.getSnapshot().has(4)).toBe(false);
  });

  it('без входа лайк не ставится, reset очищает', async () => {
    const { likes, sent } = make({}, null);
    await expect(likes.toggle(1)).rejects.toThrow('вход');
    expect(sent).toEqual([]);
    const ok = make();
    await ok.likes.load();
    ok.likes.reset();
    expect(ok.likes.getSnapshot().size).toBe(0);
  });
});
