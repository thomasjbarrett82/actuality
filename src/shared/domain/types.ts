// Domain types (04 §1–2). The host converts Actual objects to these; the renderer only sees these.

/** Actual UUID. */
export type Id = string;
/** Integer, minor units (Actual amount), always ×100 (04 §1). Never a float. */
export type Money = number;
/** 'YYYY-MM-DD' */
export type ISODate = `${number}-${number}-${number}`;
/** 'YYYY-MM' */
export type Month = `${number}-${number}`;
/** Uncleared / Cleared / Reconciled */
export type ClearedState = 'U' | 'C' | 'R';
/** Rank 0 / 1 / 5 / 10 (04 §7). */
export type ErrorLevel = 'none' | 'needsCategory' | 'forReview' | 'error';
/** Actuality supports envelope budgets only; Actual's Tracking mode is out of scope (01 §3). */
export type BudgetType = 'envelope';

/** Why a transaction has its error level (04 §7). The renderer turns it into text through i18n. */
export type ErrorMessageKey =
  | 'onBudgetTransferCategorized'
  | 'splitProblems'
  | 'reviewScheduled'
  | 'reviewImported'
  | 'needsCategory'
  | 'offBudgetTransferNeedsCategory';

export interface ErrorMessage {
  key: ErrorMessageKey;
  /** For splitProblems: the messages of the child lines with problems, in order. */
  children?: ErrorMessage[];
}

/** An Actual tag entity (04 §5.2): the shared color and description of a tag name used in notes. */
export interface TagEntity {
  id: Id;
  /** The name without the `#`; case-sensitive. */
  tag: string;
  color: string | null;
  description: string | null;
}

export const ERROR_RANK: Readonly<Record<ErrorLevel, number>> = {
  none: 0,
  needsCategory: 1,
  forReview: 5,
  error: 10,
};

export interface AccountBalances {
  cleared: Money;
  uncleared: Money;
  working: Money;
  reconciled: Money;
}

export interface Account {
  id: Id;
  name: string;
  /** Actual: !offbudget */
  onBudget: boolean;
  /** Actual: closed ("hidden") */
  closed: boolean;
  /** Actual sort_order (writable via updateAccount) */
  sortIndex: number;
  /** Actual note with id `account-{account.id}` */
  note: string | null;
  /** Actual's `last_reconciled` (ms timestamp) as a local calendar date; null when never reconciled. */
  lastReconciledDate: ISODate | null;
  /** Actual account_group_id: preserved, not shown */
  accountGroupId: Id | null;
  balances: AccountBalances;
  attention: { count: number; maxLevel: ErrorLevel };
  hasTransactions: boolean;
  scheduledCount: number;
}

/**
 * The other side of a transfer (04 §2): what the commit, delete and move rules need to know about it
 * (10 §6.1, §8; 11 §6).
 */
export interface TransferSide {
  id: Id;
  accountId: Id;
  date: ISODate;
  cleared: ClearedState;
  /** The other side is a line of a split in its account: this row was created by that split. */
  isSplitLine: boolean;
}

export interface SubTransaction {
  id: Id;
  parentId: Id;
  amount: Money;
  payeeId: Id | null;
  transferAccountId: Id | null;
  transferId: Id | null;
  transferSide: TransferSide | null;
  categoryId: Id | null;
  notes: string;
  rawNotes: string;
  errorLevel: ErrorLevel;
  errorMessage: ErrorMessage | null;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  date: ISODate;
  /** + inflow / − outflow */
  amount: Money;
  payeeId: Id | null;
  /** resolved display name */
  payeeName: string;
  /** from payee.transfer_acct */
  transferAccountId: Id | null;
  /** Actual transfer_id (other side) */
  transferId: Id | null;
  transferSide: TransferSide | null;
  /** null on split parents */
  categoryId: Id | null;
  /** notes minus metadata tokens, user tags intact (04 §5.1) */
  notes: string;
  /** the Actual tags in `notes`, as typed (04 §5.1) */
  tags: string[];
  checkNumber: string | null;
  needsReview: boolean;
  cleared: ClearedState;
  importedId: string | null;
  importedPayee: string | null;
  scheduleId: Id | null;
  isStartingBalance: boolean;
  /** non-empty ⇒ split */
  subtransactions: SubTransaction[];
  errorLevel: ErrorLevel;
  errorMessage: ErrorMessage | null;
  /** untouched original, for round-trip */
  rawNotes: string;
}

export interface Category {
  id: Id;
  groupId: Id;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  sortIndex: number;
  note: string | null;
}

export interface CategoryGroup {
  id: Id;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  sortIndex: number;
  note: string | null;
  categories: Category[];
}

export interface RenameCondition {
  op: 'contains' | 'is' | 'startsWith' | 'endsWith';
  value: string;
}

export interface Payee {
  id: Id;
  name: string;
  transferAccountId: Id | null;
  /** ad:payees (X12); transfer payee: = !account.closed */
  enabled: boolean;
  usageCount: number;
  autoCategoryRuleId: Id | null;
  autoCategoryId: Id | null;
  renameRules: RenameCondition[];
  renameRuleId: Id | null;
}

/** Schedule frequencies (12 §1). */
export type Frequency =
  | 'Once'
  | 'Daily'
  | 'Weekly'
  | 'EveryOtherWeek'
  | 'TwiceAMonth'
  | 'Every4Weeks'
  | 'Monthly'
  | 'EveryOtherMonth'
  | 'Every3Months'
  | 'Every4Months'
  | 'TwiceAYear'
  | 'Yearly'
  | 'EveryOtherYear';

export interface ScheduleLine {
  amount: Money;
  method: 'fixed-amount' | 'remainder';
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryId: Id | null;
  notes: string;
}

/** Actual's recurrence config (12 §1). Unknown fields are preserved. */
export interface RecurConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  start: ISODate;
  endMode?: 'never' | 'after_n_occurrences' | 'on_date';
  endOccurrences?: number;
  endDate?: ISODate;
  /** `type`: 'day' (value 1–31, -1 = last day) or a weekday 'SU'…'SA' (value 1–5, -1 = last). */
  patterns?: { type: string; value: number }[];
  skipWeekend?: boolean;
  weekendSolveMode?: 'before' | 'after';
  [key: string]: unknown;
}

export interface Schedule {
  id: Id;
  /** Actual name (unique if set) */
  name: string | null;
  accountId: Id | null;
  /** Actual's next_date (system-managed) */
  nextDate: ISODate;
  frequency: Frequency | 'custom';
  /** 1–15, TwiceAMonth only */
  twiceAMonthStartDay: number | null;
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryId: Id | null;
  /** includes user tags */
  notes: string;
  /** num1 for isbetween */
  amount: Money;
  amountOp: 'is' | 'isapprox' | 'isbetween';
  /** num2, isbetween only */
  amount2: Money | null;
  subtransactions: ScheduleLine[];
  postsTransaction: boolean;
  completed: boolean;
  raw: { date: string | RecurConfig; ruleId: Id };
}

/** The Schedule dialog's pre-fill from a register transaction (12 §4). */
export interface ScheduleDraft {
  accountId: Id;
  date: ISODate | RecurConfig;
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryId: Id | null;
  notes: string;
  amount: Money;
  subtransactions: ScheduleLine[];
}

/** A row of the Schedule dialog's linked and matching transactions (12 §3.1). */
export interface ScheduleMatch {
  id: Id;
  accountId: Id;
  date: ISODate;
  payeeId: Id | null;
  /** Without the app's tokens and review tag */
  notes: string;
  amount: Money;
}

export interface BudgetCategoryMonth {
  id: Id;
  budgeted: Money;
  activity: Money;
  balance: Money;
  carryover: boolean;
  hasTransactions: boolean;
}

export interface BudgetGroupMonth {
  id: Id;
  budgeted: Money;
  activity: Money;
  balance: Money;
  categories: BudgetCategoryMonth[];
}

/** The normalized month view (09 §2). */
export interface BudgetMonthView {
  month: Month;
  type: BudgetType;
  notBudgetedPrev: Money;
  overspentPrev: Money;
  income: Money;
  incomeReceived: Money;
  incomeHeldFromPrev: Money;
  budgeted: Money;
  heldForNext: Money;
  toBudget: Money;
  /** Actual's `toBudget` minus the header identity's (09 §2): 0 unless an automatic hold applies. */
  otherAdjustments: Money;
  totals: { budgeted: Money; activity: Money; balance: Money };
  /** Expense groups, hidden ones included, in Actual's order. */
  groups: BudgetGroupMonth[];
  /** Income groups: only `activity` (received) is set. */
  incomeGroups: BudgetGroupMonth[];
  uncategorized: { activity: Money; hasTransactions: boolean };
  hasRealData: boolean;
}
