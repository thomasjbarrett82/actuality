// Matching search terms against register rows (10 §4). All terms must match; terms of the same kind for
// Payee, Category, Account and Tag are OR-ed. A split parent is shown if it or any of its lines matches;
// lines are tested with their own payee (transfer text), category, notes and amount, and the parent's other
// fields.
import { monthOf } from '../dates';
import type { ClearedState, ErrorLevel, Id, ISODate, Money } from '../domain/types';
import { parse as parseMoney, type NumberFormat } from '../money';
import type { Term } from './parser';
import type { IsValue } from './words';

/** How a transfer relates the budget: none, between on-budget accounts, across, or off-budget only. */
export type TransferKind = 'none' | 'onOn' | 'onOff' | 'offOff';

export interface SearchLine {
  /** "Transfer : {account}" for a transfer line, '' otherwise. */
  transferText: string;
  categoryText: string;
  categoryId: Id | null;
  notes: string;
  tags: readonly string[];
  amount: Money;
  /** Categorized in an income category. */
  isIncome: boolean;
  transferKind: TransferKind;
  errorLevel: ErrorLevel;
}

export interface SearchRow {
  date: ISODate;
  amount: Money;
  payeeText: string;
  categoryText: string;
  categoryId: Id | null;
  notes: string;
  checkNumber: string | null;
  accountName: string;
  accountOnBudget: boolean;
  accountClosed: boolean;
  tags: readonly string[];
  needsReview: boolean;
  errorLevel: ErrorLevel;
  cleared: ClearedState;
  isIncome: boolean;
  transferKind: TransferKind;
  /** Split lines; empty for a normal transaction. */
  lines: readonly SearchLine[];
}

export interface MatchContext {
  /** Every payee's display name, lowercased: `Payee: x` is exact when x is one of them. */
  payeeNames: ReadonlySet<string>;
  /** Every "Group: Category" display name, lowercased. */
  categoryNames: ReadonlySet<string>;
  numberFormat: NumberFormat;
}

/** Which parts of a row matched. `lines` has one entry per split line. */
export interface MatchResult {
  row: boolean;
  lines: boolean[];
}

/** A test of the parent row, and of one split line (with the parent's other fields). */
interface Test {
  row: (r: SearchRow) => boolean;
  line: (r: SearchRow, l: SearchLine) => boolean;
}

const fold = (s: string): string => s.toLocaleLowerCase();
const contains = (text: string, value: string): boolean => fold(text).includes(fold(value));

const outflowOf = (amount: Money): Money => (amount < 0 ? -amount : 0);
const inflowOf = (amount: Money): Money => (amount > 0 ? amount : 0);

/** Not income and not a transfer; transfers across the budget boundary count (10 §4). */
const isExpense = (income: boolean, transfer: TransferKind): boolean =>
  !income && (transfer === 'none' || transfer === 'onOff');
const isIncomeOrExpense = (transfer: TransferKind): boolean =>
  transfer === 'none' || transfer === 'onOff';

/** A test that doesn't depend on the line: the line takes the parent's result. */
const parentOnly = (f: (r: SearchRow) => boolean): Test => ({ row: f, line: (r) => f(r) });

/** A number typed as free text (10 §4): it also matches outflow/inflow equal to it. */
function numericValue(value: string, numberFormat: NumberFormat): Money | null {
  if (!/^[\d.,\s]+$/.test(value.trim())) return null;
  const v = parseMoney(value, { numberFormat });
  return v === null || v === 0 ? null : v;
}

function amountMatches(amount: Money, value: Money): boolean {
  return outflowOf(amount) === value || inflowOf(amount) === value;
}

function isTest(value: IsValue): Test {
  switch (value) {
    case 'approved':
      return parentOnly((r) => !r.needsReview);
    case 'unapproved':
      return parentOnly((r) => r.needsReview);
    case 'error':
      return { row: (r) => r.errorLevel === 'error', line: (_r, l) => l.errorLevel === 'error' };
    case 'needsCategory':
      return {
        row: (r) => r.errorLevel === 'needsCategory',
        line: (_r, l) => l.errorLevel === 'needsCategory',
      };
    case 'reminder':
      return parentOnly((r) => r.errorLevel === 'forReview');
    case 'cleared':
      return parentOnly((r) => r.cleared === 'C');
    case 'uncleared':
      return parentOnly((r) => r.cleared === 'U');
    case 'reconciled':
      return parentOnly((r) => r.cleared === 'R');
    case 'clearedOrReconciled':
      return parentOnly((r) => r.cleared !== 'U');
    case 'unreconciled':
      return parentOnly((r) => r.cleared !== 'R');
    case 'expense':
      return {
        row: (r) => r.lines.length === 0 && isExpense(r.isIncome, r.transferKind),
        line: (_r, l) => isExpense(l.isIncome, l.transferKind),
      };
    case 'incomeOrExpense':
      return {
        row: (r) => r.lines.length === 0 && isIncomeOrExpense(r.transferKind),
        line: (_r, l) => isIncomeOrExpense(l.transferKind),
      };
  }
}

function testFor(term: Term, ctx: MatchContext): Test {
  switch (term.kind) {
    case 'text': {
      const v = term.value;
      const n = numericValue(v, ctx.numberFormat);
      return {
        row: (r) =>
          contains(r.payeeText, v) ||
          contains(r.categoryText, v) ||
          contains(r.notes, v) ||
          contains(r.checkNumber ?? '', v) ||
          (n !== null && amountMatches(r.amount, n)),
        line: (_r, l) =>
          contains(l.transferText, v) ||
          contains(l.categoryText, v) ||
          contains(l.notes, v) ||
          (n !== null && amountMatches(l.amount, n)),
      };
    }
    case 'payee': {
      const v = term.value;
      const exact = ctx.payeeNames.has(fold(v.trim()));
      const test = (text: string): boolean =>
        v === '' ? text === '' : exact ? fold(text) === fold(v.trim()) : contains(text, v);
      return {
        row: (r) => test(r.payeeText),
        line: (r, l) => test(l.transferText === '' ? r.payeeText : l.transferText),
      };
    }
    case 'category': {
      const v = term.value;
      const exact = ctx.categoryNames.has(fold(v.trim()));
      const test = (text: string, id: Id | null): boolean =>
        v === '' ? id === null : exact ? fold(text) === fold(v.trim()) : contains(text, v);
      return {
        row: (r) =>
          r.lines.length > 0
            ? v !== '' && test(r.categoryText, null)
            : test(r.categoryText, r.categoryId),
        line: (_r, l) => test(l.categoryText, l.categoryId),
      };
    }
    case 'account':
      return parentOnly((r) => contains(r.accountName, term.value));
    case 'accountSet':
      return parentOnly((r) => {
        switch (term.set) {
          case 'budget':
            return r.accountOnBudget && !r.accountClosed;
          case 'offBudget':
            return !r.accountOnBudget && !r.accountClosed;
          case 'closed':
            return r.accountClosed;
          case 'closedBudget':
            return r.accountClosed && r.accountOnBudget;
          case 'closedOffBudget':
            return r.accountClosed && !r.accountOnBudget;
        }
      });
    case 'notes':
      return {
        row: (r) => contains(r.notes, term.value),
        line: (_r, l) => contains(l.notes, term.value),
      };
    case 'check':
      return parentOnly((r) =>
        term.value === '' ? r.checkNumber === null : contains(r.checkNumber ?? '', term.value),
      );
    case 'tag':
      return {
        row: (r) => r.tags.includes(term.value),
        line: (r, l) => l.tags.includes(term.value) || r.tags.includes(term.value),
      };
    case 'is':
      return isTest(term.value);
    case 'date': {
      const { op, date } = term;
      return parentOnly((r) =>
        op === 'on' ? r.date === date : op === 'after' ? r.date >= date : r.date <= date,
      );
    }
    case 'amount': {
      const { field, op, amount } = term;
      const test = (a: Money): boolean => {
        const value = field === 'outflow' ? outflowOf(a) : inflowOf(a);
        if (op === 'eq') return value === amount;
        // "More/less or equal" only covers that side of the transaction.
        if (value === 0 && amount !== 0) return false;
        return op === 'gte' ? value >= amount : value <= amount;
      };
      return { row: (r) => test(r.amount), line: (_r, l) => test(l.amount) };
    }
    case 'income': {
      const { month } = term;
      return {
        row: (r) => r.lines.length === 0 && r.isIncome && monthOf(r.date) === month,
        line: (r, l) => l.isIncome && monthOf(r.date) === month,
      };
    }
    case 'never':
      return { row: () => false, line: () => false };
  }
}

/** The kinds whose terms are OR-ed with each other (10 §4). */
const OR_KINDS = new Set<string>(['payee', 'category', 'account', 'tag']);
const orKind = (t: Term): string | null =>
  t.kind === 'accountSet' ? 'account' : OR_KINDS.has(t.kind) ? t.kind : null;

function anyOf(tests: readonly Test[]): Test {
  return {
    row: (r) => tests.some((t) => t.row(r)),
    line: (r, l) => tests.some((t) => t.line(r, l)),
  };
}

/** A predicate over register rows for the parsed terms; null when there are none (everything shows). */
export function compileSearch(
  terms: readonly Term[],
  ctx: MatchContext,
): ((row: SearchRow) => MatchResult) | null {
  if (terms.length === 0) return null;
  const groups = new Map<string, Test[]>();
  const tests: Test[] = [];
  for (const term of terms) {
    const kind = orKind(term);
    if (kind === null) tests.push(testFor(term, ctx));
    else {
      const list = groups.get(kind) ?? [];
      if (list.length === 0) groups.set(kind, list);
      list.push(testFor(term, ctx));
    }
  }
  for (const list of groups.values()) tests.push(anyOf(list));
  return (row) => ({
    row: tests.every((t) => t.row(row)),
    lines: row.lines.map((l) => tests.every((t) => t.line(row, l))),
  });
}

/** A row is shown when it, or any of its split lines, matches. */
export const isShown = (m: MatchResult): boolean => m.row || m.lines.some(Boolean);
