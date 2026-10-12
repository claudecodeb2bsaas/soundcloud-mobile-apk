import { describe, expect, it } from 'vitest';
import type { WaveTrack } from '../core/waveTypes';
import { cleanSettings, type Settings } from '../settings/settings';
import { createWebhook } from './webhook';

const track: WaveTrack = { id: 4, kind: 'track', title: 'Song', duration: 200000, user: { id: 1, username: 'Ann' }, permalink_url: 'https://soundcloud.com/ann/song', artwork_url: 'https://i/a.jpg' };

function setup(patch: Partial<Settings> = {}, ok = true) {
  const settings = cleanSettings({ webhookEnabled: true, webhookUrl: 'https://hook.example/x', webhookPercent: 50, ...patch });
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  let time = 1000;
  const hook = createWebhook({
    settings: { getSnapshot: () => settings },
    now: () => time,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return new Response('', { status: ok ? 200 : 500 });
    }) as unknown as typeof fetch,
  });
  return { hook, sent, wait: (ms: number) => { time += ms; } };
}

describe('вебхук', () => {
  it('шлёт POST с описанием трека, когда набрана доля', async () => {
    const { hook, sent } = setup();
    await hook.onPlay({ dur: 200000, heard: 99000 }, track);
    expect(sent).toHaveLength(0);
    await hook.onPlay({ dur: 200000, heard: 100000 }, track);
    expect(sent).toEqual([{ url: 'https://hook.example/x', body: { timestamp: new Date(1000).toISOString(), artist: 'Ann', track: 'Song', duration: 200, originUrl: 'https://soundcloud.com/ann/song', trackArt: 'https://i/a.jpg' } }]);
  });

  it('выключен, инкогнито, без адреса или без длины: молчит', async () => {
    for (const patch of [{ webhookEnabled: false }, { incognito: true }, { webhookUrl: '' }] as Array<Partial<Settings>>) {
      const { hook, sent } = setup(patch);
      await hook.onPlay({ dur: 200000, heard: 200000 }, track);
      expect(sent).toEqual([]);
    }
    const { hook, sent } = setup();
    await hook.onPlay({ dur: 0, heard: 5000 }, track);
    expect(sent).toEqual([]);
  });

  it('второй кусок того же трека не шлёт повторно, другой трек или позже шлёт; сбой не бросает', async () => {
    const { hook, sent, wait } = setup();
    const play = { dur: 200000, heard: 150000 };
    await hook.onPlay(play, track);
    wait(5000);
    await hook.onPlay(play, track);
    expect(sent).toHaveLength(1);
    await hook.onPlay(play, { ...track, id: 5 });
    expect(sent).toHaveLength(2);
    wait(400000);
    await hook.onPlay(play, track);
    expect(sent).toHaveLength(3);
    await expect(setup({}, false).hook.onPlay(play, track)).resolves.toBeUndefined();
  });
});
