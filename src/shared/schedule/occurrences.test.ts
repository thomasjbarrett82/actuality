// A recurring schedule's past occurrences as Actual computes them (12 §5). The same rules are checked
// against Actual's own `get-upcoming-dates` in tests/int/schedules.int.test.ts.
import { describe, expect, it } from 'vitest';
import type { ISODate, RecurConfig } from '../domain/types';
import { occurrencesBefore } from './occurrences';

const config = (over: Partial<RecurConfig>): RecurConfig => ({
  frequency: 'monthly',
  interval: 1,
  start: '2026-01-01',
  endMode: 'never',
  ...over,
});
const before = (c: Partial<RecurConfig>, until: string, from?: string): ISODate[] =>
  occurrencesBefore(config(c), until as ISODate, from as ISODate | undefined);

describe('occurrencesBefore (12 §5)', () => {
  it('steps days and weeks by the interval, up to but not including the date', () => {
    expect(before({ frequency: 'daily', interval: 3, start: '2026-10-01' }, '2026-10-11')).toEqual([
      '2026-10-01',
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ]);
    expect(before({ frequency: 'weekly', interval: 2, start: '2026-10-06' }, '2026-11-05')).toEqual(
      ['2026-10-06', '2026-10-20', '2026-11-03'],
    );
    expect(before({ frequency: 'weekly', start: '2026-10-06' }, '2026-10-13')).toEqual([
      '2026-10-06',
    ]);
  });

  it('skips months too short for the start day, and Feb 29 outside leap years', () => {
    expect(before({ start: '2026-01-31' }, '2026-06-01')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
    expect(before({ frequency: 'yearly', start: '2024-02-29' }, '2029-01-01')).toEqual([
      '2024-02-29',
      '2028-02-29',
    ]);
  });

  it('reads day patterns, -1 being the last day', () => {
    const twice = [
      { type: 'day', value: 15 },
      { type: 'day', value: -1 },
    ];
    expect(before({ start: '2026-01-15', patterns: twice }, '2026-03-16')).toEqual([
      '2026-01-15',
      '2026-01-31',
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
    ]);
  });

  it('reads weekday patterns: the nth, or the last', () => {
    const patterns = [
      { type: 'TU', value: 2 },
      { type: 'FR', value: -1 },
    ];
    expect(before({ patterns }, '2026-03-01')).toEqual([
      '2026-01-13',
      '2026-01-30',
      '2026-02-10',
      '2026-02-27',
    ]);
  });

  it('counts each rule on its own, as Actual builds one per kind of pattern', () => {
    const patterns = [
      { type: 'day', value: 1 },
      { type: 'MO', value: 1 },
    ];
    expect(
      before({ patterns, endMode: 'after_n_occurrences', endOccurrences: 2 }, '2026-12-31'),
    ).toEqual(['2026-01-01', '2026-01-05', '2026-02-01', '2026-02-02']);
  });

  it('stops at the end date (included) or after the count', () => {
    const weekly = { frequency: 'weekly' as const, start: '2026-10-06' as ISODate };
    expect(before({ ...weekly, endMode: 'on_date', endDate: '2026-10-20' }, '2026-11-30')).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
    ]);
    expect(
      before({ ...weekly, endMode: 'after_n_occurrences', endOccurrences: 2 }, '2026-11-30'),
    ).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('moves weekend dates to the Monday after or the Friday before', () => {
    // 2026-02-28 and 2026-03-28 are Saturdays.
    const start = '2026-02-28' as ISODate;
    expect(before({ start, skipWeekend: true, weekendSolveMode: 'after' }, '2026-04-01')).toEqual([
      '2026-03-02',
      '2026-03-30',
    ]);
    expect(before({ start, skipWeekend: true, weekendSolveMode: 'before' }, '2026-04-01')).toEqual([
      '2026-02-27',
      '2026-03-27',
    ]);
  });

  it('keeps only the dates from `from` on, and reads nothing it can’t', () => {
    expect(
      before({ frequency: 'weekly', start: '2026-10-06' }, '2026-11-05', '2026-10-15'),
    ).toEqual(['2026-10-20', '2026-10-27', '2026-11-03']);
    expect(before({ start: 'soon' as ISODate }, '2026-11-05')).toEqual([]);
  });
});
