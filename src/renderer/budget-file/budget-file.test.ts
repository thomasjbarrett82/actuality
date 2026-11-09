// Wipe the Slate Clean, Export Budget Backup, Import a budget file and About in the renderer, with a mocked
// host (18 §1–2, 07 §3.4, §6).
import { RpcError } from '@shared/rpc/protocol';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AboutDialog from '../components/budget-file/AboutDialog.vue';
import KeyboardShortcutsDialog from '../components/budget-file/KeyboardShortcutsDialog.vue';
import SlateWipeDialog from '../components/budget-file/SlateWipeDialog.vue';
import { host } from '../rpc/host-client';
import { importBudgetFile } from '../session';
import { useAppStore } from '../stores/app';
import { useConnection } from '../stores/connection';
import { useLoadingOverlay } from '../stores/loading';
import { useModals } from '../stores/modals';
import { useStart } from '../stores/start';
import { answerDialog, mockHost, ONLINE } from '../testing/fixtures';
import { axe, mountApp } from '../testing/mount';
import { exportBackup } from './backup';
import { cutoffMonths, onInterruptedSlateWipe, wipeSlateClean } from './slate-wipe';

let mocked: ReturnType<typeof mockHost>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 21, 9, 30));
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
});

/** The open standard dialog, answered with `result`. */
async function answerModal(result: unknown): Promise<Record<string, unknown>> {
  await flushPromises();
  const modals = useModals();
  const top = modals.stack.at(-1);
  if (!top) throw new Error('no modal is open');
  modals.close(top.id, result);
  await flushPromises();
  return top.props;
}

describe('Wipe the Slate Clean (18 §2)', () => {
  it('lists the cutoff months from the current one back to the first with data', () => {
    expect(cutoffMonths('2026-10', '2026-08')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(cutoffMonths('2026-10', null)).toEqual(['2026-10']);
  });

  it('hides the cutoff combo until Alt is pressed, and picks another backup file', async () => {
    vi.mocked(window.app.shell.files).saveFile.mockResolvedValueOnce('D:\\Backups\\other.zip');
    const w = mountApp(SlateWipeDialog, {
      props: {
        backupPath: 'C:\\Docs\\Home before wipe 2026-10-21.zip',
        months: ['2026-10'],
      },
    });
    expect(w.find('select').exists()).toBe(false);
    expect(await axe(document.body)).toHaveNoViolations();
    await w.find('.wipe').trigger('keydown', { key: 'Alt' });
    const select = w.find('select');
    expect(select.findAll('option').map((o) => o.text())).toEqual(['ALL DATES', 'October 2026']);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Change…')
      ?.trigger('click');
    await flushPromises();
    expect(vi.mocked(window.app.shell.files).saveFile.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        defaultName: 'Home before wipe 2026-10-21.zip',
        folder: 'C:\\Docs',
      }),
    );
    await select.setValue('2026-10');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Wipe the Slate Clean')
      ?.trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([
      { backupPath: 'D:\\Backups\\other.zip', cutoffMonth: '2026-10' },
    ]);
  });

  it('confirms with the count, shows the progress and the welcome dialog', async () => {
    let progress: ((p: { label: string; done: number; total: number }) => void) | null = null;
    vi.spyOn(host, 'on').mockImplementation(((event: string, listener: never) => {
      if (event === 'job:progress') progress = listener;
      return () => undefined;
    }) as typeof host.on);
    let finish: (v: unknown) => void = () => undefined;
    mocked = mockHost({
      'slateWipe.impact': () => ({ transactions: 412, firstMonth: '2025-01' }),
    });
    const run = mocked.spy.getMockImplementation();
    mocked.spy.mockImplementation((method, params) =>
      method === 'slateWipe.run'
        ? (new Promise((r) => (finish = r)) as never)
        : (run?.(method, params) as never),
    );
    const done = wipeSlateClean();
    const props = await answerModal({ backupPath: '/b.zip', cutoffMonth: null });
    expect(props['backupPath']).toBe('/home/me/Documents/Home before wipe 2026-10-21.zip');
    expect((props['months'] as string[]).at(-1)).toBe('2025-01');
    const confirm = await answerDialog('go');
    expect(confirm.instruction).toBe('Are you sure?');
    expect(confirm.content).toBe(
      "This deletes 412 transactions and all budgeted amounts. It can't be undone except by restoring the backup.",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.calls('slateWipe.run')).toEqual([
      {
        cutoffMonth: null,
        backupPath: '/b.zip',
        texts: { startingBalancePayee: 'Starting Balance' },
      },
    ]);
    useLoadingOverlay().label = 'Wiping the slate clean';
    (progress as unknown as (p: object) => void)({
      label: 'slateWipe.delete',
      done: 200,
      total: 412,
    });
    expect(useLoadingOverlay().label).toBe('Deleting transactions… 200/412');
    finish({ backupPath: '/b.zip', deleted: 412 });
    const welcome = await answerDialog('close');
    expect(welcome.instruction).toBe('Welcome to your clean slate');
    expect(welcome.content).toContain("A backup of your old budget was saved to '*/b.zip*'");
    await done;
  });

  it('says the budget may be partly reset when the job failed after deleting', async () => {
    mocked = mockHost({
      'slateWipe.impact': () => ({ transactions: 3, firstMonth: '2026-09' }),
      'slateWipe.run': () => {
        throw Object.assign(new Error('boom'), {
          code: 'internal',
          details: { slateWipe: { partial: true } },
        });
      },
    });
    const done = wipeSlateClean();
    await answerModal({ backupPath: 'C:\\b.zip', cutoffMonth: '2026-10' });
    const confirm = await answerDialog('go');
    expect(confirm.content).toContain('before October 2026');
    const error = await answerDialog('close');
    expect(error.instruction).toBe('Error');
    expect(error.content).toContain('Your budget may be partly reset');
    expect(error.content).toContain('**"C:\\b.zip"**');
    await done;
  });

  it('does nothing offline, and reports a slate wipe a crash interrupted', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    mocked = mockHost({});
    await wipeSlateClean();
    expect(mocked.spy).not.toHaveBeenCalled();

    let interrupted: ((p: { backupPath: string }) => void) | null = null;
    vi.spyOn(host, 'on').mockImplementation(((_event: string, listener: never) => {
      interrupted = listener;
      return () => undefined;
    }) as typeof host.on);
    onInterruptedSlateWipe();
    (interrupted as unknown as (p: object) => void)({ backupPath: '/x.zip' });
    const error = await answerDialog('close');
    expect(error.content).toContain('Your budget may be partly reset');
  });
});

describe('Export Budget Backup (07 §6)', () => {
  it('saves under the default name and offers Show in Folder', async () => {
    vi.mocked(window.app.shell.files).saveFile.mockResolvedValueOnce('/docs/b.zip');
    mocked = mockHost({ 'budgetFile.exportBackup': () => null });
    const done = exportBackup();
    const saved = await answerDialog('show');
    await done;
    expect(vi.mocked(window.app.shell.files).saveFile.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ defaultName: 'Home backup 2026-10-21 0930.zip' }),
    );
    expect(mocked.calls('budgetFile.exportBackup')).toEqual([{ path: '/docs/b.zip' }]);
    expect(saved.instruction).toBe('Backup saved');
    expect(vi.mocked(window.app.shell.files).showInFolder.mock.calls.at(-1)?.[0]).toEqual(
      '/docs/b.zip',
    );
  });
});

describe('Import a budget file (07 §3.4)', () => {
  it('asks the type, imports on the Loading screen and opens the budget', async () => {
    vi.mocked(window.app.shell.files).openFile.mockResolvedValueOnce(
      '/b/My Budget~1.ynab4/Budget.ymeta',
    );
    mocked = mockHost({ 'budgetFile.importFile': () => ONLINE.budget });
    useAppStore().navigate('start');
    useStart().show('open');
    const done = importBudgetFile();
    const asked = await answerDialog('ynab4');
    expect(asked.instruction).toBe('What type of file?');
    expect(asked.commandLinks?.map((l) => l.title)).toEqual([
      'Actual export (.zip)',
      'YNAB 4 budget',
      'nYNAB export (.json)',
    ]);
    await done;
    expect(vi.mocked(window.app.shell.files).openFile.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        filters: [{ name: 'YNAB 4 budget', extensions: ['zip', 'ymeta'] }],
      }),
    );
    expect(mocked.calls('budgetFile.importFile')).toEqual([
      {
        path: '/b/My Budget~1.ynab4/Budget.ymeta',
        type: 'ynab4',
        importedSuffix: '(imported 2026-10-21)',
        force: true,
      },
    ]);
  });

  it('shows the upload failure and returns to Open Budget', async () => {
    vi.mocked(window.app.shell.files).openFile.mockResolvedValueOnce('/b.zip');
    useConnection().info = { ...ONLINE, state: 'SignedIn', budget: null };
    mocked = mockHost({
      'budgetFile.importFile': () => {
        throw new RpcError('actual', 'x', { code: 'upload-failed' });
      },
    });
    useStart().show('open');
    const done = importBudgetFile();
    await answerDialog('actual');
    const error = await answerDialog('close');
    await done;
    expect(error.instruction).toContain("couldn't be uploaded to your Actual server");
    expect(useStart().screen).toBe('open');
  });
});

describe('About (18 §1)', () => {
  it('shows the versions, the server and View licenses', async () => {
    mocked = mockHost({ 'session.serverVersion': () => '26.2.0' });
    useConnection().info = { ...ONLINE, serverUrl: 'https://budget.example.com' };
    const queryClient = new QueryClient();
    const w = mountApp(AboutDialog, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
    await flushPromises();
    const text = w.text();
    expect(text).toContain('Potential made actual');
    expect(text).toContain('Version: 0.1.0 (abc1234)');
    expect(text).toContain('Electron 44.9.0 · Chromium 140.0.0.0 · Node 24.0.0');
    expect(text).toContain('Actual API 26.10.0');
    expect(text).toContain('Connected server: https://budget.example.com (Actual 26.2.0)');
    expect(text).toContain('Not affiliated with Actual Budget.');
    expect(await axe(document.body)).toHaveNoViolations();
    await w
      .findAll('button')
      .find((b) => b.text() === 'View licenses')
      ?.trigger('click');
    expect(vi.mocked(window.app.shell).openLicenses.mock.calls).toHaveLength(1);
  });
});

describe('Keyboard Shortcuts (06 §6.1)', () => {
  it('lists the shortcuts by area, and the filter narrows them by action or keys', async () => {
    const w = mountApp(KeyboardShortcutsDialog);
    await flushPromises();
    expect(w.findAll('h3').map((h) => h.text())).toEqual([
      'General',
      'Budget',
      'Register',
      'Editing a transaction',
    ]);
    const row = (label: string) => w.findAll('tr').find((r) => r.get('th').text() === label);
    expect(row('Categorize the selected transactions')?.get('td').text()).toBe('C');
    expect(row('Turn privacy mode on or off')?.get('td').text()).toBe('Ctrl+Shift+P');
    expect(row('Add a transaction')?.get('td').text()).toBe('T or Ctrl+N');
    expect(row('Open Preferences')?.get('td').text()).toBe('Ctrl+,');
    expect(row('Redo typing in a text field')?.get('td').text()).toBe('Ctrl+Shift+Z');
    expect(row('Turn full screen on or off')?.get('td').text()).toBe('F11');
    expect(row('Zoom in')?.get('td').text()).toBe('Ctrl+= or Ctrl+Shift+= or Ctrl+Num +');
    expect(await axe(document.body)).toHaveNoViolations();

    await w.get('input[type="search"]').setValue('privacy');
    expect(w.findAll('tr').map((r) => r.get('th').text())).toEqual(['Turn privacy mode on or off']);
    await w.get('input[type="search"]').setValue('shift+p');
    expect(w.findAll('tr').map((r) => r.get('th').text())).toEqual(['Turn privacy mode on or off']);
    await w.get('input[type="search"]').setValue('nothing like this');
    expect(w.findAll('tr')).toHaveLength(0);
    expect(w.text()).toContain('No shortcuts match your search.');
  });
});
