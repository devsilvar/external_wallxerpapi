import { describe, expect, it } from 'vitest';
import {
  buildKeysetClause,
  decodeCursor,
  encodeCursor,
  parsePaginationParams,
} from '../../src/lib/cursor.js';
import { AppError } from '../../src/lib/errors.js';

describe('Keyset cursor helper (src/lib/cursor.ts)', () => {
  it('round-trips an { updatedAt, id } pair preserving exact timestamp and id', () => {
    const original = {
      updatedAt: new Date('2026-11-10T14:30:00.123Z'),
      id: '550e8400-e29b-41d4-a716-446655440000',
    };

    const encoded = encodeCursor(original);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('{'); // Must be opaque base64url

    const decoded = decodeCursor(encoded);
    expect(decoded.updatedAt.toISOString()).toBe(original.updatedAt.toISOString());
    expect(decoded.id).toBe(original.id);
  });

  it('rejects malformed or invalid cursor strings with 400 VALIDATION_FAILED', () => {
    expect(() => decodeCursor('')).toThrow(AppError);
    expect(() => decodeCursor('not-valid-base64-json!')).toThrow(AppError);

    // Valid base64 but missing required fields
    const badJson = Buffer.from(JSON.stringify({ something: 'else' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(badJson)).toThrow(AppError);

    // Bad date format
    const badDate = Buffer.from(JSON.stringify({ u: 'invalid-date', i: 'uuid' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(badDate)).toThrow(AppError);
  });

  it('builds keyset filter clause correctly for sync (ascending) and browse (descending)', () => {
    const cursor = {
      updatedAt: new Date('2026-11-10T12:00:00.000Z'),
      id: 'item-25',
    };

    // 1. Sync mode (ascending: updatedAt ASC, id ASC)
    const syncClause = buildKeysetClause(cursor, true);
    expect(syncClause).toEqual({
      OR: [
        { updatedAt: { gt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
      ],
    });

    // 2. Browse mode (descending: updatedAt DESC, id DESC)
    const browseClause = buildKeysetClause(cursor, false);
    expect(browseClause).toEqual({
      OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ],
    });
  });

  it('simulates keyset pagination over 50 rows sharing the exact same updatedAt without skipping or duplication', () => {
    const sharedDate = new Date('2026-11-10T12:00:00.000Z');
    // 50 simulated rows sharing one timestamp, ordered by id
    const allRows = Array.from({ length: 50 }, (_, i) => ({
      id: `item-${String(i).padStart(3, '0')}`,
      updatedAt: sharedDate,
    }));

    // Page 1: take 20
    const pageSize = 20;
    const page1 = allRows.slice(0, pageSize);
    expect(page1.length).toBe(20);

    const cursor1 = page1[page1.length - 1]!;
    const encodedCursor1 = encodeCursor(cursor1);

    // Fetch Page 2 using cursor1
    const decodedCursor1 = decodeCursor(encodedCursor1);
    const filter2 = buildKeysetClause(decodedCursor1, true);

    // Apply keyset logic manually in-memory
    const page2 = allRows
      .filter((row) => {
        if (!filter2?.OR) return true;
        return (
          row.updatedAt.getTime() > decodedCursor1.updatedAt.getTime() ||
          (row.updatedAt.getTime() === decodedCursor1.updatedAt.getTime() && row.id > decodedCursor1.id)
        );
      })
      .slice(0, pageSize);

    expect(page2.length).toBe(20);
    expect(page2[0]?.id).toBe('item-020');
    expect(page2[19]?.id).toBe('item-039');

    // Fetch Page 3 using cursor2
    const cursor2 = page2[page2.length - 1]!;
    const encodedCursor2 = encodeCursor(cursor2);
    const decodedCursor2 = decodeCursor(encodedCursor2);

    const page3 = allRows
      .filter((row) => {
        return (
          row.updatedAt.getTime() > decodedCursor2.updatedAt.getTime() ||
          (row.updatedAt.getTime() === decodedCursor2.updatedAt.getTime() && row.id > decodedCursor2.id)
        );
      })
      .slice(0, pageSize);

    expect(page3.length).toBe(10);
    expect(page3[0]?.id).toBe('item-040');
    expect(page3[9]?.id).toBe('item-049');

    // Total unique items seen
    const seenIds = new Set([...page1, ...page2, ...page3].map((r) => r.id));
    expect(seenIds.size).toBe(50);
  });

  it('parses pagination parameters with default 50 and max 200 bounds', () => {
    // Default limit is 50
    const p1 = parsePaginationParams({});
    expect(p1.limit).toBe(50);
    expect(p1.cursor).toBeNull();
    expect(p1.isSync).toBe(false);

    // Limit capped at 200
    const p2 = parsePaginationParams({ limit: '500' });
    expect(p2.limit).toBe(200);

    // Invalid limit throws
    expect(() => parsePaginationParams({ limit: 'invalid' })).toThrow(AppError);
    expect(() => parsePaginationParams({ limit: '-5' })).toThrow(AppError);

    // updatedSince triggers sync mode
    const p3 = parsePaginationParams({ updatedSince: '2026-11-10T00:00:00Z' });
    expect(p3.isSync).toBe(true);
    expect(p3.updatedSince).toBeInstanceOf(Date);
  });
});
