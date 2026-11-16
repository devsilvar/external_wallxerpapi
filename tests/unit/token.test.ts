import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, verifyToken } from '../../src/lib/token.js';

describe('Token primitives (src/lib/token.ts)', () => {
  it('generates a 32-byte base64url token', () => {
    const token = generateToken();
    expect(typeof token).toBe('string');
    // 32 bytes in base64url is 43 characters
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes token to a 64-character SHA-256 hex string', () => {
    const token = 'test-token-value-12345';
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies valid token and rejects tampered token using constant-time comparison', () => {
    const raw = generateToken();
    const storedHash = hashToken(raw);

    expect(verifyToken(raw, storedHash)).toBe(true);
    expect(verifyToken(raw + 'tampered', storedHash)).toBe(false);
    expect(verifyToken('wrong-token', storedHash)).toBe(false);
    expect(verifyToken(raw, 'short-hash')).toBe(false);
  });
});
