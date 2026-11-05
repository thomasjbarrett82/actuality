// File ▸ Export… (16 §2.1): the choice, the folder, the overwrite question, the result and the errors.
import type { ExportRequest } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Register } from '../register/use-register';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { account, answerDialog, mockHost, ONLINE, type Responses } from '../testing/fixtures';
import { exportData, exportError, type ExportScreen } from './export-flow';

const files = () => vi.mocked(window.app.shell.files);

/** A register with three rows shown. */
const register = (over: Partial<Register> = {}): Register =>
  ({
    isAll: false,
    accountId: 'chk',
    account: account({ id: 'chk', name: 'Checking' }),
    shown: ['t1', 't2', 't3'].map((id) => ({ row: { t: { id } } })),
    ...over,
  }) as unknown as Register;

describe('export (16 §2.1)', () => {
  let host: ReturnType<typeof mockHost>;
  const respond = (responses: Responses): void => {
    host = mockHost(responses);
  };

  beforeEach(() => {
    useConnection().info = ONLINE;
    files().chooseExportFolder.mockResolvedValue('/out');
    respond({ 'export.data': () => ({ folder: '/out', files: ['Home.csv', 'Home-Budget.csv'] }) });
  });

  const run = async (from: ExportScreen, button: string, checkbox = false): Promise<void> => {
    const exporting = exportData(from);
    await answerDialog(button, checkbox);
    await exporting;
  };
  const request = (): ExportRequest => host.calls('export.data')[0] as ExportRequest;

  it('offers Budget to CSV only on the Budget screen, and the view checkbox only on the Register', async () => {
    const offered = async (from: ExportScreen) => {
      const exporting = exportData(from);
      const options = await answerDialog('cancel');
      await exporting;
      return {
        links: options.commandLinks?.map((l) => l.id),
        checkbox: options.checkbox?.text ?? null,
      };
    };
    expect(await offered({ screen: 'budget' })).toEqual({
      links: ['csv', 'qif', 'budgetCsv'],
      checkbox: null,
    });
    expect(await offered({ screen: 'register', register: register() })).toEqual({
      links: ['csv', 'qif'],
      checkbox: 'Export current register view only',
    });
    expect(await offered({ screen: 'other' })).toEqual({ links: ['csv', 'qif'], checkbox: null });
    expect(files().chooseExportFolder.mock.calls).toEqual([]);
  });

  it('does nothing without a budget, or without a folder', async () => {
    useConnection().info = { ...ONLINE, budget: null };
    await exportData({ screen: 'other' });
    expect(useDialogs().stack).toEqual([]);

    useConnection().info = ONLINE;
    files().chooseExportFolder.mockResolvedValueOnce(null);
    await run({ screen: 'other' }, 'csv');
    expect(host.calls('export.data')).toEqual([]);
  });

  it('exports everything to CSV and opens the folder', async () => {
    const exporting = exportData({ screen: 'other' });
    await answerDialog('csv');
    const done = await answerDialog('open');
    await exporting;
    expect(request()).toMatchObject({
      kind: 'csv',
      folder: '/out',
      budgetName: 'Home',
      view: null,
      overwrite: false,
    });
    expect(done.content).toBe(
      'Two files were successfully exported:<br/>Home.csv<br/>Home-Budget.csv',
    );
    expect(files().openFolder.mock.calls).toEqual([['/out']]);
  });

  it('exports the register view as QIF, for an account or All Accounts', async () => {
    const exporting = exportData({ screen: 'register', register: register() });
    await answerDialog('qif', true);
    const done = await answerDialog('close');
    await exporting;
    expect(request().view).toEqual({ accountId: 'chk', name: 'Checking', ids: ['t1', 't2', 't3'] });
    expect(done.content).toMatch(/^The account view was exported as a QIF file:/);
    expect(files().openFolder.mock.calls).toEqual([]);

    const all = exportData({
      screen: 'register',
      register: register({ isAll: true, accountId: 'all', account: undefined }),
    });
    await answerDialog('qif', true);
    await answerDialog('close');
    await all;
    expect(host.calls('export.data')[1]).toMatchObject({
      view: { accountId: 'all', name: 'All Accounts' },
    });
  });

  it('exports each account as QIF without the checkbox, and the budget as CSV', async () => {
    const qif = exportData({ screen: 'register', register: register() });
    await answerDialog('qif', false);
    const each = await answerDialog('close');
    await qif;
    expect(request().view).toBeNull();
    expect(each.content).toMatch(/^Each account was exported as a separate QIF file:/);

    const budget = exportData({ screen: 'budget' });
    await answerDialog('budgetCsv');
    const done = await answerDialog('close');
    await budget;
    expect(done.content).toMatch(/^Budget successfully exported/);
  });

  it('asks before overwriting, and writes again only if told to', async () => {
    let attempt = 0;
    respond({
      'export.data': () => {
        attempt++;
        if (attempt % 2 === 1)
          throw new RpcError('validation', 'exists', {
            code: 'files-exist',
            names: ['Home.csv', '<b>.csv'],
          });
        return { folder: '/out', files: ['Home.csv'] };
      },
    });
    const exporting = exportData({ screen: 'other' });
    await answerDialog('csv');
    const ask = await answerDialog('overwrite');
    await answerDialog('close');
    await exporting;
    expect(ask.content).toContain('    Home.csv\n    &lt;b&gt;.csv');
    expect(host.calls('export.data').map((r) => (r as ExportRequest).overwrite)).toEqual([
      false,
      true,
    ]);

    const declined = exportData({ screen: 'other' });
    await answerDialog('csv');
    await answerDialog('cancel');
    await declined;
    expect(host.calls('export.data')).toHaveLength(3);
    expect(useDialogs().stack).toEqual([]);
  });

  it('explains a locked file, a failed write, and anything else', async () => {
    const shown = async (e: unknown) => {
      const showing = exportError(e);
      const options = await answerDialog('close');
      await showing;
      return options;
    };
    const locked = await shown(new RpcError('actual', 'EBUSY', { code: 'file-locked' }));
    expect(locked.instruction).toBe('There was an error during the export');
    expect(locked.content).toMatch(/^The export file is in use/);
    expect(
      (await shown(new RpcError('actual', 'Disk <full>', { code: 'write-failed' }))).content,
    ).toBe('Disk &lt;full&gt;');
    expect((await shown(new Error('boom'))).instruction).not.toBe(
      'There was an error during the export',
    );
  });

  it('shows a failed export', async () => {
    respond({
      'export.data': () => {
        throw new RpcError('actual', 'EBUSY', { code: 'file-locked' });
      },
    });
    const exporting = exportData({ screen: 'other' });
    await answerDialog('csv');
    const error = await answerDialog('close');
    await exporting;
    await flushPromises();
    expect(error.instruction).toBe('There was an error during the export');
    expect(useDialogs().stack).toEqual([]);
  });
});
