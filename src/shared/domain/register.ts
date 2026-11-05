// Register logic that doesn't depend on the UI (10 §2, §7; 04 §8): columns, multisort with the fixed tie
// chain, running balances over the unfiltered list in the balance order, and the summary totals.
import type { ClearedState, ErrorLevel, Id, ISODate, Money } from './types';
import { ERROR_RANK } from './types';

/** The register's columns (10 §2), in display order. */
export const REGISTER_COLUMNS = [
  'select',
  'account',
  'date',
  'check',
  'payee',
  'error',
  'category',
  'notes',
  'outflow',
  'inflow',
  'balance',
  'cleared',
] as const;
export type RegisterColumn = (typeof REGISTER_COLUMNS)[number];

/** Columns the chooser can show or hide (10 §2), in its order. */
export const TOGGLEABLE_COLUMNS = ['check', 'cleared', 'notes', 'balance'] as const;
export type ToggleableColumn = (typeof TOGGLEABLE_COLUMNS)[number];

/** Columns whose width the user can change (10 §2). */
export const RESIZABLE_COLUMNS: ReadonlySet<RegisterColumn> = new Set([
  'account',
  'check',
  'payee',
  'category',
  'notes',
]);

/** Default widths in rem (10 §2). */
export const DEFAULT_WIDTHS: Readonly<Record<RegisterColumn, number>> = {
  select: 2.5,
  account: 5.75,
  date: 5.75,
  check: 5.75,
  payee: 13.5,
  error: 2,
  category: 13.5,
  notes: 11.5,
  outflow: 5.4,
  inflow: 5.4,
  balance: 5.4,
  cleared: 2.5,
};

/** A saved column setting (19 §2 `mainColumns`). */
export interface ColumnSetting {
  field: string;
  visible: boolean;
  width: number;
}

/** The toggleable columns' default visibility (10 §2): Check # and Running Balance start hidden. */
export function defaultColumns(): ColumnSetting[] {
  return TOGGLEABLE_COLUMNS.map((field): ColumnSetting => ({
    field,
    visible: field !== 'check' && field !== 'balance',
    width: DEFAULT_WIDTHS[field],
  })).concat(
    (['account', 'payee', 'category'] as const).map((field) => ({
      field,
      visible: true,
      width: DEFAULT_WIDTHS[field],
    })),
  );
}

/** The visible toggleable columns of a setting, as a comparable key (10 §2 width copying). */
export function visibilityKey(columns: readonly ColumnSetting[]): string {
  return TOGGLEABLE_COLUMNS.filter((c) => columns.find((x) => x.field === c)?.visible)
    .sort()
    .join(',');
}

export const SORTABLE_COLUMNS: ReadonlySet<RegisterColumn> = new Set([
  'account',
  'date',
  'check',
  'payee',
  'error',
  'category',
  'notes',
  'outflow',
  'inflow',
  'cleared',
]);

export interface RegisterSort {
  field: RegisterColumn;
  desc: boolean;
}

/** Default: Date descending, newest at the top (10 §2). */
export const DEFAULT_SORT: RegisterSort = { field: 'date', desc: true };

/** Reconciliation forces Date ascending (10 §2, 13 §6.2). */
export const RECONCILE_SORT: RegisterSort = { field: 'date', desc: false };

/** The register sorts by up to this many keys (multisort, 10 §2). */
export const MAX_SORT_KEYS = 4;

/**
 * The sort keys after a header click (10 §2). A plain click sorts by that column alone, reversing it when
 * it is already the primary key. Shift+click adds a column as the last key, ascending, or cycles a key
 * ascending → descending → removed, keeping its place; removing the last key restores the default.
 */
export function nextSortKeys(
  keys: readonly RegisterSort[],
  field: RegisterColumn,
  shift: boolean,
): RegisterSort[] {
  if (!SORTABLE_COLUMNS.has(field)) return [...keys];
  if (!shift) return [{ field, desc: keys[0]?.field === field ? !keys[0].desc : false }];
  const i = keys.findIndex((k) => k.field === field);
  if (i < 0) return keys.length >= MAX_SORT_KEYS ? [...keys] : [...keys, { field, desc: false }];
  if (!keys[i]?.desc) return keys.map((k, j) => (j === i ? { field, desc: true } : k));
  const rest = keys.filter((_, j) => j !== i);
  return rest.length ? rest : [DEFAULT_SORT];
}

/** What sorting needs from a row: its display texts and states. */
export interface SortRow {
  id: Id;
  date: ISODate;
  amount: Money;
  checkNumber: string | null;
  payeeText: string;
  categoryText: string;
  notes: string;
  accountName: string;
  cleared: ClearedState;
  errorLevel: ErrorLevel;
  /** The scheduler's Frequency column (12 §3): the position in the Frequency combo. */
  frequencyRank?: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const text = (a: string, b: string): number => collator.compare(a, b);

const CLEARED_RANK: Readonly<Record<ClearedState, number>> = { U: 0, C: 1, R: 2 };
/** Check numbers in natural order; none sorts first. */
function checkOrder(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return text(a, b);
}

const outflow = (m: Money): Money => (m < 0 ? -m : 0);
const inflow = (m: Money): Money => (m > 0 ? m : 0);

const KEYS: Readonly<Record<string, (a: SortRow, b: SortRow) => number>> = {
  date: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  amount: (a, b) => a.amount - b.amount,
  check: (a, b) => checkOrder(a.checkNumber, b.checkNumber),
  payee: (a, b) => text(a.payeeText, b.payeeText),
  category: (a, b) => text(a.categoryText, b.categoryText),
  notes: (a, b) => text(a.notes, b.notes),
  cleared: (a, b) => CLEARED_RANK[a.cleared] - CLEARED_RANK[b.cleared],
  error: (a, b) => ERROR_RANK[a.errorLevel] - ERROR_RANK[b.errorLevel],
  account: (a, b) => text(a.accountName, b.accountName),
  outflow: (a, b) => outflow(a.amount) - outflow(b.amount),
  inflow: (a, b) => inflow(a.amount) - inflow(b.amount),
  frequency: (a, b) => (a.frequencyRank ?? 0) - (b.frequencyRank ?? 0),
};

/** A sort key: the register's columns, or the scheduler's (12 §3). */
interface SortKey {
  field: string;
  desc: boolean;
}

/** Ties are broken by this fixed chain (10 §2). */
const TIE_CHAIN = ['date', 'amount', 'check', 'payee', 'category', 'notes', 'cleared', 'error'];

/**
 * The comparator for a sort (10 §2): each key in its own direction, then the tie chain without the
 * columns that are keys, then the id. The chain and the id take the primary key's direction, except that
 * in the register (`sameDayByAmount`) the chain's Amount, reached only between rows on the same date, is
 * always signed ascending: largest outflow first, largest inflow last. The scheduler (12 §3) keeps the
 * primary direction throughout.
 */
export function comparator(
  sort: SortKey | readonly SortKey[],
  { sameDayByAmount = false }: { sameDayByAmount?: boolean } = {},
): (a: SortRow, b: SortRow) => number {
  const keys = 'field' in sort ? [sort] : sort;
  const primary = keys[0]?.desc ? -1 : 1;
  const used = new Set<string>();
  const steps: [(a: SortRow, b: SortRow) => number, number][] = [];
  const add = (field: string, dir: number): void => {
    const f = KEYS[field];
    if (used.has(field) || !f) return;
    used.add(field);
    steps.push([f, dir]);
  };
  for (const k of keys) add(k.field, k.desc ? -1 : 1);
  for (const k of TIE_CHAIN) add(k, k === 'amount' && sameDayByAmount ? 1 : primary);
  return (a, b) => {
    for (const [f, dir] of steps) {
      const c = f(a, b);
      if (c !== 0) return c * dir;
    }
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * primary;
  };
}

/** The cumulative balances at a row (10 §7.4): through that row in the balance order. */
export interface RunningBalance {
  cleared: Money;
  uncleared: Money;
  working: Money;
}

/**
 * Cumulative balances over a list in accumulation order (oldest first): the result has one entry per
 * row, in the same order.
 */
export function runningBalances(
  rows: readonly { amount: Money; cleared: ClearedState }[],
): RunningBalance[] {
  let cleared = 0;
  let uncleared = 0;
  return rows.map((r) => {
    if (r.cleared === 'U') uncleared += r.amount;
    else cleared += r.amount;
    return { cleared, uncleared, working: cleared + uncleared };
  });
}

/**
 * The keys the running balance is ordered by (10 §7.4), derived from the display keys: Date in its
 * selected direction (descending if it is not a key), then Outflow and Inflow in their relative order and
 * directions, a missing one appended as Outflow descending or Inflow ascending. Other keys are ignored.
 */
export function balanceSortKeys(keys: readonly RegisterSort[]): RegisterSort[] {
  const date = keys.find((k) => k.field === 'date') ?? DEFAULT_SORT;
  const amounts = keys.filter((k) => k.field === 'outflow' || k.field === 'inflow');
  if (!amounts.some((k) => k.field === 'outflow')) amounts.push({ field: 'outflow', desc: true });
  if (!amounts.some((k) => k.field === 'inflow')) amounts.push({ field: 'inflow', desc: false });
  return [{ field: 'date', desc: date.desc }, ...amounts];
}

/**
 * Running balances by row id (04 §8, 10 §7.4, §11 criterion 3), over the account's **unfiltered** rows.
 * The rows are put in the balance order and accumulated from the oldest date to the newest: with Date
 * descending that walks the order from its end, so in a date sort each row's balance is the one below
 * it plus its amount, whichever way the dates run.
 */
export function runningBalancesById(
  rows: readonly SortRow[],
  keys: readonly RegisterSort[],
): Map<Id, RunningBalance> {
  const balanceKeys = balanceSortKeys(keys);
  const cmp = comparator(balanceKeys);
  const list = [...rows].sort(cmp);
  if (balanceKeys[0]?.desc) list.reverse();
  const running = runningBalances(list);
  return new Map(list.map((r, i) => [r.id, running[i] as RunningBalance]));
}
