import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N?: number; r?: number; p?: number; maxmem?: number }
) => Promise<Buffer>;

const N = 32768;
const r = 8;
const p = 1;
const KEYLEN = 64;
// N=2^15, r=8 needs exactly 128*N*r = 32 MiB, which is Node's DEFAULT maxmem ceiling and
// throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Verified on Node v24.22.3 — do not drop this.
const MAXMEM = 64 * 1024 * 1024;

/**
 * Hashes a plaintext password using node:crypto scrypt.
 * Output format: scrypt$32768$8$1$<hex-salt>$<hex-hash>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash string using timing-safe comparison.
 * Never throws on malformed input; returns false.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (!stored || typeof stored !== 'string') {
      return false;
    }
    const parts = stored.split('$');
    if (parts.length !== 6) {
      return false;
    }
    const [scheme, nStr, rStr, pStr, salt, hash] = parts;
    if (scheme !== 'scrypt' || !nStr || !rStr || !pStr || !salt || !hash) {
      return false;
    }
    const costN = parseInt(nStr, 10);
    const blockSizeR = parseInt(rStr, 10);
    const parallelP = parseInt(pStr, 10);
    if (isNaN(costN) || isNaN(blockSizeR) || isNaN(parallelP)) {
      return false;
    }

    const key = await scrypt(password, salt, KEYLEN, {
      N: costN,
      r: blockSizeR,
      p: parallelP,
      maxmem: MAXMEM,
    });
    const expected = Buffer.from(hash, 'hex');
    if (key.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
