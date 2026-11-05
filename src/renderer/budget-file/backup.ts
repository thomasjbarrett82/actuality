// File ▸ Export Budget Backup… (07 §6): a save dialog with the default name "{budget} backup {YYYY-MM-DD
// HHmm}.zip", `budgetFile.exportBackup` (the host writes Actual's zip), then "Backup saved" with Show in
// Folder. It only reads the budget, so it works offline.
import { exportTimestamp, safeFileName } from '@shared/export/export-format';
import type { FileFilter } from '@shared/shell-api';
import { escapeRichText } from '../components/common/rich-text';
import { tr } from '../register/dialogs';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { showUnexpected } from '../session';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useLoadingOverlay } from '../stores/loading';

/** The save dialog's filter for backup zips (07 §6, 18 §2). */
export const backupFilters = (): FileFilter[] => [
  { name: tr('app.backupFilter'), extensions: ['zip'] },
];

/** "There was a problem saving the backup", with the reason, or the generic error. */
export async function backupError(e: unknown): Promise<void> {
  if (errorInfo(e).detail !== 'backup-failed') {
    await showUnexpected(e);
    return;
  }
  await useDialogs().showTaskDialog({
    instruction: tr('app.backupFailed'),
    content: escapeRichText(errorInfo(e).message),
    icon: 'error',
    buttons: ['close'],
  });
}

export async function exportBackup(): Promise<void> {
  const budget = useConnection().info.budget;
  if (!budget) return;
  const path = await window.app.shell.files.saveFile({
    title: tr('app.backupSaveTitle'),
    defaultName: safeFileName(
      tr('app.backupDefaultName', { budget: budget.name, stamp: exportTimestamp(new Date()) }),
    ),
    filters: backupFilters(),
  });
  if (!path) return;
  try {
    await useLoadingOverlay().during(
      tr('app.backupSaving'),
      host.call('budgetFile.exportBackup', { path }),
    );
  } catch (e) {
    await backupError(e);
    return;
  }
  const { button } = await useDialogs().showTaskDialog({
    instruction: tr('app.backupSaved'),
    content: escapeRichText(path),
    icon: 'info',
    buttons: [{ id: 'show', label: tr('app.showInFolder') }, 'close'],
  });
  if (button === 'show') await window.app.shell.files.showInFolder(path).catch(() => undefined);
}
