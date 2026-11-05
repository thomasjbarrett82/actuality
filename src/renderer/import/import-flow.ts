// The bank import (16 §1): preconditions, the skippable Import Transactions window, the file dialog,
// `import.parse` and its error dialogs (including the sample CSV), one mapping dialog per account in the
// file, `import.run` under the "Importing..." overlay, the results dialog, and the register afterwards.
import { dateOrder } from '@shared/dates';
import { ENGLISH_TRANSFER_PREFIX } from '@shared/domain/payees';
import type { Account, Id } from '@shared/domain/types';
import type { ImportAccountResult, ImportParse, ImportRunAccount } from '@shared/rpc/host-api';
import { escapeRichText } from '../components/common/rich-text';
import ImportIntroDialog from '../components/import/ImportIntroDialog.vue';
import ImportMappingDialog from '../components/import/ImportMappingDialog.vue';
import { accountsQuery } from '../queries/budget-data';
import { showOffline, tell, tr, trn } from '../register/dialogs';
import { errorInfo } from '../rpc/errors';
import { host } from '../rpc/host-client';
import { queryClient } from '../rpc/query-client';
import { showUnexpected } from '../session';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useLoadingOverlay } from '../stores/loading';
import { useModals } from '../stores/modals';
import { bankAccountLabel } from './labels';

/** What a mapping dialog closes with: the run's choices, or null for Cancel (nothing is imported). */
export type MappingChoice = ImportRunAccount;

/** File ▸ Import Transactions from Your Bank… and the register's Import button (16 §1.1). */
export async function importTransactions(defaultAccountId: Id | null): Promise<void> {
  const connection = useConnection();
  if (!connection.info.budget) {
    await tell(tr('app.impNoBudgetTitle'), tr('app.impNoBudgetMessage'), 'info', 'ok');
    return;
  }
  const accounts = (await queryClient.query(accountsQuery)).filter((a) => !a.closed);
  if (accounts.length === 0) {
    await tell(tr('app.impNoAccountTitle'), tr('app.impNoAccountMessage'), 'info', 'ok');
    return;
  }
  if (!connection.canEdit) {
    await showOffline();
    return;
  }
  const budgetSettings = useBudgetSettings();
  if (budgetSettings.settings.register.showPreImportDialog) {
    const choice = await useModals().open<{ skipNextTime: boolean }>(ImportIntroDialog, {});
    if (!choice) return;
    if (choice.skipNextTime)
      await budgetSettings.patch({
        register: { ...budgetSettings.settings.register, showPreImportDialog: false },
      });
  }
  const path = await window.app.shell.files.openFile({
    title: tr('app.impChooseFileTitle'),
    filters: [
      {
        name: tr('files.importStatementFileTypes'),
        extensions: ['ofx', 'qfx', 'qif', 'csv'],
      },
    ],
  });
  if (!path) return;
  await importFile(path, defaultAccountId, accounts);
}

async function importFile(
  path: string,
  defaultAccountId: Id | null,
  accounts: Account[],
): Promise<void> {
  let parsed: ImportParse;
  try {
    parsed = await host.call('import.parse', { path });
  } catch (e) {
    await parseError(e);
    return;
  }
  if (parsed.accounts.length === 0) {
    if (parsed.format === 'qif')
      await tell(tr('app.impNoAccountsTitle'), tr('app.impNoQifAccounts'));
    else if (parsed.emptyAccounts > 0)
      await tell(
        tr('app.impNoTransactionsTitle'),
        parsed.unreadable
          ? `${tr('app.impNoTransactionsMessage')} ${trn('app.impNoTransactionsUnreadable', parsed.unreadable)}`
          : tr('app.impNoTransactionsMessage'),
      );
    else await tell(tr('app.impNoAccountsTitle'), tr('app.impNoAccountsMessage'));
    return;
  }
  const budgetOrder = dateOrder(await budgetDateFormat());
  const sorted = [...accounts].sort((a, b) => a.name.localeCompare(b.name));
  const runs: ImportRunAccount[] = [];
  let previous: ImportRunAccount | null = null;
  for (const index of parsed.accounts.keys()) {
    const choice: MappingChoice | null = await useModals().open<MappingChoice>(
      ImportMappingDialog,
      {
        parsed,
        index,
        accounts: sorted,
        defaultAccountId,
        budgetOrder,
        previous,
        last: index === parsed.accounts.length - 1,
      },
    );
    if (!choice) return;
    runs.push(choice);
    previous = choice;
  }
  let results: ImportAccountResult[];
  try {
    results = await useLoadingOverlay().during(
      tr('app.impImporting'),
      host.call('import.run', {
        token: parsed.token,
        accounts: runs,
        texts: {
          transferPrefixes: [tr('app.transferPrefix'), ENGLISH_TRANSFER_PREFIX],
          plainTransfer: tr('app.impPlainTransfer', { account: '{account}' }),
        },
      }),
    );
  } catch (e) {
    if (errorInfo(e).code === 'offline') await showOffline();
    else await showUnexpected(e);
    return;
  }
  await showResults(parsed, results, accounts);
  // The register shows the imported account, or All Accounts for several (16 §1.6).
  const imported = results.filter((r) => r.status === 'imported' && r.accountId);
  const app = useAppStore();
  if (new Set(imported.map((r) => r.accountId)).size > 1) app.toAllAccounts();
  else {
    const last = imported.at(-1)?.accountId;
    if (last) app.toAccount(last);
  }
}

async function budgetDateFormat(): Promise<string> {
  try {
    return (await host.call('prefs.synced', {}))['dateFormat'] ?? 'MM/dd/yyyy';
  } catch {
    return 'MM/dd/yyyy';
  }
}

/** The parse errors (16 §1.2–1.3): a missing file, a CSV in another format, anything else. */
async function parseError(e: unknown): Promise<void> {
  const info = errorInfo(e);
  const name = (e as { details?: { name?: unknown } }).details?.name;
  if (info.detail === 'file-not-found') {
    await tell(
      tr('app.impErrorTitle'),
      tr('app.impFileNotFound', { name: escapeRichText(typeof name === 'string' ? name : '') }),
    );
    return;
  }
  if (info.detail === 'csv-format') {
    const saved = await window.app.shell.files.saveSampleImport(tr('app.impCsvSaveTitle'));
    const name = saved ? (saved.split(/[\\/]/).at(-1) ?? 'SampleImport.csv') : 'SampleImport.csv';
    await tell(tr('app.impCsvTitle'), tr('app.impCsvMessage', { file: escapeRichText(name) }));
    return;
  }
  await tell(
    tr('app.impErrorTitle'),
    tr('app.impErrorMessage', { message: escapeRichText(info.message) }),
  );
}

/** The results dialog (16 §1.6): one block per file account. */
async function showResults(
  parsed: ImportParse,
  results: readonly ImportAccountResult[],
  accounts: readonly Account[],
): Promise<void> {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const blocks = results.map((r) => {
    const fileAccount = parsed.accounts[r.index];
    const bank = escapeRichText(fileAccount ? bankAccountLabel(fileAccount) : '');
    if (r.status === 'skipped') return tr('app.impResultSkipped', { bank });
    const account = escapeRichText(r.accountId ? (names.get(r.accountId) ?? '') : '');
    let head = tr('app.impResultHeading', { bank, account });
    if (r.status === 'failed')
      head += escapeRichText(tr('app.impResultFailed', { error: r.error ?? '' }));
    const lines = [head];
    if (r.status === 'imported') {
      const n = r.added + r.updated;
      lines.push(trn('app.impResultCount', n));
      if (r.updated > 0) lines.push(trn('app.impResultMatched', r.updated));
      if (r.ignored > 0) lines.push(trn('app.impResultIgnored', r.ignored));
      if (fileAccount?.unreadable)
        lines.push(trn('app.impResultUnreadable', fileAccount.unreadable));
      if (r.startAdjusted) lines.push(tr('app.impResultStart'));
    }
    return lines.join('<br/>');
  });
  const failed = results.filter((r) => r.status === 'failed').length;
  const ok = results.filter((r) => r.status === 'imported').length;
  const instruction =
    failed === 0 ? tr('app.impSuccess') : ok > 0 ? tr('app.impPartial') : tr('app.impFailed');
  await useDialogs().showTaskDialog({
    instruction,
    content: blocks.join('<br/><br/>'),
    icon: failed === 0 ? 'info' : 'warning',
    buttons: ['close'],
  });
}
