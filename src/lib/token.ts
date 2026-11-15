import crypto from 'node:crypto';

// Crockford's Base32 alphabet: 32 characters, excludes I, L, O, U to prevent transcription ambiguity.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a 32-byte cryptographically secure random token, base64url encoded.
 * Raw token must be shown to the client once and never logged.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the SHA-256 hex digest of a raw token or activation code.
 * Used for constant-time comparisons and indexed database lookups.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verifies a raw token against a stored SHA-256 hex hash using constant-time comparison.
 */
export function verifyToken(raw: string, storedHash: string): boolean {
  const computedHash = hashToken(raw);
  const computedBuffer = Buffer.from(computedHash, 'utf-8');
  const storedBuffer = Buffer.from(storedHash, 'utf-8');

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, storedBuffer);
}

/**
 * Generates a 10-character Crockford Base32 activation code (50 bits of entropy).
 * Excludes ambiguous characters (I, L, O, U).
 */
export function generateActivationCode(): string {
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) {
    const byte = bytes[i];
    if (byte === undefined) {
      code += CROCKFORD_ALPHABET[0];
    } else {
      code += CROCKFORD_ALPHABET[byte % 32];
    }
  }
  return code;
}
