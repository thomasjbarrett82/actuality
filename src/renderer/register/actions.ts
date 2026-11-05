// The register's transaction actions (10 §6, §8): cleared state, approve, Categorize As, delete with
// its warnings and the Undo notifier, Change Date, Move to account, and Match. The host does the writes;
// these run the dialogs around them.
import type { Account, Id, ISODate, Transaction, TransferSide } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { announce } from '../a11y/announcer';
import { escapeRichText } from '../components/common/rich-text';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { queryClient } from '../rpc/query-client';
import { showUnexpected } from '../session';
import { useDialogs } from '../stores/dialogs';
import { attempt, showOffline, tell, tr, trn } from './dialogs';
import { useRegisterSession, type UndoNotice } from './view-state';

/** The undo notifier's text (10 §5). */
export function undoText(n: UndoNotice): string {
  if (n.kind === 'dated') return trn('app.regDateChanged', n.count);
  return n.kind === 'deleted'
    ? n.count === 1
      ? tr('register.transactionDeleted')
      : tr('register.transactionsDeletedPlural', { count: n.count })
    : n.count === 1
      ? tr('register.transactionMoved', { account: n.account ?? '' })
      : tr('register.transactionsMovedPlural', { count: n.count, account: n.account ?? '' });
}

function notify(notice: UndoNotice | null): void {
  useRegisterSession().state.undo = notice;
  if (notice) announce(`${undoText(notice)}. ${tr('a11y.undoAvailable')}`);
}

/** Mark as Cleared / Uncleared (10 §6.1, §6.4): Reconciled rows never change. */
export async function setCleared(rows: readonly Transaction[], state: 'U' | 'C'): Promise<boolean> {
  const ids = rows.filter((t) => t.cleared !== 'R').map((t) => t.id);
  if (ids.length === 0) return true;
  return (await attempt(() => host.call('transactions.setCleared', { ids, state }))).ok;
}

/**
 * The cleared cell (10 §6.4): one row toggles; with several, all non-reconciled Cleared → Uncleared, else
 * Cleared (which also approves).
 */
export async function toggleCleared(rows: readonly Transaction[]): Promise<boolean> {
  const open = rows.filter((t) => t.cleared !== 'R');
  if (open.length === 0) return true;
  const allCleared = open.every((t) => t.cleared === 'C');
  return setCleared(open, allCleared ? 'U' : 'C');
}

export async function approve(rows: readonly Transaction[]): Promise<boolean> {
  const ids = rows.filter((t) => t.needsReview).map((t) => t.id);
  if (ids.length === 0) return true;
  return (await attempt(() => host.call('transactions.approve', { ids }))).ok;
}

/**
 * Categorize As (10 §6.1): split transactions are skipped after a warning; on↔on transfers are skipped
 * silently by the host.
 */
export async function categorizeAs(
  rows: readonly Transaction[],
  categoryId: Id | null,
): Promise<boolean> {
  const splits = rows.filter((t) => t.subtransactions.length > 0);
  if (splits.length > 0) {
    const { button } = await useDialogs().showTaskDialog({
      instruction: tr('app.regSplitSkipTitle'),
      content: tr('app.regSplitSkipMessage', { n: splits.length }),
      icon: 'warning',
      buttons: [
        'cancel',
        { id: 'continue', label: tr('app.regContinueCategorizing'), isDefault: true },
      ],
    });
    if (button !== 'continue') return false;
  }
  const ids = rows.filter((t) => t.subtransactions.length === 0).map((t) => t.id);
  if (ids.length === 0) return true;
  return (await attempt(() => host.call('transactions.categorize', { ids, categoryId }))).ok;
}

/** Sets the category on transactions or split lines directly (the error popovers, 10 §6.3). */
export async function setCategory(ids: readonly Id[], categoryId: Id | null): Promise<boolean> {
  if (ids.length === 0) return true;
  return (await attempt(() => host.call('transactions.categorize', { ids: [...ids], categoryId })))
    .ok;
}

const hasTransfer = (t: Transaction): boolean =>
  t.transferAccountId !== null || t.subtransactions.some((l) => l.transferAccountId !== null);
const otherSideReconciled = (t: Transaction): boolean =>
  t.transferSide?.cleared === 'R' || t.subtransactions.some((l) => l.transferSide?.cleared === 'R');
/** The transfer side a split line elsewhere created: changed only from its split (10 §6.1, §8). */
export const fromSplit = (t: Transaction): boolean => t.transferSide?.isSplitLine === true;

/** The delete confirmation's messages (10 §8), in order; empty when there's nothing to warn about. */
export function deleteWarnings(rows: readonly Transaction[]): string[] {
  const out: string[] = [];
  const reconciled = rows.filter((t) => t.cleared === 'R').length;
  if (reconciled > 0)
    out.push(`${trn('app.regDeleteReconciled', reconciled)} ${tr('app.regDeleteReconciledTail')}`);
  const other = rows.filter((t) => !fromSplit(t) && otherSideReconciled(t)).length;
  if (other > 0)
    out.push(
      `${trn('app.regDeleteOtherReconciled', other)} ${tr('app.regDeleteOtherReconciledTail')}`,
    );
  const splitLines = rows.filter(fromSplit).length;
  if (splitLines > 0) out.push(trn('app.regDeleteSplitTransfer', splitLines));
  const transfers = rows.filter((t) => !fromSplit(t) && hasTransfer(t)).length;
  if (transfers > 0)
    out.push(`${trn('app.regDeleteTransfer', transfers)} ${tr('app.regDeleteTransferTail')}`);
  return out;
}

/**
 * Delete (10 §8): a confirmation only when there's something to warn about, then the delete and the Undo
 * notifier. Resolves with the number deleted (0 when cancelled or failed).
 */
export async function deleteTransactions(rows: readonly Transaction[]): Promise<number> {
  if (rows.length === 0) return 0;
  const dialogs = useDialogs();
  if (rows.every(fromSplit)) {
    await dialogs.showTaskDialog({
      instruction: tr('app.regCouldNotDelete'),
      content: tr('app.regDeleteAllSplitTransfer'),
      icon: 'warning',
      buttons: ['close'],
    });
    return 0;
  }
  const warnings = deleteWarnings(rows);
  if (warnings.length > 0) {
    const n = rows.length;
    const { button } = await dialogs.showTaskDialog({
      instruction: trn('app.regDeleteTitle', n),
      content: warnings.join('\n\n'),
      icon: 'warning',
      buttons: [
        'cancel',
        { id: 'delete', label: trn('app.regDeleteTransactions', n), isDefault: true },
      ],
    });
    if (button !== 'delete') return 0;
  }
  const ids = rows.filter((t) => !fromSplit(t)).map((t) => t.id);
  const result = await attempt(() => host.call('transactions.delete', { ids }));
  if (!result.ok) return 0;
  const { token, count } = result.value;
  notify(token ? { token, kind: 'deleted', count } : null);
  return count;
}

/**
 * Move to account (10 §6.1): refused when any is (or contains) a transfer into the target, is a transfer a
 * split elsewhere created, or more than one is reconciled; one reconciled row asks first.
 */
export async function moveToAccount(
  rows: readonly Transaction[],
  target: Account,
): Promise<number> {
  if (rows.length === 0) return 0;
  const name = target.name;
  const blocked = async (content: string): Promise<number> => {
    await tell(tr('app.regMoveBlockedTitle', { account: name }), content);
    return 0;
  };
  const intoTarget = rows.some(
    (t) =>
      t.transferAccountId === target.id ||
      t.subtransactions.some((l) => l.transferAccountId === target.id),
  );
  if (intoTarget)
    return blocked(tr('app.regMoveBlockedTransfer', { account: escapeRichText(name) }));
  if (rows.some(fromSplit)) return blocked(tr('app.regMoveBlockedSplitTransfer'));
  const reconciled = rows.filter((t) => t.cleared === 'R').length;
  if (reconciled > 1) return blocked(tr('app.regMoveBlockedReconciled'));
  if (reconciled === 1 && !(await confirmReconciled(tr('app.regMoveReconciledMessage')))) return 0;
  const result = await attempt(() =>
    host.call('transactions.moveToAccount', { ids: rows.map((t) => t.id), accountId: target.id }),
  );
  if (!result.ok) return 0;
  const { token, count } = result.value;
  notify(token ? { token, kind: 'moved', count, account: name } : null);
  return count;
}

/** What Change Date… needs: the budget's dates (19 §1), and accounts for their last reconciliation. */
export interface ChangeDateContext {
  today: ISODate;
  dateFormat: string;
  accounts: readonly Account[];
}

/** The reconciled-transaction question Change Date… and Move to account ask (10 §6.1, 11 §6). */
async function confirmReconciled(
  content: string,
  footer = tr('app.regReconciledFooter'),
): Promise<boolean> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: tr('app.regReconciledTitle'),
    content,
    footer,
    icon: 'warning',
    buttons: [
      { id: 'yes', label: tr('app.regYesMakeChange') },
      { id: 'no', label: tr('app.regNoCancelChange'), isDefault: true },
    ],
  });
  return button === 'yes';
}

/**
 * Change Date… (10 §6.1, X25): one date on every selected transaction. More than one reconciled blocks it;
 * exactly one asks the editor's question first, and so does a reconciled other side (11 §6 step 2).
 * Resolves with the ids changed (empty when cancelled or failed).
 */
export async function changeDate(
  rows: readonly Transaction[],
  dates: ChangeDateContext,
): Promise<Id[]> {
  if (rows.length < 2) return [];
  const reconciled = rows.filter((t) => t.cleared === 'R').length;
  if (reconciled > 1) {
    await tell(tr('app.regChangeDateBlockedTitle'), tr('app.regChangeDateBlockedReconciled'));
    return [];
  }
  const { button, date } = await useDialogs().showTaskDialog({
    instruction: tr('app.regChangeDateTitle', { n: rows.length }),
    icon: 'info',
    dateField: {
      label: tr('register.columnDate'),
      placeholder: dateShort(dates.today, dates.dateFormat),
      dateFormat: dates.dateFormat,
      today: dates.today,
      requiredBy: 'change',
    },
    buttons: [{ id: 'change', label: tr('app.regChangeDateButton'), isDefault: true }, 'cancel'],
  });
  if (button !== 'change' || !date) return [];
  const own = rows.find((t) => t.cleared === 'R');
  if (own && !(await confirmReconciled(tr('app.editReconciledDateMessage')))) return [];
  const ids = rows.map((t) => t.id);
  const selected = new Set(ids);
  const reconciledSides = (t: Transaction): TransferSide[] =>
    [t.transferSide, ...t.subtransactions.map((l) => l.transferSide)].flatMap((s) =>
      s?.cleared === 'R' && !selected.has(s.id) ? [s] : [],
    );
  // The reconciled transaction's own other sides follow it without a second question, as in the editor.
  if (
    rows.some((t) => t !== own && reconciledSides(t).length > 0) &&
    !(await confirmReconciled(
      tr('app.editOtherReconciledDate'),
      tr('app.regTransferReconciledFooter'),
    ))
  )
    return [];
  // As in the editor: a reconciled transaction or other side becomes Cleared when the new date is after
  // its account's last reconciliation.
  const afterReconciliation = (accountId: Id): boolean => {
    const last = dates.accounts.find((a) => a.id === accountId)?.lastReconciledDate ?? null;
    return last !== null && date > last;
  };
  const clearReconciled = [
    ...(own && afterReconciliation(own.accountId) ? [own.id] : []),
    ...rows
      .flatMap(reconciledSides)
      .filter((s) => afterReconciliation(s.accountId))
      .map((s) => s.id),
  ];
  const result = await attempt(async () => {
    try {
      return await host.call('transactions.setDate', {
        ids,
        date,
        ...(clearReconciled.length > 0 ? { clearReconciled } : {}),
      });
    } catch (e) {
      if (errorInfo(e).detail !== 'partial-change') throw e;
      await tell(
        tr('app.somethingWentWrong'),
        tr('app.regChangeDatePartial', { n: ids.length }),
        'error',
      );
      // Reported: don't show the generic error on top, but refresh what the register shows.
      await queryClient.invalidateQueries({ queryKey: ['register'] });
      return null;
    }
  });
  if (!result.ok || !result.value) return [];
  const { token, count } = result.value;
  notify(token ? { token, kind: 'dated', count } : null);
  return ids;
}

/** The Undo notifier (10 §5, §8): resolves with the re-created ids (old → new). */
export async function undo(): Promise<Record<Id, Id> | null> {
  const session = useRegisterSession();
  const notice = session.state.undo;
  if (!notice) return null;
  // Hidden while it runs, so a second press can't send the token again.
  session.state.undo = null;
  try {
    return (await host.call('transactions.undo', { token: notice.token })).ids;
  } catch (e) {
    const offline = errorInfo(e).code === 'offline';
    if (offline) await showOffline();
    else await showUnexpected(e);
    // Refused offline, the host keeps the token: the notifier comes back so the user can retry,
    // unless a newer change has its own by now.
    const current = useRegisterSession().state;
    if (offline && !current.undo) current.undo = notice;
    return null;
  }
}

/** Any mouse-down elsewhere, navigation or a new edit discards the undo token (10 §5). */
export function dismissUndo(): void {
  useRegisterSession().state.undo = null;
}

/** Match (10 §6.1, X4): merges two transactions after a confirmation. Resolves with the kept id. */
export async function merge(a: Transaction, b: Transaction): Promise<Id | null> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: tr('app.regMergeTitle'),
    content: tr('app.regMergeMessage'),
    icon: 'warning',
    buttons: [{ id: 'merge', label: tr('app.regMergeButton'), isDefault: true }, 'cancel'],
  });
  if (button !== 'merge') return null;
  const result = await attempt(() => host.call('transactions.merge', { a: a.id, b: b.id }));
  return result.ok ? result.value.id : null;
}

/** Match is offered for exactly two in the same account with the same amount (10 §6.1). */
export const canMatch = (rows: readonly Transaction[]): boolean =>
  rows.length === 2 &&
  rows[0]?.accountId === rows[1]?.accountId &&
  rows[0]?.amount === rows[1]?.amount;
