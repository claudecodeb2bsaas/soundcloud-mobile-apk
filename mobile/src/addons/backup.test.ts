import { describe, expect, it } from 'vitest';
import { cleanSettings } from '../settings/settings';
import { BACKUP_KV_KEYS, createBackup, parseBackup } from './backup';

const data: Record<string, string> = { 'wave.marks.v1': '{"tracks":{"5":"A — B"},"artists":{}}', 'wave.library.v1': '{"order":"smart"}', 'other.key': '1' };
const settings = cleanSettings({ language: 'en', incognito: true });

describe('резервная копия', () => {
  it('копия берёт настройки и известные ключи, читается обратно', () => {
    const text = createBackup({ settings, read: (key) => data[key] ?? null, now: () => 77 });
    expect(JSON.parse(text)).toMatchObject({ app: 'soundcloud-wave', format: 1, at: 77, kv: { 'wave.marks.v1': data['wave.marks.v1'] } });
    expect(Object.keys(JSON.parse(text).kv)).toEqual(['wave.marks.v1', 'wave.library.v1']);
    const parsed = parseBackup(text);
    expect(parsed).toEqual({ ok: true, content: { settings, kv: { 'wave.marks.v1': data['wave.marks.v1'], 'wave.library.v1': data['wave.library.v1'] } } });
  });

  it('чужой текст, новый формат, порча и огромный текст отклоняются с причиной', () => {
    expect(parseBackup('привет')).toEqual({ ok: false, reason: 'not-backup' });
    expect(parseBackup('{"app":"other"}')).toEqual({ ok: false, reason: 'not-backup' });
    expect(parseBackup('{"app":"soundcloud-wave","format":2}')).toEqual({ ok: false, reason: 'newer-format' });
    expect(parseBackup('{"app":"soundcloud-wave","format":1,"kv":{"wave.marks.v1":5}}')).toEqual({ ok: false, reason: 'damaged' });
    expect(parseBackup('{"app":"soundcloud-wave","format":1,"kv":{"wave.marks.v1":"{{"}}')).toEqual({ ok: false, reason: 'damaged' });
    expect(parseBackup(' '.repeat(2_000_001))).toEqual({ ok: false, reason: 'too-big' });
  });

  it('неизвестные ключи не проходят, негодные настройки заменяются умолчаниями', () => {
    const parsed = parseBackup(JSON.stringify({ app: 'soundcloud-wave', format: 1, settings: { webhookUrl: 'javascript:1', language: 'en' }, kv: { 'sc.session.v1': '"token"', [BACKUP_KV_KEYS[0]]: '{}' } }));
    expect(parsed).toMatchObject({ ok: true, content: { settings: { webhookUrl: '', language: 'en' }, kv: { 'wave.marks.v1': '{}' } } });
    expect(parsed.ok && Object.keys(parsed.content.kv)).toEqual(['wave.marks.v1']);
  });
});
