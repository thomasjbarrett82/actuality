// The scheduler pane's grid (12 §3): its columns, which of them can be hidden or resized, default widths
// and sort. Rows sort with the register's comparator (10 §2), Date first by default.
import { DEFAULT_WIDTHS, type ColumnSetting } from './register';

export const SCHEDULER_COLUMNS = [
  'select',
  'account',
  'date',
  'frequency',
  'payee',
  'category',
  'notes',
  'outflow',
  'inflow',
] as const;
export type SchedulerColumn = (typeof SCHEDULER_COLUMNS)[number];

/** Notes can be hidden (12 §3). */
export const SCHEDULER_TOGGLEABLE = ['notes'] as const;
export type SchedulerToggleable = (typeof SCHEDULER_TOGGLEABLE)[number];

export const SCHEDULER_RESIZABLE: ReadonlySet<SchedulerColumn> = new Set([
  'account',
  'payee',
  'category',
  'notes',
]);

export const SCHEDULER_WIDTHS: Readonly<Record<SchedulerColumn, number>> = {
  select: DEFAULT_WIDTHS.select,
  account: DEFAULT_WIDTHS.account,
  date: DEFAULT_WIDTHS.date,
  frequency: 8.5,
  payee: DEFAULT_WIDTHS.payee,
  category: DEFAULT_WIDTHS.category,
  notes: DEFAULT_WIDTHS.notes,
  outflow: DEFAULT_WIDTHS.outflow,
  inflow: DEFAULT_WIDTHS.inflow,
};

export const SCHEDULER_SORTABLE: ReadonlySet<SchedulerColumn> = new Set(
  SCHEDULER_COLUMNS.filter((c) => c !== 'select'),
);

/** A saved setting (19 §2 `scheduleColumns`), completed with defaults: everything visible. */
export function schedulerColumnsOf(saved: readonly ColumnSetting[] | undefined): ColumnSetting[] {
  return [...SCHEDULER_TOGGLEABLE, 'account', 'payee', 'category'].map((field) => {
    const found = saved?.find((c) => c.field === field);
    return found ?? { field, visible: true, width: SCHEDULER_WIDTHS[field as SchedulerColumn] };
  });
}

export interface SchedulerSort {
  field: SchedulerColumn;
  desc: boolean;
}

/** Sorted by date by default (12 §3). */
export function schedulerSortOf(
  saved: { field: string; desc: boolean } | undefined,
): SchedulerSort {
  if (!saved || !(SCHEDULER_COLUMNS as readonly string[]).includes(saved.field))
    return { field: 'date', desc: false };
  return { field: saved.field as SchedulerColumn, desc: saved.desc };
}
