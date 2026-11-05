// Report ranges and periods (15 §2.2, §4.3): presets resolved against today, inclusive calendar ranges, the
// week / month / quarter / year periods clipped to a range, and Comparison's calendar periods. Weeks start
// on the budget's first day of week; the rest use calendar boundaries. Dates are 'YYYY-MM-DD' with no time
// zones (04 §1).
import type { WeekDay } from '../budget-format';
import {
  addDays,
  addMonths,
  daysBetween,
  monthBounds,
  monthOf,
  monthRange,
  parts,
  toISODate,
  toMonth,
} from '../dates';
import type { ISODate, Month } from '../domain/types';
import type { ComparisonOptions, PeriodUnit, RangePreset, Timeframe } from './model';

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

/** A period of a report, clipped to the range. `future`: it starts after today (15 §2.2). */
export interface Period extends DateRange {
  future: boolean;
}

/** The weekday of a date, 0 = Sunday. */
export function weekdayOf(date: ISODate): WeekDay {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as WeekDay;
}

/** The first day of the week holding `date`. */
export function weekStartOf(date: ISODate, weekStart: WeekDay): ISODate {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7));
}

function quarterOf(date: ISODate): DateRange {
  const { y, m } = parts(date);
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  return {
    start: toISODate(y, first, 1),
    end: monthBounds(toMonth(y, first + 2)).last,
  };
}

function yearOf(y: number): DateRange {
  return { start: toISODate(y, 1, 1), end: toISODate(y, 12, 31) };
}

/**
 * A preset's range (15 §2.2). Latest 3 Months is this month and the two before it; This Year runs through
 * December; All Dates starts at the earliest transaction's month (this month when there is none).
 */
export function presetRange(
  preset: RangePreset,
  today: ISODate,
  earliest: ISODate | null,
): DateRange {
  const month = monthOf(today);
  switch (preset) {
    case 'thisMonth':
      return { start: monthBounds(month).first, end: monthBounds(month).last };
    case 'latest3':
      return { start: monthBounds(addMonths(month, -2)).first, end: monthBounds(month).last };
    case 'thisYear':
      return yearOf(parts(today).y);
    case 'lastYear':
      return yearOf(parts(today).y - 1);
    case 'all': {
      const first = earliest && earliest < today ? monthOf(earliest) : month;
      return { start: monthBounds(first).first, end: monthBounds(month).last };
    }
  }
}

export function resolveTimeframe(
  timeframe: Timeframe,
  today: ISODate,
  earliest: ISODate | null,
): DateRange {
  return timeframe.kind === 'custom'
    ? { start: timeframe.start, end: timeframe.end }
    : presetRange(timeframe.preset, today, earliest);
}

/** The calendar months a range touches, inclusive (15 §4.1 averages). */
export function monthsOfRange(range: DateRange): Month[] {
  return monthRange(monthOf(range.start), monthOf(range.end));
}

/** The range's periods, each clipped to it (15 §2.2). */
export function periodsOf(
  range: DateRange,
  groupBy: PeriodUnit,
  weekStart: WeekDay,
  today: ISODate,
): Period[] {
  const out: Period[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const whole = periodOf(cursor, groupBy, weekStart);
    const end = whole.end < range.end ? whole.end : range.end;
    out.push({ start: cursor, end, future: cursor > today });
    cursor = addDays(end, 1);
  }
  return out;
}

/** The whole calendar period of `unit` holding `date`. */
export function periodOf(date: ISODate, unit: PeriodUnit, weekStart: WeekDay): DateRange {
  switch (unit) {
    case 'week': {
      const start = weekStartOf(date, weekStart);
      return { start, end: addDays(start, 6) };
    }
    case 'month':
      return { start: monthBounds(monthOf(date)).first, end: monthBounds(monthOf(date)).last };
    case 'quarter':
      return quarterOf(date);
    case 'year':
      return yearOf(parts(date).y);
  }
}

/** Index of the period holding `date`, or -1 outside the range (periods are sorted and contiguous). */
export function periodIndex(periods: readonly Period[], date: ISODate): number {
  let lo = 0;
  let hi = periods.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = periods[mid];
    if (!p) return -1;
    if (date < p.start) hi = mid - 1;
    else if (date > p.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** True when a range is whole calendar months: from a 1st through a month's last day. */
export function isWholeMonths(range: DateRange): boolean {
  return parts(range.start).d === 1 && monthBounds(monthOf(range.end)).last === range.end;
}

/** The period of `unit` just before `period` (15 §4.3). */
export const periodBefore = (period: DateRange, unit: PeriodUnit, weekStart: WeekDay): DateRange =>
  periodOf(addDays(period.start, -1), unit, weekStart);

/** Comparison's default (15 §2.2): Month, the current calendar month. */
export const defaultComparison = (today: ISODate): ComparisonOptions => ({
  unit: 'month',
  start: monthBounds(monthOf(today)).first,
});

/** Comparison's periods (15 §4.3): the selected calendar period and the one of the same unit before it. */
export function comparedPeriods(
  options: ComparisonOptions,
  weekStart: WeekDay,
): { current: DateRange; previous: DateRange } {
  const current = periodOf(options.start, options.unit, weekStart);
  return { current, previous: periodBefore(current, options.unit, weekStart) };
}

/** The `count` periods of `unit` through the one holding today, newest first (15 §4.3). */
export function recentPeriods(
  unit: PeriodUnit,
  today: ISODate,
  weekStart: WeekDay,
  count: number,
): DateRange[] {
  let period = periodOf(today, unit, weekStart);
  const out = [period];
  while (out.length < count) {
    period = periodBefore(period, unit, weekStart);
    out.push(period);
  }
  return out;
}

/** True when `month` is after today's month: a future, unobserved month. */
export const isFutureMonth = (month: Month, today: ISODate): boolean =>
  monthBounds(month).first > today;

/** Days from `start` through `end`, inclusive. */
export const dayCount = (range: DateRange): number => daysBetween(range.start, range.end) + 1;
