// The register's row models (10 §2): the display texts of each transaction and split line, and what the
// sort (10 §2) and the search (10 §4) read from them. Built once per data load, not per render.
import { categoryIndex, categoryLabel } from '@shared/domain/categories';
import type { SortRow } from '@shared/domain/register';
import type {
  Account,
  Category,
  CategoryGroup,
  Id,
  SubTransaction,
  Transaction,
} from '@shared/domain/types';
import { noteTags } from '@shared/metadata/notes-codec';
import type { SearchLine, SearchRow, TransferKind } from '@shared/search/match';

/** How the category cell reads (10 §2.2). */
export type CategoryKind = 'category' | 'split' | 'notNeeded' | 'none' | 'offBudget';

export interface LineView {
  line: SubTransaction;
  /** "Transfer : {account}" for a transfer line, '' otherwise. */
  transferText: string;
  categoryText: string;
  categoryKind: CategoryKind;
  isIncome: boolean;
  transferKind: TransferKind;
  search: SearchLine;
}

export interface RowView {
  t: Transaction;
  account: Account | undefined;
  accountName: string;
  payeeText: string;
  categoryText: string;
  categoryKind: CategoryKind;
  isIncome: boolean;
  transferKind: TransferKind;
  /** The other account of a transfer. */
  transferAccount: Account | undefined;
  lines: LineView[];
  search: SearchRow;
  sort: SortRow;
}

export interface RowTexts {
  /** "Transfer : {account}". */
  transfer: (account: string) => string;
  /** "Split (Multiple Categories)...". */
  split: string;
  /** "(Category not needed)". */
  notNeeded: string;
}

export interface RowContext {
  accounts: ReadonlyMap<Id, Account>;
  categories: ReadonlyMap<Id, { category: Category; group: CategoryGroup }>;
  texts: RowTexts;
}

export function rowContext(
  accounts: readonly Account[],
  groups: readonly CategoryGroup[],
  texts: RowTexts,
): RowContext {
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    categories: categoryIndex(groups),
    texts,
  };
}

export function transferKindOf(
  own: Account | undefined,
  target: Account | undefined,
): TransferKind {
  if (!own || !target) return 'none';
  if (own.onBudget && target.onBudget) return 'onOn';
  if (!own.onBudget && !target.onBudget) return 'offOff';
  return 'onOff';
}

function categoryCell(
  ctx: RowContext,
  own: Account | undefined,
  categoryId: Id | null,
  transfer: TransferKind,
  split: boolean,
): { text: string; kind: CategoryKind; isIncome: boolean } {
  if (own && !own.onBudget) return { text: '', kind: 'offBudget', isIncome: false };
  if (split) return { text: ctx.texts.split, kind: 'split', isIncome: false };
  const found = categoryId ? ctx.categories.get(categoryId) : undefined;
  if (found)
    return {
      text: categoryLabel(found.group, found.category),
      kind: 'category',
      isIncome: found.group.isIncome,
    };
  if (transfer === 'onOn') return { text: ctx.texts.notNeeded, kind: 'notNeeded', isIncome: false };
  return { text: '', kind: 'none', isIncome: false };
}

function lineView(ctx: RowContext, own: Account | undefined, l: SubTransaction): LineView {
  const target = l.transferAccountId ? ctx.accounts.get(l.transferAccountId) : undefined;
  const transferKind = transferKindOf(own, target);
  const transferText = target ? ctx.texts.transfer(target.name) : '';
  const cat = categoryCell(ctx, own, l.categoryId, transferKind, false);
  return {
    line: l,
    transferText,
    categoryText: cat.text,
    categoryKind: cat.kind,
    isIncome: cat.isIncome,
    transferKind,
    search: {
      transferText,
      categoryText: cat.kind === 'category' ? cat.text : '',
      categoryId: l.categoryId,
      notes: l.notes,
      tags: noteTags(l.notes),
      amount: l.amount,
      isIncome: cat.isIncome,
      transferKind,
      errorLevel: l.errorLevel,
    },
  };
}

export function rowView(ctx: RowContext, t: Transaction): RowView {
  const own = ctx.accounts.get(t.accountId);
  const target = t.transferAccountId ? ctx.accounts.get(t.transferAccountId) : undefined;
  const transferKind = transferKindOf(own, target);
  const split = t.subtransactions.length > 0;
  const payeeText = target ? ctx.texts.transfer(target.name) : t.payeeName;
  const cat = categoryCell(ctx, own, t.categoryId, transferKind, split);
  const lines = t.subtransactions.map((l) => lineView(ctx, own, l));
  const accountName = own?.name ?? '';
  return {
    t,
    account: own,
    accountName,
    payeeText,
    categoryText: cat.text,
    categoryKind: cat.kind,
    isIncome: cat.isIncome,
    transferKind,
    transferAccount: target,
    lines,
    search: {
      date: t.date,
      amount: t.amount,
      payeeText,
      categoryText: cat.kind === 'category' || cat.kind === 'split' ? cat.text : '',
      categoryId: t.categoryId,
      notes: t.notes,
      checkNumber: t.checkNumber,
      accountName,
      accountOnBudget: own?.onBudget ?? false,
      accountClosed: own?.closed ?? false,
      tags: t.tags,
      needsReview: t.needsReview,
      errorLevel: t.errorLevel,
      cleared: t.cleared,
      isIncome: cat.isIncome,
      transferKind,
      lines: lines.map((l) => l.search),
    },
    sort: {
      id: t.id,
      date: t.date,
      amount: t.amount,
      checkNumber: t.checkNumber,
      payeeText,
      categoryText: cat.text,
      notes: t.notes,
      accountName,
      cleared: t.cleared,
      errorLevel: t.errorLevel,
    },
  };
}

export function buildRows(ctx: RowContext, transactions: readonly Transaction[]): RowView[] {
  return transactions.map((t) => rowView(ctx, t));
}
