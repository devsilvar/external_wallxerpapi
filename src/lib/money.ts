import { Decimal } from '../db/scoped.js';
import { AppError } from './errors.js';

// Matches valid non-negative decimal representations, e.g. "15000", "15000.50", "0.99"
// Explicitly rejects shorthand like "150k", commas like "1,000", and negative signs like "-1".
const VALID_MONEY_STRING_REGEX = /^\d+(\.\d+)?$/;

/**
 * Parses a decimal string or JSON number into a Decimal normalized to 2 decimal places.
 * Rejects negative values, shorthand strings ("150k"), and formatted strings ("1,000").
 */
export function parseMoney(value: unknown): Decimal {
  let strVal: string;

  if (value instanceof Decimal || (typeof value === 'object' && value !== null && 'toFixed' in value)) {
    const d = new Decimal((value as { toString(): string }).toString());
    if (d.isNegative()) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Amount cannot be negative');
    }
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value) || value < 0) {
      throw new AppError(400, 'INVALID_AMOUNT', `Amount must be a non-negative number, received: ${value}`);
    }
    strVal = value.toString();
  } else if (typeof value === 'string') {
    if (!VALID_MONEY_STRING_REGEX.test(value)) {
      throw new AppError(
        400,
        'INVALID_AMOUNT',
        `Amount must be a valid non-negative decimal string (e.g. "15000.00"), received: "${value}"`
      );
    }
    strVal = value;
  } else {
    throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a decimal string or number');
  }

  try {
    const decimal = new Decimal(strVal);
    if (decimal.isNegative()) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Amount cannot be negative');
    }
    return decimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(400, 'INVALID_AMOUNT', `Failed to parse amount: "${strVal}"`);
  }
}

/**
 * Formats a Decimal to a string with exactly 2 decimal places.
 * Never returns a JavaScript number.
 */
export function formatMoney(value: Decimal | number | string): string {
  if (value instanceof Decimal) {
    return value.toFixed(2);
  }
  const parsed = parseMoney(value);
  return parsed.toFixed(2);
}
