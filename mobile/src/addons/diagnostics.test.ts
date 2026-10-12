import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnostics, messageOf, scrub } from './diagnostics';

const memory = (initial: string | null = null) => {
  const store = { value: initial, get: () => store.value, set: (v: string) => { store.value = v; } };
  return store;
};

afterEach(() => vi.useRealTimers());

describe('журнал диагностики', () => {
  it('из сообщений вырезаются адреса и похожее на ключи, текст обрезается', () => {
    expect(scrub('GET https://api-v2.soundcloud.com/me?client_id=AbCdEfGh12345678AbCdEfGh12345678 failed')).toBe('GET <url> failed');
    expect(scrub('Authorization: OAuth 2-293950-123456-AbCdEf')).toBe('Authorization: <auth>');
    expect(scrub('token=2-293950-123456-AbCdEfGhIjKlMnOp')).toContain('<key>');
    expect(scrub('слово '.repeat(100))).toHaveLength(240);
    expect(messageOf(['Радар', new TypeError('плохо'), { a: 1 }])).toBe('Радар TypeError: плохо {"a":1}');
  });

  it('записи копятся кольцом на 200, пишутся с задержкой и читаются заново', () => {
    vi.useFakeTimers();
    const store = memory();
    const diag = createDiagnostics(store, () => 1000);
    for (let i = 0; i < 205; i++) diag.record('warn', 'n' + i);
    expect(diag.entries()).toHaveLength(200);
    expect(diag.entries()[0].message).toBe('n5');
    expect(store.value).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(createDiagnostics(store).entries()).toHaveLength(200);
    expect(createDiagnostics(memory('{{')).entries()).toEqual([]);
    expect(createDiagnostics(memory('[{"at":1,"event":"a","message":"m"},{"at":"x"},null]')).entries()).toEqual([{ at: 1, event: 'a', message: 'm' }]);
    diag.clear();
    expect(diag.entries()).toEqual([]);
  });

  it('captureConsole пишет warn и error, пропускает вызов дальше и снимается', () => {
    const seen: unknown[][] = [];
    const target = { warn: (...args: unknown[]) => void seen.push(args), error: (...args: unknown[]) => void seen.push(args) };
    const diag = createDiagnostics(memory());
    const release = diag.captureConsole(target);
    target.warn('Радар не собран', new Error('boom'));
    target.error('плохо');
    expect(seen).toHaveLength(2);
    expect(diag.entries().map((entry) => `${entry.event}:${entry.message}`)).toEqual(['warn:Радар не собран Error: boom', 'error:плохо']);
    release();
    target.warn('ещё');
    expect(diag.entries()).toHaveLength(2);
  });

  it('exportText даёт шапку и строки', () => {
    const diag = createDiagnostics(memory(), () => Date.UTC(2026, 9, 12));
    diag.record('start', 'ok');
    expect(diag.exportText({ version: '0.1.0' })).toBe('version: 0.1.0\n\n2026-10-12T00:00:00.000Z start ok');
  });
});
