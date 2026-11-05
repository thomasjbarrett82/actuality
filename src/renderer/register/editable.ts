// The inline editor's model (11 §1–2): an `EditableTransaction` is a deep copy that the editor changes;
// the stored transaction is untouched until the commit pipeline succeeds (11 §6). Also how payee and
// category text resolves (11 §4.1–4.2).
import { categoryLabel } from '@shared/domain/categories';
import { transferAccountName } from '@shared/domain/payees';
import type {
  Account,
  CategoryGroup,
  ClearedState,
  Id,
  ISODate,
  Money,
  Payee,
  Transaction,
} from '@shared/domain/types';
import type { CommitEdit, PayeeRef } from '@shared/rpc/host-api';

export interface EditLine {
  /** Stable key for the list. */
  key: string;
  /** The stored line's id; null for a new line. */
  id: Id | null;
  /** Only transfers mean anything here: "Transfer : X" (11 §7.1). */
  payeeText: string;
  transferAccountId: Id | null;
  categoryText: string;
  categoryId: Id | null;
  notes: string;
  amount: Money;
}

export interface EditableTransaction {
  /** Null for a new transaction. */
  id: Id | null;
  accountId: Id;
  date: ISODate;
  checkNumber: string;
  payeeText: string;
  /** The existing (non-transfer) payee the text names, if any. */
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryText: string;
  categoryId: Id | null;
  split: boolean;
  lines: EditLine[];
  notes: string;
  amount: Money;
  cleared: ClearedState;
  needsReview: boolean;
}

/** What Add New Category closes with (11 §4.2): the new category and its "Group: Category" text. */
export interface NewCategory {
  id: Id;
  text: string;
}

let keys = 0;
export const lineKey = (): string => `line-${String(++keys)}`;

export interface EditTexts {
  transfer: (account: string) => string;
  categoryText: (id: Id | null) => string;
}

export function fromTransaction(
  t: Transaction,
  texts: EditTexts,
  accounts: ReadonlyMap<Id, Account>,
): EditableTransaction {
  const transferName = (id: Id | null): string => {
    const a = id ? accounts.get(id) : undefined;
    return a ? texts.transfer(a.name) : '';
  };
  const split = t.subtransactions.length > 0;
  return {
    id: t.id,
    accountId: t.accountId,
    date: t.date,
    checkNumber: t.checkNumber ?? '',
    payeeText: t.transferAccountId ? transferName(t.transferAccountId) : t.payeeName,
    payeeId: t.transferAccountId ? null : t.payeeId,
    transferAccountId: t.transferAccountId,
    categoryText: split ? '' : texts.categoryText(t.categoryId),
    categoryId: split ? null : t.categoryId,
    split,
    lines: t.subtransactions.map((l) => ({
      key: lineKey(),
      id: l.id,
      payeeText: transferName(l.transferAccountId),
      transferAccountId: l.transferAccountId,
      categoryText: texts.categoryText(l.categoryId),
      categoryId: l.categoryId,
      notes: l.notes,
      amount: l.amount,
    })),
    notes: t.notes,
    amount: t.amount,
    cleared: t.cleared,
    needsReview: t.needsReview,
  };
}

export function blankEdit(accountId: Id, date: ISODate): EditableTransaction {
  return {
    id: null,
    accountId,
    date,
    checkNumber: '',
    payeeText: '',
    payeeId: null,
    transferAccountId: null,
    categoryText: '',
    categoryId: null,
    split: false,
    lines: [],
    notes: '',
    amount: 0,
    cleared: 'U',
    needsReview: false,
  };
}

export const emptyLine = (): EditLine => ({
  key: lineKey(),
  id: null,
  payeeText: '',
  transferAccountId: null,
  categoryText: '',
  categoryId: null,
  notes: '',
  amount: 0,
});

export const cloneEdit = (e: EditableTransaction): EditableTransaction => ({
  ...e,
  lines: e.lines.map((l) => ({ ...l })),
});

const sameLines = (a: readonly EditLine[], b: readonly EditLine[]): boolean =>
  a.length === b.length &&
  a.every((l, i) => {
    const m = b[i];
    return (
      m !== undefined &&
      l.id === m.id &&
      l.transferAccountId === m.transferAccountId &&
      l.categoryId === m.categoryId &&
      l.notes.trim() === m.notes.trim() &&
      l.amount === m.amount
    );
  });

/** Which fields differ from the original (11 §1 "unchanged" / §6 step 5). */
export interface EditChanges {
  any: boolean;
  date: boolean;
  amount: boolean;
  account: boolean;
  payee: boolean;
  category: boolean;
  notes: boolean;
  /** Any of date, payee, category, notes, outflow, inflow: approves a needs-review row (11 §6 step 5). */
  approving: boolean;
}

export function changesOf(draft: EditableTransaction, original: EditableTransaction): EditChanges {
  const date = draft.date !== original.date;
  const amount = draft.amount !== original.amount;
  const account = draft.accountId !== original.accountId;
  const payee =
    draft.payeeText.trim() !== original.payeeText.trim() ||
    draft.transferAccountId !== original.transferAccountId;
  const category =
    draft.categoryId !== original.categoryId ||
    draft.split !== original.split ||
    !sameLines(draft.lines, original.lines);
  const notes = draft.notes.trim() !== original.notes.trim();
  const rest =
    draft.checkNumber.trim() !== original.checkNumber.trim() ||
    draft.cleared !== original.cleared ||
    draft.needsReview !== original.needsReview;
  return {
    any: date || amount || account || payee || category || notes || rest,
    date,
    amount,
    account,
    payee,
    category,
    notes,
    approving: date || amount || payee || category || notes,
  };
}

/** A new transaction with nothing typed: saving just closes the editor (11 §1 step 3). */
export const isBlankNew = (e: EditableTransaction): boolean =>
  e.id === null &&
  e.checkNumber.trim() === '' &&
  e.payeeText.trim() === '' &&
  e.categoryId === null &&
  !e.split &&
  e.notes.trim() === '' &&
  e.amount === 0;

/** The editor's state to the host's commit parameters (11 §6 step 6). */
export function toCommit(
  e: EditableTransaction,
  payees: readonly Payee[],
  clearOtherSide: boolean,
): CommitEdit {
  const payee = payeeRefOf(e, payees);
  const check = e.checkNumber.trim();
  return {
    ...(e.id === null ? {} : { id: e.id }),
    accountId: e.accountId,
    date: e.date,
    amount: e.amount,
    payee,
    categoryId: e.split ? null : e.categoryId,
    notes: e.notes.trim(),
    checkNumber: check === '' ? null : check,
    needsReview: e.needsReview,
    cleared: e.cleared,
    ...(e.split
      ? {
          lines: linesOf(e),
        }
      : {}),
    ...(clearOtherSide ? { clearOtherSide: true } : {}),
  };
}

/** The payee a commit or a schedule save names (11 §6 step 6): a transfer, none, existing or new. */
export function payeeRefOf(e: EditableTransaction, payees: readonly Payee[]): PayeeRef {
  const name = e.payeeText.trim();
  if (e.transferAccountId) return { kind: 'transfer', accountId: e.transferAccountId };
  if (name === '') return { kind: 'none' };
  const found =
    (e.payeeId ? payees.find((p) => p.id === e.payeeId && p.name === name) : undefined) ??
    payees.find(
      (p) => !p.transferAccountId && p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
  return found ? { kind: 'existing', id: found.id } : { kind: 'new', name };
}

/** A split's lines as the host takes them. */
export function linesOf(e: EditableTransaction): NonNullable<CommitEdit['lines']> {
  return e.lines.map((l) => ({
    ...(l.id === null ? {} : { id: l.id }),
    amount: l.amount,
    transferAccountId: l.transferAccountId,
    categoryId: l.categoryId,
    notes: l.notes.trim(),
  }));
}

// --------------------------------------------------------------------------- payee text (11 §4.1)

export type PayeeResolution =
  | { kind: 'none' }
  | { kind: 'payee'; name: string; payee: Payee | null }
  | { kind: 'transfer'; account: Account }
  | { kind: 'invalidTransfer'; name: string };

/**
 * Resolves typed payee text: a transfer ("Transfer : X", whitespace- and case-insensitive), or a payee
 * normalized to an existing payee's stored capitalization ("kroger" → "Kroger").
 */
export function resolvePayee(
  text: string,
  prefixes: readonly string[],
  payees: readonly Payee[],
  accounts: readonly Account[],
): PayeeResolution {
  const t = text.trim();
  if (t === '') return { kind: 'none' };
  const accountName = transferAccountName(t, prefixes);
  if (accountName !== null) {
    const account = accounts.find(
      (a) => !a.closed && a.name.toLocaleLowerCase() === accountName.toLocaleLowerCase(),
    );
    return account ? { kind: 'transfer', account } : { kind: 'invalidTransfer', name: t };
  }
  const payee =
    payees.find(
      (p) => !p.transferAccountId && p.name.toLocaleLowerCase() === t.toLocaleLowerCase(),
    ) ?? null;
  return { kind: 'payee', name: payee?.name ?? t, payee };
}

// ------------------------------------------------------------------------ category text (11 §4.2)

export type CategoryResolution =
  | { kind: 'none' }
  | { kind: 'split' }
  | { kind: 'category'; id: Id; text: string }
  /** Not found: the Add New Category dialog, pre-filled. */
  | { kind: 'new'; groupName: string; name: string; isIncomeGroup: boolean };

/**
 * Resolves typed category text (11 §4.2): empty, the split item, "Group: Category" (Income: → the income
 * group), or a name looked up in display order. Hidden categories and groups count only when named
 * exactly with their group.
 */
export function resolveCategory(
  text: string,
  splitLabel: string,
  groups: readonly CategoryGroup[],
): CategoryResolution {
  const t = text.trim();
  if (t === '') return { kind: 'none' };
  if (t.toLocaleLowerCase() === splitLabel.toLocaleLowerCase()) return { kind: 'split' };
  const fold = (s: string): string => s.trim().toLocaleLowerCase();
  const ordered = [...groups.filter((g) => g.isIncome), ...groups.filter((g) => !g.isIncome)];
  const colon = t.indexOf(':');
  if (colon !== -1) {
    const groupName = t.slice(0, colon).trim();
    const name = t.slice(colon + 1).trim();
    const group = ordered.find((g) => fold(g.name) === fold(groupName));
    const category = group?.categories.find((c) => fold(c.name) === fold(name));
    if (group && category)
      return { kind: 'category', id: category.id, text: categoryLabel(group, category) };
    return {
      kind: 'new',
      groupName: group?.name ?? groupName,
      name,
      isIncomeGroup: group?.isIncome === true,
    };
  }
  for (const g of ordered) {
    if (g.hidden) continue;
    const c = g.categories.find((x) => !x.hidden && fold(x.name) === fold(t));
    if (c) return { kind: 'category', id: c.id, text: categoryLabel(g, c) };
  }
  return { kind: 'new', groupName: '', name: t, isIncomeGroup: false };
}
