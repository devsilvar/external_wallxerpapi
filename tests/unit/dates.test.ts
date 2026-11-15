import { describe, expect, it } from 'vitest';
import { parseDateOnly, toDateOnly } from '../../src/lib/dates.js';
import { AppError } from '../../src/lib/errors.js';

describe('dates helper (src/lib/dates.ts)', () => {
  it('parses YYYY-MM-DD to UTC date and round-trips toDateOnly', () => {
    const input = '2026-03-15';
    const date = parseDateOnly(input);

    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(2); // 0-indexed: 2 is March
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);

    expect(toDateOnly(date)).toBe(input);
    expect(date.toISOString().slice(0, 10)).toBe(input);
  });

  it('handles leap years correctly', () => {
    const leapDay = '2024-02-29';
    const date = parseDateOnly(leapDay);
    expect(toDateOnly(date)).toBe(leapDay);
  });

  it('rejects a year before 2000 (1999-12-31)', () => {
    expect(() => parseDateOnly('1999-12-31')).toThrow(AppError);
    try {
      parseDateOnly('1999-12-31');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_DATE');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('rejects a year beyond currentYear + 10 (2099-01-01)', () => {
    expect(() => parseDateOnly('2099-01-01')).toThrow(AppError);
    try {
      parseDateOnly('2099-01-01');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_DATE');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('rejects impossible calendar dates (e.g. Feb 31)', () => {
    expect(() => parseDateOnly('2026-02-31')).toThrow(AppError);
  });

  it('rejects invalid months (e.g. month 13)', () => {
    expect(() => parseDateOnly('2026-13-01')).toThrow(AppError);
  });

  it('rejects malformed date strings', () => {
    expect(() => parseDateOnly('2026/03/15')).toThrow(AppError);
    expect(() => parseDateOnly('15-03-2026')).toThrow(AppError);
    expect(() => parseDateOnly('not-a-date')).toThrow(AppError);
    expect(() => parseDateOnly('')).toThrow(AppError);
  });
});
