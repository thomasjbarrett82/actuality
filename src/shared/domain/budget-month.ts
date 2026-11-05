// `getBudgetMonth` → the normalized month view (09 §2). Pure, so the host and the tests share it.
// Actual's signs: an envelope budget's `totalBudgeted` is negative.
import type {
  BudgetCategoryMonth,
  BudgetGroupMonth,
  BudgetMonthView,
  Id,
  Money,
  Month,
} from './types';

/** A category of `getBudgetMonth(m).categoryGroups[].categories`. */
export interface RawBudgetCategory {
  id: string;
  is_income?: boolean;
  budgeted?: number | null;
  spent?: number | null;
  received?: number | null;
  balance?: number | null;
  carryover?: boolean | null;
}

export interface RawBudgetGroup {
  id: string;
  is_income?: boolean;
  budgeted?: number | null;
  spent?: number | null;
  received?: number | null;
  balance?: number | null;
  categories?: RawBudgetCategory[];
}

/** `getBudgetMonth(m)` as Actual returns it. Values may be null where the TS types say `number`. */
export interface RawBudgetMonth {
  month: string;
  incomeAvailable: number | null;
  lastMonthOverspent: number | null;
  forNextMonth: number | null;
  totalBudgeted: number | null;
  toBudget: number | null;
  fromLastMonth: number | null;
  totalIncome: number | null;
  totalSpent: number | null;
  totalBalance: number | null;
  categoryGroups: RawBudgetGroup[];
}

/** What the host adds to Actual's numbers: AQL counts per category and the Uncategorized row (09 §2). */
export interface MonthExtras {
  /** Categories with at least one transaction in the month. */
  withTransactions: ReadonlySet<Id>;
  uncategorized: { activity: Money; hasTransactions: boolean };
}

const n = (v: number | null | undefined): Money => v ?? 0;
/** −v without −0. */
const neg = (v: number | null | undefined): Money => (v ? -v : 0);

/** The header identity (09 §2): what Available to Budget is from the lines above it. */
export function identityToBudget(
  v: Pick<
    BudgetMonthView,
    'notBudgetedPrev' | 'overspentPrev' | 'income' | 'budgeted' | 'heldForNext'
  >,
): Money {
  return v.notBudgetedPrev + v.overspentPrev + v.income - v.budgeted - v.heldForNext;
}

/**
 * The month view from `cur` = `getBudgetMonth(m)` and `prev` = `getBudgetMonth(prev(m))`, or null for the
 * first month of the range, where every `prev.*` value is 0 (09 §2).
 */
export function toBudgetMonthView(
  cur: RawBudgetMonth,
  prev: RawBudgetMonth | null,
  extras: MonthExtras,
): BudgetMonthView {
  const category = (c: RawBudgetCategory): BudgetCategoryMonth => ({
    id: c.id,
    budgeted: n(c.budgeted),
    activity: n(c.spent),
    balance: n(c.balance),
    carryover: c.carryover === true,
    hasTransactions: extras.withTransactions.has(c.id),
  });
  // Income categories carry only what was received.
  const incomeCategory = (c: RawBudgetCategory): BudgetCategoryMonth => ({
    id: c.id,
    budgeted: 0,
    activity: n(c.received),
    balance: 0,
    carryover: c.carryover === true,
    hasTransactions: extras.withTransactions.has(c.id),
  });
  const expense = cur.categoryGroups.filter((g) => g.is_income !== true);
  const income = cur.categoryGroups.filter((g) => g.is_income === true);
  const groups = expense.map((g): BudgetGroupMonth => ({
    id: g.id,
    budgeted: n(g.budgeted),
    activity: n(g.spent),
    balance: n(g.balance),
    categories: (g.categories ?? []).map(category),
  }));
  const incomeGroups = income.map((g): BudgetGroupMonth => ({
    id: g.id,
    budgeted: 0,
    activity: n(g.received),
    balance: 0,
    categories: (g.categories ?? []).map(incomeCategory),
  }));
  const incomeReceived = n(cur.totalIncome);
  const incomeHeldFromPrev = n(prev?.forNextMonth);
  const budgeted = neg(cur.totalBudgeted);
  const activity = n(cur.totalSpent);
  const base = {
    notBudgetedPrev: n(prev?.toBudget),
    overspentPrev: n(cur.lastMonthOverspent),
    income: incomeReceived + incomeHeldFromPrev,
    budgeted,
    heldForNext: n(cur.forNextMonth),
  };
  const toBudget = n(cur.toBudget);
  return {
    month: cur.month as Month,
    type: 'envelope',
    ...base,
    incomeReceived,
    incomeHeldFromPrev,
    toBudget,
    otherAdjustments: toBudget - identityToBudget(base),
    totals: { budgeted, activity, balance: n(cur.totalBalance) },
    groups,
    incomeGroups,
    uncategorized: extras.uncategorized,
    hasRealData: base.income !== 0 || budgeted !== 0 || activity !== 0,
  };
}
