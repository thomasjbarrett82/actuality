// Domain builders and a host-call mock for component tests (21 §1): complete objects with defaults for the
// fields a test leaves out, and `mockHost` that answers each method from a table and records the calls.
import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import type {
  Account,
  BudgetCategoryMonth,
  BudgetGroupMonth,
  BudgetMonthView,
  CategoryGroup,
  ISODate,
  Month,
  Payee,
  SubTransaction,
  Transaction,
} from '@shared/domain/types';
import type { HostMethod } from '@shared/rpc/host-api';
import { flushPromises } from '@vue/test-utils';
import { vi, type MockInstance } from 'vitest';
import { host } from '../rpc/host-client';
import { useCallouts, type OpenCallout } from '../stores/callouts';
import { useDialogs, type TaskDialogOptions } from '../stores/dialogs';
import { useModals } from '../stores/modals';

export function account(a: Partial<Account> & { id: string; name: string }): Account {
  return {
    onBudget: true,
    closed: false,
    sortIndex: 0,
    note: null,
    lastReconciledDate: null,
    accountGroupId: null,
    balances: { cleared: 0, uncleared: 0, working: 0, reconciled: 0 },
    attention: { count: 0, maxLevel: 'none' },
    hasTransactions: false,
    scheduledCount: 0,
    ...a,
  };
}

export function transaction(
  t: Partial<Transaction> & { id: string; accountId: string },
): Transaction {
  return {
    date: '2026-10-01',
    amount: 0,
    payeeId: null,
    payeeName: '',
    transferAccountId: null,
    transferId: null,
    transferSide: null,
    categoryId: null,
    notes: '',
    checkNumber: null,
    tags: [],
    needsReview: false,
    cleared: 'U',
    importedId: null,
    importedPayee: null,
    scheduleId: null,
    isStartingBalance: false,
    subtransactions: [],
    errorLevel: 'none',
    errorMessage: null,
    rawNotes: '',
    ...t,
  };
}

export function line(
  l: Partial<SubTransaction> & { id: string; parentId: string },
): SubTransaction {
  return {
    amount: 0,
    payeeId: null,
    transferAccountId: null,
    transferId: null,
    transferSide: null,
    categoryId: null,
    notes: '',
    rawNotes: '',
    errorLevel: 'none',
    errorMessage: null,
    ...l,
  };
}

export function payee(p: Partial<Payee> & { id: string; name: string }): Payee {
  return {
    transferAccountId: null,
    enabled: true,
    usageCount: 0,
    autoCategoryRuleId: null,
    autoCategoryId: null,
    renameRules: [],
    renameRuleId: null,
    ...p,
  };
}

/** Income (Salary) and two expense groups: Everyday Expenses (Groceries, Fuel), Bills (Rent). */
export const GROUPS: CategoryGroup[] = [
  {
    id: 'g-income',
    name: 'Income',
    isIncome: true,
    hidden: false,
    sortIndex: 0,
    note: null,
    categories: [
      {
        id: 'c-salary',
        groupId: 'g-income',
        name: 'Salary',
        isIncome: true,
        hidden: false,
        sortIndex: 1,
        note: null,
      },
    ],
  },
  {
    id: 'g-everyday',
    name: 'Everyday Expenses',
    isIncome: false,
    hidden: false,
    sortIndex: 1,
    note: null,
    categories: [
      {
        id: 'c-groceries',
        groupId: 'g-everyday',
        name: 'Groceries',
        isIncome: false,
        hidden: false,
        sortIndex: 1,
        note: null,
      },
      {
        id: 'c-fuel',
        groupId: 'g-everyday',
        name: 'Fuel',
        isIncome: false,
        hidden: false,
        sortIndex: 2,
        note: null,
      },
    ],
  },
  {
    id: 'g-bills',
    name: 'Bills',
    isIncome: false,
    hidden: false,
    sortIndex: 2,
    note: null,
    categories: [
      {
        id: 'c-rent',
        groupId: 'g-bills',
        name: 'Rent',
        isIncome: false,
        hidden: false,
        sortIndex: 1,
        note: null,
      },
    ],
  },
];

/**
 * A month view (09 §2) for `groups`: every category 0 unless `cells` sets it (`{id: {budgeted, …}}`),
 * group and month totals summed from the categories.
 */
export function monthView(
  month: Month,
  cells: Record<string, Partial<BudgetCategoryMonth>> = {},
  extra: Partial<BudgetMonthView> = {},
  groups: readonly CategoryGroup[] = GROUPS,
): BudgetMonthView {
  const group = (g: CategoryGroup): BudgetGroupMonth => {
    const categories = g.categories.map((c): BudgetCategoryMonth => ({
      id: c.id,
      budgeted: 0,
      activity: 0,
      balance: 0,
      carryover: false,
      hasTransactions: false,
      ...cells[c.id],
    }));
    const total = (f: 'budgeted' | 'activity' | 'balance'): number =>
      categories.reduce((s, c) => s + c[f], 0);
    return {
      id: g.id,
      budgeted: total('budgeted'),
      activity: total('activity'),
      balance: total('balance'),
      categories,
    };
  };
  const expense = groups.filter((g) => !g.isIncome).map(group);
  const income = groups.filter((g) => g.isIncome).map(group);
  const sum = (f: 'budgeted' | 'activity' | 'balance'): number =>
    expense.reduce((s, g) => s + g[f], 0);
  return {
    month,
    type: 'envelope',
    notBudgetedPrev: 0,
    overspentPrev: 0,
    income: 0,
    incomeReceived: 0,
    incomeHeldFromPrev: 0,
    budgeted: sum('budgeted'),
    heldForNext: 0,
    toBudget: -sum('budgeted'),
    otherAdjustments: 0,
    totals: { budgeted: sum('budgeted'), activity: sum('activity'), balance: sum('balance') },
    groups: expense,
    incomeGroups: income,
    uncategorized: { activity: 0, hasTransactions: false },
    hasRealData: true,
    ...extra,
  };
}

/** Host answers for the Budget screen (09): the range and a month view per month. */
export function budgetResponses(
  months: Month[],
  view: (month: Month) => BudgetMonthView = (m) => monthView(m),
): Responses {
  return {
    'budget.months': () => months,
    'budget.month': (p: { month: Month }) => view(p.month),
    'budget.uncategorized': () => ({ exists: false }),
    'categories.moveSupport': () => ({ category: true, group: true }),
    'notes.cellNotes': () => ({}),
    'notes.monthNote': () => null,
  };
}

export const ONLINE: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'Online',
  budget: {
    cloudFileId: 'c1',
    groupId: 'g1',
    name: 'Home',
    budgetType: 'envelope',
    localOnly: false,
  },
};

export type Responses = Partial<Record<HostMethod, (params: never) => unknown>>;

/** Answers `host.call` from `responses` (unknown methods resolve null) and records every call. */
export function mockHost(responses: Responses): {
  spy: MockInstance<typeof host.call>;
  calls: (method: HostMethod) => unknown[];
} {
  const spy = vi.spyOn(host, 'call').mockImplementation((method, params) => {
    const f = responses[method] as ((p: unknown) => unknown) | undefined;
    try {
      return Promise.resolve(f ? f(params) : null) as ReturnType<typeof host.call>;
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  return {
    spy,
    calls: (method) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p),
  };
}

/** The top TaskDialog's options, after answering it with `button` (and the footer checkbox). */
export async function answerDialog(
  button: string | null,
  checkboxChecked = false,
  date?: ISODate,
): Promise<TaskDialogOptions> {
  await flushPromises();
  const dialogs = useDialogs();
  const top = dialogs.stack.at(-1);
  if (!top) throw new Error('no dialog is open');
  dialogs.close(top.id, { button, checkboxChecked, ...(date ? { date } : {}) });
  await flushPromises();
  return top.options;
}

/** The top modal's props, after closing it with `result` (null for Cancel). */
export async function answerModal(result: unknown): Promise<Record<string, unknown>> {
  await flushPromises();
  const modals = useModals();
  const top = modals.stack.at(-1);
  if (!top) throw new Error('no modal is open');
  modals.close(top.id, result);
  await flushPromises();
  return top.props;
}

/** The newest callout, after closing it with the result id `result`. */
export async function answerCallout(result: string): Promise<OpenCallout> {
  await flushPromises();
  const callouts = useCallouts();
  const top = callouts.open.at(-1);
  if (!top) throw new Error('no callout is open');
  callouts.close(top.id, result);
  await flushPromises();
  return top;
}
