// Quick Budget math (09 §5.5): the history window, averages and scheduled outflows. The host computes the
// stats from `getBudgetMonth` values; the renderer turns them into menu items and fills.
import { addMonths, nextMonth, prevMonth } from '../dates';
import type { Id, ISODate, Money, Month } from '../domain/types';
import { divideRound } from '../money';

/**
 * The month history counts back from: the month before the current one when `m` is the current month or
 * earlier, otherwise the current month (09 §5.5).
 */
export function startingMonth(m: Month, current: Month): Month {
  return m <= current ? prevMonth(current) : current;
}

/**
 * How many months of history the averages may use, at most `maxN`: walking back from
 * `next(startingMonth(m))`, the count up to the furthest month whose previous month has real data.
 */
export function validHistory(
  maxN: number,
  m: Month,
  current: Month,
  hasRealData: (month: Month) => boolean,
): number {
  const from = nextMonth(startingMonth(m, current));
  let count = 0;
  for (let i = 0; i < maxN; i++) {
    if (hasRealData(addMonths(from, -i - 1))) count = i + 1;
  }
  return count;
}

/**
 * The average outflow over the `n` months ending at `startingMonth(m)` (09 §5.5): Σ −activity, divided by
 * the months walked (at least 1), rounded to minor units.
 */
export function averageOutflow(
  n: number,
  m: Month,
  current: Month,
  activity: (month: Month) => Money,
): Money {
  const from = nextMonth(startingMonth(m, current));
  const walked = Math.max(1, n);
  let total = 0;
  for (let i = 1; i <= walked; i++) total -= activity(addMonths(from, -i));
  return divideRound(total, walked);
}

/** A schedule as the scheduled-outflow sum needs it (12 §5). */
export interface ScheduleOutflowInput {
  /** Negative for an outflow. A schedule with a positive amount is ignored. */
  amount: Money;
  categoryId: Id | null;
  /** Split lines' categories and amounts; empty for a normal schedule. */
  lines: { categoryId: Id | null; amount: Money }[];
  /** Its occurrence dates inside the month (from `next_date` on). */
  occurrences: readonly ISODate[];
}

/** Σ outflow × occurrences per category (09 §5.5). Inflows are ignored; splits count matching lines. */
export function scheduledOutflows(schedules: readonly ScheduleOutflowInput[]): Map<Id, Money> {
  const out = new Map<Id, Money>();
  const add = (id: Id | null, outflow: Money, times: number): void => {
    if (id === null || outflow <= 0) return;
    out.set(id, (out.get(id) ?? 0) + outflow * times);
  };
  for (const s of schedules) {
    if (s.amount > 0 || s.occurrences.length === 0) continue;
    const times = s.occurrences.length;
    if (s.lines.length === 0) add(s.categoryId, -s.amount, times);
    else for (const l of s.lines) add(l.categoryId, -l.amount, times);
  }
  return out;
}

/** A category's Quick Budget values (09 §5.4–5.5). */
export interface CategoryQuickStats {
  /** Amount budgeted last month. */
  lastBudgeted: Money;
  /** −activity of last month. */
  lastOutflows: Money;
  /** Average outflows over min(3, h12) months. */
  average3: Money;
  /** Average outflows over h12 months. */
  averageYear: Money;
  scheduled: Money;
  /** The budgeted amount that brings the balance to 0: budgeted − balance. */
  balanceTo0: Money;
  /** The category's budgeted amount in the month now. */
  budgeted: Money;
}

/** `budget.quickBudgetStats` (09 §5.5). */
export interface QuickBudgetStats {
  month: Month;
  /** Months of valid history, at most 12. */
  h12: number;
  categories: Record<Id, CategoryQuickStats>;
}

/** Which average items the menus show (09 §5.4–5.5). */
export function averageItems(h12: number): {
  average3: number | null;
  /** The months of the "last year" average, or null; `partial` when fewer than 12. */
  year: { months: number; partial: boolean } | null;
} {
  return {
    average3: h12 > 1 ? Math.min(3, h12) : null,
    year: h12 > 3 ? { months: h12, partial: h12 !== 12 } : null,
  };
}

export type QuickFill =
  | 'lastBudgeted'
  | 'lastOutflows'
  | 'average3'
  | 'averageYear'
  | 'scheduled'
  | 'balanceTo0'
  | 'zero';

/**
 * The budget writes for a month-level Quick Budget item (09 §5.5): fills change only categories
 * budgeted at 0 (and skip a fill that is 0 too), except "balanceTo0", which replaces each eligible
 * category's amount with its target; "zero" sets every eligible category to 0.
 */
export function fillEntries(
  stats: QuickBudgetStats,
  which: QuickFill,
  categoryIds: readonly Id[],
): { categoryId: Id; amount: Money }[] {
  const out: { categoryId: Id; amount: Money }[] = [];
  for (const id of categoryIds) {
    const s = stats.categories[id];
    if (!s) continue;
    if (which === 'zero') {
      if (s.budgeted !== 0) out.push({ categoryId: id, amount: 0 });
      continue;
    }
    if (which === 'balanceTo0') {
      if (s.budgeted !== s.balanceTo0) out.push({ categoryId: id, amount: s.balanceTo0 });
      continue;
    }
    if (s.budgeted !== 0) continue;
    const amount = s[which];
    if (amount !== 0) out.push({ categoryId: id, amount });
  }
  return out;
}
