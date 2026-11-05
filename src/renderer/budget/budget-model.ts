// The Budget screen's pure logic (09 §1, §3–5): the rows of the category column, Budgeted-cell navigation,
// how many month columns fit, the timeline's cell states, the month to open on, and drop targets.
import { addMonths, monthsBetween } from '@shared/dates';
import type {
  BudgetCategoryMonth,
  BudgetMonthView,
  Category,
  CategoryGroup,
  Id,
  Money,
  Month,
} from '@shared/domain/types';

export type BudgetRow =
  | { kind: 'uncategorized'; key: string }
  | { kind: 'group'; key: string; group: CategoryGroup; collapsed: boolean }
  | {
      kind: 'category';
      key: string;
      category: Category;
      group: CategoryGroup;
      /** The first category row of its group: its Budgeted box has a top border (09 §5.4). */
      first: boolean;
    }
  | { kind: 'hidden'; key: string };

/**
 * The category column's rows (09 §4.2): Uncategorized (while such transactions exist), each visible
 * expense group with its visible categories, then Hidden Categories.
 */
export function budgetRows(
  tree: readonly CategoryGroup[],
  opts: { collapsed: ReadonlySet<Id>; uncategorized: boolean },
): BudgetRow[] {
  const rows: BudgetRow[] = [];
  if (opts.uncategorized) rows.push({ kind: 'uncategorized', key: 'uncategorized' });
  for (const group of tree) {
    if (group.isIncome || group.hidden) continue;
    const collapsed = opts.collapsed.has(group.id);
    rows.push({ kind: 'group', key: `g:${group.id}`, group, collapsed });
    if (collapsed) continue;
    group.categories
      .filter((c) => !c.hidden)
      .forEach((category, i) => {
        rows.push({ kind: 'category', key: `c:${category.id}`, category, group, first: i === 0 });
      });
  }
  rows.push({ kind: 'hidden', key: 'hidden' });
  return rows;
}

/** Hidden categories and the categories of hidden groups (09 §4.2, X10), expense ones only. */
export function hiddenCategoryIds(tree: readonly CategoryGroup[]): Set<Id> {
  const ids = new Set<Id>();
  for (const g of tree) {
    if (g.isIncome) continue;
    for (const c of g.categories) if (g.hidden || c.hidden) ids.add(c.id);
  }
  return ids;
}

/** The Hidden Categories row's month totals (09 §4.2). */
export function hiddenTotals(
  view: BudgetMonthView,
  hidden: ReadonlySet<Id>,
): { budgeted: Money; activity: Money; balance: Money } {
  const out = { budgeted: 0, activity: 0, balance: 0 };
  for (const g of view.groups)
    for (const c of g.categories)
      if (hidden.has(c.id)) {
        out.budgeted += c.budgeted;
        out.activity += c.activity;
        out.balance += c.balance;
      }
  return out;
}

/** A category's numbers in a month view, from either section. */
export function categoryMonth(view: BudgetMonthView, id: Id): BudgetCategoryMonth | null {
  for (const g of view.groups) for (const c of g.categories) if (c.id === id) return c;
  for (const g of view.incomeGroups) for (const c of g.categories) if (c.id === id) return c;
  return null;
}

/** The Budgeted cells in row order: every visible category row (collapsed groups' are absent). */
export const editableCategoryIds = (rows: readonly BudgetRow[]): Id[] =>
  rows.flatMap((r) => (r.kind === 'category' ? [r.category.id] : []));

/** The next (or previous) Budgeted cell, wrapping (09 §5.4). */
export function nextCategory(ids: readonly Id[], current: Id, step: 1 | -1): Id | null {
  if (ids.length === 0) return null;
  const i = ids.indexOf(current);
  if (i === -1) return ids[0] ?? null;
  return ids[(i + step + ids.length) % ids.length] ?? null;
}

/** How many month columns fit (09 §1): `max(1, floor((available + gap) / (monthColW + gap)))`. */
export function visibleMonthCount(available: number, monthColW: number, gap: number): number {
  if (monthColW <= 0) return 1;
  return Math.max(1, Math.floor((available + gap) / (monthColW + gap)));
}

/** The month to open on (09 §3): the saved one, not after the current month, showing the current one. */
export function initialMonth(
  saved: string | null,
  current: Month,
  months: readonly Month[],
  count: number,
): Month {
  let m = (saved && /^\d{4}-\d{2}$/.test(saved) ? saved : current) as Month;
  if (m > current) m = current;
  if (monthsBetween(m, current) >= count) m = addMonths(current, -(count - 1));
  return clampMonth(m, months);
}

/** Into the budget's range. */
export function clampMonth(m: Month, months: readonly Month[]): Month {
  const first = months[0];
  const last = months.at(-1);
  if (first && m < first) return first;
  if (last && m > last) return last;
  return m;
}

/** The visible columns from `selected`: a month, or null for a placeholder past the range (09 §3). */
export function visibleMonths(
  selected: Month,
  count: number,
  months: readonly Month[],
): (Month | null)[] {
  const last = months.at(-1);
  return Array.from({ length: count }, (_, i) => {
    const m = addMonths(selected, i);
    return last && m > last ? null : m;
  });
}

export type TimelineLabel = 'narrow' | 'short' | 'long';

/** Month labels by the strip's width in rem (09 §3): "J", "Jan", "January". */
export const timelineLabel = (widthRem: number): TimelineLabel =>
  widthRem < 25 ? 'narrow' : widthRem < 65 ? 'short' : 'long';

export type TimelineStyle = 'normal' | 'current' | 'alsoVisible' | 'currentSelected';

export interface TimelineCell {
  month: Month;
  style: TimelineStyle;
  inRange: boolean;
  /** Before the first month with data: muted text. */
  noData: boolean;
}

/** The 12 cells of the selected year (09 §3), and whether December gets the end cap. */
export function timelineCells(opts: {
  selected: Month;
  count: number;
  current: Month;
  months: readonly Month[];
  firstDataMonth: Month | null;
}): { cells: TimelineCell[]; endCap: boolean } {
  const year = opts.selected.slice(0, 4);
  const lastVisible = addMonths(opts.selected, opts.count - 1);
  const first = opts.months[0];
  const last = opts.months.at(-1);
  const cells = Array.from({ length: 12 }, (_, i): TimelineCell => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}` as Month;
    const visible = month >= opts.selected && month <= lastVisible;
    const isCurrent = month === opts.current;
    const style: TimelineStyle = visible
      ? isCurrent
        ? 'currentSelected'
        : 'alsoVisible'
      : isCurrent
        ? 'current'
        : 'normal';
    return {
      month,
      style,
      inRange: first !== undefined && last !== undefined && month >= first && month <= last,
      noData: opts.firstDataMonth !== null && month < opts.firstDataMonth,
    };
  });
  return { cells, endCap: lastVisible >= `${year}-12` };
}

/**
 * Where a category drop lands (09 §4.3). Over a category row: above or below it by the pointer's half.
 * Over a group header: its upper half is the end of the previous group, its lower half the start of that
 * group. Returns the target group and the category to insert before (null = last), or null.
 */
export function categoryDropTarget(
  rows: readonly BudgetRow[],
  overIndex: number,
  lowerHalf: boolean,
): { groupId: Id; beforeId: Id | null; indicator: { row: number; below: boolean } } | null {
  const row = rows[overIndex];
  if (!row) return null;
  if (row.kind === 'category') {
    if (!lowerHalf)
      return {
        groupId: row.group.id,
        beforeId: row.category.id,
        indicator: { row: overIndex, below: false },
      };
    const next = rows[overIndex + 1];
    const beforeId =
      next?.kind === 'category' && next.group.id === row.group.id ? next.category.id : null;
    return { groupId: row.group.id, beforeId, indicator: { row: overIndex, below: true } };
  }
  if (row.kind !== 'group') return null;
  if (lowerHalf) {
    const next = rows[overIndex + 1];
    const beforeId =
      next?.kind === 'category' && next.group.id === row.group.id ? next.category.id : null;
    return { groupId: row.group.id, beforeId, indicator: { row: overIndex, below: true } };
  }
  // The end of the previous group.
  for (let i = overIndex - 1; i >= 0; i--) {
    const r = rows[i];
    if (r?.kind === 'group') {
      return { groupId: r.group.id, beforeId: null, indicator: { row: overIndex, below: false } };
    }
  }
  return null;
}

/** Where a group drop lands (09 §4.3): before the group under the pointer, or after it by its half. */
export function groupDropTarget(
  rows: readonly BudgetRow[],
  overIndex: number,
  lowerHalf: boolean,
): { beforeId: Id | null; indicator: { row: number; below: boolean } } | null {
  const row = rows[overIndex];
  if (row?.kind !== 'group') return null;
  if (!lowerHalf) return { beforeId: row.group.id, indicator: { row: overIndex, below: false } };
  const next = rows
    .slice(overIndex + 1)
    .find((r): r is Extract<BudgetRow, { kind: 'group' }> => r.kind === 'group');
  return {
    beforeId: next ? next.group.id : null,
    indicator: { row: overIndex, below: true },
  };
}

/**
 * Move Up / Move Down (22 §2.4): a category moves within its group only; a group past its neighbor.
 * Returns the move, or null at the edge.
 */
export function stepMove(
  tree: readonly CategoryGroup[],
  target: { kind: 'category'; id: Id } | { kind: 'group'; id: Id },
  step: 1 | -1,
): { groupId: Id; beforeId: Id | null } | null {
  if (target.kind === 'group') {
    const same = tree.filter(
      (g) => !g.hidden && g.isIncome === tree.find((x) => x.id === target.id)?.isIncome,
    );
    const i = same.findIndex((g) => g.id === target.id);
    if (i === -1) return null;
    if (step === -1) {
      const prev = same[i - 1];
      return prev ? { groupId: target.id, beforeId: prev.id } : null;
    }
    if (i + 1 >= same.length) return null;
    const after = same[i + 2];
    // Before the group after the next one, or last overall when the next one is the last.
    return { groupId: target.id, beforeId: after?.id ?? nextGroupAfter(tree, same[i + 1]?.id) };
  }
  const group = tree.find((g) => g.categories.some((c) => c.id === target.id));
  if (!group) return null;
  const visible = group.categories.filter((c) => !c.hidden || c.id === target.id);
  const i = visible.findIndex((c) => c.id === target.id);
  if (step === -1) {
    const prev = visible[i - 1];
    return prev ? { groupId: group.id, beforeId: prev.id } : null;
  }
  if (i + 1 >= visible.length) return null;
  return { groupId: group.id, beforeId: visible[i + 2]?.id ?? null };
}

/** The group after `id` in the whole tree (hidden or income ones included), or null. */
function nextGroupAfter(tree: readonly CategoryGroup[], id: Id | undefined): Id | null {
  const i = tree.findIndex((g) => g.id === id);
  return i === -1 ? null : (tree[i + 1]?.id ?? null);
}
