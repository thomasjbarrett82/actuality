import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateOrder,
  daysBetween,
  daysInMonth,
  expandYear,
  firstDayOfMonth,
  firstDayOfYear,
  isISODate,
  isMonth,
  lastDayOfMonth,
  lastDayOfYear,
  monthBounds,
  monthOf,
  monthRange,
  monthsBetween,
  nextMonth,
  parseLoose,
  parts,
  prevMonth,
  today,
  toISODate,
} from './dates';
import type { ISODate, Month } from './domain/types';

const ref = '2026-10-18' as ISODate;

describe('dates: helpers', () => {
  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('validates dates and months', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('26-01-01')).toBe(false);
    expect(isMonth('2026-12')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-1')).toBe(false);
    expect(() => parts('nope')).toThrow();
  });

  it('does day arithmetic across months, years and DST', () => {
    expect(addDays(ref, 1)).toBe('2026-10-19');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });

  it('does month arithmetic', () => {
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
    expect(monthRange('2025-11', '2026-01')).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(monthRange('2026-02', '2026-01')).toEqual([]);
    expect(monthOf(ref)).toBe('2026-10');
    expect(() => addMonths('bad' as Month, 1)).toThrow();
  });

  it('finds month and year boundaries', () => {
    expect(firstDayOfMonth(ref)).toBe('2026-10-01');
    expect(lastDayOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(firstDayOfYear(ref)).toBe('2026-01-01');
    expect(lastDayOfYear(ref)).toBe('2026-12-31');
    expect(monthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
  });

  it('reads today from a clock', () => {
    expect(today(new Date(2026, 9, 18, 23, 59))).toBe('2026-10-18');
  });

  it('derives the day order of a date format', () => {
    expect(dateOrder('MM/dd/yyyy')).toBe('MDY');
    expect(dateOrder('dd.MM.yyyy')).toBe('DMY');
    expect(dateOrder('yyyy-MM-dd')).toBe('YMD');
  });

  it('round-trips addDays', () => {
    fc.assert(
      fc.property(fc.integer({ min: -40000, max: 40000 }), (n) => {
        expect(addDays(addDays(ref, n), -n)).toBe(ref);
        expect(daysBetween(ref, addDays(ref, n))).toBe(n);
      }),
    );
  });
});

describe('dates: loose parsing (11 §3)', () => {
  const p = (s: string, order: 'MDY' | 'DMY' | 'YMD' = 'MDY'): ISODate | null =>
    parseLoose(s, order, ref);

  it("accepts / . - and ' as separators", () => {
    expect(p('1/5/2026')).toBe('2026-01-05');
    expect(p('01.05.2026')).toBe('2026-01-05');
    expect(p('1-5-26')).toBe('2026-01-05');
    expect(p("1'5'26")).toBe('2026-01-05');
  });

  it('accepts the locale separator', () => {
    expect(parseLoose('5|1|2026', 'DMY', ref, '|')).toBe('2026-01-05');
  });

  it('follows the date order', () => {
    expect(p('5/1/2026', 'DMY')).toBe('2026-01-05');
    expect(p('2026-01-05', 'YMD')).toBe('2026-01-05');
    expect(p('26/1/5', 'YMD')).toBe('2026-01-05');
  });

  it('parses runs of digits', () => {
    expect(p('010526')).toBe('2026-01-05');
    expect(p('01052026')).toBe('2026-01-05');
    expect(p('05012026', 'DMY')).toBe('2026-01-05');
    expect(p('20260105', 'YMD')).toBe('2026-01-05');
    expect(p('1052026')).toBeNull();
  });

  it('uses the current year when it is missing', () => {
    expect(p('1/5')).toBe('2026-01-05');
    expect(p('5/1', 'DMY')).toBe('2026-01-05');
    expect(p('1/5', 'YMD')).toBe('2026-01-05');
  });

  it('expands two-digit years: > 70 → 19xx, else 20xx', () => {
    expect(expandYear(71)).toBe(1971);
    expect(expandYear(70)).toBe(2070);
    expect(p('1/5/99')).toBe('1999-01-05');
    expect(p('1/5/70')).toBe('2070-01-05');
  });

  it('rejects invalid dates and junk', () => {
    expect(p('')).toBeNull();
    expect(p('2/30/2026')).toBeNull();
    expect(p('13/1/2026')).toBeNull();
    expect(p('1/5/202')).toBeNull();
    expect(p('a/b/c')).toBeNull();
    expect(p('1/2/3/4')).toBeNull();
    expect(p('1')).toBeNull();
  });

  it('round-trips every valid date written in MDY', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1971, max: 2069 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          expect(p(`${m}/${d}/${y}`)).toBe(toISODate(y, m, d));
        },
      ),
    );
  });
});
