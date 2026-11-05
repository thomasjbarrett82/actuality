// Actual rows → domain types (04 §2–3, §7). Pure, so read services and tests share it.
import { clearedState } from '@shared/domain/balances';
import { attention, lineState, splitState, type StateInput } from '@shared/domain/error-state';
import type {
  ErrorLevel,
  ISODate,
  SubTransaction,
  Transaction,
  TransferSide,
} from '@shared/domain/types';
import { decode, noteTags } from '@shared/metadata/notes-codec';
import type { RawAccount, RawPayee, RawRow, RawTransaction } from '../actual';

/** What converting transactions needs: accounts and payees by id, and the other sides of transfers. */
export interface ConvertContext {
  accounts: ReadonlyMap<string, RawAccount>;
  payees: ReadonlyMap<string, RawPayee>;
  /** Transfer counterparts by their own id. */
  sides: ReadonlyMap<string, RawRow>;
}

export function contextOf(
  accounts: readonly RawAccount[],
  payees: readonly RawPayee[],
  sides: readonly RawRow[] = [],
): ConvertContext {
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    payees: new Map(payees.map((p) => [p.id, p])),
    sides: new Map(sides.map((r) => [r.id, r])),
  };
}

/** The ids of every transfer counterpart the rows point to, parents and lines. */
export function counterpartIds(raws: readonly RawTransaction[]): string[] {
  const out: string[] = [];
  for (const r of raws) {
    if (r.transferId) out.push(r.transferId);
    for (const c of r.subtransactions) if (c.transferId) out.push(c.transferId);
  }
  return out;
}

function sideOf(ctx: ConvertContext, transferId: string | null): TransferSide | null {
  const row = transferId ? ctx.sides.get(transferId) : undefined;
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account,
    date: row.date as ISODate,
    cleared: clearedState(row.cleared, row.reconciled),
    isSplitLine: row.isChild,
  };
}

function transferOf(ctx: ConvertContext, payeeId: string | null): string | null {
  return payeeId ? (ctx.payees.get(payeeId)?.transferAcct ?? null) : null;
}

/** A transfer payee shows the target account's name; others their own (04 §2). */
function payeeName(ctx: ConvertContext, payeeId: string | null): string {
  if (!payeeId) return '';
  const payee = ctx.payees.get(payeeId);
  if (!payee) return '';
  if (payee.transferAcct) return ctx.accounts.get(payee.transferAcct)?.name ?? payee.name;
  return payee.name;
}

function stateInput(
  ctx: ConvertContext,
  accountId: string,
  row: { payee: string | null; category: string | null; amount: number; schedule: string | null },
  needsReview: boolean,
): StateInput {
  const target = transferOf(ctx, row.payee);
  return {
    onBudget: ctx.accounts.get(accountId)?.offbudget === false,
    transferTargetOnBudget: target ? ctx.accounts.get(target)?.offbudget === false : null,
    categoryId: row.category,
    amount: row.amount,
    needsReview,
    scheduleId: row.schedule,
  };
}

export function toTransaction(ctx: ConvertContext, raw: RawTransaction): Transaction {
  const meta = decode(raw.notes);
  const isSplit = raw.isParent || raw.subtransactions.length > 0;
  const lines = raw.subtransactions.map((child): SubTransaction => {
    const childMeta = decode(child.notes);
    const state = lineState(stateInput(ctx, raw.account, child, childMeta.needsReview));
    return {
      id: child.id,
      parentId: raw.id,
      amount: child.amount,
      payeeId: child.payee,
      transferAccountId: transferOf(ctx, child.payee),
      transferId: child.transferId,
      transferSide: sideOf(ctx, child.transferId),
      categoryId: child.category,
      notes: childMeta.notes,
      rawNotes: child.notes ?? '',
      errorLevel: state.level,
      errorMessage: state.message,
    };
  });
  const input = stateInput(ctx, raw.account, raw, meta.needsReview);
  const state = isSplit
    ? splitState(
        input,
        lines.map((l) => ({ level: l.errorLevel, message: l.errorMessage })),
      )
    : lineState(input);
  return {
    id: raw.id,
    accountId: raw.account,
    date: raw.date as ISODate,
    amount: raw.amount,
    payeeId: raw.payee,
    payeeName: payeeName(ctx, raw.payee),
    transferAccountId: transferOf(ctx, raw.payee),
    transferId: raw.transferId,
    transferSide: sideOf(ctx, raw.transferId),
    categoryId: isSplit ? null : raw.category,
    notes: meta.notes,
    checkNumber: meta.checkNumber,
    tags: noteTags(meta.notes),
    needsReview: meta.needsReview,
    cleared: clearedState(raw.cleared, raw.reconciled),
    importedId: raw.importedId,
    importedPayee: raw.importedPayee,
    scheduleId: raw.schedule,
    isStartingBalance: raw.startingBalance,
    subtransactions: lines,
    errorLevel: state.level,
    errorMessage: state.message,
    rawNotes: raw.notes ?? '',
  };
}

export function attentionOf(transactions: readonly Transaction[]): {
  count: number;
  maxLevel: ErrorLevel;
} {
  return attention(transactions.map((t) => t.errorLevel));
}
