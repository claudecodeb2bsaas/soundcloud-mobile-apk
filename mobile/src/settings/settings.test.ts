import { describe, expect, it } from 'vitest';
import { cleanSettings, createSettings, DEFAULT_SETTINGS, isWebhookUrl } from './settings';

const memory = (initial: string | null = null) => {
  const store = { value: initial, get: () => store.value, set: (v: string) => { store.value = v; } };
  return store;
};

describe('настройки', () => {
  it('негодные поля заменяются значениями по умолчанию, годные остаются', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ language: 'de', incognito: 'yes', webhookUrl: 'ftp://x', webhookPercent: 'a', radarDay: 9, radarTime: '25:00' })).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ language: 'en', incognito: true, webhookUrl: 'https://hook.example/a?b=1', webhookPercent: 140.4, radarDay: 0, radarTime: '07:30', radarEnabled: false })).toEqual({
      ...DEFAULT_SETTINGS, language: 'en', incognito: true, webhookUrl: 'https://hook.example/a?b=1', webhookPercent: 100, radarDay: 0, radarTime: '07:30', radarEnabled: false,
    });
  });

  it('адрес вебхука: только http(s) без пробелов', () => {
    expect(isWebhookUrl('http://192.168.1.5:8080/x')).toBe(true);
    expect(['', 'javascript:alert(1)', 'https://', 'https://a b', 'a'.repeat(501)].some(isWebhookUrl)).toBe(false);
  });

  it('set сохраняет, подписчики видят новый снимок, испорченное хранилище читается по умолчанию', () => {
    const store = memory();
    const settings = createSettings(store);
    const before = settings.getSnapshot();
    let seen = 0;
    settings.subscribe(() => seen++);
    settings.set({ incognito: true, webhookPercent: 80 });
    expect(settings.getSnapshot()).not.toBe(before);
    expect(seen).toBe(1);
    expect(createSettings(memory(store.value)).getSnapshot()).toMatchObject({ incognito: true, webhookPercent: 80 });
    expect(createSettings(memory('{{')).getSnapshot()).toEqual(DEFAULT_SETTINGS);
    settings.replace({ language: 'en' });
    expect(settings.getSnapshot()).toEqual({ ...DEFAULT_SETTINGS, language: 'en' });
  });
});
