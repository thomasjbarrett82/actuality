// Dates are 'YYYY-MM-DD' strings and months 'YYYY-MM', with no time zones (04 §1). Calendar maths is done
// on integers (or UTC Date values, which have no DST), never on local-time Dates.
import type { ISODate, Month } from './domain/types';

/** Day order of a date format (11 §3, 16 §1.3). */
export type DateOrder = 'MDY' | 'DMY' | 'YMD';

/** Actual's synced `dateFormat` values (07 §4), in date-fns tokens. */
export type DateFormat = 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'MM.dd.yyyy' | 'dd.MM.yyyy';

export const DATE_FORMATS: readonly DateFormat[] = [
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'yyyy-MM-dd',
  'MM.dd.yyyy',
  'dd.MM.yyyy',
];

export function dateOrder(format: string): DateOrder {
  const y = format.indexOf('y');
  const m = format.indexOf('M');
  const d = format.indexOf('d');
  if (y < m && y < d) return 'YMD';
  return d < m ? 'DMY' : 'MDY';
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function toISODate(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}` as ISODate;
}

export function toMonth(y: number, m: number): Month {
  return `${pad(y, 4)}-${pad(m)}` as Month;
}

/** Splits a date into numbers. Throws on anything that isn't a valid 'YYYY-MM-DD'. */
export function parts(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
    throw new Error(`Not a valid date: ${date}`);
  return { y, m, d };
}

export function isISODate(value: string): value is ISODate {
  try {
    parts(value);
    return true;
  } catch {
    return false;
  }
}

export function isMonth(value: string): value is Month {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

/** Today's date in the given (local) clock. Callers pass `new Date()` so tests can fix the clock. */
export function today(now: Date): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const toUTC = (date: ISODate): number => {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms: number): ISODate => {
  const dt = new Date(ms);
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};
const DAY_MS = 86_400_000;

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function monthOf(date: ISODate): Month {
  return date.slice(0, 7) as Month;
}

export function monthParts(month: Month): { y: number; m: number } {
  if (!isMonth(month)) throw new Error(`Not a YYYY-MM month: ${String(month)}`);
  return { y: Number(month.slice(0, 4)), m: Number(month.slice(5, 7)) };
}

export function addMonths(month: Month, n: number): Month {
  const { y, m } = monthParts(month);
  const index = y * 12 + (m - 1) + n;
  return toMonth(Math.floor(index / 12), (index % 12) + 1);
}

export const nextMonth = (month: Month): Month => addMonths(month, 1);
export const prevMonth = (month: Month): Month => addMonths(month, -1);

/** Months from `a` to `b` (positive when `b` is later). */
export function monthsBetween(a: Month, b: Month): number {
  const pa = monthParts(a);
  const pb = monthParts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: Month, to: Month): Month[] {
  const n = monthsBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addMonths(from, i));
}

export function firstDayOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return toISODate(y, m, 1);
}

export function lastDayOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return toISODate(y, m, daysInMonth(y, m));
}

export function firstDayOfYear(date: ISODate): ISODate {
  return toISODate(parts(date).y, 1, 1);
}

export function lastDayOfYear(date: ISODate): ISODate {
  return toISODate(parts(date).y, 12, 31);
}

/** First and last day of a month. */
export function monthBounds(month: Month): { first: ISODate; last: ISODate } {
  const { y, m } = monthParts(month);
  return { first: toISODate(y, m, 1), last: toISODate(y, m, daysInMonth(y, m)) };
}

/** Two-digit years: > 70 → 19xx, else 20xx (11 §3). */
export function expandYear(yy: number): number {
  return yy > 70 ? 1900 + yy : 2000 + yy;
}

/**
 * Loose date parsing for typed input (11 §3):
 * - the separators / . - ' (and `extraSeparator`, the locale's) are interchangeable;
 * - without separators, 6 digits are three 2-digit parts, and 8 digits are MMDDYYYY / DDMMYYYY (YYYYMMDD
 *   for year-first orders);
 * - a missing year means the current year (from `reference`);
 * - two-digit years: > 70 → 19xx, else 20xx;
 * - the part order follows `order`.
 * Returns null for anything that isn't a real date.
 */
export function parseLoose(
  text: string,
  order: DateOrder,
  reference: ISODate,
  extraSeparator?: string,
): ISODate | null {
  const s = text.trim();
  if (!s) return null;
  const seps = ['/', '.', '-', "'", ...(extraSeparator ? [extraSeparator] : [])];
  let fields: string[];
  if (/^\d+$/.test(s)) {
    if (s.length === 6) fields = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
    else if (s.length === 8)
      fields =
        order === 'YMD'
          ? [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)]
          : [s.slice(0, 2), s.slice(2, 4), s.slice(4, 8)];
    else return null;
  } else {
    let normalized = s;
    for (const sep of seps) normalized = normalized.split(sep).join('/');
    fields = normalized.split('/').filter((f) => f !== '');
    if (!fields.every((f) => /^\d{1,4}$/.test(f))) return null;
  }
  const nums = fields.map(Number);
  let y: number;
  let m: number;
  let d: number;
  const currentYear = parts(reference).y;
  if (nums.length === 2) {
    // No year: the remaining parts keep their relative order.
    [m, d] = order === 'DMY' ? [nums[1] ?? 0, nums[0] ?? 0] : [nums[0] ?? 0, nums[1] ?? 0];
    y = currentYear;
  } else if (nums.length === 3) {
    const [a = 0, b = 0, c = 0] = nums;
    const yearField = order === 'YMD' ? fields[0] : fields[2];
    if (order === 'YMD') [y, m, d] = [a, b, c];
    else if (order === 'DMY') [d, m, y] = [a, b, c];
    else [m, d, y] = [a, b, c];
    if ((yearField ?? '').length <= 2) y = expandYear(y);
    else if ((yearField ?? '').length === 3) return null;
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || y < 1) return null;
  return toISODate(y, m, d);
}
