import { describe, expect, it } from 'vitest';
import {
  generateActivationCode,
  generateToken,
  hashToken,
  verifyToken,
} from '../../src/lib/token.js';

describe('Token and code primitives (src/lib/token.ts)', () => {
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

  it('generates 10-character Crockford Base32 activation codes excluding I, L, O, U', () => {
    const forbiddenChars = ['I', 'L', 'O', 'U', 'i', 'l', 'o', 'u'];
    for (let i = 0; i < 100; i++) {
      const code = generateActivationCode();
      expect(code).toHaveLength(10);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      for (const forbidden of forbiddenChars) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it('generates distinct codes across calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateActivationCode()));
    expect(codes.size).toBe(100);
  });
});
