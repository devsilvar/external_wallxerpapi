import { AppError } from './errors.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD string into a UTC Date object.
 * Rejects invalid format, impossible calendar dates, and years outside [2000, currentYear + 10].
 */
export function parseDateOnly(value: string): Date {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw new AppError(400, 'INVALID_DATE', `Date must be formatted as YYYY-MM-DD, received: "${value}"`);
  }

  const parts = value.split('-');
  const yearStr = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];

  if (!yearStr || !monthStr || !dayStr) {
    throw new AppError(400, 'INVALID_DATE', `Date must be formatted as YYYY-MM-DD, received: "${value}"`);
  }

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const currentYear = new Date().getUTCFullYear();
  const maxYear = currentYear + 10;

  if (year < 2000 || year > maxYear) {
    throw new AppError(
      400,
      'INVALID_DATE',
      `Year ${year} is out of allowed range [2000, ${maxYear}]`
    );
  }

  if (month < 1 || month > 12) {
    throw new AppError(400, 'INVALID_DATE', `Invalid month: ${month}`);
  }

  // Construct UTC date
  const date = new Date(Date.UTC(year, month - 1, day));

  // Verify the date didn't overflow (e.g. Feb 31 -> Mar 3)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError(400, 'INVALID_DATE', `Invalid calendar date: "${value}"`);
  }

  return date;
}

/**
 * Formats a Date to a YYYY-MM-DD string using UTC values.
 */
export function toDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
