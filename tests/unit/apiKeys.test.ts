import { describe, expect, it } from 'vitest';
import { createApiKey, maskKey, KEY_PREFIX, TEST_KEY_PREFIX } from '../../src/lib/apiKeys.js';
import { hashToken } from '../../src/lib/token.js';

describe('API Key Generation & Masking (src/lib/apiKeys.ts)', () => {
  it('creates a live API key with correct prefix and hash', () => {
    const { apiKey, prefix, keyHash } = createApiKey('live');

    expect(apiKey.startsWith(KEY_PREFIX)).toBe(true);
    expect(prefix).toBe(apiKey.slice(0, 16));
    expect(keyHash).toBe(hashToken(apiKey));
    expect(prefix).toHaveLength(16);
  });

  it('creates a test API key with test prefix', () => {
    const { apiKey, prefix, keyHash } = createApiKey('test');

    expect(apiKey.startsWith(TEST_KEY_PREFIX)).toBe(true);
    expect(prefix).toBe(apiKey.slice(0, 16));
    expect(keyHash).toBe(hashToken(apiKey));
  });

  it('masks key prefix properly', () => {
    expect(maskKey('sk_ext_live_1234')).toBe('sk_ext_live_1234…');
  });
});
