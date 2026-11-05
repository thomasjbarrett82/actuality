// File ▸ Wipe the Slate Clean… (18 §2): the dialog, the "Are you sure?" step with the number of
// transactions, `slateWipe.run` under the "Wiping the slate clean" overlay with the deletion progress, and
// the completion or error dialog. A slate wipe a host crash interrupted is reported after the reopen.
import { canEdit } from '@shared/connection';
import { monthOf, monthRange, today } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { safeFileName } from '@shared/export/export-format';
import { monthHeader } from '@shared/format';
import SlateWipeDialog from '../components/budget-file/SlateWipeDialog.vue';
import { escapeRichText } from '../components/common/rich-text';
import { dateLocale } from '../i18n';
import { tr } from '../register/dialogs';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useLoadingOverlay } from '../stores/loading';
import { useModals } from '../stores/modals';

export interface SlateWipeChoice {
  backupPath: string;
  /** null: ALL DATES. */
  cutoffMonth: Month | null;
}

/** The cutoff combo's months: the current one back to the first month with data (18 §2). */
export function cutoffMonths(current: Month, first: Month | null): Month[] {
  return first === null || first >= current ? [current] : monthRange(first, current).reverse();
}

/** The Error dialog (18 §2), with the backup path when data may already have been deleted. */
export async function slateWipeError(
  message: string,
  partial: boolean,
  backupPath: string,
): Promise<void> {
  const content =
    escapeRichText(tr('app.swErrorMessage', { message })) +
    (partial ? tr('app.swErrorPartial', { path: escapeRichText(backupPath) }) : '');
  await useDialogs().showTaskDialog({
    instruction: tr('app.swErrorTitle'),
    content,
    icon: 'error',
    buttons: ['close'],
  });
}

export async function wipeSlateClean(): Promise<void> {
  const connection = useConnection();
  const budget = connection.info.budget;
  if (!budget || !canEdit(connection.info.state)) return;
  const now = today(new Date());
  const all = await host.call('slateWipe.impact', { cutoffMonth: null });
  const backupPath = await window.app.shell.files.defaultPath(
    safeFileName(tr('app.swBackupName', { budget: budget.name, date: now })),
  );
  const choice = await useModals().open<SlateWipeChoice>(SlateWipeDialog, {
    backupPath,
    months: cutoffMonths(monthOf(now), all.firstMonth),
  });
  if (!choice) return;
  const { cutoffMonth } = choice;
  const n =
    cutoffMonth === null
      ? all.transactions
      : (await host.call('slateWipe.impact', { cutoffMonth })).transactions;
  const cutoffText = cutoffMonth === null ? '' : monthHeader(cutoffMonth, dateLocale.value);
  const confirm = await useDialogs().showTaskDialog({
    instruction: tr('app.swConfirmTitle'),
    content:
      cutoffMonth === null
        ? tr('app.swConfirmMessage', { n })
        : tr('app.swConfirmMessageBefore', { n, cutoff: cutoffText }),
    icon: 'warning',
    buttons: [{ id: 'go', label: tr('app.swWipe'), isDefault: true }, 'cancel'],
  });
  if (confirm.button !== 'go') return;

  const overlay = useLoadingOverlay();
  const offProgress = host.on('job:progress', (p) => {
    if (p.label === 'slateWipe.delete')
      overlay.update(tr('app.swDeleting', { done: p.done, total: p.total }));
  });
  try {
    await overlay.during(
      tr('app.swWiping'),
      host.call('slateWipe.run', {
        cutoffMonth,
        backupPath: choice.backupPath,
        texts: { startingBalancePayee: tr('app.swStartingBalance') },
      }),
    );
  } catch (e) {
    const details = (e as { details?: { slateWipe?: { partial?: unknown } } }).details;
    await slateWipeError(
      errorInfo(e).message,
      details?.slateWipe?.partial === true,
      choice.backupPath,
    );
    return;
  } finally {
    offProgress();
  }
  await useDialogs().showTaskDialog({
    instruction: tr('app.swDoneTitle'),
    content:
      cutoffMonth === null
        ? tr('app.swDoneAll', { path: escapeRichText(choice.backupPath) })
        : tr('app.swDoneCutoff', { cutoff: cutoffText, path: escapeRichText(choice.backupPath) }),
    icon: 'logo',
    buttons: ['close'],
  });
}

/** A slate wipe a host crash interrupted (03 §6.5 step 5): its Error dialog, after the reopen. */
export function onInterruptedSlateWipe(): () => void {
  return host.on('slateWipe:interrupted', ({ backupPath }) => {
    void slateWipeError(tr('app.swInterrupted'), true, backupPath);
  });
}
