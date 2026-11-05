// Display formatters (07 §4.2). Number and date *formats* come from the budget's Actual prefs; month and
// weekday *names* come from the UI language's date-fns locale (20 §3.3). User-visible words ("Today at",
// "(Current)") are added by the caller through i18n, so these helpers return parts where words are needed.
import { format as formatDate, type Locale } from 'date-fns';
import { daysBetween, monthParts, parts, today } from './dates';
import type { ISODate, Money, Month } from './domain/types';
import { format, separators, type MoneySettings } from './money';

/**
 * `1234.56`: editable fields (the budget's decimal separator) and exports (pass `decimal: '.'`).
 * No thousands separators and no symbol.
 */
export function currencyPlain(m: Money, settings: MoneySettings, decimal?: string): string {
  return format(m, settings, {
    thousands: false,
    decimal: decimal ?? separators(settings.numberFormat).decimal,
  });
}

const toDate = (date: ISODate): Date => {
  const { y, m, d } = parts(date);
  return new Date(y, m - 1, d);
};

/** Per `dateFormat`; with `twoDigitYear` in grids that use MM/DD/YY. */
export function dateShort(date: ISODate, dateFormat: string, twoDigitYear = false): string {
  return formatDate(toDate(date), twoDigitYear ? dateFormat.replace('yyyy', 'yy') : dateFormat);
}

/** `01/31/2026`: `dateFormat` with a four-digit year (CSV export). */
export function dateLongYear(date: ISODate, dateFormat: string): string {
  return formatDate(toDate(date), dateFormat);
}

const monthDate = (month: Month): Date => {
  const { y, m } = monthParts(month);
  return new Date(y, m - 1, 1);
};

/** `January 2026`. The caller adds "(Current)" for the current month through i18n. */
export function monthHeader(month: Month, locale?: Locale): string {
  return formatDate(monthDate(month), 'MMMM yyyy', locale ? { locale } : {});
}

/** `January` for month 1–12, in its standalone form (a month select that sits beside a year select). */
export function monthName(month: number, locale?: Locale): string {
  return formatDate(new Date(2000, month - 1, 1), 'LLLL', locale ? { locale } : {});
}

/** `Jan 2026`: Spending Comparison's period names (15 §4.3). */
export function monthShortFullYear(month: Month, locale?: Locale): string {
  return formatDate(monthDate(month), 'MMM yyyy', locale ? { locale } : {});
}

/** `Jan '26`: timeline, report columns. */
export function monthShortYear(month: Month, locale?: Locale): string {
  return formatDate(monthDate(month), "MMM ''yy", locale ? { locale } : {});
}

export type RecentDate =
  { kind: 'today' | 'yesterday'; time: string } | { kind: 'date'; date: string };

/**
 * "Today at 3:15 PM" / "Yesterday at 3:15 PM" / the short date (Budget List). Returns the parts; the
 * caller supplies the words. `dateFormat` is the budget's, `now` the current time.
 */
export function recentDate(at: Date, now: Date, dateFormat: string, locale?: Locale): RecentDate {
  const opts = locale ? { locale } : {};
  const diff = daysBetween(today(at), today(now));
  if (diff === 0) return { kind: 'today', time: formatDate(at, 'p', opts) };
  if (diff === 1) return { kind: 'yesterday', time: formatDate(at, 'p', opts) };
  return { kind: 'date', date: dateShort(today(at), dateFormat, true) };
}
