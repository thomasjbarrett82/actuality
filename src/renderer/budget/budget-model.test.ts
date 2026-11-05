// The Budget screen's pure logic (09 §1, §3–5; 22 §2.4): rows, cell navigation, column count, the month
// to open on, the timeline, drop targets and Move Up / Move Down.
import type { CategoryGroup, Month } from '@shared/domain/types';
import { describe, expect, it } from 'vitest';
import { GROUPS, monthView } from '../testing/fixtures';
import {
  budgetRows,
  categoryDropTarget,
  editableCategoryIds,
  groupDropTarget,
  hiddenCategoryIds,
  hiddenTotals,
  initialMonth,
  nextCategory,
  stepMove,
  timelineCells,
  visibleMonthCount,
  visibleMonths,
} from './budget-model';

const M = (s: string): Month => s as Month;
const MONTHS = [
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
].map(M);

const withHidden = (): CategoryGroup[] => {
  const groups = structuredClone(GROUPS);
  const fuel = groups[1]?.categories[1];
  if (fuel) fuel.hidden = true;
  return [
    ...groups,
    {
      id: 'g-old',
      name: 'Old',
      isIncome: false,
      hidden: true,
      sortIndex: 3,
      note: null,
      categories: [
        {
          id: 'c-gym',
          groupId: 'g-old',
          name: 'Gym',
          isIncome: false,
          hidden: false,
          sortIndex: 1,
          note: null,
        },
      ],
    },
  ];
};

describe('budgetRows (09 §4.2)', () => {
  it('lists Uncategorized, visible expense groups and categories, then Hidden', () => {
    const rows = budgetRows(withHidden(), {
      collapsed: new Set(),
      uncategorized: true,
    });
    expect(rows.map((r) => r.key)).toEqual([
      'uncategorized',
      'g:g-everyday',
      'c:c-groceries',
      'g:g-bills',
      'c:c-rent',
      'hidden',
    ]);
  });

  it('leaves out a collapsed group’s categories and the Uncategorized row without transactions', () => {
    const rows = budgetRows(GROUPS, {
      collapsed: new Set(['g-everyday']),
      uncategorized: false,
    });
    expect(rows.map((r) => r.key)).toEqual(['g:g-everyday', 'g:g-bills', 'c:c-rent', 'hidden']);
  });

  it('leaves out income groups and their categories', () => {
    const rows = budgetRows(GROUPS, { collapsed: new Set(), uncategorized: false });
    expect(rows.some((r) => r.key === 'g:g-income' || r.key === 'c:c-salary')).toBe(false);
  });

  it('marks the first category of each group', () => {
    const rows = budgetRows(GROUPS, {
      collapsed: new Set(),
      uncategorized: false,
    });
    const firsts = rows.flatMap((r) => (r.kind === 'category' && r.first ? [r.category.id] : []));
    expect(firsts).toEqual(['c-groceries', 'c-rent']);
  });

  it('totals the hidden categories and those of hidden groups', () => {
    const tree = withHidden();
    const hidden = hiddenCategoryIds(tree);
    expect([...hidden].sort()).toEqual(['c-fuel', 'c-gym']);
    const view = monthView(
      M('2026-10'),
      { 'c-fuel': { budgeted: 100, activity: -30, balance: 70 }, 'c-gym': { budgeted: 5 } },
      {},
      tree,
    );
    expect(hiddenTotals(view, hidden)).toEqual({ budgeted: 105, activity: -30, balance: 70 });
  });
});

describe('cell navigation (09 §5.4)', () => {
  const ids = editableCategoryIds(
    budgetRows(GROUPS, { collapsed: new Set(), uncategorized: true }),
  );

  it('moves to the next and previous visible category, wrapping', () => {
    expect(ids).toEqual(['c-groceries', 'c-fuel', 'c-rent']);
    expect(nextCategory(ids, 'c-groceries', 1)).toBe('c-fuel');
    expect(nextCategory(ids, 'c-rent', 1)).toBe('c-groceries');
    expect(nextCategory(ids, 'c-groceries', -1)).toBe('c-rent');
  });

  it('skips collapsed groups', () => {
    const shown = editableCategoryIds(
      budgetRows(GROUPS, {
        collapsed: new Set(['g-bills']),
        uncategorized: false,
      }),
    );
    expect(nextCategory(shown, 'c-fuel', 1)).toBe('c-groceries');
  });
});

describe('month columns (09 §1, §3)', () => {
  it('fits max(1, floor((available + gap) / (monthColW + gap))) columns', () => {
    expect(visibleMonthCount(0, 247, 6.5)).toBe(1);
    expect(visibleMonthCount(247, 247, 6.5)).toBe(1);
    expect(visibleMonthCount(247 * 2 + 6.5, 247, 6.5)).toBe(2);
    expect(visibleMonthCount(247 * 3 + 12, 247, 6.5)).toBe(2);
  });

  it('opens on the saved month, never after the current one, showing the current month', () => {
    expect(initialMonth(null, M('2026-10'), MONTHS, 3)).toBe('2026-10');
    expect(initialMonth('2026-09', M('2026-10'), MONTHS, 3)).toBe('2026-09');
    expect(initialMonth('2026-12', M('2026-10'), MONTHS, 3)).toBe('2026-10');
    // The current month is beyond the last column: move forward just enough.
    expect(initialMonth('2026-03', M('2026-10'), MONTHS, 3)).toBe('2026-08');
    expect(initialMonth('2025-01', M('2026-10'), MONTHS, 30)).toBe('2026-02');
  });

  it('draws placeholders past the range', () => {
    expect(visibleMonths(M('2026-11'), 3, MONTHS)).toEqual(['2026-11', '2026-12', null]);
  });
});

describe('timelineCells (09 §3)', () => {
  it('styles the visible months, the current month and the end cap', () => {
    const { cells, endCap } = timelineCells({
      selected: M('2026-10'),
      count: 3,
      current: M('2026-10'),
      months: MONTHS,
      firstDataMonth: M('2026-05'),
    });
    const style = Object.fromEntries(cells.map((c) => [c.month, c.style]));
    expect(style['2026-10']).toBe('currentSelected');
    expect(style['2026-11']).toBe('alsoVisible');
    expect(style['2026-12']).toBe('alsoVisible');
    expect(style['2026-09']).toBe('normal');
    expect(endCap).toBe(true);
    expect(cells.find((c) => c.month === '2026-01')).toMatchObject({
      inRange: false,
      noData: true,
    });
    expect(cells.find((c) => c.month === '2026-05')?.noData).toBe(false);
  });

  it('marks the current month outside the visible ones', () => {
    const { cells, endCap } = timelineCells({
      selected: M('2026-06'),
      count: 2,
      current: M('2026-10'),
      months: MONTHS,
      firstDataMonth: null,
    });
    expect(cells.find((c) => c.month === '2026-10')?.style).toBe('current');
    expect(endCap).toBe(false);
  });
});

describe('drop targets (09 §4.3)', () => {
  const rows = budgetRows(GROUPS, { collapsed: new Set(), uncategorized: true });
  const index = (key: string): number => rows.findIndex((r) => r.key === key);

  it('drops above or below a category by the pointer’s half', () => {
    expect(categoryDropTarget(rows, index('c:c-fuel'), false)).toMatchObject({
      groupId: 'g-everyday',
      beforeId: 'c-fuel',
    });
    expect(categoryDropTarget(rows, index('c:c-groceries'), true)).toMatchObject({
      groupId: 'g-everyday',
      beforeId: 'c-fuel',
    });
    expect(categoryDropTarget(rows, index('c:c-fuel'), true)).toMatchObject({
      groupId: 'g-everyday',
      beforeId: null,
    });
  });

  it('uses a group header’s halves: the end of the previous group, or the start of this one', () => {
    expect(categoryDropTarget(rows, index('g:g-bills'), false)).toMatchObject({
      groupId: 'g-everyday',
      beforeId: null,
    });
    expect(categoryDropTarget(rows, index('g:g-bills'), true)).toMatchObject({
      groupId: 'g-bills',
      beforeId: 'c-rent',
    });
  });

  it('refuses Uncategorized, Hidden and the first group’s upper half', () => {
    expect(categoryDropTarget(rows, index('uncategorized'), true)).toBeNull();
    expect(categoryDropTarget(rows, index('hidden'), false)).toBeNull();
    expect(categoryDropTarget(rows, index('g:g-everyday'), false)).toBeNull();
  });

  it('drops a group before or after another, never onto categories', () => {
    expect(groupDropTarget(rows, index('g:g-bills'), false)).toMatchObject({ beforeId: 'g-bills' });
    expect(groupDropTarget(rows, index('g:g-everyday'), true)).toMatchObject({
      beforeId: 'g-bills',
    });
    expect(groupDropTarget(rows, index('g:g-bills'), true)).toMatchObject({ beforeId: null });
    expect(groupDropTarget(rows, index('c:c-rent'), false)).toBeNull();
  });
});

describe('stepMove (22 §2.4)', () => {
  it('moves a category within its group only', () => {
    expect(stepMove(GROUPS, { kind: 'category', id: 'c-fuel' }, -1)).toEqual({
      groupId: 'g-everyday',
      beforeId: 'c-groceries',
    });
    expect(stepMove(GROUPS, { kind: 'category', id: 'c-groceries' }, 1)).toEqual({
      groupId: 'g-everyday',
      beforeId: null,
    });
    expect(stepMove(GROUPS, { kind: 'category', id: 'c-fuel' }, 1)).toBeNull();
    expect(stepMove(GROUPS, { kind: 'category', id: 'c-groceries' }, -1)).toBeNull();
  });

  it('moves a group past its neighbor', () => {
    expect(stepMove(GROUPS, { kind: 'group', id: 'g-bills' }, -1)).toEqual({
      groupId: 'g-bills',
      beforeId: 'g-everyday',
    });
    expect(stepMove(GROUPS, { kind: 'group', id: 'g-everyday' }, 1)).toEqual({
      groupId: 'g-everyday',
      beforeId: null,
    });
    expect(stepMove(GROUPS, { kind: 'group', id: 'g-everyday' }, -1)).toBeNull();
  });
});
