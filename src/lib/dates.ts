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

// Nigeria is UTC+1 year-round (no DST). Deriving the calendar day through Intl
// rather than shifting by a fixed offset keeps this correct if the platform
// ever changes zone.
const LAGOS_DATE = new Intl.DateTimeFormat('en-CA', {
timeZone: 'Africa/Lagos',
year: 'numeric',
month: '2-digit',
day: '2-digit',
});

/**
 * Returns the Africa/Lagos calendar day for `now`, encoded as a UTC-midnight
 * Date. Every `@db.Date` value must be built this way — Prisma serialises them
 * using UTC, so any other construction shifts the day on a UTC+ host.
 */
export function lagosDateOnly(now: Date = new Date()): Date {
const key = LAGOS_DATE.format(now);
const [year, month, day] = key.split('-').map(Number);
return new Date(Date.UTC(year!, month! - 1, day!));
}

/** Returns a new UTC-midnight Date `days` days after `date` (negative moves back). */
export function addUtcDays(date: Date, days: number): Date {
return new Date(date.getTime() + days * 86_400_000);
}
