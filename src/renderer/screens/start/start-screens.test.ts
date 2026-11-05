import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import type { BudgetListEntry, BudgetProperties, HostMethod } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Component } from 'vue';
import SignInModal from '../../components/session/SignInModal.vue';
import { host } from '../../rpc/host-client';
import { useAppStore } from '../../stores/app';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useSettings } from '../../stores/settings';
import { useStart } from '../../stores/start';
import { axe, mountApp } from '../../testing/mount';
import BudgetSetupScreen from './BudgetSetupScreen.vue';
import LoadingScreen from './LoadingScreen.vue';
import OpenBudgetScreen from './OpenBudgetScreen.vue';
import PreferencesScreen from './PreferencesScreen.vue';

const budgets: BudgetListEntry[] = [
  {
    cloudFileId: 'c2',
    groupId: 'g2',
    name: 'Team',
    encrypted: true,
    offlineCopy: false,
    shared: true,
  },
  {
    cloudFileId: 'c1',
    groupId: 'g1',
    name: 'Home',
    encrypted: false,
    offlineCopy: true,
    shared: false,
  },
];
const properties: BudgetProperties = {
  name: 'Home',
  currency: 'EUR',
  numberFormat: 'dot-comma',
  dateFormat: 'dd.MM.yyyy',
  hideFraction: false,
  renameAvailable: true,
  shared: false,
  firstDayOfWeek: null,
  encryption: 'disabled',
  encryptionKeyAvailable: true,
};
const online: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'Online',
  serverUrl: 'https://budget.test',
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
    'session.listBudgets': () => budgets,
    'budgetFile.properties': () => properties,
    'session.serverVersion': () => null,
  };
  call = vi.spyOn(host, 'call').mockImplementation(async (method, params) => {
    const respond = responses[method];
    return (respond ? await respond(params) : { ...INITIAL_CONNECTION }) as never;
  });
  window.app.shell.secrets.available = vi.fn(() => Promise.resolve(true));
  window.app.shell.secrets.has = vi.fn(() => Promise.resolve(true));
});

function mountScreen(component: Component): ReturnType<typeof mountApp> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return mountApp(component, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

describe('Loading screen (07 §5)', () => {
  it('shows the message, and Cancel only after 10 s', async () => {
    vi.useFakeTimers();
    const start = useStart();
    start.loading('Loading "Home"');
    const wrapper = mountScreen(LoadingScreen);
    expect(wrapper.text()).toContain('Loading "Home"');
    expect(wrapper.text()).not.toContain('Cancel');
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    await wrapper.get('button').trigger('click');
    expect(start.screen).toBe('budgets');
    vi.useRealTimers();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Open Budget screen (07 §3.2)', () => {
  it('lists every budget by name, with Shared, Encrypted and Offline copy', async () => {
    const wrapper = mountScreen(OpenBudgetScreen);
    await flushPromises();
    const rows = wrapper.findAll('tbody tr');
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining('Home'),
      expect.stringContaining('Team'),
    ]);
    expect(rows[1]?.text()).toContain('Shared');
    expect(rows[0]?.attributes('aria-selected')).toBe('true');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('opens with Enter on a row, and with the Open button', async () => {
    responses['session.openBudget'] = () => online.budget;
    const wrapper = mountScreen(OpenBudgetScreen);
    await flushPromises();
    const rows = wrapper.findAll('tbody tr');
    await rows[0]?.trigger('keydown', { key: 'ArrowDown' });
    expect(rows[1]?.attributes('aria-selected')).toBe('true');
    await rows[1]?.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(call).toHaveBeenCalledWith('session.openBudget', { cloudFileId: 'c2' });
  });
});

describe('Budget Setup (07 §4)', () => {
  beforeEach(() => {
    useStart().show('setup');
    useAppStore().navigate('start');
  });

  it('starts from the defaults and creates the chosen template with the formats', async () => {
    useSettings().app = {
      ...DEFAULT_APP_SETTINGS,
      lastPickedCurrency: 'CAD',
      lastPickedNumberFormat: 'comma-dot',
      lastPickedDateFormat: 'yyyy-MM-dd',
    };
    responses['session.listBudgets'] = () => [];
    responses['budgetFile.create'] = () => online.budget;
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('#setup-name').element.value).toBe('My Budget');
    expect(wrapper.get<HTMLSelectElement>('#setup-currency').element.value).toBe('CAD');
    expect(wrapper.find('#setup-week').exists()).toBe(false);
    await wrapper.get('input[value="business"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const created = call.mock.calls.find(([m]) => m === 'budgetFile.create')?.[1] as {
      template: { groups: { name: string; categories: string[] }[] };
      formats: unknown;
    };
    expect(created.template.groups[0]).toEqual({
      name: 'Marketing',
      categories: ['Printing', 'Online', 'Referral Fees', 'Commissions'],
    });
    expect(created.formats).toEqual({
      currency: 'CAD',
      numberFormat: 'comma-dot',
      dateFormat: 'yyyy-MM-dd',
      hideFraction: false,
    });
  });

  it('stops on the first problem, and refuses a name the server already has', async () => {
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    await wrapper.get('#setup-name').setValue('   ');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toBe('You need to give this budget a name first');
    await wrapper.get('#setup-name').setValue('Home');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "You already have a budget named 'Home' on this server",
    );
    expect(call.mock.calls.some(([m]) => m === 'budgetFile.create')).toBe(false);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Budget Properties (07 §4)', () => {
  beforeEach(() => {
    useConnection().info = online;
    useStart().show('properties');
    useAppStore().navigate('start');
  });

  it('shows the budget’s values and saves only what changed', async () => {
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Starting Categories');
    expect(wrapper.get<HTMLSelectElement>('#setup-number').element.value).toBe('dot-comma');
    await wrapper.get('#setup-name').setValue('Our Home');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(call).toHaveBeenCalledWith('budgetFile.updateProperties', {
      name: 'Our Home',
      hideFraction: true,
    });
  });

  it('shows the locale’s week start while unset, and saves a chosen first day of the week', async () => {
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    const week = wrapper.get<HTMLSelectElement>('#setup-week');
    expect(week.findAll('option').map((o) => o.text())).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
    expect(week.element.selectedIndex).toBe(0);
    await wrapper.get('#setup-name').setValue('Our Home');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await week.setValue('1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const saves = call.mock.calls.filter(([m]) => m === 'budgetFile.updateProperties');
    expect(saves.map(([, p]) => p)).toEqual([
      { name: 'Our Home' },
      { name: 'Our Home', firstDayOfWeek: 1 },
    ]);
  });

  it('is read-only offline, with only Close (03 §5.3)', async () => {
    useConnection().info = { ...online, state: 'OfflineReadOnly' };
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.get('#setup-name').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Close']);
  });

  it('keeps the name of a Shared budget read-only (03 §7.1)', async () => {
    responses['budgetFile.properties'] = () => ({ ...properties, shared: true });
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.get('#setup-name').attributes('readonly')).toBeDefined();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('enables end-to-end encryption apart from Save Changes, then shows it enabled (03 §7)', async () => {
    let encryption: BudgetProperties['encryption'] = 'disabled';
    responses['budgetFile.properties'] = () => ({ ...properties, encryption });
    responses['budgetFile.setEncryptionKey'] = () => {
      encryption = 'enabled';
      return { rememberFailed: false, forgetFailed: false };
    };
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.text()).toContain('Not enabled');
    const enable = wrapper.findAll('button').find((b) => b.text() === 'Enable encryption');
    await enable?.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('This resets syncing.');
    const field = document.querySelector<HTMLInputElement>('#key-password');
    expect(field?.type).toBe('password');
    document.querySelector<HTMLButtonElement>('[aria-label="Show password"]')?.click();
    await flushPromises();
    expect(field?.type).toBe('text');
    expect(await axe(document.body)).toHaveNoViolations();
    if (field) {
      field.value = 'secret';
      field.dispatchEvent(new Event('input'));
    }
    document.querySelector<HTMLFormElement>('form.key')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(call).toHaveBeenCalledWith('budgetFile.setEncryptionKey', {
      password: 'secret',
      remember: false,
    });
    expect(call).not.toHaveBeenCalledWith('budgetFile.updateProperties', expect.anything());
    expect(document.querySelector('#key-password')).toBeNull();
    expect(wrapper.text()).toContain('Enabled');
    expect(wrapper.findAll('button').map((b) => b.text())).toContain('Generate a new key');
    expect(useDialogs().stack).toEqual([]);
  });

  it('warns when the password could not be remembered, without calling the key change failed', async () => {
    responses['budgetFile.setEncryptionKey'] = () => ({
      rememberFailed: true,
      forgetFailed: false,
    });
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Enable encryption')
      ?.trigger('click');
    await flushPromises();
    const field = document.querySelector<HTMLInputElement>('#key-password');
    if (field) {
      field.value = 'secret';
      field.dispatchEvent(new Event('input'));
    }
    document.querySelector<HTMLInputElement>('.key input[type="checkbox"]')?.click();
    document.querySelector<HTMLFormElement>('form.key')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(call).toHaveBeenCalledWith('budgetFile.setEncryptionKey', {
      password: 'secret',
      remember: true,
    });
    expect(document.querySelector('#key-password')).toBeNull();
    expect(useDialogs().stack.at(-1)?.options).toMatchObject({
      instruction: "The password wasn't remembered",
      icon: 'warning',
    });
  });

  it('warns when the old remembered password could not be removed', async () => {
    responses['budgetFile.setEncryptionKey'] = () => ({
      rememberFailed: false,
      forgetFailed: true,
    });
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Enable encryption')
      ?.trigger('click');
    await flushPromises();
    const field = document.querySelector<HTMLInputElement>('#key-password');
    if (field) {
      field.value = 'secret';
      field.dispatchEvent(new Event('input'));
    }
    document.querySelector<HTMLFormElement>('form.key')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(document.querySelector('#key-password')).toBeNull();
    expect(useDialogs().stack.at(-1)?.options).toMatchObject({
      instruction: 'The old password is still saved',
      icon: 'warning',
    });
  });

  it('shows a failed key change in the dialog and does not retry it', async () => {
    responses['budgetFile.setEncryptionKey'] = () => {
      throw new RpcError('actual', 'Upload failed', { code: 'upload-failure' });
    };
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Enable encryption')
      ?.trigger('click');
    await flushPromises();
    const field = document.querySelector<HTMLInputElement>('#key-password');
    if (field) {
      field.value = 'secret';
      field.dispatchEvent(new Event('input'));
    }
    document.querySelector<HTMLFormElement>('form.key')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(document.body.textContent).toContain("Encryption couldn't be set up: Upload failed");
    expect(call.mock.calls.filter(([m]) => m === 'budgetFile.setEncryptionKey')).toHaveLength(1);
  });

  it('shows the encryption status as unknown and offers no action when it can’t be read', async () => {
    responses['budgetFile.properties'] = () => ({ ...properties, encryption: 'unknown' });
    const wrapper = mountScreen(BudgetSetupScreen);
    await flushPromises();
    expect(wrapper.text()).toContain('Unknown while offline');
    expect(wrapper.text()).not.toContain('Enable encryption');
  });
});

describe('Preferences (07 §7)', () => {
  it('saves settings as they change and clears the cache after confirming', async () => {
    useConnection().info = online;
    const set = vi.spyOn(useSettings(), 'set').mockResolvedValue();
    const wrapper = mountScreen(PreferencesScreen);
    await flushPromises();
    expect(wrapper.text()).toContain('Connected to https://budget.test');
    expect(wrapper.get<HTMLInputElement>('input[readonly]').element.value).toBe(
      '/user/actual-cache',
    );
    await wrapper.get('input[value="dark"]').setValue(true);
    expect(set).toHaveBeenCalledWith('appearance', 'dark');
    const clear = wrapper.findAll('button').find((b) => b.text() === 'Clear Offline Cache…');
    await clear?.trigger('click');
    await flushPromises();
    const dialogs = useDialogs();
    expect(dialogs.stack[0]?.options.instruction).toBe('Clear offline cache?');
    const top = dialogs.stack[0];
    if (top) dialogs.close(top.id, { button: 'clear', checkboxChecked: false });
    await flushPromises();
    expect(call).toHaveBeenCalledWith('session.clearCache', { force: true });
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('stores or forgets the session token with Stay signed in', async () => {
    useConnection().info = online;
    const wrapper = mountScreen(PreferencesScreen);
    await flushPromises();
    const box = wrapper
      .findAll('label')
      .find((l) => l.text() === 'Stay signed in on this computer')
      ?.get('input');
    expect((box?.element as HTMLInputElement | undefined)?.checked).toBe(true);
    await box?.setValue(false);
    await flushPromises();
    expect(call).toHaveBeenCalledWith('session.setStaySignedIn', { on: false });
  });
});

describe('Preferences ▸ Diagnostics (07 §7, 02 §8.6)', () => {
  const debugBox = (wrapper: ReturnType<typeof mountScreen>) =>
    wrapper
      .findAll('label')
      .find((l) => l.text() === 'Enable debug logging')
      ?.get<HTMLInputElement>('input');

  it('shows the saved value and writes debugLogging', async () => {
    useSettings().app.debugLogging = true;
    const set = vi.spyOn(useSettings(), 'set').mockResolvedValue();
    const wrapper = mountScreen(PreferencesScreen);
    await flushPromises();
    const box = debugBox(wrapper);
    expect(box?.element.checked).toBe(true);
    await box?.setValue(false);
    expect(set).toHaveBeenCalledWith('debugLogging', false);
    expect(box?.attributes('aria-describedby')).toBe('prefs-debug-hint');
    expect(wrapper.get('#prefs-debug-hint').text()).toBe(
      'Records detailed diagnostic information in the log file to help find problems. Passwords, tokens and budget contents are never recorded.',
    );
  });

  it('is the last setting before Done, and reachable by keyboard', async () => {
    const wrapper = mountScreen(PreferencesScreen);
    await flushPromises();
    const box = debugBox(wrapper);
    const inputs = wrapper.findAll('input');
    expect(inputs.at(-1)?.element).toBe(box?.element);
    expect(box?.element.disabled).toBe(false);
    expect(box?.element.tabIndex).toBeGreaterThanOrEqual(0);
    box?.element.focus();
    expect(document.activeElement).toBe(box?.element);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Sign-in modal (03 §6.3)', () => {
  beforeEach(() => {
    useConnection().info = {
      ...INITIAL_CONNECTION,
      state: 'AuthRequired',
      serverUrl: 'https://budget.test',
    };
  });

  it('signs in with a password, and shows a wrong one inline', async () => {
    responses['session.probeLogin'] = () => ({ method: 'password', displayName: '' });
    let attempts = 0;
    const { RpcError } = await import('@shared/rpc/protocol');
    responses['session.connect'] = () => {
      attempts++;
      if (attempts === 1) throw new RpcError('auth', 'no', { code: 'invalid-password' });
      return { ...INITIAL_CONNECTION, state: 'SignedIn' };
    };
    const wrapper = mountScreen(SignInModal);
    await flushPromises();
    expect(wrapper.text()).toContain('Sign in to your Actual server');
    await wrapper.get('input[type="password"]').setValue('bad');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('That password is incorrect.');
    await wrapper.get('input[type="password"]').setValue('good');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith('session.serverVersion', {});
    expect(wrapper.emitted('signedIn')).toHaveLength(1);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('offers the OpenID sign-in, and Cancel follows 03 §4', async () => {
    responses['session.probeLogin'] = () => ({ method: 'openid', displayName: 'Authentik' });
    responses['session.cancelSignIn'] = () => ({
      ...INITIAL_CONNECTION,
      serverUrl: 'https://budget.test',
    });
    const wrapper = mountScreen(SignInModal);
    await flushPromises();
    expect(wrapper.text()).toContain('This server signs in with Authentik.');
    expect(wrapper.findAll('button').map((b) => b.text())).toContain('Sign in with Authentik');
    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancel');
    await cancel?.trigger('click');
    await flushPromises();
    expect(call).toHaveBeenCalledWith('session.cancelSignIn', {});
    expect(useStart().screen).toBe('connect');
    expect(useStart().connectAddress).toBe('https://budget.test');
  });
});
