// The Budget screen's flows (09 §4.1, §4.3, §5.5, §6): the popovers and what follows them, creating,
// renaming, hiding and deleting categories and groups, notes, overspending, hold, the month Quick Budget
// menu and its confirmations, the transactions popover and Show in Account View, and category moves.
import { addMonths, prevMonth } from '@shared/dates';
import { categoryLabel } from '@shared/domain/categories';
import type { BudgetMonthView, Category, CategoryGroup, Id, Month } from '@shared/domain/types';
import { format as formatMoney } from '@shared/money';
import { averageItems, fillEntries, type QuickFill } from '@shared/quickbudget/quickbudget';
import type { CalloutTransaction } from '@shared/rpc/host-api';
import type { ContextMenuItem } from '@shared/shell-api';
import { format as formatDate } from 'date-fns';
import { nextTick } from 'vue';
import CategoryEditCallout from '../components/budget/CategoryEditCallout.vue';
import EmptyOutflowCallout from '../components/budget/EmptyOutflowCallout.vue';
import HiddenCategoriesCallout from '../components/budget/HiddenCategoriesCallout.vue';
import HoldCallout from '../components/budget/HoldCallout.vue';
import MoveToGroupDialog from '../components/budget/MoveToGroupDialog.vue';
import NoteCallout from '../components/budget/NoteCallout.vue';
import OverspendingCallout from '../components/budget/OverspendingCallout.vue';
import TransactionsCallout from '../components/budget/TransactionsCallout.vue';
import { escapeRichText } from '../components/common/rich-text';
import { dateLocale } from '../i18n';
import { moneyText } from '../money-display';
import { attempt, tell, tr } from '../register/dialogs';
import { useJump } from '../register/jump';
import { programmatic, uiSearchWords } from '../register/search';
import { useRegisterSession, writeDateFilter } from '../register/view-state';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { queryClient } from '../rpc/query-client';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useCallouts } from '../stores/callouts';
import { useDialogs } from '../stores/dialogs';
import { useModals } from '../stores/modals';
import { categoryMonth } from './budget-model';
import type { BudgetScreen } from './use-budget';

// ------------------------------------------------------------------------------ month names

const monthDate = (m: Month): Date => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
/** "Jan" (the header's "Not Budgeted in Dec"). */
export const shortMonth = (m: Month): string =>
  formatDate(monthDate(m), 'LLL', { locale: dateLocale.value });
/** "January". */
export const longMonth = (m: Month): string =>
  formatDate(monthDate(m), 'LLLL', { locale: dateLocale.value });
/** "January 2026". */
export const monthYear = (m: Month): string =>
  formatDate(monthDate(m), 'LLLL yyyy', { locale: dateLocale.value });
/** "Jan '26" (the Quick Budget confirmations' `{Mon 'YY}`). */
export const monthShortYear = (m: Month): string =>
  formatDate(monthDate(m), "LLL ''yy", { locale: dateLocale.value });

/** The UI language's reserved group names (09 §6.2). */
const reservedNames = (): string[] => [
  tr('budget.hiddenCategoriesGroup'),
  tr('budget.uncategorizedTransactionsCategory'),
  tr('budget.categoryAddNewLabel'),
];

/** Waits for an element to render (after a refetch), for a callout's anchor. */
async function element(selector: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 40; i++) {
    await nextTick();
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

export const nameSelector = (kind: 'g' | 'c', id: Id): string =>
  `[data-budget-name="${kind}:${CSS.escape(id)}"]`;

/** A write with the usual failure dialogs ("You're offline", "Something went wrong"). */
async function write(fn: () => Promise<unknown>): Promise<boolean> {
  return (await attempt(fn)).ok;
}

/** Shows a failure with the same dialogs as `write`. */
async function report(e: unknown): Promise<void> {
  await attempt(() => Promise.reject(e instanceof Error ? e : new Error(String(e))));
}

// ------------------------------------------------------------------------------ categories (09 §6.1–6.2)

/** The Edit / Add category popover. A new category is deleted again on Cancel (09 §6.1). */
export async function editCategory(
  b: BudgetScreen,
  category: Category,
  anchor: HTMLElement,
  isNew = false,
): Promise<void> {
  const group = b.tree.find((g) => g.id === category.groupId);
  const title = tr(isNew ? 'app.budAddCategoryTitle' : 'app.budEditCategoryTitle');
  const result = await useCallouts().show(
    CategoryEditCallout,
    {
      kind: 'category',
      title,
      name: category.name,
      others: (group?.categories ?? []).filter((c) => c.id !== category.id).map((c) => c.name),
      isNew,
      save: (name: string) =>
        write(() => host.call('categories.update', { id: category.id, name })),
    },
    { anchor, title, placements: ['topLeft', 'bottomLeft', 'top', 'bottom'] },
  );
  if (result === 'cancel' && isNew)
    await write(() => host.call('categories.delete', { id: category.id }));
  else if (result === 'hide')
    await write(() => host.call('categories.update', { id: category.id, hidden: true }));
  else if (result === 'delete') await deleteCategory(b, category);
}

/** The Edit / Add master category popover (09 §6.2). */
export async function editGroup(
  b: BudgetScreen,
  group: CategoryGroup,
  anchor: HTMLElement,
  isNew = false,
): Promise<void> {
  const title = tr(isNew ? 'app.budAddGroupTitle' : 'app.budEditGroupTitle');
  const reserved = reservedNames();
  const result = await useCallouts().show(
    CategoryEditCallout,
    {
      kind: 'group',
      title,
      name: group.name,
      others: b.tree.filter((g) => g.id !== group.id).map((g) => g.name),
      reserved,
      isNew,
      save: (name: string) =>
        write(() => host.call('categories.updateGroup', { id: group.id, name, reserved })),
    },
    { anchor, title, placements: ['topLeft', 'bottomLeft', 'top', 'bottom'] },
  );
  if (result === 'cancel' && isNew)
    await write(() => host.call('categories.deleteGroup', { id: group.id }));
  else if (result === 'hide')
    await write(() => host.call('categories.updateGroup', { id: group.id, hidden: true }));
  else if (result === 'delete') await deleteGroup(b, group);
}

const DELETE_KEYS = {
  category: {
    budgeted: 'app.budDeleteCategoryBudgeted',
    transactions: 'app.budDeleteCategoryTransactions',
    confirm: 'app.budDeleteCategoryConfirm',
    button: 'app.budDeleteCategoryButton',
  },
  group: {
    budgeted: 'app.budDeleteGroupBudgeted',
    transactions: 'app.budDeleteGroupTransactions',
    confirm: 'app.budDeleteGroupConfirm',
    button: 'app.budDeleteGroupButton',
  },
} as const;

/** The delete confirmation (09 §6.1–6.2), with what would be lost. True once deleted. */
async function confirmDelete(
  b: BudgetScreen,
  kind: 'category' | 'group',
  id: Id,
  name: string,
): Promise<boolean> {
  let impact;
  try {
    impact = await host.call('categories.deleteImpact', { id });
  } catch (e) {
    await report(e);
    return false;
  }
  const money = b.format.money;
  const keys = DELETE_KEYS[kind];
  const parts: string[] = [];
  if (impact.budgetedMonths > 0) parts.push(tr(keys.budgeted, { n: impact.budgetedMonths }));
  if (impact.transactionCount > 0)
    parts.push(
      tr(keys.transactions, {
        n: impact.transactionCount,
        amount: escapeRichText(moneyText(impact.transactionTotal, money, { symbol: true })),
      }),
    );
  parts.push(tr(keys.confirm));
  const { button } = await useDialogs().showTaskDialog({
    instruction: tr(kind === 'group' ? 'app.budDeleteGroupTitle' : 'app.budDeleteCategoryTitle', {
      name,
    }),
    content: parts.join('<br/><br/>'),
    icon: 'logo',
    buttons: [{ id: 'delete', label: tr(keys.button) }, 'cancel'],
  });
  return button === 'delete';
}

async function deleteCategory(b: BudgetScreen, category: Category): Promise<void> {
  if (!(await confirmDelete(b, 'category', category.id, category.name))) return;
  await write(() => host.call('categories.delete', { id: category.id }));
}

async function deleteGroup(b: BudgetScreen, group: CategoryGroup): Promise<void> {
  if (!(await confirmDelete(b, 'group', group.id, group.name))) return;
  await write(() => host.call('categories.deleteGroup', { id: group.id }));
}

/** The Categories header's [+] (09 §4.1): a new group at the top, then its Add popover. */
export async function addGroup(b: BudgetScreen, scrollTop: () => void): Promise<void> {
  const base = tr('budget.newCategoryGroupName', { number: '' }).trim();
  const created = await attempt(() => host.call('categories.createGroup', { name: base }));
  if (!created.ok) return;
  await queryClient.invalidateQueries({ queryKey: ['categories'] });
  scrollTop();
  const anchor = await element(nameSelector('g', created.value.id));
  const group = b.tree.find((g) => g.id === created.value.id);
  if (anchor && group) await editGroup(b, group, anchor, true);
}

/** A group's [+] (09 §4.3): expand it, add "New Category" at its end, then its Add popover. */
export async function addCategory(b: BudgetScreen, groupId: Id): Promise<void> {
  if (b.collapsed.has(groupId)) b.toggleGroup(groupId, true);
  const base = tr('budget.newCategoryName', { number: '' }).trim();
  const created = await attempt(() =>
    host.call('categories.create', { groupId, name: base, unique: true }),
  );
  if (!created.ok) return;
  await queryClient.invalidateQueries({ queryKey: ['categories'] });
  const anchor = await element(nameSelector('c', created.value.id));
  anchor?.scrollIntoView({ block: 'nearest' });
  const category = b.tree.flatMap((g) => g.categories).find((c) => c.id === created.value.id);
  if (anchor && category) await editCategory(b, category, anchor, true);
}

// ------------------------------------------------------------------------------ notes (09 §6.3)

/** The note popover. An outside click saves too; the text is trimmed and "" clears it. */
export async function editNote(
  anchor: HTMLElement,
  title: string,
  initial: string | null,
  save: (text: string) => Promise<unknown>,
  canEdit: boolean,
): Promise<void> {
  let text = initial ?? '';
  const result = await useCallouts().show(
    NoteCallout,
    {
      initial: text,
      label: title,
      update: (v: string) => {
        text = v;
      },
    },
    { anchor, title, placements: ['topRight', 'bottomRight', 'topLeft', 'bottomLeft'] },
  );
  if (!canEdit) return;
  let next: string | null = null;
  if (result === 'delete') next = '';
  else if (result === 'done' || result === 'clickOutside') next = text.trim();
  if (next === null || next === (initial ?? '').trim()) return;
  const value = next;
  await write(() => save(value));
}

/** A category's or group's note (Actual's note on its id, 04 §3). */
export const saveEntityNote = (id: Id) => (text: string) => host.call('notes.set', { id, text });

// ------------------------------------------------------------------------------ overspending (09 §6.4)

export async function overspending(
  b: BudgetScreen,
  anchor: HTMLElement,
  month: Month,
  categoryId: Id,
): Promise<void> {
  const view = b.views.get(month);
  const current = view ? (categoryMonth(view, categoryId)?.carryover ?? false) : false;
  const result = await useCallouts().show(
    OverspendingCallout,
    { carryover: current },
    { anchor, title: tr('app.budOverspendingTitle') },
  );
  if (result !== 'on' && result !== 'off') return;
  const flag = result === 'on';
  if (flag === current) return;
  await write(() => host.call('budget.setCarryover', { month, categoryId, flag }));
}

// ------------------------------------------------------------------------------ hidden (09 §6.5)

export async function showHidden(b: BudgetScreen, anchor: HTMLElement): Promise<void> {
  const groups = b.tree.filter((g) => !g.isIncome);
  const result = await useCallouts().show(
    HiddenCategoriesCallout,
    { groups },
    { anchor, title: tr('app.budShowHiddenTitle') },
  );
  if (!result.startsWith('{')) return;
  const ids = JSON.parse(result) as { categoryIds: Id[]; groupIds: Id[] };
  await write(() => host.call('categories.setHidden', { ...ids, hidden: false }));
}

// ------------------------------------------------------------------------------ transactions (09 §6.6)

export type OutflowTarget =
  | { kind: 'category'; category: Category; group: CategoryGroup }
  | { kind: 'group'; group: CategoryGroup }
  | { kind: 'uncategorized' }
  | { kind: 'all' };

/** The transactions popover for an Outflows value, or the empty-outflow help (09 §6.6). */
export async function showOutflows(
  b: BudgetScreen,
  anchor: HTMLElement,
  target: OutflowTarget,
  month: Month,
): Promise<void> {
  const id =
    target.kind === 'category'
      ? target.category.id
      : target.kind === 'group'
        ? target.group.id
        : target.kind;
  const rows = await host.call('transactions.forCategoryMonth', { target: id, month });
  const name =
    target.kind === 'category'
      ? target.category.name
      : target.kind === 'group'
        ? target.group.name
        : target.kind === 'uncategorized'
          ? tr('budget.uncategorizedTransactionsCategory')
          : '';
  if (rows.length === 0 && (target.kind === 'category' || target.kind === 'group')) {
    if (!b.showEmptyOutflowTooltip) return;
    const result = await useCallouts().show(
      EmptyOutflowCallout,
      {
        text: tr('app.budEmptyOutflowText', {
          category: escapeRichText(name),
          month: escapeRichText(longMonth(month)),
        }),
      },
      { anchor, title: tr('app.budEmptyOutflowTitle') },
    );
    if (result === 'dontShow') await b.patchView({ showEmptyOutflowTooltip: false });
    return;
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const spent = escapeRichText(moneyText(total ? -total : 0, b.format.money, { symbol: true }));
  const summary =
    target.kind === 'uncategorized'
      ? tr('budget.spentWithoutCategory', { amount: spent, count: rows.length })
      : rows.length === 1
        ? tr('budget.spentInOneTransaction', { amount: spent, count: rows.length })
        : tr('budget.spentAcrossTransactions', { amount: spent, count: rows.length });
  const search =
    target.kind === 'category'
      ? programmatic.category(
          uiSearchWords(dateLocale.value),
          categoryLabel(target.group, target.category),
        )
      : target.kind === 'group'
        ? programmatic.category(uiSearchWords(dateLocale.value), `${target.group.name}:`)
        : target.kind === 'uncategorized'
          ? programmatic.category(uiSearchWords(dateLocale.value), '')
          : programmatic.is(uiSearchWords(dateLocale.value), 'expense');
  await transactionsCallout(b, anchor, {
    title: target.kind === 'all' ? tr('budget.outflows') : name,
    summary,
    lines: [],
    rows,
    held: null,
    month,
    search,
  });
}

/** "Income for {Month}" (09 §5.1). */
export async function showIncome(
  b: BudgetScreen,
  anchor: HTMLElement,
  view: BudgetMonthView,
): Promise<void> {
  const month = view.month;
  const rows = await host.call('transactions.incomeForMonth', { month });
  const money = b.format.money;
  const prev = prevMonth(month);
  const title = tr('app.budIncomeFor', { month: longMonth(month) });
  const empty = rows.length === 0 && view.incomeHeldFromPrev === 0;
  const summary = empty
    ? tr('app.budIncomeNone', { month: longMonth(month) })
    : tr('app.budIncomeSummary', {
        amount: escapeRichText(moneyText(view.income, money, { symbol: true })),
        month: escapeRichText(longMonth(month)),
      });
  const lines = empty
    ? []
    : [
        tr('app.budIncomeReceivedIn', {
          amount: moneyText(view.incomeHeldFromPrev, money, { symbol: true }),
          month: longMonth(prev),
        }),
        tr('app.budIncomeReceivedIn', {
          amount: moneyText(view.incomeReceived, money, { symbol: true }),
          month: longMonth(month),
        }),
      ];
  await transactionsCallout(b, anchor, {
    title,
    summary,
    lines,
    rows,
    held:
      view.incomeHeldFromPrev === 0
        ? null
        : {
            label: tr('app.budHeldFrom', { month: longMonth(prev) }),
            amount: view.incomeHeldFromPrev,
          },
    month,
    search: `${uiSearchWords(dateLocale.value).keywords.income}: ${monthYear(month)},`,
  });
}

async function transactionsCallout(
  b: BudgetScreen,
  anchor: HTMLElement,
  opts: {
    title: string;
    summary: string;
    lines: string[];
    rows: CalloutTransaction[];
    held: { label: string; amount: number } | null;
    month: Month;
    search: string;
  },
): Promise<void> {
  const result = await useCallouts().show(
    TransactionsCallout,
    {
      summary: opts.summary,
      lines: opts.lines,
      rows: opts.rows,
      held: opts.held,
      settings: b.format.money,
      dateFormat: b.format.dateFormat,
    },
    { anchor, title: opts.title, width: 'popover-w-lg' },
  );
  if (result.startsWith('jump:')) {
    const row = opts.rows[Number(result.slice(5))];
    if (row)
      useJump().jump({
        accountId: row.accountId,
        transactionId: row.transactionId,
        ...(row.isSplitLine ? { expand: true } : {}),
      });
  } else if (result === 'show') await showInAccountView(opts.rows, opts.search);
}

/**
 * Show in Account View (09 §6.6): the one account all rows share, or All Accounts, with the
 * pre-built search and a date filter over the rows' months.
 */
export async function showInAccountView(
  rows: readonly CalloutTransaction[],
  search: string,
): Promise<void> {
  const accounts = new Set(rows.map((r) => r.accountId));
  const [only] = accounts;
  const accountId = accounts.size === 1 && only ? only : 'all';
  const dates = rows.map((r) => r.date).sort();
  const from = (dates[0] ?? '').slice(0, 7) as Month;
  const to = (dates.at(-1) ?? '').slice(0, 7) as Month;
  useRegisterSession().view(accountId).search = search;
  const settings = useBudgetSettings();
  await settings.patch(({ register }) => ({
    register: {
      ...register,
      accounts: {
        ...register.accounts,
        [accountId]: {
          ...register.accounts[accountId],
          dateFilter: writeDateFilter({ preset: 'custom', from, to }),
        },
      },
    },
  }));
  const app = useAppStore();
  if (accountId === 'all') app.toAllAccounts();
  else app.toAccount(accountId);
}

// ------------------------------------------------------------------------------ Quick Budget (09 §5.5)

const INDENT = '   ';

/** The month Quick Budget menu, its confirmation and the fill; Hold / Reset hold. */
export async function quickBudgetMenu(
  b: BudgetScreen,
  view: BudgetMonthView,
  anchor: HTMLElement,
): Promise<void> {
  const month = view.month;
  const result = await attempt(() => host.call('budget.quickBudgetStats', { month }));
  if (!result.ok) return;
  const stats = result.value;
  const zero = formatMoney(0, b.format.money);
  const items = averageItems(stats.h12);
  const on = b.canEdit;
  const menu: ContextMenuItem[] = [
    { id: 'h1', label: tr('app.budMenuFillEmpty'), enabled: false },
    { id: 'lastBudgeted', label: INDENT + tr('app.budMenuLastBudgeted'), enabled: on },
    { id: 'lastOutflows', label: INDENT + tr('app.budMenuLastOutflows'), enabled: on },
    ...(items.average3
      ? [
          {
            id: 'average3',
            label: INDENT + tr('app.budMenuAverage', { n: items.average3 }),
            enabled: on,
          },
        ]
      : []),
    ...(items.year
      ? [
          {
            id: 'averageYear',
            label:
              INDENT +
              (items.year.partial
                ? tr('app.budMenuAverageYearPartial', { n: items.year.months })
                : tr('app.budMenuAverageYear')),
            enabled: on,
          },
        ]
      : []),
    { id: 'scheduled', label: INDENT + tr('app.budMenuScheduled'), enabled: on },
    { id: 'balanceTo0', label: INDENT + tr('app.budMenuBalanceTo', { zero }), enabled: on },
    { id: 'h2', label: tr('app.budMenuFillAll'), enabled: false },
    { id: 'zero', label: INDENT + tr('app.budMenuZero', { zero }), enabled: on },
    { id: 'sep' },
    { id: 'hold', label: tr('app.budMenuHold'), enabled: on },
    ...(view.heldForNext !== 0
      ? [{ id: 'resetHold', label: tr('app.budMenuResetHold'), enabled: on }]
      : []),
  ];
  const choice = await window.app.shell.showContextMenu(menu);
  if (!choice) return;
  if (choice === 'hold') return hold(b, anchor, view);
  if (choice === 'resetHold') {
    await write(() => host.call('budget.resetHold', { month }));
    return;
  }
  const which = choice as QuickFill;
  if (!(await confirmFill(which, month, stats.h12, zero))) return;
  await b.commitAmounts(month, fillEntries(stats, which, fillableCategories(b)));
}

/** The categories a fill may change (09 §5.5): not hidden, not income, not Uncategorized. */
export function fillableCategories(b: BudgetScreen): Id[] {
  return b.tree
    .filter((g) => !g.isIncome && !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden).map((c) => c.id));
}

async function confirmFill(
  which: QuickFill,
  month: Month,
  h12: number,
  zero: string,
): Promise<boolean> {
  const prev = monthShortYear(prevMonth(month));
  let instruction: string;
  let content = tr('app.budFillCannotUndo');
  let button = tr('app.budFillButton');
  switch (which) {
    case 'lastBudgeted':
      instruction = tr('app.budFillLastBudgeted', { month: prev });
      break;
    case 'lastOutflows':
      instruction = tr('app.budFillLastOutflows', { month: prev });
      break;
    case 'average3': {
      const n = Math.min(3, h12);
      instruction =
        n === 1 ? tr('app.budFillAverageOne', { month: prev }) : tr('app.budFillAverageN', { n });
      break;
    }
    case 'averageYear':
      instruction =
        h12 === 12 ? tr('app.budFillAverageYear') : tr('app.budFillAverageN', { n: h12 });
      break;
    case 'scheduled':
      instruction = tr('app.budFillScheduled', { month: monthShortYear(month) });
      break;
    case 'balanceTo0':
      instruction = tr('app.budFillBalance');
      button = tr('app.budFillBalanceButton', { zero });
      break;
    case 'zero':
      instruction = tr('app.budZeroTitle', { zero });
      content = tr('app.budZeroMessage');
      button = tr('app.budZeroButton', { zero });
      break;
  }
  const { button: pressed } = await useDialogs().showTaskDialog({
    instruction,
    content,
    icon: 'logo',
    buttons: ['cancel', { id: 'fill', label: button, isDefault: true }],
  });
  return pressed === 'fill';
}

/** Hold for next month… (09 §5.5): the callout on the header, then `budget.hold`. */
async function hold(b: BudgetScreen, anchor: HTMLElement, view: BudgetMonthView): Promise<void> {
  const next = addMonths(view.month, 1);
  const available = view.toBudget + view.heldForNext;
  const result = await useCallouts().show(
    HoldCallout,
    {
      month: longMonth(view.month),
      next: longMonth(next),
      available,
      initial: view.heldForNext !== 0 ? view.heldForNext : Math.max(0, view.toBudget),
      settings: b.format.money,
    },
    { anchor, title: tr('app.budHoldTitle'), width: 'popover-w-sm' },
  );
  if (!/^-?\d+$/.test(result)) return;
  const amount = Number(result);
  await write(() => host.call('budget.hold', { month: view.month, amount }));
}

// ------------------------------------------------------------------------------ moves (09 §4.3, 22 §2.4)

/** Moves a category, with the same refusals for drops and the keyboard (09 §4.3, 03 §3). */
export async function moveCategory(
  b: BudgetScreen,
  categoryId: Id,
  groupId: Id,
  beforeId: Id | null,
): Promise<void> {
  const from = b.tree.find((g) => g.categories.some((c) => c.id === categoryId));
  const to = b.tree.find((g) => g.id === groupId);
  const category = from?.categories.find((c) => c.id === categoryId);
  if (!from || !to || !category) return;
  const fold = (s: string): string => s.trim().toLocaleLowerCase();
  if (to.id !== from.id && to.categories.some((c) => fold(c.name) === fold(category.name))) {
    await tell(
      tr('app.budDuplicateCategory', { group: to.name, category: category.name }),
      tr('app.budDuplicateCategoryHint'),
      'warning',
      'ok',
    );
    return;
  }
  if (to.id === from.id && !b.moveSupport.category) {
    await refuseReorder();
    return;
  }
  try {
    await host.call('categories.move', { id: categoryId, groupId, beforeId });
  } catch (e) {
    const info = errorInfo(e);
    if (info.detail === 'internal-handler-unavailable') {
      await queryClient.invalidateQueries({ queryKey: ['categories', 'moveSupport'] });
      await refuseReorder();
    } else if (info.detail === 'name-duplicate')
      await tell(
        tr('app.budDuplicateCategory', { group: to.name, category: category.name }),
        tr('app.budDuplicateCategoryHint'),
        'warning',
        'ok',
      );
    else await report(e);
  }
}

async function refuseReorder(): Promise<void> {
  await useDialogs().showTaskDialog({
    instruction: tr('app.budReorderUnavailable'),
    icon: 'warning',
    buttons: ['ok'],
  });
}

/** Moves a group (09 §4.3). Disabled without `category-group-move`. */
export async function moveGroup(groupId: Id, beforeId: Id | null): Promise<void> {
  try {
    await host.call('categories.moveGroup', { id: groupId, beforeId });
  } catch (e) {
    if (errorInfo(e).detail === 'internal-handler-unavailable')
      await queryClient.invalidateQueries({ queryKey: ['categories', 'moveSupport'] });
    else await report(e);
  }
}

/** Move to Group… (22 §2.4): the picker, then the same move as a drop at the group's end. */
export async function moveToGroup(b: BudgetScreen, category: Category): Promise<void> {
  const from = b.tree.find((g) => g.id === category.groupId);
  const groups = b.tree.filter(
    (g) => g.id !== category.groupId && g.isIncome === (from?.isIncome ?? false) && !g.hidden,
  );
  const groupId = await useModals().open<Id>(MoveToGroupDialog, { name: category.name, groups });
  if (groupId) await moveCategory(b, category.id, groupId, null);
}
