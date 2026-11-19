import { generateApiKey, hashToken } from './token.js';

export const KEY_PREFIX = 'sk_ext_live_';
export const TEST_KEY_PREFIX = 'sk_ext_test_';

export interface CreatedApiKeyResult {
  apiKey: string;
  prefix: string;
  keyHash: string;
}

/**
 * Creates a cryptographically secure API key for a given environment.
 * Returns the raw key (shown once), prefix (16 chars), and SHA-256 hash.
 */
export function createApiKey(environment: 'test' | 'live' = 'live'): CreatedApiKeyResult {
  const prefix = environment === 'test' ? TEST_KEY_PREFIX : KEY_PREFIX;
  const apiKey = generateApiKey(prefix);
  const keyPrefix = apiKey.slice(0, 16);
  const keyHash = hashToken(apiKey);

  return {
    apiKey,
    prefix: keyPrefix,
    keyHash,
  };
}

/**
 * Formats a prefix for masked display in logs and UI.
 * e.g. "sk_ext_live_1234…"
 */
export function maskKey(prefix: string): string {
  return `${prefix}…`;
}
