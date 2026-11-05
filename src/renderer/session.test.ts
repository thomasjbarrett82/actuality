import { INITIAL_CONNECTION, type ConnectionInfo, type OpenBudgetInfo } from '@shared/connection';
import type { HostMethod } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BUDGET_SETTINGS,
  type BudgetSettings,
} from '@shared/settings';
import type { ShellApi } from '@shared/shell-api';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { HOST_FAILED, host } from './rpc/host-client';
import {
  changeServer,
  closeBudgetToList,
  connectWithOpenId,
  connectWithPassword,
  continuePendingOpen,
  createBudget,
  goBackToBudget,
  handleErrorState,
  importBudgetFile,
  leaveStartScreen,
  openBudget,
  openFromMenu,
  restoreFailed,
  retryConnection,
  showStartScreen,
  showUnexpected,
  signOut,
  startup,
} from './session';
import { useAppStore } from './stores/app';
import { useConnection } from './stores/connection';
import { useDialogs } from './stores/dialogs';
import { usePrompts } from './stores/prompts';
import { useSettings } from './stores/settings';
import { LOADING_CANCEL_AFTER_MS, useStart } from './stores/start';

const budget: OpenBudgetInfo = {
  cloudFileId: 'c1',
  groupId: 'g1',
  name: 'Home',
  budgetType: 'envelope',
  localOnly: false,
};
const online: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'Online',
  serverUrl: 'https://budget.test',
  budget,
};
const template = {
  groups: [{ name: 'Giving', categories: ['Tithing'] }],
  incomeCategory: 'Income',
};
const formats = {
  currency: 'USD',
  numberFormat: 'comma-dot',
  dateFormat: 'MM/dd/yyyy',
  hideFraction: false,
} as const;

type Responder = (params: unknown) => unknown;

describe('session flows (07 §1–5)', () => {
  let call: MockInstance<typeof host.call>;
  let responses: Partial<Record<HostMethod, Responder>>;

  beforeEach(() => {
    responses = { 'session.serverVersion': () => '26.10.0' };
    call = vi.spyOn(host, 'call').mockImplementation(async (method, params) => {
      const respond = responses[method];
      if (!respond) return { ...INITIAL_CONNECTION };
      return (await respond(params)) as never;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const methods = (): string[] => call.mock.calls.map(([m]) => m);
  const answerDialog = async (button: string | null): Promise<void> => {
    await flushPromises();
    const dialogs = useDialogs();
    const top = dialogs.stack.at(-1);
    if (!top) throw new Error('no dialog open');
    dialogs.close(top.id, { button, checkboxChecked: false });
    await flushPromises();
  };

  it('starts on Connect without a server', async () => {
    await startup();
    expect(useStart().screen).toBe('connect');
    expect(useAppStore().screen).toBe('start');
    expect(call).not.toHaveBeenCalled();
  });

  it('signs in with the stored token and opens the last budget', async () => {
    const settings = useSettings();
    settings.app = {
      ...DEFAULT_APP_SETTINGS,
      serverUrl: 'https://budget.test',
      lastBudget: { cloudFileId: 'c1', groupId: 'g1', name: 'Home' },
    };
    responses['session.openBudget'] = () => budget;
    await startup();
    expect(methods()).toContain('session.connect');
    expect(call).toHaveBeenCalledWith('session.openBudget', { cloudFileId: 'c1' });
    expect(useAppStore().screen).toBe('welcome');
  });

  it('without a stored token, shows the Budget List and keeps the open for after the sign-in', async () => {
    useSettings().app = {
      ...DEFAULT_APP_SETTINGS,
      serverUrl: 'https://budget.test',
      lastBudget: { cloudFileId: 'c1', groupId: 'g1', name: 'Home' },
    };
    responses['session.connect'] = () => {
      throw new RpcError('auth', 'Sign in.', { code: 'no-token' });
    };
    await startup();
    expect(useStart().screen).toBe('budgets');
    expect(useStart().pendingOpen).toMatchObject({ cloudFileId: 'c1' });
    expect(methods()).not.toContain('session.openBudget');
  });

  it('with the server unreachable, opens the last budget offline', async () => {
    useSettings().app = {
      ...DEFAULT_APP_SETTINGS,
      serverUrl: 'https://budget.test',
      lastBudget: { cloudFileId: 'c1', groupId: 'g1', name: 'Home' },
    };
    responses['session.connect'] = () => {
      throw new RpcError('offline', 'down', { code: 'network-failure', diagnosis: 'none' });
    };
    responses['session.openBudget'] = () => ({ ...budget, localOnly: true });
    await startup();
    expect(useAppStore().screen).toBe('welcome');
  });

  it('asks for the encryption password and opens again with it (03 §7)', async () => {
    let attempts = 0;
    responses['session.openBudget'] = () => {
      attempts++;
      if (attempts === 1) throw new RpcError('actual', 'missing', { code: 'missing-key' });
      return budget;
    };
    const opening = openBudget({ cloudFileId: 'c1', name: 'Home' });
    await flushPromises();
    const prompts = usePrompts();
    expect(prompts.encryption).toMatchObject({ name: 'Home', retry: false });
    prompts.answerEncryption({ password: 'secret', remember: true });
    await opening;
    expect(call).toHaveBeenLastCalledWith('session.openBudget', {
      cloudFileId: 'c1',
      e2ePassword: 'secret',
      remember: true,
    });
    expect(useAppStore().screen).toBe('welcome');
  });

  it('a budget a restarted host could not reopen is handled like a failed open (03 §6.5)', async () => {
    useSettings().app = {
      ...DEFAULT_APP_SETTINGS,
      serverUrl: 'https://budget.test',
      lastBudget: { cloudFileId: 'c1', groupId: 'g1', name: 'Home' },
    };
    useAppStore().navigate('budget');
    responses['session.openBudget'] = () => budget;
    const failing = restoreFailed('c1', {
      code: 'actual',
      message: 'missing',
      details: { code: 'missing-key' },
    });
    await flushPromises();
    expect(useAppStore().screen).toBe('start');
    const prompts = usePrompts();
    expect(prompts.encryption).toMatchObject({ name: 'Home', retry: false });
    prompts.answerEncryption({ password: 'secret', remember: false });
    await failing;
    expect(call).toHaveBeenLastCalledWith('session.openBudget', {
      cloudFileId: 'c1',
      e2ePassword: 'secret',
      remember: false,
    });

    const gone = restoreFailed('c1', {
      code: 'not-found',
      message: 'gone',
      details: { code: 'budget-not-found' },
    });
    await flushPromises();
    expect(useStart().screen).toBe('budgets');
    expect(useDialogs().stack[0]?.options.instruction).toBe(
      'This budget no longer exists on the server.',
    );
    await answerDialog('close');
    await gone;
  });

  it('warns that a tracking budget is not supported, and stays on the Budget List', async () => {
    responses['session.openBudget'] = () => {
      throw new RpcError('validation', 'tracking', { code: 'tracking-budget' });
    };
    const opening = openBudget({ cloudFileId: 'c1', name: 'Home' });
    await flushPromises();
    const options = useDialogs().stack[0]?.options;
    expect(options?.instruction).toBe("This budget can't be opened in Actuality");
    expect(options?.content).toMatch(/Actuality supports envelope budgets only/);
    await answerDialog('close');
    await opening;
    expect(useStart().screen).toBe('budgets');
  });

  it('shows the error for a budget that is gone, and stays on the Budget List', async () => {
    responses['session.openBudget'] = () => {
      throw new RpcError('not-found', 'gone', { code: 'budget-not-found' });
    };
    const opening = openBudget({ cloudFileId: 'c1', name: 'Home' });
    await flushPromises();
    expect(useDialogs().stack[0]?.options.instruction).toBe(
      'This budget no longer exists on the server.',
    );
    await answerDialog('close');
    await opening;
    expect(useStart().screen).toBe('budgets');
  });

  it('shows no dialog of its own for a call the failed host rejected (03 §6.5)', async () => {
    await showUnexpected(new RpcError('internal', 'stopped', { code: HOST_FAILED }));
    expect(useDialogs().stack).toHaveLength(0);
  });

  it('Cancel on a slow Loading screen returns to the list and closes the budget once open (07 §5)', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    responses['session.openBudget'] = () =>
      new Promise((resolve) => {
        finish = () => {
          resolve(budget);
        };
      });
    const opening = openBudget({ cloudFileId: 'c1', name: 'Home' });
    const start = useStart();
    expect(start.screen).toBe('loading');
    expect(start.loadingCancelable).toBe(false);
    vi.advanceTimersByTime(LOADING_CANCEL_AFTER_MS);
    expect(start.loadingCancelable).toBe(true);
    start.cancelLoading();
    expect(start.screen).toBe('budgets');
    finish();
    await opening;
    expect(call).toHaveBeenLastCalledWith('session.closeBudget', { force: false });
    expect(useAppStore().screen).toBe('start');
  });

  it('creates a budget, opens it and remembers the formats (07 §4)', async () => {
    responses['budgetFile.create'] = () => budget;
    const set = vi.spyOn(useSettings(), 'set').mockResolvedValue();
    await createBudget('Home', template, formats);
    expect(call).toHaveBeenCalledWith('budgetFile.create', {
      name: 'Home',
      template,
      formats,
      force: true,
    });
    expect(useAppStore().screen).toBe('welcome');
    expect(set).toHaveBeenCalledWith('lastPickedCurrency', 'USD');
    expect(set).toHaveBeenCalledWith('lastPickedDateFormat', 'MM/dd/yyyy');
  });

  it('returns to Budget Setup with the duplicate-name message', async () => {
    responses['budgetFile.create'] = () => {
      throw new RpcError('conflict', 'dup', { code: 'duplicate-name' });
    };
    await createBudget('Home', template, formats);
    expect(useStart().screen).toBe('setup');
    expect(useStart().setupError).toBe("You already have a budget named 'Home' on this server");
  });

  it('a failed upload goes back to the Budget List with its dialog (S-8)', async () => {
    responses['budgetFile.create'] = () => {
      throw new RpcError('actual', 'lost', { code: 'upload-failed' });
    };
    const creating = createBudget('Home', template, formats);
    await flushPromises();
    expect(useDialogs().stack[0]?.options.instruction).toContain(
      "couldn't be uploaded to your Actual server",
    );
    await answerDialog('close');
    await creating;
    expect(useStart().screen).toBe('budgets');
  });

  it('start screens opened over a budget return to it (07 §4, §7)', () => {
    useConnection().info = online;
    const app = useAppStore();
    app.navigate('reports');
    showStartScreen('preferences');
    expect(app.screen).toBe('start');
    leaveStartScreen();
    expect(app.screen).toBe('reports');
    // Opened from another start screen, Back returns to it.
    app.navigate('start');
    useStart().show('budgets');
    showStartScreen('open');
    leaveStartScreen();
    expect(useStart().screen).toBe('budgets');
  });

  it('File ▸ Open goes straight to Open Budget when there are no other recent budgets (07 §3.2)', () => {
    useConnection().info = online;
    useAppStore().navigate('welcome');
    openFromMenu();
    expect(useStart().screen).toBe('open');
    expect(useStart().canGoBack).toBe(true);
    useSettings().app = {
      ...DEFAULT_APP_SETTINGS,
      recentBudgets: [{ cloudFileId: 'c2', groupId: 'g2', name: 'Other', lastOpenedAt: 1 }],
    };
    useAppStore().navigate('welcome');
    openFromMenu();
    expect(useStart().screen).toBe('budgets');
  });

  it('Close Budget returns to the list, or to Connect when the session was signed out (03 §4)', async () => {
    useConnection().info = online;
    await closeBudgetToList();
    expect(call).toHaveBeenCalledWith('session.closeBudget', { force: true });
    expect(useStart().screen).toBe('budgets');
    useConnection().info = { ...online, state: 'OfflineReadOnly', signedOut: true };
    await closeBudgetToList();
    expect(useStart().screen).toBe('connect');
    expect(useStart().connectAddress).toBe('https://budget.test');
  });

  it('Retry now explains a certificate problem once, with its action (03 §9.1)', async () => {
    const offline = { ...online, state: 'OfflineReadOnly' as const };
    responses['session.retryConnection'] = () => ({ connection: offline, diagnosis: 'none' });
    await retryConnection();
    expect(useDialogs().stack).toHaveLength(0);

    responses['session.retryConnection'] = () => ({
      connection: offline,
      diagnosis: 'tls-untrusted',
      errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    const retrying = retryConnection();
    await flushPromises();
    const dialog = useDialogs().stack[0]?.options;
    expect(dialog?.instruction).toContain("doesn't trust the security certificate for");
    expect(dialog?.buttons).toContainEqual({
      id: 'trustCertificate',
      label: 'Trust a certificate file…',
    });
    await answerDialog('close');
    await retrying;

    responses['session.retryConnection'] = () => ({
      connection: offline,
      diagnosis: 'tls-other',
      errorCode: 'EPROTO',
    });
    const other = retryConnection();
    await flushPromises();
    expect(useDialogs().stack[0]?.options.instruction).toContain('(EPROTO)');
    expect(useDialogs().stack[0]?.options.buttons).toEqual(['close']);
    await answerDialog('close');
    await other;
  });
});

describe('the last screen (06 §3)', () => {
  let patchBudget: MockInstance<ShellApi['settings']['patchBudget']>;

  const restoring = async (lastScreen: string | null, accountIds: string[] = []) => {
    vi.spyOn(window.app.shell.settings, 'getBudget').mockResolvedValue({
      ...DEFAULT_BUDGET_SETTINGS,
      lastScreen,
    });
    patchBudget = vi
      .spyOn(window.app.shell.settings, 'patchBudget')
      .mockImplementation((_id, patch) =>
        Promise.resolve({ ...DEFAULT_BUDGET_SETTINGS, ...(patch as Partial<BudgetSettings>) }),
      );
    vi.spyOn(host, 'call').mockImplementation((method) => {
      if (method === 'session.openBudget') {
        useConnection().info = online;
        return Promise.resolve(budget as never);
      }
      if (method === 'accounts.list')
        return Promise.resolve(accountIds.map((id) => ({ id, name: id })) as never);
      return Promise.resolve({ ...INITIAL_CONNECTION } as never);
    });
    await openBudget({ cloudFileId: 'c1', name: 'Home' });
    return useAppStore();
  };

  it('reopens on the saved screen', async () => {
    expect((await restoring('reports')).screen).toBe('reports');
  });

  it('reopens on an account’s register by its id', async () => {
    const app = await restoring('account:a2', ['a1', 'a2']);
    expect(app.screen).toBe('register');
    expect(app.activeAccountId).toBe('a2');
  });

  it('falls back to Budget when the account is gone, and to Welcome with nothing saved', async () => {
    expect((await restoring('account:gone', ['a1'])).screen).toBe('budget');
    expect((await restoring(null)).screen).toBe('welcome');
    expect((await restoring('all')).activeAccountId).toBe('all');
  });

  it('saves every main-canvas screen for the next start', async () => {
    const app = await restoring(null);
    const patch = patchBudget;
    app.toAccount('a1');
    expect(patch).toHaveBeenLastCalledWith('c1', { lastScreen: 'account:a1' });
    await flushPromises();
    app.toAllAccounts();
    await flushPromises();
    expect(patch).toHaveBeenLastCalledWith('c1', { lastScreen: 'all' });
    app.toBudget();
    await flushPromises();
    expect(patch).toHaveBeenLastCalledWith('c1', { lastScreen: 'budget' });
    app.toWelcome();
    await flushPromises();
    expect(patch).toHaveBeenLastCalledWith('c1', { lastScreen: null });
  });

  it('ignores navigation while the current screen is loading, but not a start screen', async () => {
    const app = await restoring('budget');
    app.busy = true;
    expect(app.toReports()).toBe(false);
    expect(app.screen).toBe('budget');
    showStartScreen('preferences');
    expect(app.screen).toBe('start');
    app.busy = false;
    leaveStartScreen();
    expect(app.screen).toBe('budget');
  });
});

describe('leaving the server, errors and the Error state (03 §4, §5.4, §7, §9)', () => {
  let responses: Partial<Record<HostMethod, Responder>>;
  let call: MockInstance<typeof host.call>;

  beforeEach(() => {
    responses = {
      'session.serverVersion': () => '26.10.0',
      'session.signOut': () => ({ ...online, state: 'SignedOut', budget: null }),
      'session.openBudget': () => budget,
    };
    call = vi.spyOn(host, 'call').mockImplementation(async (method, params) => {
      const respond = responses[method];
      if (!respond) return { ...INITIAL_CONNECTION };
      return (await respond(params)) as never;
    });
    useConnection().info = online;
  });

  const calls = (method: HostMethod): unknown[] =>
    call.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
  /** Answers the open dialog and returns its options. */
  const answer = async (button: string | null) => {
    await flushPromises();
    const dialogs = useDialogs();
    const top = dialogs.stack.at(-1);
    if (!top) throw new Error('no dialog open');
    dialogs.close(top.id, { button, checkboxChecked: false });
    await flushPromises();
    return top.options;
  };

  it('signs out straight away with nothing unsynced, back to Connect with the address', async () => {
    await signOut();
    expect(calls('session.signOut')).toEqual([{ force: true }]);
    expect(useStart().screen).toBe('connect');
    expect(useStart().connectAddress).toBe('https://budget.test');
    expect(useAppStore().screen).toBe('start');
  });

  it('asks before signing out with unsynced changes: Try again syncs and asks again', async () => {
    useConnection().info = { ...online, unsyncedChanges: true };
    const cancelled = signOut();
    const asked = await answer('cancel');
    await cancelled;
    expect(asked.instruction).toBe("Some changes haven't reached your server");
    expect(asked.buttons).toContainEqual({ id: 'anyway', label: 'Sign out anyway' });
    expect(calls('session.signOut')).toEqual([]);

    const signingOut = signOut();
    await answer('retry');
    await answer('anyway');
    await signingOut;
    expect(calls('session.syncNow')).toHaveLength(1);
    expect(calls('session.signOut')).toEqual([{ force: true }]);
  });

  it('changes server after its confirmation and the unsynced question, to an empty Connect', async () => {
    const cancelled = changeServer();
    const confirm = await answer('cancel');
    await cancelled;
    expect(confirm.buttons).toContainEqual({ id: 'change', label: 'Change server' });
    expect(calls('session.forgetServer')).toEqual([]);

    useConnection().info = { ...online, unsyncedChanges: true };
    const unsynced = changeServer();
    await answer('change');
    const asked = await answer('cancel');
    await unsynced;
    expect(asked.buttons).toContainEqual({ id: 'anyway', label: 'Change server anyway' });
    expect(calls('session.forgetServer')).toEqual([]);

    useConnection().info = online;
    useStart().connectAddress = 'https://old.test';
    const changing = changeServer();
    await answer('change');
    await changing;
    expect(calls('session.forgetServer')).toEqual([{ force: true }]);
    expect(useStart().screen).toBe('connect');
    expect(useStart().connectAddress).toBe('');
  });

  it('Close Budget stops when the unsynced question is cancelled', async () => {
    useConnection().info = { ...online, unsyncedChanges: true };
    const closing = closeBudgetToList();
    await answer('cancel');
    await closing;
    expect(calls('session.closeBudget')).toEqual([]);
  });

  it('a budget reset on another device downloads again or closes (03 §9)', async () => {
    useConnection().info = { ...online, unsyncedChanges: true };
    const downloading = handleErrorState('file-has-reset');
    const asked = await answer('download');
    await downloading;
    expect(asked.instruction).toBe('This budget was changed on another device');
    expect(asked.content).toMatch(/^<p>.*<\/p><p>.*<\/p>$/);
    expect(calls('session.closeBudget')).toEqual([{ force: true }]);
    expect(calls('session.openBudget')).toEqual([{ cloudFileId: 'c1' }]);

    useConnection().info = online;
    const closing = handleErrorState('file-has-reset');
    const plain = await answer('close');
    await closing;
    expect(plain.content).not.toContain('<p>');
    expect(calls('session.openBudget')).toHaveLength(1);
    expect(useStart().screen).toBe('budgets');
    expect(useAppStore().screen).toBe('start');
  });

  it('explains the other Error states and goes to the Budget List', async () => {
    const shown = async (code: string | undefined) => {
      const handling = handleErrorState(code);
      const options = await answer('close');
      await handling;
      return options;
    };
    expect((await shown('out-of-sync-migrations')).instruction).toMatch(/can't be opened/);
    expect((await shown('decrypt-failure')).instruction).toBe(
      "That password didn't work. Try again.",
    );
    // A reset with no budget open is any other error.
    useConnection().info = { ...online, budget: null };
    expect((await shown('file-has-reset')).instruction).toBe('Something went wrong');
    expect((await shown(undefined)).instruction).toBe('Something went wrong');
    expect(calls('session.closeBudget')).toHaveLength(4);
    expect(useStart().screen).toBe('budgets');
  });

  it('shows an unreachable server, a missing permission, and nothing once the host has failed', async () => {
    const shown = async (e: unknown) => {
      const showing = showUnexpected(e);
      const options = await answer('close');
      await showing;
      return options.instruction;
    };
    expect(
      await shown(new RpcError('offline', 'down', { code: 'network-failure', diagnosis: 'none' })),
    ).toContain('https://budget.test');
    expect(await shown(new RpcError('actual', 'no', { code: 'permission-denied' }))).toMatch(
      /^You don't have permission/,
    );
    await showUnexpected(new RpcError('internal', 'gone', { code: HOST_FAILED }));
    expect(useDialogs().stack).toEqual([]);
  });

  it('explains each failed open (03 §7, §9)', async () => {
    const failed = async (e: RpcError): Promise<string | null> => {
      responses['session.openBudget'] = () => {
        throw e;
      };
      const opening = openBudget({ cloudFileId: 'c1', name: 'Home' });
      await flushPromises();
      if (useDialogs().stack.length === 0) {
        await opening;
        return null;
      }
      const options = await answer('close');
      await opening;
      return options.instruction;
    };
    expect(await failed(new RpcError('actual', 'old', { code: 'old-key-style' }))).toMatch(
      /old encryption format/,
    );
    expect(await failed(new RpcError('not-found', 'gone'))).toBe(
      'This budget no longer exists on the server.',
    );
    expect(await failed(new RpcError('actual', 'x', { code: 'out-of-sync-migrations' }))).toMatch(
      /can't be opened/,
    );
    expect(await failed(new RpcError('offline', 'down'))).toMatch(/^Couldn't reach your Actual/);
    expect(await failed(new RpcError('actual', 'boom'))).toBe('Something went wrong');
    // The sign-in modal handles an expired session.
    expect(await failed(new RpcError('auth', 'Sign in.'))).toBeNull();
    expect(useStart().screen).toBe('budgets');
  });

  it('opens the budget a sign-in was waiting for', async () => {
    await continuePendingOpen();
    expect(calls('session.openBudget')).toEqual([]);
    useStart().pendingOpen = { cloudFileId: 'c1', name: 'Home' };
    await continuePendingOpen();
    expect(calls('session.openBudget')).toEqual([{ cloudFileId: 'c1' }]);
  });

  it('warns about a server older than the minimum after signing in (21 §7)', async () => {
    responses['session.serverVersion'] = () => '1.0.0';
    await connectWithPassword('https://budget.test', 'pw', false);
    const warning = await answer('ok');
    expect(warning.instruction).toMatch(
      /^This server runs Actual 1\.0\.0\. Actuality needs Actual /,
    );
    expect(useStart().screen).toBe('budgets');
  });

  it('OpenID sign-in shows the Budget List, unless it resumed an open budget', async () => {
    useConnection().info = { ...online, budget: null };
    useStart().show('connect');
    await connectWithOpenId('https://budget.test', true);
    expect(calls('session.connectOpenId')).toEqual([
      { serverURL: 'https://budget.test', remember: true },
    ]);
    expect(useStart().screen).toBe('budgets');

    useConnection().info = online;
    useStart().show('connect');
    await connectWithOpenId('https://budget.test', true);
    expect(useStart().screen).toBe('connect');
  });

  it('startup without a last budget shows the Budget List; a failed sign-in shows its error', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, serverUrl: 'https://budget.test' };
    await startup();
    expect(useStart().screen).toBe('budgets');
    expect(calls('session.openBudget')).toEqual([]);

    responses['session.connect'] = () => {
      throw new RpcError('actual', 'boom');
    };
    const starting = startup();
    const error = await answer('close');
    await starting;
    expect(error.instruction).toBe('Something went wrong');
    expect(useStart().screen).toBe('budgets');

    responses['session.connect'] = () => {
      throw new RpcError('offline', 'down', { code: 'network-failure', diagnosis: 'none' });
    };
    await startup();
    await flushPromises();
    expect(useDialogs().stack).toEqual([]);
    expect(useStart().screen).toBe('budgets');
  });

  it('Go Back returns from the Budget List to the open budget', () => {
    useAppStore().navigate('budget');
    showStartScreen('budgets');
    useStart().canGoBack = true;
    goBackToBudget();
    expect(useStart().canGoBack).toBe(false);
    expect(useAppStore().screen).toBe('budget');
  });

  it('a failed Create Budget returns to Budget Setup with the error', async () => {
    responses['budgetFile.create'] = () => {
      throw new RpcError('actual', 'boom');
    };
    useConnection().info = { ...online, budget: null };
    const creating = createBudget('Home', template, formats);
    const error = await answer('close');
    await creating;
    expect(error.instruction).toBe('Something went wrong');
    expect(useStart().screen).toBe('setup');
  });

  it('a failed budget-file import explains a bad file and other errors', async () => {
    vi.mocked(window.app.shell.files).openFile.mockResolvedValue('/files/budget.zip');
    const imported = async (e: RpcError): Promise<string> => {
      responses['budgetFile.importFile'] = () => {
        throw e;
      };
      const importing = importBudgetFile();
      await answer('actual');
      const options = await answer('close');
      await importing;
      return options.instruction;
    };
    expect(await imported(new RpcError('actual', 'bad', { code: 'bad-file' }))).toMatch(
      /^This file couldn't be imported/,
    );
    expect(
      await imported(new RpcError('validation', 'tracking', { code: 'tracking-budget' })),
    ).toBe("This budget can't be opened in Actuality");
    expect(await imported(new RpcError('actual', 'boom'))).toBe('Something went wrong');
  });
});
