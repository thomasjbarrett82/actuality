// The per-cell Quick Budget list's items (09 §5.4): labelled values from `budget.quickBudgetStats`, then
// "Show calculator". The averages follow the same history rules as the month menu (09 §5.5).
import type { Id, Money } from '@shared/domain/types';
import { format, type MoneySettings } from '@shared/money';
import {
  averageItems,
  type CategoryQuickStats,
  type QuickBudgetStats,
} from '@shared/quickbudget/quickbudget';

export interface QuickItem {
  id: string;
  label: string;
  /** The amount; null for "Show calculator". */
  amount: Money | null;
}

/** Which stat an item sets. */
export type QuickItemId = keyof Omit<CategoryQuickStats, 'budgeted'> | 'calculator';

export function cellQuickItems(
  stats: QuickBudgetStats,
  categoryId: Id,
  money: MoneySettings,
  tr: (key: string, params?: Record<string, unknown>) => string,
): QuickItem[] {
  const s = stats.categories[categoryId];
  if (!s) return [{ id: 'calculator', label: tr('app.budQbShowCalculator'), amount: null }];
  const items = averageItems(stats.h12);
  const item = (id: QuickItemId, label: string, value: Money): QuickItem => ({
    id,
    label,
    amount: value,
  });
  return [
    item('lastBudgeted', tr('app.budQbLastBudgeted'), s.lastBudgeted),
    item('lastOutflows', tr('app.budQbLastOutflows'), s.lastOutflows),
    ...(items.average3
      ? [item('average3', tr('app.budQbAverage', { n: items.average3 }), s.average3)]
      : []),
    ...(items.year
      ? [
          item(
            'averageYear',
            items.year.partial
              ? tr('app.budQbAverageYearPartial', { n: items.year.months })
              : tr('app.budQbAverageYear'),
            s.averageYear,
          ),
        ]
      : []),
    item('scheduled', tr('app.budQbScheduled'), s.scheduled),
    item('balanceTo0', tr('app.budQbBalanceTo', { zero: format(0, money) }), s.balanceTo0),
    { id: 'calculator', label: tr('app.budQbShowCalculator'), amount: null },
  ];
}
