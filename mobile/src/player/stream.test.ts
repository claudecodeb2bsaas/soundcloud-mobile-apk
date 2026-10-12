import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { createStreamResolver, hasMedia, isProtected, resolveStream, streamCandidates, StreamUnavailableError, type StreamTrack, type Transcoding } from './stream';

const BASE = 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1/uuid/stream/';
const t = (protocol: string, mime: string, extra: Partial<Transcoding> = {}): Transcoding => ({ url: BASE + protocol, format: { protocol, mime_type: mime }, ...extra });

const plain: Transcoding[] = [
  t('hls', 'audio/mp4; codecs="mp4a.40.2"'),
  t('hls', 'audio/mpegurl'),
  t('hls', 'audio/mpeg'),
  t('progressive', 'audio/mpeg'),
];
const track = (list: Transcoding[], extra: Partial<StreamTrack> = {}): StreamTrack => ({ id: 1, kind: 'track', track_authorization: 'AUTH', media: { transcodings: list }, ...extra });

describe('выбор потока', () => {
  it('порядок: progressive, hls mp3, hls AAC; mpegurl пропускается', () => {
    expect(streamCandidates(track(plain)).map((c) => c.kind)).toEqual(['progressive', 'hls-mp3', 'hls-aac']);
  });

  it('отрывки идут после целых потоков и помечены', () => {
    const list = [t('progressive', 'audio/mpeg', { snipped: true }), t('hls', 'audio/mpeg')];
    expect(streamCandidates(track(list)).map((c) => [c.kind, c.preview])).toEqual([['hls-mp3', false], ['progressive', true]]);
  });

  it('чужие адреса и мусор отбрасываются', () => {
    const list: Array<Transcoding | null> = [{ url: 'https://evil.example/x', format: { protocol: 'progressive', mime_type: 'audio/mpeg' } }, null, { format: { protocol: 'progressive', mime_type: 'audio/mpeg' } }];
    expect(streamCandidates({ id: 1, media: { transcodings: list } })).toEqual([]);
    expect(streamCandidates({ id: 1 })).toEqual([]);
  });

  it('isProtected и hasMedia', () => {
    expect(isProtected(track([...plain, t('ctr-encrypted-hls', 'audio/mp4; codecs="mp4a.40.2"')]))).toBe(true);
    expect(isProtected(track(plain))).toBe(false);
    expect(hasMedia(track(plain))).toBe(true);
    expect(hasMedia(track(plain, { track_authorization: '' }))).toBe(false);
    expect(hasMedia({ id: 1 })).toBe(false);
  });
});

function fakeApi(handler: (url: string) => { status?: number; url?: string } | Error) {
  const calls: string[] = [];
  const api = {
    callUrl: async (url: string) => {
      calls.push(url);
      const result = handler(url);
      if (result instanceof Error) throw result;
      if (result.status && result.status >= 400) throw new ApiError(result.status, {}, null);
      return { status: 200, body: { url: result.url } };
    },
  } as unknown as ApiClient;
  return { api, calls };
}

describe('resolveStream', () => {
  it('берёт первый рабочий поток и подписывает запрос track_authorization', async () => {
    const { api, calls } = fakeApi(() => ({ url: 'https://cf-media.sndcdn.com/a.mp3?Policy=x' }));
    expect(await resolveStream(api, track(plain, { track_authorization: 'A B' }))).toEqual({ url: 'https://cf-media.sndcdn.com/a.mp3?Policy=x', kind: 'progressive', preview: false });
    expect(calls).toEqual([BASE + 'progressive?track_authorization=A%20B']);
  });

  it('404 уводит к следующему кандидату', async () => {
    const { api, calls } = fakeApi((url) => (url.includes('/progressive') ? { status: 404 } : { url: 'https://cf-hls-media.sndcdn.com/x.m3u8' }));
    expect(await resolveStream(api, track(plain))).toMatchObject({ kind: 'hls-mp3' });
    expect(calls).toHaveLength(2);
  });

  it('трек лейбла с шифрованием и 404 на открытых потоках недоступен как protected', async () => {
    const list = [t('ctr-encrypted-hls', 'audio/mp4; codecs="mp4a.40.2"'), t('hls', 'audio/mpeg'), t('progressive', 'audio/mpeg')];
    const { api } = fakeApi(() => ({ status: 404 }));
    await expect(resolveStream(api, track(list))).rejects.toMatchObject({ name: 'StreamUnavailableError', reason: 'protected' });
  });

  it('без потоков no-stream, заблокированный blocked, без ключа no-stream', async () => {
    const { api, calls } = fakeApi(() => ({ url: 'https://x' }));
    await expect(resolveStream(api, track([]))).rejects.toMatchObject({ reason: 'no-stream' });
    await expect(resolveStream(api, track(plain, { policy: 'BLOCK' }))).rejects.toMatchObject({ reason: 'blocked' });
    await expect(resolveStream(api, track(plain, { track_authorization: undefined }))).rejects.toBeInstanceOf(StreamUnavailableError);
    expect(calls).toEqual([]);
  });

  it('429, 401 и сетевой сбой не вина трека и пробрасываются', async () => {
    for (const result of [{ status: 429 }, { status: 401 }]) {
      const { api, calls } = fakeApi(() => result);
      await expect(resolveStream(api, track(plain))).rejects.toMatchObject({ status: result.status });
      expect(calls).toHaveLength(1);
    }
    const { api } = fakeApi(() => new TypeError('Network request failed'));
    await expect(resolveStream(api, track(plain))).rejects.toThrow('Network request failed');
  });

  it('http-адрес в ответе не принимается', async () => {
    const { api } = fakeApi(() => ({ url: 'http://cf-media.sndcdn.com/a.mp3' }));
    await expect(resolveStream(api, track(plain))).rejects.toMatchObject({ reason: 'no-stream' });
  });
});

describe('createStreamResolver', () => {
  it('трек без данных потока догружается по id', async () => {
    const { api } = fakeApi(() => ({ url: 'https://cf-media.sndcdn.com/a.mp3' }));
    const asked: number[][] = [];
    const resolver = createStreamResolver(api, { tracksByIds: async (ids) => { asked.push(ids); return [track(plain, { id: ids[0] })]; } });
    expect(await resolver.resolve({ id: 7, title: 'из сессии' })).toMatchObject({ kind: 'progressive' });
    expect(asked).toEqual([[7]]);
    // Полный трек второй раз не запрашивается
    await resolver.resolve(track(plain));
    expect(asked).toHaveLength(1);
  });

  it('удалённый трек: no-stream', async () => {
    const { api } = fakeApi(() => ({ url: 'https://x' }));
    const resolver = createStreamResolver(api, { tracksByIds: async () => [] });
    await expect(resolver.resolve({ id: 9 })).rejects.toMatchObject({ reason: 'no-stream' });
  });
});
