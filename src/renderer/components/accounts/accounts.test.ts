// The account dialogs and the register's account header (13 §2–5): Create Account's defaults and checks,
// rename and notes in the header (offline too), and the close, force close and delete flows.
import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import type { Account } from '@shared/domain/types';
import { HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import type { HostMethod } from '@shared/rpc/host-api';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Component } from 'vue';
import { closeAccount, deleteAccount } from '../../accounts/flows';
import { headerRequest } from '../../accounts/header-request';
import { host } from '../../rpc/host-client';
import { useCallouts } from '../../stores/callouts';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
import { answerCallout, answerModal } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import NoteCallout from '../budget/NoteCallout.vue';
import AccountHeader from '../register/AccountHeader.vue';
import CloseAccountDialog from './CloseAccountDialog.vue';
import CreateAccountDialog from './CreateAccountDialog.vue';

function account(a: Partial<Account> & { id: string; name: string }): Account {
  return {
    onBudget: true,
    closed: false,
    sortIndex: 0,
    note: null,
    lastReconciledDate: null,
    accountGroupId: null,
    balances: { cleared: 0, uncleared: 0, working: 0, reconciled: 0 },
    attention: { count: 0, maxLevel: 'none' },
    hasTransactions: false,
    scheduledCount: 0,
    ...a,
  };
}

const CHECKING = account({
  id: 'chk',
  name: 'Checking',
  note: 'Joint',
  hasTransactions: true,
  balances: { cleared: 0, uncleared: 0, working: 12_345, reconciled: 0 },
});
const HOUSE = account({ id: 'house', name: 'House', onBudget: false });

const online: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'Online',
  budget: {
    cloudFileId: 'c1',
    groupId: 'g1',
    name: 'Home',
    budgetType: 'envelope',
    localOnly: false,
  },
};

let call: MockInstance<typeof host.call>;
let responses: Partial<Record<HostMethod, (params: unknown) => unknown>>;

beforeEach(() => {
  responses = {
    'accounts.list': () => [CHECKING, HOUSE, account({ id: 'na', name: 'New Account' })],
    'prefs.synced': () => ({ defaultCurrencyCode: 'USD' }),
    'categories.tree': () => [
      {
        id: 'g',
        name: 'Bills',
        isIncome: false,
        hidden: false,
        sortIndex: 1,
        note: null,
        categories: [
          {
            id: 'rent',
            groupId: 'g',
            name: 'Rent',
            isIncome: false,
            hidden: false,
            sortIndex: 1,
            note: null,
          },
        ],
      },
    ],
    'accounts.create': () => ({ id: 'new' }),
  };
  call = vi.spyOn(host, 'call').mockImplementation(async (method, params) => {
    const respond = responses[method];
    return (respond ? await respond(params) : null) as never;
  });
  useConnection().info = online;
  useConnection().hostReady = true;
});

async function open(component: Component, props: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const wrapper = mountApp(component, {
    props,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
}

/** The top TaskDialog: its instruction and content, then answers it. */
async function answer(button: string | null): Promise<{ instruction: string; content: string }> {
  await flushPromises();
  const dialogs = useDialogs();
  const top = dialogs.stack.at(-1);
  if (!top) throw new Error('no dialog');
  dialogs.close(top.id, { button, checkboxChecked: false });
  await flushPromises();
  return { instruction: top.options.instruction, content: top.options.content ?? '' };
}

const field = (w: Awaited<ReturnType<typeof open>>, label: string) => {
  const id = w
    .findAll('label')
    .find((l) => l.text() === label)
    ?.attributes('for');
  return w.get(`#${CSS.escape(id ?? '')}`);
};
const button = (w: Awaited<ReturnType<typeof open>>, text: string) => {
  const found = w.findAll('button').find((b) => b.text().includes(text));
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

describe('Create Account (13 §2)', () => {
  it('starts from a unique default name, on budget, with no balance', async () => {
    const w = await open(CreateAccountDialog);
    expect((field(w, 'Name:').element as HTMLInputElement).value).toBe('New Account 2');
    expect((w.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
    expect(w.text()).toContain('Off budget');
    expect(w.text()).not.toContain('Type:');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('creates it with the balance as typed, any sign, without asking', async () => {
    const w = await open(CreateAccountDialog);
    await field(w, 'Name:').setValue('Visa');
    await field(w, 'Balance:').setValue('-500');
    await button(w, 'Create Account').trigger('click');
    await flushPromises();
    expect(useDialogs().stack).toEqual([]);
    expect(call).toHaveBeenCalledWith('accounts.create', {
      name: 'Visa',
      onBudget: true,
      balance: -50_000,
    });
    expect(w.emitted('close')?.[0]).toEqual(['new']);
  });

  it('creates an off-budget account; an empty balance is 0', async () => {
    const w = await open(CreateAccountDialog);
    await field(w, 'Name:').setValue('Brokerage');
    await w.get('input[type="checkbox"]').setValue(true);
    await button(w, 'Create Account').trigger('click');
    await flushPromises();
    expect(call).toHaveBeenCalledWith('accounts.create', {
      name: 'Brokerage',
      onBudget: false,
      balance: 0,
    });
  });

  it('refuses a duplicate name and an invalid balance', async () => {
    const w = await open(CreateAccountDialog);
    await field(w, 'Name:').setValue('checking');
    await button(w, 'Create Account').trigger('click');
    expect(await answer('close')).toEqual({
      instruction: 'Please choose a different account name',
      content: 'An account with this name already exists.',
    });
    await field(w, 'Name:').setValue('Wallet');
    await field(w, 'Balance:').setValue('1.2.3');
    await button(w, 'Create Account').trigger('click');
    expect(await answer('close')).toEqual({
      instruction: 'Invalid Balance',
      content: "'**1.2.3**' is not a valid number",
    });
    expect(call).not.toHaveBeenCalledWith('accounts.create', expect.anything());
  });

  it('masks a typed balance in privacy mode once the field loses focus (06 §7)', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: true };
    const w = await open(CreateAccountDialog);
    const input = field(w, 'Balance:');
    await input.setValue('12.34');
    await input.trigger('blur');
    expect((input.element as HTMLInputElement).value).toBe(HIDDEN_AMOUNT_TEXT);
    await button(w, 'Create Account').trigger('click');
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      'accounts.create',
      expect.objectContaining({ balance: 1_234 }),
    );
    useSettings().app = DEFAULT_APP_SETTINGS;
  });
});

describe('the account header (13 §3)', () => {
  const heading = (w: Awaited<ReturnType<typeof open>>) => w.get('h1');
  const iconButton = (w: Awaited<ReturnType<typeof open>>, name: string) =>
    w.get(`button[aria-label="${name}"]`);

  it('shows the name as the heading, with Notes, Rename and the account menu', async () => {
    const w = await open(AccountHeader, { account: CHECKING, ready: true });
    expect(heading(w).text()).toBe('Checking');
    expect(heading(w).attributes('data-ready')).toBe('true');
    const notes = iconButton(w, 'Account notes');
    // Described by its note (and its tooltip, which the directive adds).
    const [described] = (notes.attributes('aria-describedby') ?? '').split(' ');
    expect(w.get(`[id="${described ?? ''}"]`).text()).toBe('Joint');
    expect(iconButton(w, 'Account actions').attributes('aria-haspopup')).toBe('menu');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('renames in place: an error keeps the input open, Enter saves, Esc cancels', async () => {
    const w = await open(AccountHeader, { account: CHECKING, ready: true });
    await iconButton(w, 'Rename account').trigger('click');
    await flushPromises();
    const input = w.get('h1 input');
    expect(input.attributes('aria-label')).toBe('Account name');
    expect(document.activeElement).toBe(input.element);
    await input.setValue('house');
    await input.trigger('keydown', { key: 'Enter' });
    expect(await answer('close')).toEqual({
      instruction: 'Choose a different account name',
      content: "You already have an account named 'house'",
    });
    expect(w.find('h1 input').exists()).toBe(true);
    expect(call).not.toHaveBeenCalledWith('accounts.update', expect.anything());
    await input.setValue('Joint Checking');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(call).toHaveBeenCalledWith('accounts.update', { id: 'chk', name: 'Joint Checking' });
    expect(w.find('h1 input').exists()).toBe(false);
    expect(document.activeElement).toBe(iconButton(w, 'Rename account').element);

    call.mockClear();
    await iconButton(w, 'Rename account').trigger('click');
    await flushPromises();
    await w.get('h1 input').setValue('Other');
    await w.get('h1 input').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(w.find('h1 input').exists()).toBe(false);
    expect(call).not.toHaveBeenCalledWith('accounts.update', expect.anything());
  });

  it("edits the account's native note in the note popover", async () => {
    const w = await open(AccountHeader, { account: CHECKING, ready: true });
    await iconButton(w, 'Account notes').trigger('click');
    await flushPromises();
    const popover = useCallouts().open[0];
    expect(popover?.component).toBe(NoteCallout);
    expect(popover?.options.title).toBe('Checking');
    (popover?.props['update'] as (text: string) => void)('Joint account ');
    await answerCallout('done');
    expect(call).toHaveBeenCalledWith('accounts.update', { id: 'chk', note: 'Joint account' });
  });

  it('closes from the ⋯ menu, and a closed account offers Re-open (13 §4)', async () => {
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValue('close');
    const w = await open(AccountHeader, { account: HOUSE, ready: true });
    await iconButton(w, 'Account actions').trigger('click');
    await flushPromises();
    expect(menu.mock.calls[0]?.[0].map((i) => i.label)).toEqual(['Close Account']);
    expect(useModals().stack[0]?.component).toBe(CloseAccountDialog);
    await answerModal(null);
    expect(call).not.toHaveBeenCalledWith('accounts.close', expect.anything());

    menu.mockClear().mockResolvedValue('reopen');
    const closed = await open(AccountHeader, { account: { ...HOUSE, closed: true }, ready: true });
    await iconButton(closed, 'Account actions').trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(menu.mock.calls[0]?.[0].map((i) => i.label)).toEqual(['Re-open Account']);
    expect(call).toHaveBeenCalledWith('accounts.reopen', { id: 'house' });
  });

  it('acts on a Rename Account asked for from the sidebar once the register is shown', async () => {
    headerRequest.value = { accountId: 'chk', action: 'rename' };
    const w = await open(AccountHeader, { account: CHECKING, ready: false });
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(w.find('h1 input').exists()).toBe(false);
    await w.setProps({ ready: true });
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(w.find('h1 input').exists()).toBe(true);
    expect(headerRequest.value).toBeNull();
  });

  it('is disabled offline, with the offline tooltip, and stays focusable', async () => {
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    const menu = vi.spyOn(window.app.shell, 'showContextMenu');
    const w = await open(AccountHeader, { account: CHECKING, ready: true });
    for (const name of ['Account notes', 'Rename account', 'Account actions'])
      expect(iconButton(w, name).attributes('aria-disabled')).toBe('true');
    await iconButton(w, 'Rename account').trigger('click');
    await iconButton(w, 'Account notes').trigger('click');
    await iconButton(w, 'Account actions').trigger('click');
    await flushPromises();
    expect(w.find('h1 input').exists()).toBe(false);
    expect(useCallouts().open).toEqual([]);
    expect(menu).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('closing and deleting (13 §4–5)', () => {
  const EMPTY = account({ id: 'empty', name: 'Empty' });
  const SETTLED = account({ id: 'settled', name: 'Settled', hasTransactions: true });

  it('says an account without transactions will be deleted, and offers no force close', async () => {
    const w = await open(CloseAccountDialog, { account: EMPTY });
    expect(w.text()).toContain(
      "Close 'Empty'? This account has no transactions, so it will be permanently deleted.",
    );
    expect(w.text()).not.toContain('Force close');
    await button(w, 'Close Account').trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ action: 'close' }]);
  });

  it('closes an account with transactions at a zero balance, or offers force close', async () => {
    const w = await open(CloseAccountDialog, { account: SETTLED });
    expect(w.text()).toContain(
      "Close 'Settled'? This account has transactions, so it can't be permanently deleted. You can re-open it later from Closed Accounts.",
    );
    expect(w.text()).toContain(
      "Force close deletes this account and all of its transactions. This can't be undone.",
    );
    await button(w, 'Force close').trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ action: 'forceClose' }]);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('needs an account for a balance, and a category moving on-budget money off-budget', async () => {
    const w = await open(CloseAccountDialog, { account: CHECKING });
    expect(w.text()).toContain(
      "Close 'Checking'? To close it, choose an account to transfer the remaining $123.45 into.",
    );
    await field(w, 'Transfer to:').setValue('house');
    expect(button(w, 'Close Account').attributes('disabled')).toBeDefined();
    await field(w, 'Category:').setValue('rent');
    await button(w, 'Close Account').trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([
      { action: 'close', transfer: { transferAccountId: 'house', transferCategoryId: 'rent' } },
    ]);
  });

  it('runs the choice: close with the transfer, or delete after force close', async () => {
    expect(await closeAccount(EMPTY, () => Promise.resolve(null))).toBeNull();
    expect(call).not.toHaveBeenCalledWith('accounts.close', expect.anything());

    const transfer = { transferAccountId: 'house' };
    expect(await closeAccount(CHECKING, () => Promise.resolve({ action: 'close', transfer }))).toBe(
      'closed',
    );
    expect(call).toHaveBeenCalledWith('accounts.close', { id: 'chk', transferAccountId: 'house' });
    // Without transactions, Actual's close deletes it.
    expect(await closeAccount(EMPTY, () => Promise.resolve({ action: 'close' }))).toBe('deleted');

    const forcing = closeAccount(CHECKING, () => Promise.resolve({ action: 'forceClose' }));
    await answer('delete');
    expect(await forcing).toBe('deleted');
    expect(call).toHaveBeenCalledWith('accounts.delete', { id: 'chk' });
  });

  it('confirms a delete with what it loses, and Cancel keeps the account', async () => {
    const deleting = deleteAccount(CHECKING);
    expect(await answer('cancel')).toEqual({
      instruction: "Delete account 'Checking'?",
      content:
        'Deleting an account cannot be undone. All of its transactions will be deleted, and if it is an on-budget account, the money in them will disappear from your budget.',
    });
    expect(await deleting).toBe(false);
    expect(call).not.toHaveBeenCalledWith('accounts.delete', expect.anything());
  });
});
