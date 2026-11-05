// Quick Budget math (09 §5.5): the history window, averages, scheduled outflows and fills.
import { describe, expect, it } from 'vitest';
import type { Month } from '../domain/types';
import { divideRound } from '../money';
import {
  averageItems,
  averageOutflow,
  fillEntries,
  scheduledOutflows,
  startingMonth,
  validHistory,
  type QuickBudgetStats,
} from './quickbudget';

const CURRENT = '2026-10' as Month;

describe('startingMonth', () => {
  it('is the month before the current one for the current month or earlier', () => {
    expect(startingMonth('2026-10', CURRENT)).toBe('2026-09');
    expect(startingMonth('2026-03', CURRENT)).toBe('2026-09');
  });
  it('is the current month for a future month', () => {
    expect(startingMonth('2026-12', CURRENT)).toBe('2026-10');
  });
});

describe('validHistory', () => {
  const withData =
    (months: string[]) =>
    (m: Month): boolean =>
      months.includes(m);

  it('counts back from the starting month to the furthest month with data', () => {
    // Starting month 2026-09: 09, 08, 07 have data.
    expect(validHistory(12, CURRENT, CURRENT, withData(['2026-09', '2026-08', '2026-07']))).toBe(3);
  });

  it('counts up to the furthest month with data, across a gap', () => {
    expect(validHistory(12, CURRENT, CURRENT, withData(['2026-09', '2026-06']))).toBe(4);
  });

  it('caps at maxN and is 0 without data', () => {
    const all = (): boolean => true;
    expect(validHistory(12, CURRENT, CURRENT, all)).toBe(12);
    expect(validHistory(3, CURRENT, CURRENT, all)).toBe(3);
    expect(validHistory(12, CURRENT, CURRENT, () => false)).toBe(0);
  });

  it('includes the current month for a future month', () => {
    expect(validHistory(12, '2026-12', CURRENT, withData(['2026-10']))).toBe(1);
  });
});

describe('averageOutflow', () => {
  const activity: Record<string, number> = {
    '2026-09': -10_000,
    '2026-08': -20_000,
    '2026-07': -30_000,
    '2026-06': -40_000,
  };
  const of = (m: Month): number => activity[m] ?? 0;

  it('averages −activity over the n months ending at the starting month', () => {
    expect(averageOutflow(3, CURRENT, CURRENT, of)).toBe(20_000);
    expect(averageOutflow(1, CURRENT, CURRENT, of)).toBe(10_000);
    expect(averageOutflow(4, CURRENT, CURRENT, of)).toBe(25_000);
  });

  it('divides by the months walked, so empty months count as 0', () => {
    expect(averageOutflow(12, CURRENT, CURRENT, of)).toBe(8_333);
  });

  it('rounds half away from zero to minor units', () => {
    expect(divideRound(5, 2)).toBe(3);
    expect(divideRound(-5, 2)).toBe(-3);
    expect(divideRound(4, 3)).toBe(1);
    expect(divideRound(100, 3)).toBe(33);
    expect(divideRound(7, 1)).toBe(7);
  });
});

describe('averageItems (09 §5.4–5.5)', () => {
  it('shows the 3-month average only with more than 1 month of history', () => {
    expect(averageItems(1).average3).toBeNull();
    expect(averageItems(2).average3).toBe(2);
    expect(averageItems(7).average3).toBe(3);
  });

  it('shows the year average with more than 3 months, partial below 12', () => {
    expect(averageItems(3).year).toBeNull();
    expect(averageItems(4).year).toEqual({ months: 4, partial: true });
    expect(averageItems(12).year).toEqual({ months: 12, partial: false });
  });
});

describe('scheduledOutflows', () => {
  it('sums outflow × occurrences per category, ignoring inflows', () => {
    const out = scheduledOutflows([
      { amount: -5_000, categoryId: 'c-gym', lines: [], occurrences: ['2026-11-01', '2026-11-15'] },
      { amount: -1_000, categoryId: 'c-gym', lines: [], occurrences: ['2026-11-20'] },
      { amount: 300_000, categoryId: 'c-inc', lines: [], occurrences: ['2026-11-01'] },
      { amount: -9_000, categoryId: 'c-none', lines: [], occurrences: [] },
    ]);
    expect(Object.fromEntries(out)).toEqual({ 'c-gym': 11_000 });
  });

  it('counts the matching lines of a split schedule', () => {
    const out = scheduledOutflows([
      {
        amount: -3_000,
        categoryId: null,
        lines: [
          { categoryId: 'c-a', amount: -1_000 },
          { categoryId: 'c-b', amount: -2_000 },
        ],
        occurrences: ['2026-11-01'],
      },
    ]);
    expect(Object.fromEntries(out)).toEqual({ 'c-a': 1_000, 'c-b': 2_000 });
  });
});

describe('fillEntries (09 §5.5)', () => {
  const stats: QuickBudgetStats = {
    month: CURRENT,
    h12: 12,
    categories: {
      empty: {
        budgeted: 0,
        lastBudgeted: 100,
        lastOutflows: 90,
        average3: 80,
        averageYear: 70,
        scheduled: 0,
        balanceTo0: 50,
      },
      set: {
        budgeted: 200,
        lastBudgeted: 100,
        lastOutflows: 90,
        average3: 80,
        averageYear: 70,
        scheduled: 60,
        balanceTo0: 10,
      },
      setToZero: {
        budgeted: 250,
        lastBudgeted: 100,
        lastOutflows: 90,
        average3: 80,
        averageYear: 70,
        scheduled: 60,
        balanceTo0: 0,
      },
    },
  };

  it('fills only categories budgeted at 0, skipping fills of 0', () => {
    expect(fillEntries(stats, 'average3', ['empty', 'set'])).toEqual([
      { categoryId: 'empty', amount: 80 },
    ]);
    expect(fillEntries(stats, 'scheduled', ['empty', 'set'])).toEqual([]);
  });

  it('zeroes every category that has an amount', () => {
    expect(fillEntries(stats, 'zero', ['empty', 'set'])).toEqual([
      { categoryId: 'set', amount: 0 },
    ]);
  });

  it('balances all eligible categories, replacing existing amounts and including zero targets', () => {
    expect(fillEntries(stats, 'balanceTo0', ['empty', 'set', 'setToZero'])).toEqual([
      { categoryId: 'empty', amount: 50 },
      { categoryId: 'set', amount: 10 },
      { categoryId: 'setToZero', amount: 0 },
    ]);
  });
});
