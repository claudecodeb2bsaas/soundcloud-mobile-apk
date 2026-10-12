import { describe, expect, it } from 'vitest';
import { theme } from '../theme';

describe('каркас', () => {
  it('тема задана', () => {
    expect(theme.accent).toBe('#ff5500');
  });
});
