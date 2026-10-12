import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { notePresetSkip, parsePresetMarks, presetPenalty } from './presetMarks';

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({ id, kind: 'track', title: 'T' + id, duration: 200000, user_id: 500 + id, user: { id: 500 + id, username: 'u' + id }, genre: 'Ambient', ...extra });

describe('отметки пресетов', () => {
  it('пропуск копится по аккаунту и тегам, штраф растёт до двух пропусков', () => {
    let map = notePresetSkip({}, 'calm', track(1));
    expect(map.calm?.a['501']).toBe(1);
    expect(map.calm?.t.ambient).toBeGreaterThan(0);
    const once = presetPenalty(map.calm, track(1));
    expect(once).toBeGreaterThan(0.5);
    map = notePresetSkip(map, 'calm', track(1));
    const twice = presetPenalty(map.calm, track(1));
    expect(twice).toBeGreaterThan(once);
    // Потолок: после двух пропусков штраф больше не растёт
    map = notePresetSkip(map, 'calm', track(1));
    expect(presetPenalty(map.calm, track(1))).toBeCloseTo(twice, 10);
  });

  it('другой пресет и без отметок штрафа нет', () => {
    const map = notePresetSkip({}, 'calm', track(1));
    expect(presetPenalty(map.energetic, track(1))).toBe(0);
    expect(presetPenalty(undefined, track(1))).toBe(0);
    expect(presetPenalty(map.calm, track(2, { genre: 'Metal', user_id: 9, user: { id: 9, username: 'x' } }))).toBe(0);
  });

  it('значение не больше 10, ключей не больше 300', () => {
    let map = {};
    for (let i = 0; i < 20; i++) map = notePresetSkip(map, 'calm', track(1));
    expect((map as { calm: { a: Record<string, number> } }).calm.a['501']).toBe(10);
    for (let i = 0; i < 350; i++) map = notePresetSkip(map, 'calm', track(1000 + i));
    expect(Object.keys((map as { calm: { a: Record<string, number> } }).calm.a).length).toBeLessThanOrEqual(300);
  });

  it('читается из хранилища с проверкой формы', () => {
    const map = parsePresetMarks(JSON.stringify({ calm: { a: { '5': 2, '6': -1, '7': 'x' }, t: { ambient: 99 } }, loud: { a: { '1': 1 } } }));
    expect(map).toEqual({ calm: { a: { '5': 2 }, t: { ambient: 10 } } });
    expect(parsePresetMarks('{{')).toEqual({});
    expect(parsePresetMarks(null)).toEqual({});
  });
});
