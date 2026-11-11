// The register's scheduling and reconciliation parts with a mocked host (12 §3–4, 13 §6): the Scheduled
// Transactions toggle and pane, opening the Schedule dialog, the scheduled actions menu, Make recurring…,
// the "Matched to scheduled transaction" notifier, and the reconcile flow.
import { APP_NAME } from '@shared/app';
import type { Schedule, Transaction } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import { DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveEdit } from '../../register/edit-guard';
import type { ScheduleForm } from '../../register/schedule-form';
import { useRegisterSession } from '../../register/view-state';
import { queryClient as appQueryClient } from '../../rpc/query-client';
import RegisterPanel from '../../screens/shell/RegisterPanel.vue';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useModals } from '../../stores/modals';
import {
  account,
  answerDialog,
  GROUPS,
  mockHost,
  ONLINE,
  payee,
  transaction,
  type Responses,
} from '../../testing/fixtures';
import { mountApp } from '../../testing/mount';
import DateField from '../common/DateField.vue';
import ReconcileDialog from './ReconcileDialog.vue';
import ScheduleDialog from './ScheduleDialog.vue';

const CHECKING = account({
  id: 'chk',
  name: 'Checking',
  scheduledCount: 2,
  balances: { cleared: 10000, uncleared: -500, working: 9500, reconciled: 4000 },
});
const SAVINGS = account({ id: 'sav', name: 'Savings' });
const PAYEES = [payee({ id: 'p-rent', name: 'Landlord' }), payee({ id: 'p-gym', name: 'Gym' })];

const schedule = (s: Partial<Schedule> & { id: string }): Schedule => ({
  name: null,
  accountId: 'chk',
  nextDate: '2099-01-05',
  frequency: 'Monthly',
  twiceAMonthStartDay: null,
  payeeId: 'p-rent',
  transferAccountId: null,
  categoryId: 'c-rent',
  notes: 'Rent',
  amount: -100_000,
  amountOp: 'is',
  amount2: null,
  subtransactions: [],
  postsTransaction: true,
  completed: false,
  raw: {
    date: { frequency: 'monthly', interval: 1, start: '2099-01-05', endMode: 'never' },
    ruleId: 'r1',
  },
  ...s,
});

let rows: Transaction[];
let schedules: Schedule[];
let host: ReturnType<typeof mockHost>;

function responses(extra: Responses = {}): Responses {
  return {
    'accounts.list': () => [CHECKING, SAVINGS],
    'categories.tree': () => GROUPS,
    'payees.list': () => PAYEES,
    'prefs.synced': () => ({}),
    'transactions.list': () => rows,
    'schedules.list': () => schedules,
    'schedules.support': () => ({ skip: true, upcomingDates: true }),
    'schedules.save': (p: { id?: string }) => ({ id: p.id ?? 's-new' }),
    'schedules.enterNow': () => ({ ids: ['t-entered'] }),
    'schedules.draftFromTransaction': () => ({
      accountId: 'chk',
      date: { frequency: 'monthly', interval: 1, start: '2099-11-02', endMode: 'never' },
      payeeId: null,
      transferAccountId: null,
      categoryId: null,
      notes: '',
      amount: 6000,
      subtransactions: [],
    }),
    'reconcile.clearedThrough': () => 6000,
    'reconcile.finish': () => ({ reconciled: 1, adjustmentId: null }),
    'transactions.commit': () => ({
      id: 'new-1',
      matched: { scheduleId: 's1', payeeId: 'p-rent' },
    }),
    ...extra,
  };
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => 1000,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 2000,
});

beforeEach(() => {
  appQueryClient.clear();
  rows = [
    transaction({
      id: 't1',
      accountId: 'chk',
      date: '2026-10-02',
      amount: 6000,
      cleared: 'C',
      payeeName: 'Boss',
    }),
    transaction({
      id: 't2',
      accountId: 'chk',
      date: '2026-10-04',
      amount: -500,
      cleared: 'U',
      payeeName: 'Shop',
    }),
    transaction({
      id: 't3',
      accountId: 'chk',
      date: '2026-09-01',
      amount: 4000,
      cleared: 'R',
      payeeName: 'Old',
    }),
    transaction({
      id: 't4',
      accountId: 'chk',
      date: '2026-12-01',
      amount: -100,
      cleared: 'C',
      payeeName: 'Later',
    }),
  ];
  schedules = [
    schedule({ id: 's1' }),
    schedule({
      id: 's2',
      frequency: 'custom',
      payeeId: 'p-gym',
      notes: 'Gym',
      postsTransaction: false,
      raw: {
        date: { frequency: 'weekly', interval: 3, start: '2099-01-01', endMode: 'never' },
        ruleId: 'r2',
      },
    }),
  ];
  host = mockHost(responses());
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
  const settings = useBudgetSettings();
  settings.cloudFileId = 'c1';
  settings.settings = structuredClone(DEFAULT_BUDGET_SETTINGS);
  vi.spyOn(window.app.shell.settings, 'patchBudget').mockImplementation((_id, p) => {
    settings.settings = { ...settings.settings, ...(p as object) };
    return Promise.resolve(settings.settings);
  });
});

async function open(): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(RegisterPanel, {
    props: { accountId: 'chk', shown: true },
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  await flushPromises();
  return w;
}

const toggle = (w: VueWrapper) => w.findAll('button').find((b) => b.text().includes('Scheduled'));

async function showPane(w: VueWrapper): Promise<void> {
  await toggle(w)?.trigger('click');
  await flushPromises();
  await flushPromises();
}

/** The open Schedule dialog's props, after the opener fetched its data. */
async function scheduleDialog(): Promise<{ id: number; form: ScheduleForm; transfer: boolean }> {
  await flushPromises();
  await flushPromises();
  const top = useModals().stack.at(-1);
  if (top?.component !== ScheduleDialog) throw new Error('no Schedule dialog is open');
  return { id: top.id, ...(top.props as { form: ScheduleForm; transfer: boolean }) };
}

async function closeDialog(id: number, result: { id: string } | null): Promise<void> {
  useModals().close(id, result);
  await flushPromises();
  await flushPromises();
}

describe('the scheduler pane (12 §3)', () => {
  it('toggles with the count badge and lists the schedules', async () => {
    const w = await open();
    expect(toggle(w)?.text()).toContain('2');
    expect(w.find('[data-scheduler]').exists()).toBe(false);
    await showPane(w);
    expect(w.find('[data-scheduler]').exists()).toBe(true);
    expect(useBudgetSettings().settings.register.accounts['chk']?.schedulerVisible).toBe(true);
    const ids = w.findAll('[data-schedule-id]').map((r) => r.attributes('data-schedule-id'));
    expect(ids).toEqual(['s2', 's1']);
    expect(w.get('[data-schedule-id="s1"]').text()).toContain('Monthly');
    expect(w.get('[data-schedule-id="s2"]').text()).toContain('Every 3 weeks');
    expect(w.get('[data-schedule-id="s2"]').text()).toContain('Not entered automatically');
  });

  it('lets navigation leave at once when nothing is being edited', async () => {
    const w = await open();
    await showPane(w);
    // A pending answer makes navigation wait and ask again: it must be a plain `true` here.
    expect(leaveEdit()).toBe(true);
  });

  it('opens the Schedule dialog on a double-click, not inline (12 §3)', async () => {
    const w = await open();
    await showPane(w);
    const notes = () => w.get('[data-schedule-id="s1"] [data-col="notes"]');
    await notes().trigger('click');
    await notes().trigger('click');
    await flushPromises();
    expect(w.find('[data-scheduler] [data-editor]').exists()).toBe(false);
    expect(useModals().stack).toHaveLength(0);
    await notes().trigger('dblclick');
    const dialog = await scheduleDialog();
    expect(dialog.form).toMatchObject({
      id: 's1',
      repeats: true,
      magnitude: 100_000,
      tx: { payeeText: 'Landlord', notes: 'Rent' },
    });
    await closeDialog(dialog.id, { id: 's1' });
    expect(w.get('[data-schedule-id="s1"]').classes()).toContain('is-selected');
  });

  it.each(['Enter', 'F2'])('opens the Schedule dialog on %s (12 §3)', async (key) => {
    const w = await open();
    await showPane(w);
    await w.get('[data-schedule-id="s1"] [data-col="notes"]').trigger('click');
    await flushPromises();
    const body = w.get('[data-schedule-id="s1"]').element.closest<HTMLElement>('[tabindex]');
    body?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const dialog = await scheduleDialog();
    expect(dialog.form.id).toBe('s1');
    await closeDialog(dialog.id, null);
  });

  it('expands a split schedule into its lines, with tag pills that filter the register (12 §3)', async () => {
    schedules = [
      schedule({
        id: 's3',
        categoryId: null,
        notes: 'Weekly shop',
        amount: -3000,
        subtransactions: [
          {
            amount: -2000,
            method: 'fixed-amount',
            payeeId: null,
            transferAccountId: null,
            categoryId: 'c-groceries',
            notes: 'milk #trip',
          },
          {
            amount: -1000,
            method: 'remainder',
            payeeId: null,
            transferAccountId: 'sav',
            categoryId: null,
            notes: 'to savings',
          },
        ],
      }),
    ];
    const w = await open();
    await showPane(w);
    const lines = () => w.findAll('[data-scheduler] [data-line-parent="s3"]');
    const disclosure = () => w.get('[data-schedule-id="s3"] .sched__disclosure');
    expect(w.get('[data-schedule-id="s3"] [data-col="category"]').text()).toBe(
      'Split (Multiple Categories)...',
    );
    expect(lines()).toHaveLength(0);
    expect(disclosure().attributes('aria-expanded')).toBe('false');
    await disclosure().trigger('click');
    expect(disclosure().attributes('aria-expanded')).toBe('true');
    const [groceries, transfer] = lines();
    expect(lines()).toHaveLength(2);
    expect(groceries?.get('[data-col="category"]').text()).toContain('Groceries');
    expect(groceries?.get('[data-col="outflow"]').text()).toContain('20.00');
    expect(transfer?.get('[data-col="payee"]').text()).toBe('Transfer : Savings');
    expect(transfer?.get('[data-col="category"]').text()).toBe('(Category not needed)');
    expect(lines().map((l) => l.attributes('aria-rowindex'))).toEqual(['3', '4']);
    // Expanding doesn't select; a click on a line selects its schedule.
    expect(w.get('[data-schedule-id="s3"]').classes()).not.toContain('is-selected');
    await transfer?.get('[data-col="notes"]').trigger('click');
    expect(w.get('[data-schedule-id="s3"]').classes()).toContain('is-selected');
    const pills = groceries?.findAll('.note-pill') ?? [];
    expect(pills.map((p) => p.text())).toEqual(['#trip']);
    expect(pills[0]?.attributes('aria-label')).toBe('Filter by tag #trip');
    await pills[0]?.trigger('click');
    expect(useRegisterSession().view('chk').search).toBe('Tag: trip,');
    await disclosure().trigger('click');
    expect(lines()).toHaveLength(0);
  });

  it('opens a custom schedule with its own pattern', async () => {
    const w = await open();
    await showPane(w);
    vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('edit');
    await w.get('[data-schedule-id="s2"] [data-col="payee"]').trigger('contextmenu');
    const dialog = await scheduleDialog();
    expect(dialog.form.config).toEqual({
      frequency: 'weekly',
      interval: 3,
      start: '2099-01-01',
      endMode: 'never',
    });
    expect(dialog.form.postsTransaction).toBe(false);
  });

  it('opens a new schedule, Monthly from tomorrow, from Add and Transfer in the title bar (12 §3)', async () => {
    const w = await open();
    await showPane(w);
    const add = (text: string) =>
      w.findAll('[data-scheduler] .sched__bar button').find((b) => b.text() === text);
    await add('Add')?.trigger('click');
    const dialog = await scheduleDialog();
    expect(dialog.form).toMatchObject({
      id: null,
      repeats: true,
      postsTransaction: true,
      config: { frequency: 'monthly', interval: 1, endMode: 'never' },
      tx: { accountId: 'chk', payeeText: '' },
    });
    await closeDialog(dialog.id, null);
    expect(host.calls('schedules.save')).toEqual([]);
    await add('Transfer')?.trigger('click');
    const transfer = await scheduleDialog();
    expect(transfer.transfer).toBe(true);
    expect(transfer.form.tx.payeeText).toBe('Transfer : ');
  });

  it('hides Transfer when no other open account exists (12 §3)', async () => {
    host = mockHost(responses({ 'accounts.list': () => [CHECKING, { ...SAVINGS, closed: true }] }));
    const w = await open();
    await showPane(w);
    expect(w.find('[data-scheduler] .sched__add').exists()).toBe(true);
    expect(w.find('[data-scheduler] .sched__transfer').exists()).toBe(false);
  });

  it('keeps Add and Transfer focusable but inert offline (12 §3, 22 §4.6)', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await open();
    await showPane(w);
    for (const button of [
      w.get('[data-scheduler] .sched__add'),
      w.get('[data-scheduler] .sched__transfer'),
    ]) {
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.attributes('aria-disabled')).toBe('true');
      expect(button.attributes('aria-describedby')).toBeDefined();
      await button.trigger('click');
    }
    await flushPromises();
    expect(useModals().stack).toHaveLength(0);
  });

  it('Shift+F10 on a focused header opens the column chooser, as a right-click does (12 §3)', async () => {
    const w = await open();
    await showPane(w);
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('notes');
    (w.get('[data-scheduler] .sched__sort').element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }));
    await flushPromises();
    expect(menu.mock.calls[0]?.[0].map((i) => i.label ?? '-')).toEqual([
      'Notes',
      '-',
      'Apply current settings to all existing accounts',
    ]);
    expect(
      useBudgetSettings().settings.register.accounts['chk']?.scheduleColumns?.find(
        (c) => c.field === 'notes',
      )?.visible,
    ).toBe(false);
    menu.mockResolvedValueOnce(null);
    await w.get('[data-scheduler] [role="columnheader"]').trigger('contextmenu');
    expect(menu).toHaveBeenCalledTimes(2);
    expect(w.find('[data-scheduler] [aria-label="Choose columns"]').exists()).toBe(false);
  });

  it('runs Enter in register now from the actions menu', async () => {
    const w = await open();
    await showPane(w);
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('enter');
    await w.get('[data-schedule-id="s1"] [data-col="payee"]').trigger('contextmenu');
    await flushPromises();
    expect(host.calls('schedules.enterNow')).toEqual([{ ids: ['s1'] }]);
    const items = menu.mock.calls[0]?.[0] ?? [];
    expect(items[0]).toMatchObject({ label: '1 selected scheduled transaction', enabled: false });
    expect(items[2]).toMatchObject({ id: 'edit', label: 'Edit Schedule...', enabled: true });
  });

  it('keeps Skip disabled while support information is unresolved', async () => {
    host = mockHost(
      responses({
        'schedules.support': () => new Promise<{ skip: boolean; upcomingDates: boolean }>(() => {}),
      }),
    );
    const w = await open();
    await showPane(w);
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce(null);
    await w.get('[data-schedule-id="s1"] [data-col="payee"]').trigger('contextmenu');
    await flushPromises();
    const skip = menu.mock.calls[0]?.[0].find((item) => item.id === 'skip');
    expect(skip).toMatchObject({ enabled: false });
    expect(skip).not.toHaveProperty('toolTip');
  });

  it('makes a transaction recurring in the Schedule dialog, then shows it in the pane (12 §4)', async () => {
    const w = await open();
    await w.get('[data-row-id="t1"] [data-col="payee"]').trigger('click');
    vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('recurring');
    await w.get('[data-row-id="t1"] [data-col="payee"]').trigger('contextmenu');
    const dialog = await scheduleDialog();
    expect(host.calls('schedules.draftFromTransaction')).toEqual([{ id: 't1', mode: 'recurring' }]);
    expect(dialog.form).toMatchObject({ id: null, magnitude: 6000, outflow: false });
    expect(w.find('[data-scheduler]').exists()).toBe(false);
    await closeDialog(dialog.id, { id: 's1' });
    expect(w.find('[data-scheduler]').exists()).toBe(true);
    expect(w.get('[data-schedule-id="s1"]').classes()).toContain('is-selected');
  });

  it('Ctrl+Shift+Enter in a new transaction editor saves the transaction, then makes it recurring (11 §9)', async () => {
    const w = await open();
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    const notes = w.get('[data-editor] [data-main] [data-field="notes"] input');
    (notes.element as HTMLInputElement).value = 'Rent';
    await notes.trigger('input');
    await notes.trigger('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true });
    const dialog = await scheduleDialog();
    expect(host.calls('transactions.commit')).toHaveLength(1);
    expect(host.calls('schedules.draftFromTransaction')).toEqual([
      { id: 'new-1', mode: 'recurring' },
    ]);
    await closeDialog(dialog.id, null);
  });

  it('writes nothing when Make recurring is cancelled', async () => {
    const w = await open();
    await w.get('[data-row-id="t1"] [data-col="payee"]').trigger('click');
    vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('scheduler');
    await w.get('[data-row-id="t1"] [data-col="payee"]').trigger('contextmenu');
    const dialog = await scheduleDialog();
    await closeDialog(dialog.id, null);
    expect(host.calls('schedules.save')).toEqual([]);
    expect(w.find('[data-scheduler]').exists()).toBe(false);
  });
});

describe('reconciliation (13 §6)', () => {
  async function begin(w: VueWrapper, target: number): Promise<void> {
    await w
      .findAll('button')
      .find((b) => b.text().includes('Reconcile'))
      ?.trigger('click');
    await flushPromises();
    const modals = useModals();
    const top = modals.stack.at(-1);
    expect(top?.props).toMatchObject({ current: null });
    if (top) modals.close(top.id, { statementDate: '2026-10-31', target });
    await flushPromises();
  }

  it('shows the unreconciled transactions up to the statement date and the footer', async () => {
    const w = await open();
    await begin(w, 9500);
    expect(w.text()).toContain('Reconciling Checking...');
    const ids = w.findAll('[data-row-id]').map((r) => r.attributes('data-row-id'));
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).not.toContain('t3');
    expect(w.text()).toContain('Transactions cleared above');
    expect(w.text()).toContain('Difference between');
  });

  it('offers an adjustment when unbalanced and finishes with it', async () => {
    const w = await open();
    await begin(w, 9500);
    const finish = w.findAll('button').find((b) => b.text() === 'Finish Reconciliation');
    await finish?.trigger('click');
    const options = await answerDialog('adjust');
    expect(options.instruction).toContain("aren't balanced");
    expect(host.calls('reconcile.finish')).toEqual([
      expect.objectContaining({ accountId: 'chk', target: 9500, createAdjustment: true }),
    ]);
    expect(w.text()).not.toContain('Finish Reconciliation');
  });
});

describe('the Matched notifier (12 §2)', () => {
  it('names the schedule after a commit Actual linked', async () => {
    const w = await open();
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    const notes = w.get('[data-editor] [data-main] [data-field="notes"] input');
    await notes.setValue('rent');
    await w.get('[data-editor]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await flushPromises();
    expect(w.text()).toContain("Matched to scheduled transaction 'Landlord'");
  });
});

describe('the Reconcile Account dialog (13 §6.1)', () => {
  const mountDialog = () => {
    const queryClient = new QueryClient();
    return mountApp(ReconcileDialog, {
      props: {
        account: account({ id: 'chk', name: 'Card' }),
        today: '2026-10-20',
        current: null,
      },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
  };
  it('shows the cleared balance and "Use this amount." begins with it', async () => {
    const w = mountDialog();
    await flushPromises();
    expect(host.calls('reconcile.clearedThrough')).toEqual([
      { accountId: 'chk', date: '2026-10-20' },
    ]);
    expect(w.text()).toContain(`${APP_NAME} is 60.00.`);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Use this amount.')
      ?.trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ statementDate: '2026-10-20', target: 6000 }]);
  });
  it('takes the balance as typed, with its sign: a balance owed is negative', async () => {
    const w = mountDialog();
    await flushPromises();
    expect(w.text()).not.toContain('overpaid');
    await w.get('input[inputmode="decimal"]').setValue('-25');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Begin Reconciliation')
      ?.trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ statementDate: '2026-10-20', target: -2500 }]);
  });
  describe('with a date still typed in the field', () => {
    type Dialog = ReturnType<typeof mountDialog>;
    const dateInput = (w: Dialog) => w.findComponent(DateField).get('input');
    const button = (w: Dialog, name: string) => {
      const found = w.findAll('button').find((b) => b.text() === name);
      if (!found) throw new Error(`no button "${name}"`);
      return found;
    };
    const fill = async (date: string): Promise<Dialog> => {
      const w = mountDialog();
      await flushPromises();
      await w.get('input[inputmode="decimal"]').setValue('25');
      await dateInput(w).setValue(date);
      return w;
    };
    const submitters: [string, (w: Dialog) => Promise<void>][] = [
      ['Enter', (w) => dateInput(w).trigger('keydown', { key: 'Enter' })],
      ['the Begin button', (w) => button(w, 'Begin Reconciliation').trigger('click')],
    ];

    it.each(submitters)('%s begins with the typed date', async (_, submit) => {
      const w = await fill('10/10/2026');
      await submit(w);
      expect(w.emitted('close')?.[0]).toEqual([{ statementDate: '2026-10-10', target: 2500 }]);
    });
    it.each(submitters)('%s refuses an invalid date and stays open', async (_, submit) => {
      const w = await fill('99/99/9999');
      await submit(w);
      await flushPromises();
      expect(w.emitted('close')).toBeUndefined();
      expect(dateInput(w).attributes('aria-invalid')).toBe('true');
    });
    it('"Use this amount." recalculates for a typed date instead of using the old amount', async () => {
      const w = await fill('10/10/2026');
      await button(w, 'Use this amount.').trigger('click');
      await flushPromises();
      expect(w.emitted('close')).toBeUndefined();
      expect(host.calls('reconcile.clearedThrough').at(-1)).toEqual({
        accountId: 'chk',
        date: '2026-10-10',
      });
    });
    it('"Use this amount." refuses an invalid date and stays open', async () => {
      const w = await fill('99/99/9999');
      await button(w, 'Use this amount.').trigger('click');
      await flushPromises();
      expect(w.emitted('close')).toBeUndefined();
      expect(dateInput(w).attributes('aria-invalid')).toBe('true');
    });
    it.each(['Begin Reconciliation', 'Use this amount.'])(
      'pressing "%s" leaves focus in the field, so no blur commits the date first',
      async (name) => {
        const w = await fill('10/10/2026');
        const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        button(w, name).element.dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
      },
    );
  });
  it('keeps the hint line while the cleared balance reloads, so the buttons stay put', async () => {
    const pending = new Map<string, (value: number) => void>();
    host = mockHost(
      responses({
        'reconcile.clearedThrough': (p: { date: string }) =>
          new Promise<number>((resolve) => pending.set(p.date, resolve)),
      }),
    );
    const w = mountDialog();
    await flushPromises();
    expect(w.find('.rec__hint').exists()).toBe(true);
    pending.get('2026-10-20')?.(6000);
    await flushPromises();
    expect(w.get('.rec__hint').text()).toContain('Use this amount.');
    w.findComponent(DateField).vm.$emit('update:modelValue', '2026-10-10');
    await flushPromises();
    expect(w.find('.rec__hint').exists()).toBe(true);
    expect(w.get('.rec__hint').text()).not.toContain('Use this amount.');
  });
  it("keeps the current date's cleared balance when an earlier date's answer comes late", async () => {
    const pending = new Map<string, (value: number) => void>();
    host = mockHost(
      responses({
        'reconcile.clearedThrough': (p: { date: string }) =>
          new Promise<number>((resolve) => pending.set(p.date, resolve)),
      }),
    );
    const w = mountDialog();
    await flushPromises();
    w.findComponent(DateField).vm.$emit('update:modelValue', '2026-10-10');
    await flushPromises();
    pending.get('2026-10-10')?.(1000);
    await flushPromises();
    pending.get('2026-10-20')?.(6000);
    await flushPromises();
    expect(w.text()).toContain(`${APP_NAME} is 10.00.`);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Use this amount.')
      ?.trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ statementDate: '2026-10-10', target: 1000 }]);
  });
  it('says why when the cleared balance could not be read, and hides the hint', async () => {
    host = mockHost(
      responses({
        'reconcile.clearedThrough': () => {
          throw new RpcError('actual', 'boom');
        },
      }),
    );
    const w = mountDialog();
    expect((await answerDialog('close')).instruction).toBe('Something went wrong');
    expect(w.text()).not.toContain('Use this amount.');
  });
});
