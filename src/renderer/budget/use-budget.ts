// The Budget screen's state (09): the budget's months, the selected month and how many columns
// show, the month views of the visible columns (with optimistic budget edits applied), cell and month
// notes, the rows of the category column, the saved view settings (09 §8) and the focused Budgeted cell.
// The panel creates it and its children inject it.
import { today } from '@shared/dates';
import type { BudgetMonthView, Id, Money, Month } from '@shared/domain/types';
import { useQueries, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, inject, provide, reactive, ref, toRaw, watch, type InjectionKey } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../a11y/announcer';
import { moneyLabel } from '../money-display';
import { useBudgetFormat, useCategories } from '../queries/budget-data';
import { attempt } from '../register/dialogs';
import { host } from '../rpc/host-client';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import { useSettings } from '../stores/settings';
import {
  budgetRows,
  categoryMonth,
  clampMonth,
  hiddenCategoryIds,
  initialMonth,
  visibleMonths,
} from './budget-model';

/** Category column width limits in rem (09 §1). */
export const CATEGORY_COL_MIN = 14.5;
export const CATEGORY_COL_MAX = 29;

export const monthQuery = (month: Month) => ({
  queryKey: ['budgetMonth', month] as const,
  queryFn: (): Promise<BudgetMonthView> => host.call('budget.month', { month }),
});

/** A Budgeted cell: month × category. */
export interface CellRef {
  month: Month;
  categoryId: Id;
}

/** The view with not-yet-confirmed budget edits applied (21 §5: optimistic within 100 ms). */
function withOverrides(
  view: BudgetMonthView,
  overrides: ReadonlyMap<string, Money>,
): BudgetMonthView {
  const mine = [...overrides].filter(([k]) => k.startsWith(`${view.month}:`));
  if (mine.length === 0) return view;
  // Query data is reactive: clone the raw object.
  const next = structuredClone(toRaw(view));
  for (const [key, amount] of mine) {
    const id = key.slice(8);
    for (const g of next.groups) {
      const c = g.categories.find((x) => x.id === id);
      if (!c) continue;
      const delta = amount - c.budgeted;
      c.budgeted = amount;
      g.budgeted += delta;
      c.balance += delta;
      g.balance += delta;
      next.budgeted += delta;
      next.totals.budgeted += delta;
      next.totals.balance += delta;
      next.toBudget -= delta;
    }
  }
  return next;
}

export function createBudgetScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const budgetSettings = useBudgetSettings();
  const settings = useSettings();
  const format = useBudgetFormat();
  const open = computed(() => connection.info.budget !== null && connection.hostReady);
  const canEdit = computed(() => connection.canEdit);

  const categoriesQ = useCategories();
  const monthsQ = useQuery({
    queryKey: ['budgetMonth', 'months'] as const,
    queryFn: () => host.call('budget.months', {}),
    enabled: open,
  });
  const uncategorizedQ = useQuery({
    queryKey: ['budgetMonth', 'uncategorized'] as const,
    queryFn: () => host.call('budget.uncategorized', {}),
    enabled: open,
  });
  const moveSupportQ = useQuery({
    queryKey: ['categories', 'moveSupport'] as const,
    queryFn: () => host.call('categories.moveSupport', {}),
    enabled: open,
  });

  const tree = computed(() => categoriesQ.data.value ?? []);
  const months = computed<Month[]>(() => monthsQ.data.value ?? []);

  /** "Today", refreshed by the panel when the day changes. */
  const current = ref<Month>(today(new Date()).slice(0, 7) as Month);
  /** How many month columns fit (09 §1), measured by the grid. */
  const count = ref(1);
  const measured = ref(false);
  const selected = ref<Month | null>(null);

  function setCount(n: number): void {
    count.value = n;
    measured.value = true;
  }

  // The saved month is restored once the range and the column count are known (09 §3).
  watch(
    [months, count, measured],
    ([ms]) => {
      if (ms.length === 0 || !measured.value) return;
      if (selected.value === null)
        selected.value = initialMonth(
          budgetSettings.settings.budget.lastSelectedMonth,
          current.value,
          ms,
          count.value,
        );
      else selected.value = clampMonth(selected.value, ms);
    },
    { immediate: true },
  );

  const visible = computed<(Month | null)[]>(() =>
    selected.value ? visibleMonths(selected.value, count.value, months.value) : [],
  );
  const shownMonths = computed(() => visible.value.filter((m): m is Month => m !== null));

  const viewQueries = useQueries({
    queries: computed(() =>
      shownMonths.value.map((m) => ({ ...monthQuery(m), enabled: open.value })),
    ),
  });
  const cellNoteQueries = useQueries({
    queries: computed(() =>
      shownMonths.value.map((month) => ({
        queryKey: ['notes', 'cells', month] as const,
        queryFn: () => host.call('notes.cellNotes', { month }),
        enabled: open.value,
      })),
    ),
  });
  const monthNoteQueries = useQueries({
    queries: computed(() =>
      shownMonths.value.map((month) => ({
        queryKey: ['notes', 'month', month] as const,
        queryFn: () => host.call('notes.monthNote', { month }),
        enabled: open.value,
      })),
    ),
  });

  /** Budget amounts typed but not yet confirmed by a refetch: `${month}:${categoryId}`. */
  const overrides = reactive(new Map<string, Money>());

  const views = computed(() => {
    const out = new Map<Month, BudgetMonthView>();
    viewQueries.value.forEach((q, i) => {
      const m = shownMonths.value[i];
      if (m && q.data) out.set(m, withOverrides(q.data, overrides));
    });
    return out;
  });
  const cellNotes = computed(() => {
    const out = new Map<Month, Record<Id, string>>();
    cellNoteQueries.value.forEach((q, i) => {
      const m = shownMonths.value[i];
      if (m && q.data) out.set(m, q.data);
    });
    return out;
  });
  const monthNotes = computed(() => {
    const out = new Map<Month, string | null>();
    monthNoteQueries.value.forEach((q, i) => {
      const m = shownMonths.value[i];
      if (m) out.set(m, q.data ?? null);
    });
    return out;
  });

  /** The first data has arrived: the loading illustration can go (09 §1). */
  const loaded = computed(
    () =>
      categoriesQ.data.value !== undefined &&
      monthsQ.data.value !== undefined &&
      shownMonths.value.length > 0 &&
      shownMonths.value.every((m) => views.value.has(m)),
  );

  // ----------------------------------------------------------------------------- view settings (09 §8)

  const view = computed(() => budgetSettings.settings.budget);
  const collapsed = computed(() => new Set(view.value.collapsedGroups));
  const categoryColumnWidth = computed(() =>
    Math.min(CATEGORY_COL_MAX, Math.max(CATEGORY_COL_MIN, view.value.categoryColumnWidth)),
  );
  const headerExpanded = computed(() => settings.app.budgetHeaderExpanded);

  async function patchView(p: Partial<typeof view.value>): Promise<void> {
    await budgetSettings.patch({ budget: { ...view.value, ...p } });
  }

  function select(m: Month): void {
    if (!months.value.includes(m)) return;
    selected.value = m;
    void patchView({ lastSelectedMonth: m });
  }

  /** The left arrow stops at the first month (09 §3). */
  const canStepBack = computed(() => {
    const first = months.value[0];
    return selected.value !== null && first !== undefined && selected.value > first;
  });
  /** The right arrow stops once the last visible column is the range's last month (09 §3). */
  const canStepForward = computed(() => {
    const last = months.value.at(-1);
    return (
      last !== undefined &&
      visible.value.length > 0 &&
      !visible.value.includes(last) &&
      !visible.value.includes(null)
    );
  });

  /** The arrows, and ←/→ (09 §3, §7). */
  function step(n: 1 | -1): void {
    const s = selected.value;
    if (!s || !(n === 1 ? canStepForward.value : canStepBack.value)) return;
    const next = months.value[months.value.indexOf(s) + n];
    if (next) select(next);
  }

  /** Home/End on the timeline (22 §2.3): the first month, or the last that still fills the columns. */
  function jumpTo(edge: 'first' | 'last'): void {
    const ms = months.value;
    const target = edge === 'first' ? ms[0] : ms[Math.max(0, ms.length - count.value)];
    if (target) select(target);
  }

  function toggleGroup(id: Id, open?: boolean): void {
    const set = new Set(collapsed.value);
    const close = open === undefined ? !set.has(id) : !open;
    if (close) set.add(id);
    else set.delete(id);
    void patchView({ collapsedGroups: [...set] });
  }

  function setAllCollapsed(close: boolean): void {
    void patchView({ collapsedGroups: close ? tree.value.map((g) => g.id) : [] });
  }

  function setColumnWidth(rem: number): void {
    void patchView({
      categoryColumnWidth:
        Math.round(Math.min(CATEGORY_COL_MAX, Math.max(CATEGORY_COL_MIN, rem)) * 100) / 100,
    });
  }

  function toggleHeader(): void {
    void settings.set('budgetHeaderExpanded', !headerExpanded.value);
  }

  // ----------------------------------------------------------------------------- rows

  const rows = computed(() =>
    budgetRows(tree.value, {
      collapsed: collapsed.value,
      uncategorized: uncategorizedQ.data.value?.exists === true,
    }),
  );
  const hiddenIds = computed(() => hiddenCategoryIds(tree.value));

  // ----------------------------------------------------------------------------- Budgeted cells

  /** The focused Budgeted cell (its row is highlighted, 09 §5.4), and whether it's being edited. */
  const focus = ref<CellRef | null>(null);
  const editing = ref<CellRef | null>(null);

  const budgetedOf = (cell: CellRef): Money => {
    const v = views.value.get(cell.month);
    return v ? (categoryMonth(v, cell.categoryId)?.budgeted ?? 0) : 0;
  };

  /**
   * Commits a Budgeted amount (09 §5.4): unchanged → no write. Shown at once, rolled back on error, and
   * announced (22 §4.5) once the new numbers arrive.
   */
  async function commitAmount(cell: CellRef, amount: Money): Promise<boolean> {
    if (amount === budgetedOf(cell)) return true;
    const key = `${cell.month}:${cell.categoryId}`;
    overrides.set(key, amount);
    const result = await attempt(() =>
      host.call('budget.setAmount', { month: cell.month, categoryId: cell.categoryId, amount }),
    );
    if (result.ok) await queryClient.invalidateQueries({ queryKey: ['budgetMonth'] });
    overrides.delete(key);
    if (!result.ok) return false;
    const v = views.value.get(cell.month);
    const c = v ? categoryMonth(v, cell.categoryId) : null;
    const name = tree.value
      .flatMap((g) => g.categories)
      .find((x) => x.id === cell.categoryId)?.name;
    if (v && c && name)
      announce(
        t('a11y.budgetCommitted', {
          category: name,
          budgeted: moneyLabel(c.budgeted, format.value.money, { symbol: true }),
          balance: moneyLabel(c.balance, format.value.money, { symbol: true }),
          available: moneyLabel(v.toBudget, format.value.money, { symbol: true }),
        }),
      );
    return true;
  }

  /** Several amounts at once (Quick Budget fills, 09 §5.5). */
  async function commitAmounts(
    month: Month,
    entries: { categoryId: Id; amount: Money }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const result = await attempt(() => host.call('budget.setAmounts', { month, entries }));
    if (result.ok) await queryClient.invalidateQueries({ queryKey: ['budgetMonth'] });
  }

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['budgetMonth'] });
  }

  return reactive({
    t,
    format,
    canEdit,
    tree,
    months,
    current,
    count,
    selected,
    visible,
    shownMonths,
    views,
    cellNotes,
    monthNotes,
    loaded,
    collapsed,
    categoryColumnWidth,
    headerExpanded,
    showEmptyOutflowTooltip: computed(() => view.value.showEmptyOutflowTooltip),
    moveSupport: computed(() => moveSupportQ.data.value ?? { category: true, group: true }),
    rows,
    hiddenIds,
    focus,
    editing,
    canStepBack,
    canStepForward,
    setCount,
    select,
    step,
    jumpTo,
    toggleGroup,
    setAllCollapsed,
    setColumnWidth,
    toggleHeader,
    patchView,
    budgetedOf,
    commitAmount,
    commitAmounts,
    refresh,
  });
}

export type BudgetScreen = ReturnType<typeof createBudgetScreen>;

const KEY: InjectionKey<BudgetScreen> = Symbol('budget');

export function provideBudget(b: BudgetScreen): void {
  provide(KEY, b);
}

export function useBudget(): BudgetScreen {
  const b = inject(KEY);
  if (!b) throw new Error('useBudget() outside the Budget screen');
  return b;
}
