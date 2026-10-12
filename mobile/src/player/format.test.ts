import { describe, expect, it } from 'vitest';
import { artistIdOf, artwork, clock, count } from './format';

describe('format', () => {
  it('count сокращает большие числа', () => {
    expect(count(950)).toBe('950');
    expect(count(1000)).toBe('1 тыс.');
    expect(count(12450)).toBe('12,4 тыс.');
    expect(count(3200000)).toBe('3,2 млн');
    expect(count(-1)).toBe('0');
    expect(count(NaN)).toBe('0');
  });

  it('artistIdOf берёт user.id, потом user_id', () => {
    expect(artistIdOf({ user: { id: 5 }, user_id: 6 })).toBe(5);
    expect(artistIdOf({ user: null, user_id: 6 })).toBe(6);
    expect(artistIdOf({})).toBeNull();
    expect(artistIdOf({ user_id: 0 })).toBeNull();
  });

  it('clock и artwork', () => {
    expect(clock(83)).toBe('1:23');
    expect(artwork('https://x/a-large.jpg')).toBe('https://x/a-t200x200.jpg');
    expect(artwork(null)).toBeNull();
  });
});
