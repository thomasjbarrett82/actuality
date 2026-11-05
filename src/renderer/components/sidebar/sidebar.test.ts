// The sidebar (08, 22 §2.3–2.4): groups, balances and badges, compact mode, selection, the keyboard tree
// and the account menu. Drag-and-drop needs real layout and is covered by the E2E journey.
import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import type { Account } from '@shared/domain/types';
import type { HostMethod } from '@shared/rpc/host-api';
import { DEFAULT_APP_SETTINGS, DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import type { ShellApi } from '@shared/shell-api';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { liveRegions, resetAnnouncer } from '../../a11y/announcer';
import { headerRequest } from '../../accounts/header-request';
import { commands } from '../../commands';
import { host } from '../../rpc/host-client';
import { useAppStore } from '../../stores/app';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
import { answerModal } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import CloseAccountDialog from '../accounts/CloseAccountDialog.vue';
import TheSidebar from './TheSidebar.vue';

function account(a: Partial<Account> & { id: string; name: string; working?: number }): Account {
  const { working = 0, ...rest } = a;
  return {
    onBudget: true,
    closed: false,
    sortIndex: 0,
    note: null,
    lastReconciledDate: null,
    accountGroupId: null,
    balances: { cleared: working, uncleared: 0, working, reconciled: 0 },
    attention: { count: 0, maxLevel: 'none' },
    hasTransactions: working !== 0,
    scheduledCount: 0,
    ...rest,
  };
}

let accounts: Account[];
let queryClient: QueryClient;
let call: MockInstance<typeof host.call>;
let responses: Partial<Record<HostMethod, (params: unknown) => unknown>>;
let patchBudget: MockInstance<ShellApi['settings']['patchBudget']>;
let showContextMenu: MockInstance<ShellApi['showContextMenu']>;
let setSetting: MockInstance<ShellApi['settings']['set']>;

const online: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'Online',
  serverUrl: 'https://budget.test',
  lastSyncAt: Date.UTC(2026, 9, 20, 9, 30),
  budget: {
    cloudFileId: 'c1',
    groupId: 'g1',
    name: 'Home',
    budgetType: 'envelope',
    localOnly: false,
  },
};

beforeEach(() => {
  accounts = [
    account({
      id: 'chk',
      name: 'Checking',
      sortIndex: 1,
      working: 200_000,
      note: 'Joint',
      attention: { count: 3, maxLevel: 'error' },
    }),
    account({ id: 'sav', name: 'Savings', sortIndex: 2, working: 350_000 }),
    account({
      id: 'visa',
      name: 'Visa',
      sortIndex: 3,
      working: -50_000,
      attention: { count: 1, maxLevel: 'forReview' },
    }),
    account({ id: 'house', name: 'House', onBudget: false, sortIndex: 1, working: 10_000_000 }),
  ];
  responses = {
    'accounts.list': () => accounts,
    'prefs.synced': () => ({ defaultCurrencyCode: 'USD' }),
  };
  call = vi.spyOn(host, 'call').mockImplementation(async (method, params) => {
    const respond = responses[method];
    return (respond ? await respond(params) : null) as never;
  });
  const connection = useConnection();
  connection.info = online;
  connection.hostReady = true;
  useSettings().app = { ...DEFAULT_APP_SETTINGS };
  const budget = useBudgetSettings();
  budget.cloudFileId = 'c1';
  budget.settings = { ...DEFAULT_BUDGET_SETTINGS };
  showContextMenu = vi.spyOn(window.app.shell, 'showContextMenu');
  setSetting = vi.spyOn(window.app.shell.settings, 'set');
  patchBudget = vi
    .spyOn(window.app.shell.settings, 'patchBudget')
    .mockImplementation((_id, patch) =>
      Promise.resolve({ ...budget.settings, ...(patch as object) }),
    );
  useAppStore().navigate('welcome');
});

async function mountSidebar() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const wrapper = mountApp(TheSidebar, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
}

const treeitems = (w: Awaited<ReturnType<typeof mountSidebar>>) => w.findAll('[role="treeitem"]');
/** A row's visible parts (badge, label, balance), space-separated. */
const rowText = (r: { element: Element }): string =>
  [...r.element.children]
    .filter((c) => !c.classList.contains('visually-hidden'))
    .map((c) => c.textContent.trim())
    .filter(Boolean)
    .join(' ');
/** A row's accessible name, computed from its content: everything not hidden from assistive technology. */
const rowName = (r: { element: Element }): string =>
  [...r.element.children]
    .filter((c) => c.getAttribute('aria-hidden') !== 'true')
    .map((c) => c.textContent.trim())
    .filter(Boolean)
    .join(' ');
const item = (w: Awaited<ReturnType<typeof mountSidebar>>, text: string) => {
  const found = treeitems(w).find((el) => el.text().includes(text));
  if (!found) throw new Error(`no tree item ${text}`);
  return found;
};

describe('layout (08 §1–2)', () => {
  it('shows the sections, groups, balances and badges', async () => {
    const w = await mountSidebar();
    expect(treeitems(w).map(rowText)).toEqual([
      'Budget',
      'Reports',
      'All Accounts $105,000.00',
      'Budget Accounts 4 $5,000.00',
      '3 Checking 2,000.00',
      'Savings 3,500.00',
      '1 Visa -500.00',
      'Off-Budget Accounts $100,000.00',
      'House 100,000.00',
    ]);
    // The negative balance uses --negative-on-blue; Closed is hidden while it's empty.
    expect(item(w, 'Visa').find('.row__balance--negative').exists()).toBe(true);
    expect(w.text()).not.toContain('Closed Accounts');
    // The name comes from the content: the visible label, then the amount in full and the badge's
    // sentence; the visible badge and balance are hidden from it (22 §4.3, WCAG 2.5.3).
    expect(item(w, 'Checking').attributes('aria-label')).toBeUndefined();
    expect(rowName(item(w, 'Checking'))).toBe(
      'Checking , $2,000.00, There are 3 transactions that require your attention.',
    );
    expect(item(w, 'Budget Accounts').find('.badge--error').text()).toBe('4');
    expect(item(w, 'Visa').find('.badge--forReview').exists()).toBe(true);
    expect(w.text()).toContain('Connected');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('compact mode shortens the labels and hides balances and group badges', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, sidebarExpanded: false };
    const w = await mountSidebar();
    const texts = treeitems(w).map(rowText);
    expect(texts).toContain('Accounts');
    expect(texts).toContain('Budget Accts');
    expect(texts).toContain('Off-Budget Accts');
    expect(texts).toContain('3 Checking');
    expect(texts.join(' ')).not.toContain('2,000.00');
    expect(w.find('[aria-label="Add"]').exists()).toBe(true);
  });

  it('is compact at 150% zoom without changing the setting (22 §5)', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, zoomFactor: 1.5 };
    const w = await mountSidebar();
    expect(w.text()).toContain('Budget Accts');
    expect(useSettings().app.sidebarExpanded).toBe(true);
  });

  it('expands and collapses with the toggle at 150% zoom, keeping the setting', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, zoomFactor: 1.6 };
    const w = await mountSidebar();
    const toggle = () => w.get('button.toggle');
    expect(toggle().attributes('aria-pressed')).toBe('true');
    expect(toggle().attributes('aria-label')).toBe('Click to expand the sidebar');
    await toggle().trigger('click');
    expect(w.text()).toContain('Budget Accounts');
    expect(toggle().attributes('aria-pressed')).toBe('false');
    expect(toggle().attributes('aria-label')).toBe('Click to collapse the sidebar');
    await toggle().trigger('click');
    expect(w.text()).toContain('Budget Accts');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('saves expanded when the toggle expands a collapsed sidebar at 150% zoom', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, sidebarExpanded: false, zoomFactor: 1.6 };
    const w = await mountSidebar();
    await w.get('button.toggle').trigger('click');
    expect(setSetting).toHaveBeenCalledWith('sidebarExpanded', true);
  });

  it('collapses an empty Budget Accounts group', async () => {
    accounts = accounts.filter((a) => !a.onBudget);
    const w = await mountSidebar();
    expect(item(w, 'Budget Accounts').attributes('aria-expanded')).toBe('false');
  });
});

describe('selection and groups (08 §2.3, §3)', () => {
  it('opens the register of a clicked account and marks it selected', async () => {
    const w = await mountSidebar();
    await item(w, 'Savings').trigger('click');
    expect(useAppStore()).toMatchObject({ screen: 'register', activeAccountId: 'sav' });
    expect(item(w, 'Savings').attributes('aria-selected')).toBe('true');
    await item(w, 'All Accounts').trigger('click');
    expect(useAppStore()).toMatchObject({ screen: 'register', activeAccountId: 'all' });
  });

  it('saves a collapsed group, and moves the selection out of it', async () => {
    const w = await mountSidebar();
    useAppStore().toAccount('sav');
    await flushPromises();
    await item(w, 'Budget Accounts').trigger('click');
    await flushPromises();
    expect(patchBudget).toHaveBeenCalledWith('c1', {
      onBudgetGroupCollapsed: true,
    });
    expect(useAppStore().activeAccountId).toBe('house');
    expect(w.text()).not.toContain('Savings');
  });

  it('expands a collapsed group when one of its accounts is selected', async () => {
    useBudgetSettings().settings = { ...DEFAULT_BUDGET_SETTINGS, offBudgetGroupCollapsed: true };
    await mountSidebar();
    useAppStore().toAccount('house');
    await flushPromises();
    expect(patchBudget).toHaveBeenCalledWith('c1', {
      offBudgetGroupCollapsed: false,
    });
  });

  it('hands the selection on when the selected account is closed or deleted (08 §2.3)', async () => {
    await mountSidebar();
    useAppStore().toAccount('sav');
    await flushPromises();
    // A data:changed refetch delivers it closed: Budget Accounts is searched first.
    accounts = accounts.map((a) => (a.id === 'sav' ? { ...a, closed: true } : a));
    await queryClient.invalidateQueries();
    await flushPromises();
    expect(useAppStore().activeAccountId).toBe('visa');
    // Deleted: the same search from where it was.
    accounts = accounts.filter((a) => a.id !== 'visa');
    await queryClient.invalidateQueries();
    await flushPromises();
    expect(useAppStore().activeAccountId).toBe('chk');
  });
});

describe('keyboard tree (22 §2.3–2.4)', () => {
  it('moves with the arrows, Home/End and typeahead, and opens with Enter', async () => {
    const w = await mountSidebar();
    const first = treeitems(w)[0];
    (first?.element as HTMLElement | undefined)?.focus();
    await first?.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Reports');
    await item(w, 'Reports').trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(document.activeElement?.textContent).toContain('House');
    await item(w, 'House').trigger('keydown', { key: 's' });
    await flushPromises();
    expect(document.activeElement?.textContent).toContain('Savings');
    await item(w, 'Savings').trigger('keydown', { key: 'Enter' });
    expect(useAppStore().activeAccountId).toBe('sav');
    // ← on an account goes to its header; ← again collapses the group.
    await item(w, 'Savings').trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();
    expect(document.activeElement?.textContent).toContain('Budget Accounts');
    await item(w, 'Budget Accounts').trigger('keydown', { key: 'ArrowLeft' });
    expect(patchBudget).toHaveBeenCalledWith('c1', {
      onBudgetGroupCollapsed: true,
    });
  });

  it('only the focused item is a Tab stop', async () => {
    useAppStore().toAccount('visa');
    const w = await mountSidebar();
    const stops = treeitems(w).filter((r) => r.attributes('tabindex') === '0');
    expect(stops.map((r) => r.text())).toEqual([expect.stringContaining('Visa')]);
  });

  it('Alt+↓ and Alt+↑ move an account inside its group, never past its edge', async () => {
    const w = await mountSidebar();
    await item(w, 'Checking').trigger('keydown', { key: 'ArrowDown', altKey: true });
    await flushPromises();
    expect(call).toHaveBeenCalledWith('accounts.reorder', {
      id: 'chk',
      beforeId: 'visa',
      group: 'onBudget',
    });
    call.mockClear();
    await item(w, 'Visa').trigger('keydown', { key: 'ArrowDown', altKey: true });
    await item(w, 'House').trigger('keydown', { key: 'ArrowUp', altKey: true });
    await flushPromises();
    expect(call).not.toHaveBeenCalledWith('accounts.reorder', expect.anything());
  });

  it('Shift+F10 opens the account menu, the same as a right-click (08 §2.2)', async () => {
    const w = await mountSidebar();
    const menu = showContextMenu.mockResolvedValue('rename');
    (item(w, 'Savings').element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }));
    await flushPromises();
    const items = menu.mock.calls[0]?.[0] ?? [];
    expect(items.map((i) => [i.label ?? '-', i.enabled])).toEqual([
      ['Rename Account', true],
      ['Edit Account Note', true],
      ['Close Account', true],
      ['-', undefined],
      ['Move Up', true],
      ['Move Down', true],
    ]);
    // Rename Account opens the account's register; its header renames there (13 §3).
    expect(headerRequest.value).toEqual({ accountId: 'sav', action: 'rename' });
    expect(useAppStore().activeAccountId).toBe('sav');
    headerRequest.value = null;
    // A right-click gives the same menu.
    menu.mockClear().mockResolvedValue('note');
    await item(w, 'Visa').trigger('contextmenu');
    await flushPromises();
    expect(menu.mock.calls[0]?.[0].map((i) => i.label ?? '-')).toEqual(
      items.map((i) => i.label ?? '-'),
    );
    expect(headerRequest.value).toEqual({ accountId: 'visa', action: 'note' });
    headerRequest.value = null;
  });

  it('Close Account asks in its dialog and keeps the closed account selected (13 §4)', async () => {
    accounts = accounts.map((a) =>
      a.id === 'sav' ? { ...a, balances: { ...a.balances, working: 0 }, hasTransactions: true } : a,
    );
    useAppStore().toAccount('sav');
    const w = await mountSidebar();
    showContextMenu.mockResolvedValue('closeOrReopen');
    responses['accounts.close'] = () => {
      accounts = accounts.map((a) => (a.id === 'sav' ? { ...a, closed: true } : a));
      return null;
    };
    await item(w, 'Savings').trigger('contextmenu');
    await flushPromises();
    expect(useModals().stack[0]?.component).toBe(CloseAccountDialog);
    await answerModal({ action: 'close' });
    expect(call).toHaveBeenCalledWith('accounts.close', { id: 'sav' });
    await queryClient.invalidateQueries();
    await flushPromises();
    // It moved to Closed Accounts and stays selected, so its menu offers Re-open.
    expect(useAppStore().activeAccountId).toBe('sav');
    expect(item(w, 'Savings').attributes('aria-selected')).toBe('true');
    showContextMenu.mockClear().mockResolvedValue('closeOrReopen');
    await item(w, 'Savings').trigger('contextmenu');
    await flushPromises();
    expect(showContextMenu.mock.calls[0]?.[0][2]?.label).toBe('Re-open Account');
    expect(call).toHaveBeenCalledWith('accounts.reopen', { id: 'sav' });
  });

  it('the Edit menu runs the account actions on the active account (06 §4)', async () => {
    await mountSidebar();
    useAppStore().toAccount('visa');
    await flushPromises();
    await commands.run('edit.editAccountNote');
    expect(headerRequest.value).toEqual({ accountId: 'visa', action: 'note' });
    headerRequest.value = null;
    await commands.run('edit.reopenAccount');
    expect(call).not.toHaveBeenCalledWith('accounts.reopen', expect.anything());
    const closing = commands.run('edit.closeAccount');
    await flushPromises();
    expect(useModals().stack[0]?.component).toBe(CloseAccountDialog);
    await answerModal(null);
    await closing;
    expect(call).not.toHaveBeenCalledWith('accounts.close', expect.anything());
  });
});

describe('bottom controls (08 §2.4)', () => {
  it('Add Account opens Create Account, but not offline', async () => {
    const w = await mountSidebar();
    await w.get('button.add').trigger('click');
    expect(useModals().stack).toHaveLength(1);
    useModals().stack.splice(0);
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    await flushPromises();
    expect(w.get('button.add').attributes('aria-disabled')).toBe('true');
    await w.get('button.add').trigger('click');
    expect(useModals().stack).toHaveLength(0);
  });

  it('the toggle collapses the sidebar', async () => {
    const w = await mountSidebar();
    await w.get('button.toggle').trigger('click');
    expect(setSetting).toHaveBeenCalledWith('sidebarExpanded', false);
  });

  it('the privacy toggle masks every balance and announces the change (06 §7)', async () => {
    setSetting.mockImplementation((key, value) =>
      Promise.resolve({ ...useSettings().app, [key]: value }),
    );
    const w = await mountSidebar();
    const toggle = () => w.get('button.privacy');
    expect(toggle().attributes('aria-pressed')).toBe('false');
    expect(toggle().attributes('aria-label')).toBe('Privacy mode');

    await toggle().trigger('click');
    await flushPromises();
    expect(setSetting).toHaveBeenCalledWith('privacyMode', true);
    expect(toggle().attributes('aria-pressed')).toBe('true');
    expect(toggle().attributes('aria-label')).toBe('Privacy mode');
    expect(liveRegions.polite).toBe('Privacy mode on');
    // Every balance is the mask, named "Hidden amount"; no amount's digits are left anywhere.
    expect(rowText(item(w, 'Checking'))).toBe('3 Checking');
    expect(item(w, 'Checking').get('.money-mask').attributes('aria-label')).toBe('Hidden amount');
    expect(rowName(item(w, 'Checking'))).toBe(
      'Checking , Hidden amount, There are 3 transactions that require your attention.',
    );
    expect(w.findAll('.money-mask')).toHaveLength(7);
    expect(w.text()).not.toMatch(/\d\.\d\d/);
    for (const amount of ['105,000.00', '5,000.00', '2,000.00', '3,500.00', '500.00'])
      expect(w.html()).not.toContain(amount);
    expect(await axe(document.body)).toHaveNoViolations();

    await toggle().trigger('click');
    await flushPromises();
    expect(setSetting).toHaveBeenLastCalledWith('privacyMode', false);
    expect(rowText(item(w, 'Checking'))).toBe('3 Checking 2,000.00');
    expect(w.find('.money-mask').exists()).toBe(false);
  });

  it('a toggle from the keyboard-focused button isn\u2019t announced twice, a menu toggle is', async () => {
    const w = mountApp(TheSidebar, {
      attachTo: document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
    });
    await flushPromises();
    const app = useAppStore();
    const settings = useSettings();
    resetAnnouncer();
    (w.get('button.privacy').element as HTMLButtonElement).focus();
    settings.app = { ...settings.app, privacyMode: true };
    await flushPromises();
    expect(liveRegions.polite).toBe('');

    (document.activeElement as HTMLElement).blur();
    settings.app = { ...settings.app, privacyMode: false };
    await flushPromises();
    expect(app.privacyMode).toBe(false);
    expect(liveRegions.polite).toBe('Privacy mode off');
    w.unmount();
  });

  it('the privacy toggle stays enabled offline', async () => {
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    const w = await mountSidebar();
    expect(w.get('button.privacy').attributes('disabled')).toBeUndefined();
    expect(w.get('button.privacy').attributes('aria-disabled')).toBeUndefined();
  });

  it('the server web link sits between the privacy toggle and the indicator and opens the server (08 §2.4)', async () => {
    const openExternal = vi.spyOn(window.app.shell, 'openExternal');
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    const w = await mountSidebar();
    const link = w.get('button.server-web');
    expect(link.attributes('aria-label')).toBe('Connect to https://budget.test web');
    const order = w.findAll('.sidebar__indicator > *').map((el) => el.classes()[0]);
    expect(order.slice(0, 3)).toEqual(['privacy', 'server-web', 'indicator']);
    await link.trigger('click');
    expect(openExternal).toHaveBeenCalledWith('https://budget.test');

    useConnection().info = { ...online, serverUrl: null };
    await flushPromises();
    expect(w.find('button.server-web').exists()).toBe(false);
  });

  it('the connection indicator follows the state and syncs or retries', async () => {
    const w = await mountSidebar();
    const indicator = () => w.get('.indicator');
    expect(indicator().classes()).toContain('indicator--online');
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    await flushPromises();
    expect(indicator().text()).toBe('Offline');
    await indicator().trigger('click');
    expect(call).toHaveBeenCalledWith('session.retryConnection', {});
    useConnection().info = { ...online, state: 'OfflineReadOnly', signedOut: true };
    await flushPromises();
    expect(indicator().text()).toBe('Signed out');
    useConnection().info = { ...online, unsyncedChanges: true };
    await flushPromises();
    expect(indicator().text()).toBe('Not synced');
    useConnection().info = { ...online, state: 'Error' };
    await flushPromises();
    expect(indicator().text()).toBe('Error');
  });
});
