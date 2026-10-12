import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { currentItem, emptyQueue, insertLast, insertNext, jump, makeItem, moveItem, nextIndex, nextRepeat, previousIndex, removeAt, replaceQueue, upcoming } from './queue';

const q = (ids: number[], index = 0, repeat: 'off' | 'all' | 'one' = 'off') =>
  replaceQueue(emptyQueue(repeat), ids.map((id) => makeItem({ id } as WaveTrack)), index);
const ids = (state: ReturnType<typeof q>) => state.items.map((item) => item.track.id);

describe('очередь', () => {
  it('ключи уникальны, даже у одного трека', () => {
    const a = makeItem({ id: 1 } as WaveTrack);
    const b = makeItem({ id: 1 } as WaveTrack);
    expect(a.key).not.toBe(b.key);
  });

  it('replaceQueue зажимает номер', () => {
    expect(q([1, 2, 3], 9).index).toBe(2);
    expect(q([1, 2, 3], -4).index).toBe(0);
    expect(q([]).index).toBe(0);
    expect(currentItem(q([]))).toBeNull();
  });

  it('nextIndex: конец без повтора, повтор всех и одного', () => {
    expect(nextIndex(q([1, 2], 0), true)).toBe(1);
    expect(nextIndex(q([1, 2], 1), true)).toBeNull();
    expect(nextIndex(q([1, 2], 1, 'all'), true)).toBe(0);
    expect(nextIndex(q([1, 2], 0, 'one'), true)).toBe(0);
    // Кнопка «дальше» повтор одного не держит
    expect(nextIndex(q([1, 2], 0, 'one'), false)).toBe(1);
    expect(nextIndex(q([]), true)).toBeNull();
  });

  it('previousIndex', () => {
    expect(previousIndex(q([1, 2, 3], 2))).toBe(1);
    expect(previousIndex(q([1, 2, 3], 0))).toBe(0);
    expect(previousIndex(q([1, 2, 3], 0, 'all'))).toBe(2);
    expect(previousIndex(q([1], 0, 'all'))).toBe(0);
  });

  it('insertNext и insertLast', () => {
    const base = q([1, 2, 3], 1);
    expect(ids(insertNext(base, makeItem({ id: 9 } as WaveTrack)))).toEqual([1, 2, 9, 3]);
    expect(ids(insertLast(base, makeItem({ id: 9 } as WaveTrack)))).toEqual([1, 2, 3, 9]);
    expect(insertNext(base, makeItem({ id: 9 } as WaveTrack)).index).toBe(1);
    const empty = insertNext(emptyQueue(), makeItem({ id: 5 } as WaveTrack));
    expect(ids(empty)).toEqual([5]);
    expect(ids(insertLast(emptyQueue(), makeItem({ id: 6 } as WaveTrack)))).toEqual([6]);
  });

  it('removeAt: до, после и сам играющий', () => {
    const base = q([1, 2, 3, 4], 2);
    expect(removeAt(base, 0)).toMatchObject({ removedCurrent: false, state: { index: 1 } });
    expect(ids(removeAt(base, 0).state)).toEqual([2, 3, 4]);
    expect(removeAt(base, 3)).toMatchObject({ removedCurrent: false, state: { index: 2 } });
    const current = removeAt(base, 2);
    expect(current.removedCurrent).toBe(true);
    expect(ids(current.state)).toEqual([1, 2, 4]);
    expect(current.state.index).toBe(2);
    // Последний трек: номер уходит на новый последний
    expect(removeAt(q([1, 2], 1), 1).state.index).toBe(0);
    expect(removeAt(q([1], 0), 0)).toMatchObject({ removedCurrent: true, state: { items: [], index: 0 } });
    expect(removeAt(base, 9).state).toBe(base);
  });

  it('moveItem: играющий остаётся тем же', () => {
    const base = q([1, 2, 3, 4], 1);
    const moved = moveItem(base, 3, 1);
    expect(ids(moved)).toEqual([1, 4, 2, 3]);
    expect(currentItem(moved)?.track.id).toBe(2);
    const over = moveItem(base, 0, 3);
    expect(ids(over)).toEqual([2, 3, 4, 1]);
    expect(currentItem(over)?.track.id).toBe(2);
    expect(moveItem(base, 1, 1)).toBe(base);
    expect(moveItem(base, 0, 9)).toBe(base);
  });

  it('jump, upcoming, nextRepeat', () => {
    expect(jump(q([1, 2, 3]), 2).index).toBe(2);
    expect(jump(q([1, 2, 3]), 7).index).toBe(2);
    expect(upcoming(q([1, 2, 3], 0)).map((item) => item.track.id)).toEqual([2, 3]);
    expect(nextRepeat('off')).toBe('all');
    expect(nextRepeat('all')).toBe('one');
    expect(nextRepeat('one')).toBe('off');
  });
});
