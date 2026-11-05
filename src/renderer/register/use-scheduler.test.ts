// The scheduler pane's state (12 §3) on a stand-in register: its rows, columns and sort, the selection,
// the Schedule dialog and the pane's actions.
import type { Schedule } from '@shared/domain/types';
import { DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import {
  account,
  answerDialog,
  mockHost,
  ONLINE,
  payee,
  type Responses,
} from '../testing/fixtures';
import { mountApp } from '../testing/mount';
import { openScheduleDialog } from './schedule-dialog';
import type { Register } from './use-register';
import { createScheduler, SCHEDULER_MIN_H, type Scheduler } from './use-scheduler';

vi.mock('./schedule-dialog', () => ({ openScheduleDialog: vi.fn(() => Promise.resolve(null)) }));

const schedule = (s: Partial<Schedule> & { id: string }): Schedule => ({
  name: null,
  accountId: 'chk',
  nextDate: '2026-11-05',
  frequency: 'Monthly',
  twiceAMonthStartDay: null,
  payeeId: null,
  transferAccountId: null,
  categoryId: null,
  notes: '',
  amount: -100_00,
  amountOp: 'is',
  amount2: null,
  subtransactions: [],
  postsTransaction: true,
  completed: false,
  raw: { date: '2026-11-05', ruleId: 'r' },
  ...s,
});

const SCHEDULES: Schedule[] = [
  schedule({ id: 'rent', nextDate: '2026-11-01', payeeId: 'landlord', categoryId: 'c-rent' }),
  schedule({ id: 'save', nextDate: '2026-11-15', transferAccountId: 'sav' }),
  schedule({
    id: 'split',
    nextDate: '2026-11-10',
    frequency: 'custom',
    raw: { date: { frequency: 'weekly', interval: 2, start: '2026-11-10' } as never, ruleId: 'r' },
    subtransactions: [
      {
        amount: -50_00,
        method: 'fixed-amount',
        payeeId: null,
        transferAccountId: null,
        categoryId: 'c-rent',
        notes: '',
      },
    ],
  }),
];

const ACCOUNTS = [
  account({ id: 'old', name: 'Old', closed: true }),
  account({ id: 'card', name: 'Card', onBudget: false }),
  account({ id: 'chk', name: 'Checking' }),
  account({ id: 'sav', name: 'Savings' }),
];

/** A stand-in register for an account (or All Accounts). */
const register = (over: Record<string, unknown> = {}) =>
  ({
    isAll: false,
    account: ACCOUNTS[2],
    accounts: ACCOUNTS,
    accountMap: new Map(ACCOUNTS.map((a) => [a.id, a])),
    payees: [payee({ id: 'landlord', name: 'Landlord' })],
    categoryText: (id: string | null) => (id === 'c-rent' ? 'Bills: Rent' : ''),
    format: { dateFormat: 'MM/dd/yyyy' },
    patchView: vi.fn(() => Promise.resolve()),
    settleOpenEdit: vi.fn(() => Promise.resolve(true)),
    ...over,
  }) as unknown as Register & {
    patchView: ReturnType<typeof vi.fn>;
    settleOpenEdit: ReturnType<typeof vi.fn>;
  };

describe('scheduler pane (12 §3)', () => {
  let host: ReturnType<typeof mockHost>;
  let queryClient: QueryClient;
  const respond = (responses: Responses): void => {
    host = mockHost({
      'schedules.list': () => SCHEDULES,
      'schedules.support': () => ({ skip: true, upcomingDates: true }),
      'schedules.enterNow': () => ({ ids: ['t-new'] }),
      ...responses,
    });
  };

  beforeEach(() => {
    useConnection().info = ONLINE;
    useConnection().hostReady = true;
    const budgetSettings = useBudgetSettings();
    budgetSettings.cloudFileId = 'c1';
    vi.mocked(window.app.shell.settings).patchBudget.mockImplementation((_id, patch) =>
      Promise.resolve({ ...budgetSettings.settings, ...(patch as object) }),
    );
    vi.mocked(openScheduleDialog).mockReset().mockResolvedValue(null);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    respond({});
  });

  /** The scheduler of a mounted host component, once its queries have loaded. */
  const mountScheduler = async (reg = register(), accountId = 'chk'): Promise<Scheduler> => {
    let scheduler: Scheduler | undefined;
    mountApp(
      defineComponent({
        setup() {
          scheduler = createScheduler(ref(accountId), reg);
          return () => null;
        },
      }),
      { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
    );
    await flushPromises();
    if (!scheduler) throw new Error('not mounted');
    return scheduler;
  };

  it('lists the schedules by date, with their payee, category and frequency text', async () => {
    const s = await mountScheduler();
    expect(s.loaded).toBe(true);
    expect(s.count).toBe(3);
    expect(s.canSkip).toBe(true);
    expect(s.skipUnavailable).toBe(false);
    expect(
      s.rows.map((r) => [r.s.id, r.payeeText, r.categoryText, r.frequencyText, r.accountName]),
    ).toEqual([
      ['rent', 'Landlord', 'Bills: Rent', 'Monthly', 'Checking'],
      ['split', '', 'Split (Multiple Categories)...', 'Every 2 weeks', 'Checking'],
      ['save', 'Transfer : Savings', '', 'Monthly', 'Checking'],
    ]);
    expect(host.calls('schedules.list')).toEqual([{ accountId: 'chk' }]);
  });

  it("shows Account in All Accounts, and no Category for an off-budget account's pane", async () => {
    const own = await mountScheduler();
    expect([...own.visible]).not.toContain('account');
    expect([...own.visible]).toContain('category');
    expect([...own.visible]).toContain('notes');
    const all = await mountScheduler(register({ isAll: true, account: null }), 'all');
    expect([...all.visible]).toContain('account');
    const card = await mountScheduler(register({ account: ACCOUNTS[1] }), 'card');
    expect([...card.visible]).not.toContain('category');
  });

  it('says when Actual cannot skip', async () => {
    respond({ 'schedules.support': () => ({ skip: false, upcomingDates: true }) });
    const s = await mountScheduler();
    expect(s.canSkip).toBe(false);
    expect(s.skipUnavailable).toBe(true);
  });

  it("saves the pane's visibility, height and sort in the register's view", async () => {
    const reg = register();
    const s = await mountScheduler(reg);
    await s.setVisible(true);
    await s.setHeight(3);
    await s.setHeight(20.456);
    await s.setSort('date');
    await s.setSort('payee');
    expect(reg.patchView.mock.calls.map(([p]) => p as unknown)).toEqual([
      { schedulerVisible: true },
      { schedulerHeight: SCHEDULER_MIN_H },
      { schedulerHeight: 20.46 },
      { scheduleSort: { field: 'date', desc: true } },
      { scheduleSort: { field: 'payee', desc: false } },
    ]);
  });

  it('reads the saved view, with the minimum height', async () => {
    const budgetSettings = useBudgetSettings();
    budgetSettings.settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      register: {
        ...DEFAULT_BUDGET_SETTINGS.register,
        accounts: {
          chk: {
            schedulerVisible: true,
            schedulerHeight: 2,
            scheduleSort: { field: 'payee', desc: true },
          },
        },
      },
    };
    const s = await mountScheduler();
    expect(s.shownPref).toBe(true);
    expect(s.height).toBe(SCHEDULER_MIN_H);
    expect(s.sort).toEqual({ field: 'payee', desc: true });
    expect(s.rows.map((r) => r.s.id)).toEqual(['save', 'rent', 'split']);
  });

  it('saves columns for this account, or for every account', async () => {
    const s = await mountScheduler();
    await s.toggleColumn('notes');
    expect([...s.visible]).not.toContain('notes');
    await s.resizeColumn('payee', 20);
    expect(s.columns.find((c) => c.field === 'payee')?.width).toBe(20);
    await s.setColumns(s.columns, true);
    const accounts = useBudgetSettings().settings.register.accounts;
    expect(Object.keys(accounts).sort()).toEqual(['card', 'chk', 'old', 'sav']);
    expect(accounts['sav']?.scheduleColumns).toEqual(accounts['chk']?.scheduleColumns);
  });

  it('selects one, toggles, extends a range, and moves with the keys', async () => {
    const s = await mountScheduler();
    const selected = (): string[] => [...s.selection].sort();
    s.select('rent');
    s.select('save', { toggle: true });
    expect(selected()).toEqual(['rent', 'save']);
    s.select('save', { toggle: true });
    expect(selected()).toEqual(['rent']);
    s.select('rent');
    s.select('save', { range: true });
    expect(selected()).toEqual(['rent', 'save', 'split']);
    expect(s.selectedRows.map((r) => r.s.id)).toEqual(['rent', 'split', 'save']);
    s.selectAll(false);
    expect(selected()).toEqual([]);
    s.selectAll(true);
    expect(selected()).toHaveLength(3);
    s.clearSelection();

    expect(s.moveSelection(1, false)).toBe('rent');
    expect(s.moveSelection(1, true)).toBe('split');
    expect(selected()).toEqual(['rent', 'split']);
    s.clearSelection();
    expect(s.moveSelection(-1, false)).toBe('save');
    expect(s.moveSelection(-1, false)).toBe('split');
    expect(s.moveSelection(-1, false)).toBe('rent');
    expect(s.moveSelection(-1, false)).toBe('rent');
  });

  it('moves nowhere in an empty pane', async () => {
    respond({ 'schedules.list': () => [] });
    const s = await mountScheduler();
    expect(s.moveSelection(1, false)).toBeNull();
  });

  describe('the Schedule dialog (12 §3.1)', () => {
    it('edits a schedule, then selects and focuses it', async () => {
      vi.mocked(openScheduleDialog).mockResolvedValueOnce('rent');
      const s = await mountScheduler();
      await s.openEditor({ id: 'rent' });
      expect(openScheduleDialog).toHaveBeenCalledWith({
        kind: 'edit',
        schedule: SCHEDULES[0],
        fallbackAccountId: 'chk',
      });
      expect([...s.selection]).toEqual(['rent']);
      expect(s.focusRow).toBe('rent');
    });

    it("adds a schedule to the pane's account, or in All Accounts the first open on-budget one", async () => {
      vi.mocked(openScheduleDialog).mockResolvedValueOnce('new-id');
      const s = await mountScheduler();
      await s.openEditor({ transfer: true });
      expect(openScheduleDialog).toHaveBeenLastCalledWith({
        kind: 'new',
        accountId: 'chk',
        transfer: true,
      });
      expect(s.focusRow).toBe('new-id');

      const all = await mountScheduler(register({ isAll: true, account: null }), 'all');
      await all.openEditor();
      expect(openScheduleDialog).toHaveBeenLastCalledWith({
        kind: 'new',
        accountId: 'chk',
        transfer: false,
      });

      const offBudget = await mountScheduler(
        register({ isAll: true, account: null, accounts: [ACCOUNTS[0], ACCOUNTS[1]] }),
        'all',
      );
      await offBudget.openEditor();
      expect(openScheduleDialog).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: 'card' }),
      );
    });

    it('opens nothing offline, with an edit that will not settle, or for a schedule that is gone', async () => {
      const reg = register();
      const s = await mountScheduler(reg);
      await s.openEditor({ id: 'gone' });
      reg.settleOpenEdit.mockResolvedValueOnce(false);
      await s.openEditor();
      useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
      await s.openEditor();
      const none = await mountScheduler(
        register({ isAll: true, account: null, accounts: [ACCOUNTS[0]] }),
        'all',
      );
      useConnection().info = ONLINE;
      await none.openEditor();
      expect(openScheduleDialog).not.toHaveBeenCalled();
    });
  });

  describe('actions (12 §3)', () => {
    it('enters, skips, deletes and moves the schedules, clearing the selection', async () => {
      const s = await mountScheduler();
      s.select('rent');
      expect(await s.enterNow(['rent'])).toEqual(['t-new']);
      expect([...s.selection]).toEqual([]);
      await s.skip(['rent']);
      s.select('rent');
      await s.remove(['rent']);
      expect([...s.selection]).toEqual([]);
      s.select('save');
      await s.moveTo(['save'], 'sav');
      expect([...s.selection]).toEqual([]);
      expect(host.calls('schedules.enterNow')).toEqual([{ ids: ['rent'] }]);
      expect(host.calls('schedules.skip')).toEqual([{ ids: ['rent'] }]);
      expect(host.calls('schedules.delete')).toEqual([{ ids: ['rent'] }]);
      expect(host.calls('schedules.moveToAccount')).toEqual([{ ids: ['save'], accountId: 'sav' }]);
      // Each refreshes the list.
      expect(host.calls('schedules.list').length).toBeGreaterThan(1);
    });

    it('does nothing for no schedules', async () => {
      const s = await mountScheduler();
      expect(await s.enterNow([])).toEqual([]);
      await s.skip([]);
      await s.remove([]);
      await s.moveTo([], 'sav');
      for (const m of [
        'schedules.enterNow',
        'schedules.skip',
        'schedules.delete',
        'schedules.moveToAccount',
      ] as const)
        expect(host.calls(m)).toEqual([]);
    });

    it('keeps the selection when a write fails', async () => {
      const fail = () => {
        throw new Error('boom');
      };
      respond({
        'schedules.enterNow': fail,
        'schedules.skip': fail,
        'schedules.delete': fail,
        'schedules.moveToAccount': fail,
      });
      const s = await mountScheduler();
      s.select('rent');
      const entering = s.enterNow(['rent']);
      await answerDialog('close');
      expect(await entering).toEqual([]);
      for (const run of [
        () => s.skip(['rent']),
        () => s.remove(['rent']),
        () => s.moveTo(['rent'], 'sav'),
      ]) {
        const running = run();
        await answerDialog('close');
        await running;
      }
      expect([...s.selection]).toEqual(['rent']);
    });
  });
});
