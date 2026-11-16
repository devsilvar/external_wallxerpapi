import crypto from 'node:crypto';

/**
 * Generates a 32-byte cryptographically secure random token, base64url encoded.
 * Raw token must be shown to the client once and never logged.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generates a platform API key with a readable prefix (default 'sk_ext_live_').
 */
export function generateApiKey(prefix = 'sk_ext_live_'): string {
  return `${prefix}${crypto.randomBytes(24).toString('base64url')}`;
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
