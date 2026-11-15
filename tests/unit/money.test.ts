import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../../src/lib/money.js';
import { AppError } from '../../src/lib/errors.js';

describe('money helper (src/lib/money.ts)', () => {
  it('parses valid decimal string "15000.00" and formats as "15000.00"', () => {
    const d = parseMoney('15000.00');
    expect(d.toNumber()).toBe(15000);
    expect(formatMoney(d)).toBe('15000.00');
  });

  it('accepts JSON number 15000.5 and formats as "15000.50"', () => {
    const d = parseMoney(15000.5);
    expect(formatMoney(d)).toBe('15000.50');
  });

  it('accepts whole integer string and formats with 2 decimal places', () => {
    const d = parseMoney('250');
    expect(formatMoney(d)).toBe('250.00');
  });

  it('rejects shorthand "150k" with INVALID_AMOUNT', () => {
    expect(() => parseMoney('150k')).toThrow(AppError);
    try {
      parseMoney('150k');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_AMOUNT');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('rejects comma-formatted numbers like "1,000"', () => {
    expect(() => parseMoney('1,000')).toThrow(AppError);
    try {
      parseMoney('1,000');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_AMOUNT');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('rejects negative numbers and negative strings (-1, "-15.00")', () => {
    expect(() => parseMoney(-1)).toThrow(AppError);
    expect(() => parseMoney('-15.00')).toThrow(AppError);
  });

  it('rejects non-numeric and non-string inputs', () => {
    expect(() => parseMoney(null)).toThrow(AppError);
    expect(() => parseMoney(undefined)).toThrow(AppError);
    expect(() => parseMoney({})).toThrow(AppError);
    expect(() => parseMoney(NaN)).toThrow(AppError);
    expect(() => parseMoney(Infinity)).toThrow(AppError);
  });
});
