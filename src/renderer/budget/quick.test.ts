// The per-cell Quick Budget list (09 §5.4): its items and amounts, and which averages show for the months
// of history there are (09 §5.5).
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import type { CategoryQuickStats, QuickBudgetStats } from '@shared/quickbudget/quickbudget';
import { describe, expect, it } from 'vitest';
import { cellQuickItems } from './quick';

const tr = (key: string, params?: Record<string, unknown>): string =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const STATS: CategoryQuickStats = {
  lastBudgeted: 100,
  lastOutflows: 200,
  average3: 300,
  averageYear: 400,
  scheduled: 500,
  balanceTo0: 600,
  budgeted: 700,
};
const stats = (h12: number): QuickBudgetStats => ({
  month: '2026-10',
  h12,
  categories: { c1: STATS },
});

describe('cellQuickItems (09 §5.4)', () => {
  it('lists every stat, then Show calculator, with a full year of history', () => {
    const items = cellQuickItems(stats(12), 'c1', DEFAULT_MONEY_SETTINGS, tr);
    expect(items.map((i) => [i.id, i.amount])).toEqual([
      ['lastBudgeted', 100],
      ['lastOutflows', 200],
      ['average3', 300],
      ['averageYear', 400],
      ['scheduled', 500],
      ['balanceTo0', 600],
      ['calculator', null],
    ]);
    expect(items.find((i) => i.id === 'average3')?.label).toBe('app.budQbAverage {"n":3}');
    expect(items.find((i) => i.id === 'averageYear')?.label).toBe('app.budQbAverageYear');
    expect(items.find((i) => i.id === 'balanceTo0')?.label).toBe(
      'app.budQbBalanceTo {"zero":"0.00"}',
    );
  });

  it('labels a year average over fewer months as partial', () => {
    const items = cellQuickItems(stats(5), 'c1', DEFAULT_MONEY_SETTINGS, tr);
    expect(items.find((i) => i.id === 'averageYear')?.label).toBe(
      'app.budQbAverageYearPartial {"n":5}',
    );
  });

  it('leaves out the averages there is too little history for', () => {
    const ids = (h12: number) =>
      cellQuickItems(stats(h12), 'c1', DEFAULT_MONEY_SETTINGS, tr).map((i) => i.id);
    expect(ids(1)).not.toContain('average3');
    expect(ids(1)).not.toContain('averageYear');
    expect(ids(2)).toContain('average3');
    expect(ids(3)).not.toContain('averageYear');
  });

  it('offers only the calculator for a category without stats', () => {
    expect(cellQuickItems(stats(12), 'c-new', DEFAULT_MONEY_SETTINGS, tr)).toEqual([
      { id: 'calculator', label: 'app.budQbShowCalculator', amount: null },
    ]);
  });
});
