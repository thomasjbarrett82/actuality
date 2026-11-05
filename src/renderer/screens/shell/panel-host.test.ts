// The panel host (06 §2–3): the loading illustration the first time a screen shows (until its data has
// arrived and 1 s has passed), navigation ignored meanwhile, and focus on the new panel's heading.
import { INITIAL_CONNECTION } from '@shared/connection';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app';
import { useConnection } from '../../stores/connection';
import { account, budgetResponses, mockHost } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import PanelHost from './PanelHost.vue';

beforeEach(() => {
  vi.useFakeTimers();
  mockHost({
    'accounts.list': () => [account({ id: 'a1', name: 'Checking' })],
    'transactions.list': () => [],
    'categories.tree': () => [],
    'payees.list': () => [],
    'prefs.synced': () => ({}),
    ...budgetResponses(['2026-09', '2026-10', '2026-11']),
  });
  const connection = useConnection();
  connection.info = {
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
  connection.hostReady = true;
});
afterEach(() => {
  vi.useRealTimers();
});

function mountHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mountApp(PanelHost, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

describe('PanelHost (06 §2–3)', () => {
  it('shows the illustration once per screen, for at least 1 s, and blocks navigation meanwhile', async () => {
    const app = useAppStore();
    app.navigate('budget');
    const w = mountHost();
    await flushPromises();
    expect(w.find('[role="status"]').exists()).toBe(true);
    expect(w.attributes('aria-busy')).toBe('true');
    expect(app.toReports()).toBe(false);
    vi.advanceTimersByTime(999);
    await flushPromises();
    expect(app.busy).toBe(true);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(app.busy).toBe(false);
    expect(document.activeElement?.textContent.trim()).toBe('Budget');

    // A register: its heading is the account's name once the accounts have loaded.
    expect(app.toAccount('a1')).toBe(true);
    await flushPromises();
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(document.activeElement?.textContent.trim()).toBe('Checking');

    // Seen before: no illustration, no wait.
    app.toBudget();
    await flushPromises();
    expect(app.busy).toBe(false);
    expect(w.find('.panel-host__loading').exists()).toBe(false);
    vi.useRealTimers();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('shows All Accounts as the register heading', async () => {
    useAppStore().toAllAccounts();
    const w = mountHost();
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(w.find('h1').text()).toBe('All Accounts');
  });
});
