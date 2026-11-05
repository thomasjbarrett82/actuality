// The bank import (16 §1): its preconditions, the intro window, the parse errors, the mapping dialogs,
// the run, the results dialog and the register afterwards.
import type { ParsedAccount } from '@shared/import/import-rules';
import type { ImportAccountResult, ImportParse, ImportRunAccount } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportIntroDialog from '../components/import/ImportIntroDialog.vue';
import ImportMappingDialog from '../components/import/ImportMappingDialog.vue';
import { queryClient } from '../rpc/query-client';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useModals } from '../stores/modals';
import {
  account,
  answerDialog,
  answerModal,
  mockHost,
  ONLINE,
  type Responses,
} from '../testing/fixtures';
import { importTransactions } from './import-flow';

const fileAccount = (number: string): ParsedAccount => ({
  key: `fid|${number}`,
  type: 'CHECKING',
  number,
  transactions: [],
});
const parsed = (over: Partial<ImportParse> = {}): ImportParse => ({
  token: 'tok',
  fileName: 'bank.ofx',
  format: 'ofx',
  accounts: [fileAccount('12345678')],
  emptyAccounts: 0,
  mappings: {},
  startDates: {},
  ...over,
});
const choice = (index: number, accountId: string): ImportRunAccount => ({
  index,
  accountId,
  importNotes: true,
  swapPayeeNotes: false,
  dateOrder: null,
  includeBeforeStart: false,
});
const imported = (over: Partial<ImportAccountResult> = {}): ImportAccountResult => ({
  index: 0,
  accountId: 'chk',
  status: 'imported',
  added: 3,
  updated: 0,
  ignored: 0,
  startAdjusted: false,
  ...over,
});

const ACCOUNTS = [
  account({ id: 'sav', name: 'Savings' }),
  account({ id: 'chk', name: 'Checking' }),
  account({ id: 'old', name: 'Old', closed: true }),
];

describe('bank import (16 §1)', () => {
  let host: ReturnType<typeof mockHost>;
  const respond = (responses: Responses): void => {
    host = mockHost({
      'accounts.list': () => ACCOUNTS,
      'prefs.synced': () => ({ dateFormat: 'dd.MM.yyyy' }),
      'import.parse': () => parsed(),
      'import.run': () => [imported()],
      ...responses,
    });
  };

  beforeEach(() => {
    useConnection().info = ONLINE;
    const budgetSettings = useBudgetSettings();
    budgetSettings.cloudFileId = 'c1';
    budgetSettings.settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      register: { ...DEFAULT_BUDGET_SETTINGS.register, showPreImportDialog: false },
    };
    vi.mocked(window.app.shell.settings).patchBudget.mockImplementation((_id, patch) =>
      Promise.resolve({ ...budgetSettings.settings, ...(patch as Partial<BudgetSettings>) }),
    );
    vi.mocked(window.app.shell.files).openFile.mockResolvedValue('/bank/bank.ofx');
    respond({});
  });
  afterEach(() => {
    queryClient.clear();
  });

  /** Runs the import, answering each mapping dialog in turn, then returns the results dialog. */
  const importWith = async (choices: (ImportRunAccount | null)[]) => {
    const importing = importTransactions('chk');
    for (const c of choices) await answerModal(c);
    const results = useDialogs().stack.length > 0 ? await answerDialog('close') : null;
    await importing;
    return results;
  };

  it('needs a budget, an open account and a connection', async () => {
    const told = async (): Promise<string> => {
      const importing = importTransactions(null);
      const options = await answerDialog('ok').catch(() => answerDialog('close'));
      await importing;
      return options.instruction;
    };
    useConnection().info = { ...ONLINE, budget: null };
    expect(await told()).toBe('Before importing, please load a budget file.');

    useConnection().info = ONLINE;
    respond({ 'accounts.list': () => [ACCOUNTS[2]] });
    expect(await told()).toBe('Before importing, please add at least one account.');

    queryClient.clear();
    respond({});
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    expect(await told()).toBe("You're offline");
    expect(vi.mocked(window.app.shell.files).openFile.mock.calls).toEqual([]);
  });

  it('shows the intro window first, and remembers "Don\'t show this again"', async () => {
    useBudgetSettings().settings.register.showPreImportDialog = true;
    const cancelled = importTransactions(null);
    await flushPromises();
    expect(useModals().stack.at(-1)?.component).toBe(ImportIntroDialog);
    await answerModal(null);
    await cancelled;
    expect(vi.mocked(window.app.shell.files).openFile.mock.calls).toEqual([]);

    const skipped = importTransactions(null);
    await answerModal({ skipNextTime: true });
    await answerModal(null);
    await skipped;
    expect(useBudgetSettings().settings.register.showPreImportDialog).toBe(false);
    expect(vi.mocked(window.app.shell.files).openFile.mock.calls).toHaveLength(1);
  });

  it('stops when no file is chosen', async () => {
    vi.mocked(window.app.shell.files).openFile.mockResolvedValueOnce(null);
    await importTransactions(null);
    expect(host.calls('import.parse')).toEqual([]);
  });

  it('explains a missing file, a CSV in another format and other parse errors', async () => {
    const parseError = async (e: Error): Promise<{ instruction: string; content: string }> => {
      respond({
        'import.parse': () => {
          throw e;
        },
      });
      const importing = importTransactions(null);
      const options = await answerDialog('close');
      await importing;
      queryClient.clear();
      return { instruction: options.instruction, content: options.content ?? '' };
    };
    expect(
      await parseError(
        new RpcError('validation', 'missing', { code: 'file-not-found', name: '<bank>.ofx' }),
      ),
    ).toEqual({
      instruction: 'Importing Error',
      content: 'File could not be found: &lt;bank&gt;.ofx',
    });

    vi.mocked(window.app.shell.files).saveSampleImport.mockResolvedValueOnce(
      'C:\\Users\\me\\Sample.csv',
    );
    const csv = await parseError(new RpcError('validation', 'bad csv', { code: 'csv-format' }));
    expect(csv.instruction).toBe('This CSV file is not formatted correctly');
    expect(csv.content).toContain('**Sample.csv**');
    expect(
      (await parseError(new RpcError('validation', 'x', { code: 'csv-format' }))).content,
    ).toContain('**SampleImport.csv**');

    expect(await parseError(new Error('Unexpected token'))).toEqual({
      instruction: 'Importing Error',
      content: 'There was an error while importing:\nUnexpected token',
    });
  });

  it('explains a file with no accounts to import', async () => {
    const empty = async (over: Partial<ImportParse>): Promise<string> => {
      respond({ 'import.parse': () => parsed({ accounts: [], ...over }) });
      const importing = importTransactions(null);
      const options = await answerDialog('close');
      await importing;
      queryClient.clear();
      return options.content ?? '';
    };
    expect(await empty({ format: 'qif' })).toMatch(/does not support importing stock transactions/);
    expect(await empty({ emptyAccounts: 2 })).toBe(
      'This file contains no accounts with transactions to import.',
    );
    expect(await empty({ emptyAccounts: 1, unreadable: 3 })).toBe(
      "This file contains no accounts with transactions to import. 3 transactions in it couldn't be read.",
    );
    expect(await empty({})).toMatch(/appears to be empty or is malformed/);
  });

  it('maps each file account, imports them, and opens the account imported into', async () => {
    respond({
      'import.parse': () =>
        parsed({
          accounts: [{ ...fileAccount('11112222'), unreadable: 2 }, fileAccount('33334444')],
        }),
      'import.run': () => [
        imported({ index: 0, updated: 2, ignored: 1, startAdjusted: true }),
        imported({ index: 1, status: 'skipped', accountId: null }),
      ],
    });
    const importing = importTransactions('chk');
    const first = await answerModal(choice(0, 'chk'));
    expect(useModals().stack.at(-1)?.component).toBe(ImportMappingDialog);
    const second = await answerModal(choice(1, 'chk'));
    const results = await answerDialog('close');
    await importing;

    expect(first).toMatchObject({ index: 0, last: false, previous: null, budgetOrder: 'DMY' });
    expect((first['accounts'] as { id: string }[]).map((a) => a.id)).toEqual(['chk', 'sav']);
    expect(second).toMatchObject({ index: 1, last: true, previous: choice(0, 'chk') });
    expect(host.calls('import.run')[0]).toMatchObject({
      token: 'tok',
      accounts: [choice(0, 'chk'), choice(1, 'chk')],
    });
    expect(results.instruction).toBe('Import successful');
    expect(results.content).toContain('5 transactions have been imported');
    expect(results.content).toContain(`CHECKING: ${'&ast;'.repeat(8)}2222 into Checking:`);
    expect(results.content).toContain(`CHECKING: ${'&ast;'.repeat(8)}4444:** Skipped`);
    expect(results.content).toContain('2 new transactions were matched');
    expect(results.content).toContain("2 transactions couldn't be read and were skipped");
    expect(useAppStore().activeAccountId).toBe('chk');
  });

  it('opens All Accounts after importing into several accounts', async () => {
    respond({
      'import.parse': () => parsed({ accounts: [fileAccount('1'), fileAccount('2')] }),
      'import.run': () => [imported(), imported({ index: 1, accountId: 'sav' })],
    });
    await importWith([choice(0, 'chk'), choice(1, 'sav')]);
    expect(useAppStore().activeAccountId).toBe('all');
  });

  it('imports nothing when a mapping is cancelled', async () => {
    respond({ 'import.parse': () => parsed({ accounts: [fileAccount('1'), fileAccount('2')] }) });
    await importWith([choice(0, 'chk'), null]);
    expect(host.calls('import.run')).toEqual([]);
  });

  it('reads the budget date order as MDY when the synced prefs fail', async () => {
    respond({
      'prefs.synced': () => {
        throw new Error('no prefs');
      },
    });
    const importing = importTransactions(null);
    const props = await answerModal(null);
    await importing;
    expect(props['budgetOrder']).toBe('MDY');
  });

  it('reports a partial and a failed import', async () => {
    respond({
      'import.parse': () => parsed({ accounts: [fileAccount('1'), fileAccount('2')] }),
      'import.run': () => [
        imported(),
        imported({ index: 1, status: 'failed', error: 'Bad <date>', added: 0 }),
      ],
    });
    const partial = await importWith([choice(0, 'chk'), choice(1, 'sav')]);
    expect(partial).toMatchObject({ instruction: 'Import partially successful', icon: 'warning' });
    expect(partial?.content).toContain('Bad &lt;date&gt;');

    queryClient.clear();
    respond({ 'import.run': () => [imported({ status: 'failed', error: 'x', added: 0 })] });
    expect((await importWith([choice(0, 'chk')]))?.instruction).toBe('Import failed');
  });

  it('shows the offline dialog or the error when the run fails', async () => {
    const failed = async (e: Error): Promise<string> => {
      respond({
        'import.run': () => {
          throw e;
        },
      });
      const importing = importTransactions(null);
      await answerModal(choice(0, 'chk'));
      const options = await answerDialog('close');
      await importing;
      queryClient.clear();
      return options.instruction;
    };
    expect(await failed(new RpcError('offline', 'gone'))).toBe("You're offline");
    expect(await failed(new Error('boom'))).toBe('Something went wrong');
    expect(useAppStore().activeAccountId).toBeNull();
  });
});
