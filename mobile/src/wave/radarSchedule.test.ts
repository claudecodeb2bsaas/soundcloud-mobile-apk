import { describe, expect, it } from 'vitest';
import type { RadarView } from './radar';
import { armRadar, radarPeriod, runRadarJob, type RadarJobDeps } from './radarSchedule';

// Время местное, как у телефона: тесты не зависят от пояса машины. 16.10.2026 пятница
const at = (day: number, hour = 12, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();

describe('период радара', () => {
  it('до срока в тот же день это прошлая неделя, после срока этот день', () => {
    expect(radarPeriod(at(16, 8, 59), 5, '09:00')).toEqual({ key: '2026-10-09', at: at(9, 9) });
    expect(radarPeriod(at(16, 9, 0), 5, '09:00')).toEqual({ key: '2026-10-16', at: at(16, 9) });
    expect(radarPeriod(at(18, 23, 59), 5, '09:00').key).toBe('2026-10-16');
    expect(radarPeriod(at(22, 8, 0), 5, '09:00').key).toBe('2026-10-16');
    expect(radarPeriod(at(22, 9, 30), 5, '09:00').key).toBe('2026-10-16');
  });

  it('переход через месяц и негодное время (по умолчанию 09:00)', () => {
    expect(radarPeriod(new Date(2026, 10, 2, 12).getTime(), 5, '09:00').key).toBe('2026-10-30');
    expect(radarPeriod(at(16, 10), 5, 'xx').key).toBe('2026-10-16');
    expect(radarPeriod(at(16, 10), 0, '00:00').key).toBe('2026-10-11');
  });
});

const view = (heard: boolean[]): RadarView => ({ checked: 9, total: 10, edition: { items: heard.map((h, i) => ({ id: i, heard: h })), uploads: [] } }) as unknown as RadarView;

function setup(overrides: Partial<RadarJobDeps> = {}, saved: string | null = '2026-10-09', now = at(17)) {
  const state = { saved, built: 0, notified: [] as number[], logs: [] as string[] };
  const deps: RadarJobDeps = {
    settings: () => ({ radarEnabled: true, radarDay: 5, radarTime: '09:00' }),
    now: () => now,
    done: { get: () => state.saved, set: (value) => { state.saved = value; } },
    signedIn: async () => true,
    build: async () => { state.built++; return view([false, false, true]); },
    notify: async (count) => { state.notified.push(count); },
    log: (event, message) => state.logs.push(`${event}:${message}`),
    ...overrides,
  };
  return { deps, state };
}

describe('плановая проверка радара', () => {
  it('в срок собирает выпуск, уведомляет о неслышанном и закрывает период', async () => {
    const { deps, state } = setup();
    expect(await runRadarJob(deps)).toBe('sent');
    expect(state.notified).toEqual([2]);
    expect(state.saved).toBe('2026-10-16');
    expect(await runRadarJob(deps)).toBe('not-due');
    expect(state.built).toBe(1);
  });

  it('выключен, первый запуск (отсчёт), нет входа: сеть не трогается или ждёт', async () => {
    const off = setup({ settings: () => ({ radarEnabled: false, radarDay: 5, radarTime: '09:00' }) });
    expect(await runRadarJob(off.deps)).toBe('off');
    const first = setup({}, null);
    expect(await runRadarJob(first.deps)).toBe('baseline');
    expect(first.state.saved).toBe('2026-10-16');
    expect(first.state.built).toBe(0);
    const anon = setup({ signedIn: async () => false });
    expect(await runRadarJob(anon.deps)).toBe('no-session');
    expect(anon.state.saved).toBe('2026-10-09');
  });

  it('сбой сборки не закрывает период, пустой выпуск закрывает без уведомления, сбой уведомления не роняет', async () => {
    const bad = setup({ build: async () => { throw new Error('429'); } });
    expect(await runRadarJob(bad.deps)).toBe('failed');
    expect(bad.state.saved).toBe('2026-10-09');
    expect(bad.state.logs[0]).toContain('429');
    const empty = setup({ build: async () => view([true]) });
    expect(await runRadarJob(empty.deps)).toBe('empty');
    expect(empty.state).toMatchObject({ saved: '2026-10-16', notified: [] });
    const mute = setup({ notify: async () => { throw new Error('нет разрешения'); } });
    expect(await runRadarJob(mute.deps)).toBe('sent');
    expect(mute.state.logs.some((line) => line.includes('нет разрешения'))).toBe(true);
  });

  it('arm закрывает текущий период без сборки: включение или смена срока не шлёт задним числом', async () => {
    const { deps, state } = setup({}, '2026-09-01');
    armRadar(deps);
    expect(state.saved).toBe('2026-10-16');
    expect(await runRadarJob(deps)).toBe('not-due');
  });
});
