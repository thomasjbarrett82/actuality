// A recurring schedule's past occurrences (12 §5), computed the way Actual computes them: its
// `recurConfigToRSchedule` turns the config into RFC 5545 rules for rschedule, and `get-upcoming-dates`
// moves weekend dates (26.11.0). Actual's handler only lists dates from today on, so the app needs this for
// the overdue occurrences before today. Dates from today on still come from Actual.
import { addDays, addMonths, daysInMonth, isISODate, monthParts, parts, toISODate } from '../dates';
import type { ISODate, Month, RecurConfig } from '../domain/types';

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 0 = Sunday … 6 = Saturday. */
const weekdayOf = (date: ISODate): number => {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** A month's days that a `day` pattern names: days past its end are skipped, `-1` is the last day. */
function monthDays(month: Month, days: readonly number[]): number[] {
  const { y, m } = monthParts(month);
  const length = daysInMonth(y, m);
  return days.filter((d) => Math.abs(d) <= length).map((d) => (d > 0 ? d : length + d + 1));
}

/** A month's days that weekday patterns name: the nth one (from the end when negative), or every one. */
function monthWeekdays(month: Month, weekdays: readonly [number, number | null][]): number[] {
  const { y, m } = monthParts(month);
  const length = daysInMonth(y, m);
  const first = weekdayOf(toISODate(y, m, 1));
  const out: number[] = [];
  for (const [weekday, nth] of weekdays) {
    const all: number[] = [];
    for (let d = 1 + ((weekday - first + 7) % 7); d <= length; d += 7) all.push(d);
    if (nth === null) out.push(...all);
    else {
      const d = nth > 0 ? all[nth - 1] : all[all.length + nth];
      if (d !== undefined) out.push(d);
    }
  }
  return out;
}

/** One rschedule rule: its candidate days in each month of the cycle (monthly and yearly). */
type DaysOf = (month: Month) => number[];

/** The rules Actual builds from a config: a monthly config with both kinds of pattern makes two. */
function rulesOf(config: RecurConfig): (DaysOf | null)[] {
  if (config.frequency !== 'monthly' || !config.patterns?.length) return [null];
  const days = config.patterns.filter((p) => p.type === 'day').map((p) => p.value);
  const weekdays = config.patterns
    .filter((p) => p.type !== 'day')
    .map((p): [number, number | null] => [
      WEEKDAYS.indexOf(p.type.slice(0, 2).toUpperCase()),
      typeof p.value === 'number' && p.value !== 0 ? p.value : null,
    ])
    .filter(([w]) => w >= 0);
  const rules: DaysOf[] = [];
  if (days.length > 0) rules.push((month) => monthDays(month, days));
  if (weekdays.length > 0) rules.push((month) => monthWeekdays(month, weekdays));
  return rules;
}

/** One rule's dates from the start, before `before` (and within the end date and count). */
function ruleDates(config: RecurConfig, days: DaysOf | null, before: ISODate): ISODate[] {
  const start = config.start;
  const interval = config.interval !== undefined && config.interval > 0 ? config.interval : 1;
  const end = config.endMode === 'on_date' && config.endDate ? config.endDate : null;
  const count = config.endMode === 'after_n_occurrences' ? (config.endOccurrences ?? 0) : Infinity;
  const limit = end !== null && end < before ? addDays(end, 1) : before;
  const out: ISODate[] = [];
  const take = (date: ISODate): boolean => {
    if (date >= limit || out.length >= count) return false;
    if (date >= start) out.push(date);
    return true;
  };
  if (config.frequency === 'daily' || config.frequency === 'weekly') {
    const step = config.frequency === 'daily' ? interval : interval * 7;
    for (let date = start; take(date); date = addDays(date, step));
    return out;
  }
  // Monthly and yearly: without patterns, the start's day, skipped in months too short for it.
  const { d } = parts(start);
  const stepMonths = config.frequency === 'yearly' ? interval * 12 : interval;
  for (
    let month = start.slice(0, 7) as Month;
    `${month}-01` < limit;
    month = addMonths(month, stepMonths)
  ) {
    const { y, m } = monthParts(month);
    const candidates = [...new Set(days ? days(month) : monthDays(month, [d]))].sort(
      (a, b) => a - b,
    );
    for (const day of candidates) if (!take(toISODate(y, m, day))) return out;
  }
  return out;
}

/** A weekend date moved as Actual moves it: to the Friday before or the Monday after. */
function solveWeekend(config: RecurConfig, date: ISODate): ISODate {
  if (!config.skipWeekend) return date;
  const weekday = weekdayOf(date);
  if (weekday !== 0 && weekday !== 6) return date;
  if (config.weekendSolveMode === 'after') return addDays(date, weekday === 6 ? 2 : 1);
  if (config.weekendSolveMode === 'before') return addDays(date, weekday === 6 ? -1 : -2);
  return date;
}

/**
 * The occurrences Actual would list for `config` before `before` (today, where its handler starts), and
 * from `from` on when given, with weekend dates moved, in order. As in Actual, the bounds apply to the
 * dates before they're moved. Empty for a config Actual couldn't read.
 */
export function occurrencesBefore(config: RecurConfig, before: ISODate, from?: ISODate): ISODate[] {
  if (!isISODate(config.start)) return [];
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(config.frequency)) return [];
  const raw = rulesOf(config).flatMap((days) => ruleDates(config, days, before));
  return [...new Set(raw)]
    .filter((date) => from === undefined || date >= from)
    .sort()
    .map((date) => solveWeekend(config, date));
}
