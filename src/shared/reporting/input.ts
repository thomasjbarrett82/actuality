// What a report calculation reads (15 §6–7): the accounts, the category tree, the payees and every
// transaction side, normalized by the host. A side is a non-split transaction or one split line, never a
// split parent, so each amount counts once. Amounts keep Actual's sign: + inflow / credit, − outflow.
import type { Id, ISODate, Money } from '../domain/types';
import { NO_PAYEE, UNCATEGORIZED, type AccountSelection, type FlowFilters } from './model';
import type { DateRange } from './periods';

export interface ReportAccount {
  id: Id;
  name: string;
  offBudget: boolean;
  closed: boolean;
  sortIndex: number;
}

export interface ReportCategory {
  id: Id;
  name: string;
  groupId: Id;
  isIncome: boolean;
}

export interface ReportGroup {
  id: Id;
  name: string;
  isIncome: boolean;
  categories: ReportCategory[];
}

export interface ReportPayee {
  id: Id;
  name: string;
  /** A transfer payee's account. */
  transferAccountId: Id | null;
}

export interface ReportSide {
  id: Id;
  /** The transaction: a split line's parent, or the side itself. */
  transactionId: Id;
  /** A split line's position in its split; 0 otherwise (15 §5 ordering). */
  line: number;
  accountId: Id;
  date: ISODate;
  amount: Money;
  /** A split line without its own payee takes its parent's. */
  payeeId: Id | null;
  categoryId: Id | null;
  /** The other account of a transfer, from the payee's `transfer_acct`. */
  transferAccountId: Id | null;
  /** Actual's `starting_balance_flag` (a split line takes its parent's). */
  startingBalance: boolean;
}

export interface ReportInput {
  accounts: ReportAccount[];
  /** In budget order, with their categories in order. */
  groups: ReportGroup[];
  payees: ReportPayee[];
  /** Every side through the request's last needed date, sorted by date. */
  sides: ReportSide[];
}

/** Lookups built once per calculation. */
export interface ReportIndex {
  input: ReportInput;
  account: Map<Id, ReportAccount>;
  category: Map<Id, ReportCategory>;
  group: Map<Id, ReportGroup>;
  payee: Map<Id, ReportPayee>;
}

export function indexOf(input: ReportInput): ReportIndex {
  const category = new Map<Id, ReportCategory>();
  for (const g of input.groups) for (const c of g.categories) category.set(c.id, c);
  return {
    input,
    account: new Map(input.accounts.map((a) => [a.id, a])),
    category,
    group: new Map(input.groups.map((g) => [g.id, g])),
    payee: new Map(input.payees.map((p) => [p.id, p])),
  };
}

/** The open accounts an Accounts filter picks (15 §2.2): closed accounts are never included. */
export function selectedAccounts(index: ReportIndex, selection: AccountSelection): Set<Id> {
  const open = index.input.accounts.filter((a) => !a.closed);
  switch (selection.kind) {
    case 'all':
      return new Set(open.map((a) => a.id));
    case 'onBudget':
      return new Set(open.filter((a) => !a.offBudget).map((a) => a.id));
    case 'ids': {
      const wanted = new Set(selection.ids);
      return new Set(open.filter((a) => wanted.has(a.id)).map((a) => a.id));
    }
  }
}

/** A side's category is income: it belongs to the Inflow section; anything else to Outflow (15 §6). */
export const isIncomeSide = (index: ReportIndex, side: ReportSide): boolean =>
  side.categoryId !== null && index.category.get(side.categoryId)?.isIncome === true;

/**
 * The sides an ordinary flow report counts (15 §6): in the range, in a selected open account, not a
 * Starting Balance, and matching the Categories and Payees filters. Each transfer side is judged on its
 * own, with its own category.
 */
export function flowSides(
  index: ReportIndex,
  filters: FlowFilters,
  range: DateRange,
): ReportSide[] {
  const accounts = selectedAccounts(index, filters.accounts);
  const categories = filters.categories.kind === 'all' ? null : new Set<Id>(filters.categories.ids);
  const payees = filters.payees.kind === 'all' ? null : new Set<Id>(filters.payees.ids);
  return index.input.sides.filter(
    (s) =>
      s.date >= range.start &&
      s.date <= range.end &&
      !s.startingBalance &&
      accounts.has(s.accountId) &&
      (categories === null || categories.has(s.categoryId ?? UNCATEGORIZED)) &&
      (payees === null || payees.has(s.payeeId ?? NO_PAYEE)),
  );
}

/** The earliest transaction date, for All Dates (15 §2.2). */
export function earliestDate(input: ReportInput): ISODate | null {
  let first: ISODate | null = null;
  for (const s of input.sides) if (first === null || s.date < first) first = s.date;
  return first;
}
