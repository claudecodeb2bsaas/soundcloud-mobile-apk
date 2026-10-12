import { describe, expect, it } from 'vitest';
import { endpointPath } from './endpoints';

describe('конечные точки api-v2', () => {
  it('строят пути', () => {
    expect(endpointPath('me')).toBe('/me');
    expect(endpointPath('soundLikesIds')).toBe('/me/track_likes/ids');
    expect(endpointPath('relatedSounds', { track_id: 42 })).toBe('/tracks/42/related');
    expect(endpointPath('searchCategory', { category: 'tracks' })).toBe('/search/tracks');
    expect(endpointPath('user', { id: 7 })).toBe('/users/7');
    expect(endpointPath('userToptracks', { id: 7 })).toBe('/users/7/toptracks');
    expect(endpointPath('recentTracks', { tag: 'drum & bass' })).toBe('/recent-tracks/drum%20%26%20bass');
  });

  it('без параметра пути бросают ошибку', () => {
    expect(() => endpointPath('relatedSounds')).toThrow(/track_id/);
    expect(() => endpointPath('userTracks', { id: '' })).toThrow(/id/);
  });
});
