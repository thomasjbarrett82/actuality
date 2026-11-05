// File ▸ Export… (16 §2.1): the Export TaskDialog (CSV, QIF, and Budget to CSV on the Budget screen; on the
// Register, "Export current register view only"), a folder, `export.data` under the "Exporting..." overlay
// with the overwrite confirmation, and the success dialog with Open Output Folder. Works offline.
import { exportTimestamp } from '@shared/export/export-format';
import type { ExportRequest, ExportResult } from '@shared/rpc/host-api';
import { escapeRichText } from '../components/common/rich-text';
import { tr } from '../register/dialogs';
import type { Register } from '../register/use-register';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { showUnexpected } from '../session';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useLoadingOverlay } from '../stores/loading';

export type ExportScreen =
  { screen: 'register'; register: Register } | { screen: 'budget' } | { screen: 'other' };

export async function exportData(from: ExportScreen): Promise<void> {
  const budget = useConnection().info.budget;
  if (!budget) return;
  const { button, checkboxChecked } = await useDialogs().showTaskDialog({
    instruction: tr('app.expTitle'),
    content: tr('app.expChoose'),
    icon: 'none',
    commandLinks: [
      { id: 'csv', title: tr('app.expCsv'), subLabel: tr('app.expCsvDesc') },
      { id: 'qif', title: tr('app.expQif'), subLabel: tr('app.expQifDesc') },
      ...(from.screen === 'budget'
        ? [{ id: 'budgetCsv', title: tr('app.expBudgetCsv'), subLabel: tr('app.expBudgetCsvDesc') }]
        : []),
    ],
    ...(from.screen === 'register' ? { checkbox: { text: tr('app.expCurrentView') } } : {}),
    buttons: ['cancel'],
  });
  if (button !== 'csv' && button !== 'qif' && button !== 'budgetCsv') return;
  const folder = await window.app.shell.files.chooseExportFolder(tr('app.expFolderTitle'));
  if (!folder) return;
  const reg = from.screen === 'register' ? from.register : null;
  const view =
    reg && checkboxChecked && button !== 'budgetCsv'
      ? {
          accountId: reg.isAll ? ('all' as const) : reg.accountId,
          name: reg.isAll ? tr('app.sidebarAllAccounts') : (reg.account?.name ?? ''),
          ids: reg.shown.map((s) => s.row.t.id),
        }
      : null;
  const request: ExportRequest = {
    kind: button,
    folder,
    budgetName: budget.name,
    timestamp: exportTimestamp(new Date()),
    view,
    overwrite: false,
  };
  const result = await writeFiles(request);
  if (!result) return;
  const content =
    button === 'qif'
      ? tr(view ? 'app.expQifView' : 'app.expQifEach')
      : tr(button === 'csv' ? 'app.expTwoFiles' : 'app.expBudgetDone');
  const done = await useDialogs().showTaskDialog({
    instruction: tr('app.expTitle'),
    content: `${content}<br/>${result.files.map((f) => escapeRichText(f)).join('<br/>')}`,
    icon: 'info',
    buttons: [{ id: 'open', label: tr('app.expOpenFolder') }, 'close'],
  });
  if (done.button === 'open')
    await window.app.shell.files.openFolder(result.folder).catch(() => undefined);
}

/** `export.data`, asking before existing files are overwritten (16 §2.1). */
async function writeFiles(request: ExportRequest): Promise<ExportResult | null> {
  const overlay = useLoadingOverlay();
  try {
    return await overlay.during(tr('app.expExporting'), host.call('export.data', request));
  } catch (e) {
    const names = (e as { details?: { names?: unknown } }).details?.names;
    if (errorInfo(e).detail === 'files-exist' && Array.isArray(names)) {
      const { button } = await useDialogs().showTaskDialog({
        instruction: tr('app.expOverwriteTitle'),
        content: tr('app.expOverwriteMessage', {
          names: names.map((n) => `    ${escapeRichText(String(n))}`).join('\n'),
        }),
        icon: 'warning',
        buttons: [{ id: 'overwrite', label: tr('app.expOverwrite') }, 'cancel'],
      });
      if (button !== 'overwrite') return null;
      return writeFiles({ ...request, overwrite: true });
    }
    await exportError(e);
    return null;
  }
}

/** "There was an error during the export" (16 §2.1), with the locked-file text when it applies. */
export async function exportError(e: unknown): Promise<void> {
  const info = errorInfo(e);
  if (info.detail === 'file-locked' || info.detail === 'write-failed') {
    await useDialogs().showTaskDialog({
      instruction: tr('app.expErrorTitle'),
      content: info.detail === 'file-locked' ? tr('app.expLocked') : escapeRichText(info.message),
      icon: 'error',
      buttons: ['close'],
    });
    return;
  }
  await showUnexpected(e);
}
