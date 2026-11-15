import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';

/**
 * Recursively canonicalizes a payload:
 * - Sorts object keys alphabetically
 * - Normalizes money values to 2-decimal-place strings
 * - Normalizes Dates to ISO strings
 * - Trims strings
 */
export function canonicalizePayload(val: unknown): unknown {
  if (val === null || val === undefined) {
    return null;
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (Array.isArray(val)) {
    return val.map((item) => canonicalizePayload(item));
  }

  if (typeof val === 'object') {
    // If it's a Decimal-like object or has toFixed
    if ('toFixed' in val && typeof (val as { toFixed: unknown }).toFixed === 'function') {
      try {
        return formatMoney(val as Parameters<typeof formatMoney>[0]);
      } catch {
        // Fallback
      }
    }

    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();

    for (const key of keys) {
      // Exclude internal metadata or hash properties
      if (key === '_payloadHash' || key === 'idempotencyPayloadHash') {
        continue;
      }
      const itemVal = (val as Record<string, unknown>)[key];
      // Normalize money fields by name convention
      if (
        (key === 'amount' ||
          key === 'unitPrice' ||
          key === 'lineTotal' ||
          key === 'subtotal' ||
          key === 'total' ||
          key === 'discount' ||
          key === 'vatAmount' ||
          key === 'quantity') &&
        (typeof itemVal === 'string' || typeof itemVal === 'number' || (itemVal && typeof itemVal === 'object'))
      ) {
        try {
          sortedObj[key] = formatMoney(itemVal as Parameters<typeof formatMoney>[0]);
          continue;
        } catch {
          // If not parseable as money, fallback to canonicalize
        }
      }

      sortedObj[key] = canonicalizePayload(itemVal);
    }
    return sortedObj;
  }

  if (typeof val === 'string') {
    return val.trim();
  }

  return val;
}

/**
 * Produces a SHA-256 hex digest of the canonicalized payload.
 */
export function hashCanonicalPayload(payload: unknown): string {
  const canonical = canonicalizePayload(payload);
  const jsonStr = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
}

export interface IdempotencyCheckResult<T> {
  isReplay: boolean;
  record?: T;
}

/**
 * Validates idempotency against an existing record:
 * - If record does not exist: proceeds as a new creation
 * - If record exists with the EXACT same payload hash: returns the original record (200 OK replay)
 * - If record exists with a DIFFERENT payload hash: throws 409 DUPLICATE_REFERENCE
 */
export function checkIdempotency<T>(
  existingRecord: T | null | undefined,
  incomingHash: string,
  storedHash?: string | null
): IdempotencyCheckResult<T> {
  if (!existingRecord) {
    return { isReplay: false };
  }

  if (storedHash && storedHash === incomingHash) {
    return {
      isReplay: true,
      record: existingRecord,
    };
  }

  // Same reference with different payload -> 409 DUPLICATE_REFERENCE
  throw new AppError(
    409,
    'DUPLICATE_REFERENCE',
    'A record with this reference already exists with a different payload'
  );
}
