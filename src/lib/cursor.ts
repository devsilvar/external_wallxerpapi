import { AppError } from './errors.js';

export interface CursorPayload {
  updatedAt: Date;
  id: string;
}

/**
 * Encodes a keyset cursor ({ updatedAt, id }) to an opaque base64url string.
 */
export function encodeCursor(payload: CursorPayload): string {
  const jsonStr = JSON.stringify({
    u: payload.updatedAt.toISOString(),
    i: payload.id,
  });
  return Buffer.from(jsonStr, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque base64url cursor string back into { updatedAt, id }.
 * Throws 400 VALIDATION_FAILED if cursor is malformed or invalid.
 */
export function decodeCursor(rawCursor: string): CursorPayload {
  if (!rawCursor || typeof rawCursor !== 'string') {
    throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor format');
  }

  try {
    const jsonStr = Buffer.from(rawCursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr) as { u?: unknown; i?: unknown };

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Cursor must be an object');
    }

    if (typeof parsed.u !== 'string' || typeof parsed.i !== 'string' || !parsed.i.trim()) {
      throw new Error('Cursor missing required fields');
    }

    const updatedAt = new Date(parsed.u);
    if (isNaN(updatedAt.getTime())) {
      throw new Error('Invalid date in cursor');
    }

    return {
      updatedAt,
      id: parsed.i,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(400, 'VALIDATION_FAILED', 'Invalid pagination cursor');
  }
}

export interface KeysetQueryFilter {
  OR?: Array<
    | { updatedAt: { gt: Date } }
    | { updatedAt: Date; id: { gt: string } }
    | { updatedAt: { lt: Date } }
    | { updatedAt: Date; id: { lt: string } }
  >;
}

/**
 * Builds the Prisma keyset filter clause based on sync vs browse order.
 * - When isSync (updatedSince supplied): Orders ascending (updatedAt ASC, id ASC).
 *   Row must be > cursor: (updatedAt > c.updatedAt) OR (updatedAt == c.updatedAt AND id > c.id).
 * - When browse (!updatedSince): Orders descending (updatedAt DESC, id DESC).
 *   Row must be < cursor: (updatedAt < c.updatedAt) OR (updatedAt == c.updatedAt AND id < c.id).
 */
export function buildKeysetClause(
  cursor: CursorPayload | null | undefined,
  isSync: boolean
): KeysetQueryFilter | null {
  if (!cursor) {
    return null;
  }

  if (isSync) {
    return {
      OR: [
        { updatedAt: { gt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
      ],
    };
  }

  return {
    OR: [
      { updatedAt: { lt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Normalizes query pagination parameters.
 * Limit defaults to 50, max 200.
 */
export function parsePaginationParams(query: {
  cursor?: unknown;
  limit?: unknown;
  updatedSince?: unknown;
}): {
  limit: number;
  cursor: CursorPayload | null;
  updatedSince: Date | null;
  isSync: boolean;
} {
  let limit = 50;
  if (query.limit !== undefined) {
    const parsedLimit = Number(query.limit);
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      throw new AppError(400, 'VALIDATION_FAILED', 'limit must be a positive integer');
    }
    limit = Math.min(Math.floor(parsedLimit), 200);
  }

  let cursor: CursorPayload | null = null;
  if (query.cursor) {
    if (typeof query.cursor !== 'string') {
      throw new AppError(400, 'VALIDATION_FAILED', 'cursor must be a string');
    }
    cursor = decodeCursor(query.cursor);
  }

  let updatedSince: Date | null = null;
  if (query.updatedSince) {
    const d = new Date(String(query.updatedSince));
    if (isNaN(d.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'updatedSince must be a valid ISO-8601 date');
    }
    updatedSince = d;
  }

  return {
    limit,
    cursor,
    updatedSince,
    isSync: updatedSince !== null,
  };
}

/**
 * Paginates a list of items where items.length may be limit + 1 (to probe for next page).
 * Emits the items capped to limit, and computes nextCursor if hasMore is true.
 */
export function formatPagedResponse<T extends { updatedAt: Date; id: string }>(
  items: T[],
  limit: number
): {
  data: T[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
} {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const lastItem = data[data.length - 1];

  const nextCursor =
    hasMore && lastItem ? encodeCursor({ updatedAt: lastItem.updatedAt, id: lastItem.id }) : null;

  return {
    data,
    page: {
      nextCursor,
      hasMore,
    },
  };
}

/**
 * Paginates tombstones using their immutable createdAt timestamp.
 */
export function formatTombstonePagedResponse<T extends { createdAt: Date; id: string }>(
  items: T[],
  limit: number
): {
  data: T[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
} {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const lastItem = data[data.length - 1];

  const nextCursor =
    hasMore && lastItem ? encodeCursor({ updatedAt: lastItem.createdAt, id: lastItem.id }) : null;

  return {
    data,
    page: {
      nextCursor,
      hasMore,
    },
  };
}
