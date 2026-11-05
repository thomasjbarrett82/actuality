// The commit pipeline's interactive steps (11 §6), run before the host's write job: the can-edit pre-check,
// the reconciled warnings, the split rules and the unassigned-amount dialog, the payee rename prompt, and
// approval. Then `transactions.commit` writes it, and a chosen bulk rename follows.
import { distribute, finalizeSplit, isEmptyLine, remainingOf } from '@shared/domain/splits';
import type { Account, CategoryGroup, Id, Payee, Transaction } from '@shared/domain/types';
import type { MoneySettings } from '@shared/money';
import type { CommitResult } from '@shared/rpc/host-api';
import { escapeRichText } from '../components/common/rich-text';
import { moneyText } from '../money-display';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { showUnexpected } from '../session';
import { useDialogs } from '../stores/dialogs';
import { showOffline, tr } from './dialogs';
import { changesOf, emptyLine, toCommit, type EditableTransaction } from './editable';

export interface CommitContext {
  accounts: readonly Account[];
  payees: readonly Payee[];
  groups: readonly CategoryGroup[];
  canEdit: boolean;
  money: MoneySettings;
  /** The stored transaction and its editor form; null for a new one. */
  original: { t: Transaction; edit: EditableTransaction } | null;
  /** Category label for the rename prompt's "Rename and categorize". */
  categoryText: (id: Id | null) => string;
}

export type CommitOutcome =
  /**
   * Written. `incomeOutflow`: show the "Just Checking..." callout (11 §6 step 8). `matched`: Actual's
   * rules linked it to a schedule (12 §2), for the editor's notifier.
   */
  | { status: 'saved'; id: Id; incomeOutflow: boolean; matched?: CommitResult['matched'] }
  /** Not written; the editor stays open with the user's input. */
  | { status: 'keep' }
  /** "No, cancel this change": the whole edit is cancelled (11 §6 step 2). */
  | { status: 'cancel' };

const money = (m: number, s: MoneySettings): string => moneyText(m, s, { symbol: true });

/** Step 2: "Yes, make this change" (true) or "No, cancel this change" (false, the default). */
async function confirmReconciled(content: string, footer: string): Promise<boolean> {
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

const after = (date: string, reconciled: string | null): boolean =>
  reconciled !== null && date > reconciled;

/** What the reconciled warnings decided: which sides the write makes Cleared. */
interface ReconciledChoice {
  clearSelf: boolean;
  clearOtherSide: boolean;
}

/**
 * Step 2, the reconciled warnings. Returns null when the edit is cancelled, else which sides become
 * Cleared. The draft isn't changed: a later step can still keep the editor open, and the user may then
 * undo the edit.
 */
async function reconciledWarnings(
  draft: EditableTransaction,
  ctx: CommitContext,
): Promise<ReconciledChoice | null> {
  const none = { clearSelf: false, clearOtherSide: false };
  if (!ctx.original) return none;
  const { t, edit } = ctx.original;
  const ch = changesOf(draft, edit);
  const account = ctx.accounts.find((a) => a.id === draft.accountId);
  const side = t.transferSide;
  const otherAccount = side ? ctx.accounts.find((a) => a.id === side.accountId) : undefined;
  const otherAfter = after(draft.date, otherAccount?.lastReconciledDate ?? null);
  if (t.cleared === 'R' && (ch.date || ch.amount || ch.account)) {
    const message =
      ch.amount || ch.account ? 'app.editReconciledMessage' : 'app.editReconciledDateMessage';
    if (!(await confirmReconciled(tr(message), tr('app.regReconciledFooter')))) return null;
    return {
      clearSelf: ch.account || after(draft.date, account?.lastReconciledDate ?? null),
      clearOtherSide: side?.cleared === 'R' && otherAfter,
    };
  }
  if (side?.cleared === 'R' && (ch.date || ch.amount || ch.account)) {
    const message = ch.amount ? 'app.editOtherReconciledAmount' : 'app.editOtherReconciledDate';
    if (!(await confirmReconciled(tr(message), tr('app.regTransferReconciledFooter')))) return null;
    return { clearSelf: false, clearOtherSide: otherAfter };
  }
  if (side?.cleared === 'R' && ch.payee) {
    if (
      !(await confirmReconciled(
        tr('app.editOtherReconciledPayee'),
        tr('app.regTransferReconciledFooter'),
      ))
    )
      return null;
    return { clearSelf: false, clearOtherSide: true };
  }
  return none;
}

/** Step 3, the split rules (11 §7.3). False keeps the editor open. */
export async function applySplitRules(
  draft: EditableTransaction,
  ctx: Pick<CommitContext, 'categoryText' | 'money'>,
): Promise<boolean> {
  if (!draft.split) return true;
  const outcome = finalizeSplit(
    { hasPayee: draft.payeeText.trim() !== '', notes: draft.notes, amount: draft.amount },
    draft.lines,
  );
  if (outcome.kind === 'none') {
    draft.split = false;
    draft.lines = [];
    draft.categoryId = null;
    draft.categoryText = '';
    return true;
  }
  if (outcome.kind === 'collapse') {
    const line = draft.lines.find((l) => !isEmptyLine(l));
    draft.split = false;
    draft.lines = [];
    if (outcome.transferAccountId && line) {
      draft.transferAccountId = outcome.transferAccountId;
      draft.payeeText = line.payeeText;
      draft.payeeId = null;
    }
    draft.categoryId = outcome.categoryId;
    draft.categoryText = ctx.categoryText(outcome.categoryId);
    draft.notes = outcome.notes;
    draft.amount = outcome.amount;
    return true;
  }
  // The kept lines are the draft's own objects.
  draft.lines = draft.lines.filter((l) => outcome.lines.includes(l));
  const remaining = remainingOf(draft.amount, draft.lines);
  if (remaining === 0) return true;
  const sum = draft.amount - remaining;
  const { button } = await useDialogs().showTaskDialog({
    instruction: tr('app.splitUnassignedTitle', { remaining: money(remaining, ctx.money) }),
    content: tr('app.splitUnassignedMessage', {
      total: money(draft.amount, ctx.money),
      sum: money(sum, ctx.money),
      remaining: money(remaining, ctx.money),
    }),
    icon: 'warning',
    buttons: ['cancel'],
    commandLinks: [
      {
        id: 'manual',
        title: tr('app.splitManual'),
        subLabel: tr('app.splitManualHint'),
        isDefault: true,
      },
      {
        id: 'distribute',
        title: tr('app.splitDistribute'),
        subLabel: tr('app.splitDistributeHint', { remaining: money(remaining, ctx.money) }),
      },
      {
        id: 'adjust',
        title: tr('app.splitAdjustOriginal'),
        subLabel: tr('app.splitAdjustOriginalHint', { sum: money(sum, ctx.money) }),
      },
    ],
  });
  if (button === 'distribute') {
    const amounts = distribute(remaining, draft.lines);
    draft.lines = draft.lines.map((l, i) => ({ ...l, amount: amounts[i] ?? l.amount }));
    return true;
  }
  if (button === 'adjust') {
    draft.amount = sum;
    return true;
  }
  return false;
}

/** What the rename prompt decided (11 §8), applied after the write. */
interface RenameChoice {
  fromId: Id;
  toName: string;
  transferAccountId: Id | null;
  rename: boolean;
  categoryId: Id | null;
  disable: boolean;
}

/** Step 4, the payee rename prompt. Null aborts the commit (Cancel). */
async function renamePrompt(
  draft: EditableTransaction,
  ctx: CommitContext,
  approving: boolean,
): Promise<RenameChoice | 'none' | null> {
  if (!ctx.original) return 'none';
  const { t, edit } = ctx.original;
  const q = draft.payeeText.trim();
  if (q === '') return 'none';
  const fold = (s: string): string => s.trim().toLocaleLowerCase();
  let p: Payee | undefined;
  if (fold(q) !== fold(edit.payeeText)) {
    p = edit.payeeId ? ctx.payees.find((x) => x.id === edit.payeeId) : undefined;
  } else if (approving && t.importedPayee && fold(t.importedPayee) !== fold(q)) {
    p = ctx.payees.find(
      (x) => !x.transferAccountId && fold(x.name) === fold(t.importedPayee ?? ''),
    );
  }
  if (!p || p.transferAccountId || !p.enabled) return 'none';
  const transferAccountId = draft.transferAccountId;
  const impact = await host.call('payees.renameImpact', {
    id: p.id,
    ...(transferAccountId ? { transferAccountId } : {}),
    ...(draft.id ? { excludeId: draft.id } : {}),
  });
  const n = transferAccountId ? impact.renameable : impact.total;
  const base = { fromId: p.id, toName: q, transferAccountId, disable: false };
  if (n === 0) return { ...base, rename: true, categoryId: null };
  const categorized = !draft.split && draft.categoryId !== null;
  const offerCategorize = categorized && impact.uncategorized > 0;
  const links = offerCategorize
    ? [
        {
          id: 'categorize',
          title: tr('app.renameAndCategorize'),
          subLabel: tr('app.renameAndCategorizeHint', {
            n,
            payee: q,
            k: impact.uncategorized,
            category: ctx.categoryText(draft.categoryId),
          }),
          isDefault: true,
        },
        {
          id: 'rename',
          title: tr('app.renameJust'),
          subLabel: tr('app.renameJustHint', { n, payee: q }),
        },
      ]
    : [
        {
          id: 'rename',
          title: tr('app.renameThem'),
          subLabel: tr(categorized ? 'app.renameThemHintDot' : 'app.renameThemHint', {
            n,
            payee: q,
          }),
          isDefault: true,
        },
      ];
  const { button, checkboxChecked } = await useDialogs().showTaskDialog({
    instruction: tr('app.renamePromptTitle'),
    content: tr('app.renamePromptMessage', { n, payee: escapeRichText(p.name) }),
    icon: 'info',
    commandLinks: [
      ...links,
      { id: 'leave', title: tr('app.renameLeave'), subLabel: tr('app.renameLeaveHint') },
    ],
    checkbox: { text: tr('app.renameDontAsk') },
    buttons: ['cancel'],
  });
  if (button === null || button === 'cancel') return null;
  return {
    ...base,
    rename: button === 'rename' || button === 'categorize',
    categoryId: button === 'categorize' ? draft.categoryId : null,
    disable: checkboxChecked,
  };
}

/**
 * Runs the pipeline on `draft` (changed in place: approval and split rules). `approve`: an Approve button
 * was pressed.
 */
export async function runCommit(
  draft: EditableTransaction,
  ctx: CommitContext,
  opts: { approve?: boolean } = {},
): Promise<CommitOutcome> {
  // 1. Can edit? (03 §5.3) The host's gate is the real check.
  if (!ctx.canEdit) {
    await showOffline();
    return { status: 'keep' };
  }
  // 3. Splits, before step 2: "Adjust original transaction" and a collapse can change the amount.
  if (!(await applySplitRules(draft, ctx))) return { status: 'keep' };
  // 2. Reconciled warnings, on the amount the write will send.
  const reconciled = await reconciledWarnings(draft, ctx);
  if (reconciled === null) return { status: 'cancel' };
  // 5 (decided before 4, which needs to know): unapproved → approved.
  const approving =
    opts.approve === true ||
    (ctx.original !== null && draft.needsReview && changesOf(draft, ctx.original.edit).approving);
  // 4. Payee rename prompt.
  let rename: RenameChoice | 'none' | null;
  try {
    rename = await renamePrompt(draft, ctx, approving);
  } catch (e) {
    await reportWriteError(e);
    return { status: 'keep' };
  }
  if (rename === null) return { status: 'keep' };
  if (approving) draft.needsReview = false;
  // 6. Write.
  let id: Id;
  let matched: CommitResult['matched'];
  try {
    ({ id, matched } = await host.call(
      'transactions.commit',
      toCommit(
        reconciled.clearSelf ? { ...draft, cleared: 'C' } : draft,
        ctx.payees,
        reconciled.clearOtherSide,
      ),
    ));
  } catch (e) {
    await reportWriteError(e);
    return { status: 'keep' };
  }
  if (rename !== 'none') {
    try {
      if (rename.rename)
        await host.call('payees.rename', {
          id: rename.fromId,
          name: rename.toName,
          ...(rename.transferAccountId ? { transferAccountId: rename.transferAccountId } : {}),
          ...(rename.categoryId ? { categoryId: rename.categoryId } : {}),
        });
      if (rename.disable)
        await host.call('payees.setEnabled', { ids: [rename.fromId], enabled: false });
    } catch (e) {
      await reportWriteError(e);
    }
  }
  // 8. Income entered as outflow.
  const income =
    !draft.split &&
    draft.categoryId !== null &&
    ctx.groups.some((g) => g.isIncome && g.categories.some((c) => c.id === draft.categoryId));
  return { status: 'saved', id, incomeOutflow: income && draft.amount < 0, matched };
}

export async function reportWriteError(e: unknown): Promise<void> {
  if (errorInfo(e).code === 'offline') await showOffline();
  else await showUnexpected(e);
}

/** A fresh split's first two lines (11 §7.1). */
export const initialLines = (): ReturnType<typeof emptyLine>[] => [emptyLine(), emptyLine()];
