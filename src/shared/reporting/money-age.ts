// Money Age (15 §5): the average calendar-day age of known-age cents when spent, allocated FIFO over all
// available history. The pool is every open on-budget account, whatever the report filters.
//
// - Positive non-transfer sides (any category, split lines one by one) and inbound transfers from outside
//   the pool are known-age buckets dated on their transaction date.
// - Positive Starting Balance rows are unknown-age funds; negative ones neither fund nor offset anything.
// - Transfers within the pool change nothing.
// - Every outflow takes unknown-age funds first, then the oldest buckets. Only eligible spending (negative,
//   non-transfer, non-Starting-Balance, non-income) counts: its known-age matches add
//   `cents × age in days` to its month, and all of it adds to the month's spending (coverage).
// - Same day: positive sides first, then by transaction id and split line order.
// Cents and the weighted numerator stay integers; the average is rounded only for display.
import { daysBetween, monthOf } from '../dates';
import type { Id, ISODate, Money, Month } from '../domain/types';
import { basisPoints } from '../money';
import { isIncomeSide, type ReportIndex, type ReportSide } from './input';
import type { MoneyAgePoint } from './result';

interface MonthStats {
  known: Money;
  spending: Money;
  ageDays: bigint;
}

/** The pool's processing order (15 §5): date, positive before negative, transaction id, line. */
function compareSides(a: ReportSide, b: ReportSide): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.amount > 0 ? 0 : 1;
  const cb = b.amount > 0 ? 0 : 1;
  if (ca !== cb) return ca - cb;
  if (a.transactionId !== b.transactionId) return a.transactionId < b.transactionId ? -1 : 1;
  return a.line - b.line;
}

/** `ageDays / known`, rounded half up to whole days (both are non-negative). */
function averageDays(ageDays: bigint, known: Money): number {
  const k = BigInt(known);
  return Number((ageDays * 2n + k) / (2n * k));
}

/** The pool's monthly statistics from all history in `sides` through today (later sides haven't happened). */
export function moneyAgeByMonth(
  index: ReportIndex,
  sides: readonly ReportSide[],
  today: ISODate,
): Map<Month, MonthStats> {
  const pool = new Set<Id>(
    index.input.accounts.filter((a) => !a.closed && !a.offBudget).map((a) => a.id),
  );
  const ordered = sides
    .filter((s) => pool.has(s.accountId) && s.amount !== 0 && s.date <= today)
    .sort(compareSides);
  const bucketDate: ISODate[] = [];
  const bucketLeft: Money[] = [];
  let head = 0;
  let unknown: Money = 0;
  const stats = new Map<Month, MonthStats>();

  for (const side of ordered) {
    if (side.startingBalance) {
      if (side.amount > 0) unknown += side.amount;
      continue;
    }
    const transfer = side.transferAccountId;
    if (transfer !== null && pool.has(transfer)) continue;
    if (side.amount > 0) {
      bucketDate.push(side.date);
      bucketLeft.push(side.amount);
      continue;
    }
    const spending = transfer === null && !isIncomeSide(index, side);
    let rest = -side.amount;
    const fromUnknown = Math.min(unknown, rest);
    unknown -= fromUnknown;
    rest -= fromUnknown;
    let matched: Money = 0;
    let ageDays = 0n;
    while (rest > 0 && head < bucketLeft.length) {
      const left = bucketLeft[head] ?? 0;
      const take = Math.min(left, rest);
      if (spending) {
        matched += take;
        ageDays += BigInt(take) * BigInt(daysBetween(bucketDate[head] ?? side.date, side.date));
      }
      rest -= take;
      if (take === left) head++;
      else bucketLeft[head] = left - take;
    }
    if (!spending) continue;
    const month = monthOf(side.date);
    const s = stats.get(month) ?? { known: 0, spending: 0, ageDays: 0n };
    s.known += matched;
    s.spending += -side.amount;
    s.ageDays += ageDays;
    stats.set(month, s);
  }
  return stats;
}

/** The months' Money Age points (15 §5): no value without eligible spending; Partial below 100 %. */
export function moneyAgePoints(
  stats: ReadonlyMap<Month, MonthStats>,
  months: readonly Month[],
  today: ISODate,
): MoneyAgePoint[] {
  const thisMonth = monthOf(today);
  return months.map((month) => {
    const s = stats.get(month);
    const future = month > thisMonth;
    if (!s || s.spending === 0 || future)
      return { month, days: null, knownCents: 0, spendingCents: 0, coverage: null, future };
    return {
      month,
      days: s.known > 0 ? averageDays(s.ageDays, s.known) : null,
      knownCents: s.known,
      spendingCents: s.spending,
      coverage: basisPoints(s.known, s.spending),
      future,
    };
  });
}

/** The latest available point: the last observed month with eligible spending (15 §4.1). */
export function latestMoneyAge(points: readonly MoneyAgePoint[]): MoneyAgePoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p && !p.future && p.spendingCents > 0) return p;
  }
  return null;
}
