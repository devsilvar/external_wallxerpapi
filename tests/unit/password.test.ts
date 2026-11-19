import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('Password Hashing & Verification (src/lib/password.ts)', () => {
  it('1. hashPassword returns a string starting with scrypt$32768$8$1$', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  });

  it('2. verifyPassword returns true for the right password, false for the wrong one', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);

    const isWrong = await verifyPassword('WrongPassword123!', hash);
    expect(isWrong).toBe(false);
  });

  it('3. Two hashes of the same password differ because salt is random', async () => {
    const password = 'IdenticalPasswordToHash';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('4. verifyPassword returns false for malformed stored value and does not throw', async () => {
    const testCases = [
      '',
      'not-a-hash',
      'scrypt$invalid',
      'bcrypt$2a$10$something',
      'scrypt$32768$8$1$short',
      'scrypt$NaN$8$1$123456$abcdef',
      null as unknown as string,
      undefined as unknown as string,
      'scrypt$32768$8$1$badhex$badhex',
    ];

    for (const malformed of testCases) {
      const result = await verifyPassword('any-password', malformed);
      expect(result).toBe(false);
    }
  });
});
