// The Reports screen (15): the focused heading labelling the main region, Summary first, the
// manual-activation tabs, only the active report requested, linked filters across pages, Comparison's
// independent Compare Period, a saved-filter override that stays isolated until Use linked filters, the
// explicit loading, error and empty states, expandable tables and privacy masking. The host answers with
// the real shared calculation.
import { INITIAL_CONNECTION } from '@shared/connection';
import type { ISODate } from '@shared/domain/types';
import type { ReportInput } from '@shared/reporting/input';
import type { ReportRequest } from '@shared/reporting/model';
import { buildReport } from '@shared/reporting/reports';
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportsView } from '../../reports/state';
import { useAppStore } from '../../stores/app';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useSettings } from '../../stores/settings';
import { account, mockHost } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import MainScreen from './MainScreen.vue';
import PanelHost from './PanelHost.vue';

const TODAY = new Date(2026, 9, 20, 12);
const side = (
  id: string,
  date: string,
  amount: number,
  more: Partial<ReportInput['sides'][number]> = {},
): ReportInput['sides'][number] => ({
  id,
  transactionId: id,
  line: 0,
  accountId: 'a1',
  date: date as ISODate,
  amount,
  payeeId: null,
  categoryId: null,
  transferAccountId: null,
  startingBalance: false,
  ...more,
});

const INPUT: ReportInput = {
  accounts: [{ id: 'a1', name: 'Checking', offBudget: false, closed: false, sortIndex: 1 }],
  groups: [
    {
      id: 'gi',
      name: 'Income',
      isIncome: true,
      categories: [{ id: 'ci', name: 'Pay', groupId: 'gi', isIncome: true }],
    },
    {
      id: 'g1',
      name: 'Bills',
      isIncome: false,
      categories: [
        { id: 'c1', name: 'Rent', groupId: 'g1', isIncome: false },
        { id: 'c2', name: 'Power', groupId: 'g1', isIncome: false },
      ],
    },
  ],
  payees: [{ id: 'p1', name: 'Job', transferAccountId: null }],
  sides: [
    side('t1', '2026-09-01', 100_000, { payeeId: 'p1', categoryId: 'ci' }),
    side('t2', '2026-09-03', -40_000, { categoryId: 'c1' }),
    side('t3', '2026-10-03', -40_000, { categoryId: 'c1' }),
    side('t4', '2026-10-05', -5_000, { categoryId: 'c2' }),
  ],
};

let host: ReturnType<typeof mockHost>;
let fail = false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  fail = false;
  host = mockHost({
    'accounts.list': () => [account({ id: 'a1', name: 'Checking' })],
    'categories.tree': () => [],
    'payees.list': () => [],
    'prefs.synced': () => ({}),
    'reports.get': (p) => {
      if (fail) throw new Error('boom');
      return buildReport(INPUT, p);
    },
  });
  vi.spyOn(window.app.shell.settings, 'patchBudget').mockImplementation((_id, patch) =>
    Promise.resolve({ ...useBudgetSettings().settings, ...patch } as BudgetSettings),
  );
  useBudgetSettings().cloudFileId = 'c1';
  useBudgetSettings().settings = { ...DEFAULT_BUDGET_SETTINGS };
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

function mount(component: typeof MainScreen) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mountApp(component, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    attachTo: document.body,
  });
}

const requests = (): ReportRequest[] => host.calls('reports.get') as ReportRequest[];

describe('the Reports screen (15)', () => {
  it('opens on Summary with its heading focused, requesting only Summary', async () => {
    const app = useAppStore();
    app.navigate('reports');
    const w = mount(PanelHost);
    await flushPromises();
    const heading = w.get('h1');
    expect(heading.text()).toBe('Reports');
    expect(document.activeElement).toBe(heading.element);
    const tabs = w.findAll('[role="tab"]');
    expect(tabs.map((t) => t.text())).toEqual([
      'Summary',
      'Spending Breakdown',
      'Spending Comparison',
      'Inflow vs Outflow',
      'Net Worth',
    ]);
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    expect(requests().map((r) => r.kind)).toEqual(['summary']);
    expect(requests()[0]).toMatchObject({ today: '2026-10-20' });
    expect(w.text()).toContain('Total Inflow');
    expect(w.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(
      tabs[0]?.attributes('id'),
    );
  });

  it('labels the main region with the heading and passes axe (22 §4.1)', async () => {
    useAppStore().navigate('reports');
    const w = mount(MainScreen);
    await flushPromises();
    const main = w.get('main');
    expect(main.attributes('aria-labelledby')).toBe(main.get('h1').attributes('id'));
    expect(await axe(main.element)).toHaveNoViolations();
  });

  it('moves tab focus with the arrows and activates only on Enter or Space (15 §1)', async () => {
    useAppStore().navigate('reports');
    const w = mount(PanelHost);
    await flushPromises();
    const tabs = w.findAll('[role="tab"]');
    (tabs[0]?.element as HTMLElement).focus();
    await tabs[0]?.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]?.element);
    expect(useReportsView().tab).toBe('summary');
    await tabs[0]?.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(tabs[4]?.element);
    await tabs[1]?.trigger('click');
    await flushPromises();
    expect(useReportsView().tab).toBe('breakdown');
    expect(requests().map((r) => r.kind)).toEqual(['summary', 'breakdown']);
    expect(w.text()).toContain('Spending by month');
  });

  it('shares linked filters; a saved filter isolates its page until Use linked filters (15 §2–3)', async () => {
    useAppStore().navigate('reports');
    const view = useReportsView();
    const w = mount(PanelHost);
    await flushPromises();
    view.setFilters('summary', { timeframe: { kind: 'preset', preset: 'thisYear' } });
    view.tab = 'inflowOutflow';
    await flushPromises();
    expect(requests().at(-1)).toMatchObject({
      kind: 'inflowOutflow',
      filters: { timeframe: { kind: 'preset', preset: 'thisYear' } },
    });
    // Comparison shows Compare Period, not Timeframe: it starts on this month and requests no range.
    view.tab = 'comparison';
    await flushPromises();
    const trigger = (name: string) => w.find(`[aria-label^="${name}:"]`);
    expect(trigger('Timeframe').exists()).toBe(false);
    expect(trigger('Compare Period').attributes('aria-label')).toBe(
      'Compare Period: This Month (Oct 2026)',
    );
    const flow = {
      categories: { kind: 'all' },
      payees: { kind: 'all' },
      accounts: { kind: 'onBudget' },
    };
    expect(requests().at(-1)).toEqual({
      today: '2026-10-20',
      weekStart: 0,
      kind: 'comparison',
      filters: flow,
      options: { unit: 'month', start: '2026-10-01' },
    });

    // The Compare Period and the linked Timeframe never move each other (15 §2.1).
    const q3 = { unit: 'quarter', start: '2026-07-01' } as const;
    view.setComparison(q3);
    await flushPromises();
    expect(trigger('Compare Period').attributes('aria-label')).toBe('Compare Period: Q3 2026');
    expect(requests().at(-1)).toMatchObject({ options: q3 });
    expect(view.filtersOf('summary').timeframe).toEqual({ kind: 'preset', preset: 'thisYear' });
    view.setFilters('summary', { timeframe: { kind: 'preset', preset: 'lastYear' } });
    expect(view.comparison).toEqual(q3);

    // A saved Comparison keeps its Compare Period and the other filters, without a Timeframe.
    await view.save('comparison', 'Mine');
    expect(view.saved('comparison')).toEqual([
      { page: 'comparison', name: 'Mine', filters: flow, options: q3 },
    ]);
    view.setComparison({ unit: 'year', start: '2025-01-01' });
    expect(view.matching('comparison')).toBeNull();
    const [def] = view.saved('comparison');
    if (!def) throw new Error('not saved');
    view.load(def);
    expect(view.comparison).toEqual(q3);
    expect(view.isOverride('comparison')).toBe(true);
    expect(view.matching('comparison')?.name).toBe('Mine');
    view.setFilters('comparison', { categories: { kind: 'ids', ids: ['c1'] } });
    expect(view.filtersOf('summary').categories).toEqual({ kind: 'all' });
    view.setFilters('summary', { payees: { kind: 'ids', ids: [] } });
    expect(view.filtersOf('comparison').payees).toEqual({ kind: 'all' });
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Use linked filters')
      ?.trigger('click');
    expect(view.isOverride('comparison')).toBe(false);
    expect(view.filtersOf('comparison')).toEqual(view.filtersOf('summary'));
  });

  it('expands and collapses every Inflow vs Outflow group (15 §4.4)', async () => {
    useAppStore().navigate('reports');
    useReportsView().tab = 'inflowOutflow';
    const w = mount(PanelHost);
    await flushPromises();
    expect(w.text()).not.toContain('Rent');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Expand All')
      ?.trigger('click');
    expect(w.text()).toContain('Rent');
    expect(w.text()).toContain('Job');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Collapse All')
      ?.trigger('click');
    expect(w.text()).not.toContain('Rent');
    expect(w.text()).toContain('Net Income');
  });

  it('shows a deliberate empty state and an error with Retry (15 §7)', async () => {
    useAppStore().navigate('reports');
    const view = useReportsView();
    view.tab = 'breakdown';
    view.setFilters('breakdown', { payees: { kind: 'ids', ids: [] } });
    const w = mount(PanelHost);
    await flushPromises();
    expect(w.text()).toContain('No transactions match these filters.');
    fail = true;
    view.tab = 'netWorth';
    await flushPromises();
    const alert = w.get('[role="alert"]');
    expect(alert.text()).toContain("Net Worth couldn't be loaded.");
    fail = false;
    await alert.get('button').trigger('click');
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.text()).toContain('Month-end balances by account');
  });

  it('masks amounts in privacy mode (15 §8)', async () => {
    useSettings().app = { ...useSettings().app, privacyMode: true };
    useAppStore().navigate('reports');
    const w = mount(PanelHost);
    await flushPromises();
    expect(w.text()).not.toMatch(/\d+\.\d{2}/);
    expect(w.findAll('[aria-label="Hidden amount"]').length).toBeGreaterThan(5);
  });
});
