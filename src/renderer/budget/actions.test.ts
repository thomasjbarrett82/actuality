// The Budget screen's flows (09 §4.1, §4.3, §5.5, §6) on a stand-in Budget screen: the popovers and
// what follows them, notes, overspending, the transactions popovers, Quick Budget and category moves.
import type { Category, CategoryGroup, Month } from '@shared/domain/types';
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import type { QuickBudgetStats } from '@shared/quickbudget/quickbudget';
import type { CalloutTransaction } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import type { ContextMenuItem } from '@shared/shell-api';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryEditCallout from '../components/budget/CategoryEditCallout.vue';
import EmptyOutflowCallout from '../components/budget/EmptyOutflowCallout.vue';
import HiddenCategoriesCallout from '../components/budget/HiddenCategoriesCallout.vue';
import HoldCallout from '../components/budget/HoldCallout.vue';
import MoveToGroupDialog from '../components/budget/MoveToGroupDialog.vue';
import NoteCallout from '../components/budget/NoteCallout.vue';
import OverspendingCallout from '../components/budget/OverspendingCallout.vue';
import TransactionsCallout from '../components/budget/TransactionsCallout.vue';
import { useJump } from '../register/jump';
import { useRegisterSession } from '../register/view-state';
import { queryClient } from '../rpc/query-client';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useCallouts } from '../stores/callouts';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import { useModals } from '../stores/modals';
import {
  answerCallout,
  answerDialog,
  answerModal,
  GROUPS,
  mockHost,
  monthView,
  ONLINE,
  type Responses,
} from '../testing/fixtures';
import {
  addCategory,
  addGroup,
  editCategory,
  editGroup,
  editNote,
  fillableCategories,
  longMonth,
  monthShortYear,
  monthYear,
  moveCategory,
  moveGroup,
  moveToGroup,
  overspending,
  quickBudgetMenu,
  saveEntityNote,
  shortMonth,
  showHidden,
  showIncome,
  showOutflows,
} from './actions';
import type { BudgetScreen } from './use-budget';

const MONTH: Month = '2026-10';
const [, EVERYDAY, BILLS] = GROUPS as [CategoryGroup, CategoryGroup, CategoryGroup];
const [GROCERIES, FUEL] = EVERYDAY.categories as [Category, Category];
const RENT = BILLS.categories[0] as Category;

/** A stand-in Budget screen over `tree`, with spies for what the flows call on it. */
function screen(over: Record<string, unknown> = {}) {
  return {
    tree: GROUPS.map((g) => ({ ...g, categories: [...g.categories] })),
    format: { money: DEFAULT_MONEY_SETTINGS, dateFormat: 'MM/dd/yyyy' },
    views: new Map([[MONTH, monthView(MONTH, { 'c-rent': { carryover: true } })]]),
    canEdit: true,
    collapsed: new Set<string>(),
    toggleGroup: vi.fn(),
    showEmptyOutflowTooltip: true,
    patchView: vi.fn(() => Promise.resolve()),
    commitAmounts: vi.fn(() => Promise.resolve()),
    moveSupport: { category: true, group: true },
    ...over,
  } as unknown as BudgetScreen & {
    toggleGroup: ReturnType<typeof vi.fn>;
    patchView: ReturnType<typeof vi.fn>;
    commitAmounts: ReturnType<typeof vi.fn>;
  };
}

const row = (over: Partial<CalloutTransaction> = {}): CalloutTransaction => ({
  id: 't1',
  transactionId: 't1',
  accountId: 'chk',
  accountName: 'Checking',
  date: '2026-10-05',
  payeeName: 'Kroger',
  transferAccountName: null,
  isSplitLine: false,
  notes: '',
  parentNotes: '',
  amount: -25_00,
  ...over,
});

const anchor = (): HTMLElement => document.createElement('button');

describe('budget actions (09)', () => {
  let host: ReturnType<typeof mockHost>;
  const respond = (responses: Responses): void => {
    host = mockHost({
      'categories.deleteImpact': () => ({
        budgetedMonths: 0,
        transactionCount: 0,
        transactionTotal: 0,
      }),
      ...responses,
    });
  };

  beforeEach(() => {
    useConnection().info = ONLINE;
    respond({});
  });
  afterEach(() => {
    queryClient.clear();
  });

  it('names months in the UI language', () => {
    expect(shortMonth('2026-01')).toBe('Jan');
    expect(longMonth('2026-01')).toBe('January');
    expect(monthYear('2026-01')).toBe('January 2026');
    expect(monthShortYear('2026-01')).toBe("Jan '26");
  });

  describe('editing categories and groups (09 §6.1–6.2)', () => {
    it('saves a category name, and hides it from its popover', async () => {
      const b = screen();
      const editing = editCategory(b, GROCERIES, anchor());
      await flushPromises();
      const callout = useCallouts().open[0];
      expect(callout?.component).toBe(CategoryEditCallout);
      expect(callout?.props).toMatchObject({
        kind: 'category',
        title: 'Edit category',
        others: ['Fuel'],
        isNew: false,
      });
      await (callout?.props['save'] as (name: string) => Promise<boolean>)('Food');
      expect(host.calls('categories.update')).toEqual([{ id: 'c-groceries', name: 'Food' }]);
      await answerCallout('hide');
      await editing;
      expect(host.calls('categories.update')[1]).toEqual({ id: 'c-groceries', hidden: true });
    });

    it('deletes a new category again on Cancel, but keeps an existing one', async () => {
      const b = screen();
      const added = editCategory(b, GROCERIES, anchor(), true);
      expect((await answerCallout('cancel')).options.title).toBe('Add new category');
      await added;
      expect(host.calls('categories.delete')).toEqual([{ id: 'c-groceries' }]);

      const kept = editCategory(b, GROCERIES, anchor());
      await answerCallout('cancel');
      await kept;
      expect(host.calls('categories.delete')).toHaveLength(1);
    });

    it('confirms a delete with what would be lost', async () => {
      respond({
        'categories.deleteImpact': () => ({
          budgetedMonths: 3,
          transactionCount: 2,
          transactionTotal: -45_00,
        }),
      });
      const deleting = editCategory(screen(), GROCERIES, anchor());
      await answerCallout('delete');
      const confirm = await answerDialog('delete');
      await deleting;
      expect(confirm.instruction).toBe("Permanently delete category 'Groceries'?");
      expect(confirm.content).toContain('in 3 month(s)');
      expect(confirm.content).toContain('There are **2** transaction(s) totaling **-45.00**');
      expect(host.calls('categories.delete')).toEqual([{ id: 'c-groceries' }]);

      respond({});
      const cancelled = editCategory(screen(), GROCERIES, anchor());
      await answerCallout('delete');
      const plain = await answerDialog('cancel');
      await cancelled;
      expect(plain.content).toBe('Are you sure you wish to delete this category?');
      expect(host.calls('categories.delete')).toHaveLength(1);
    });

    it('shows the error when the delete impact cannot be read', async () => {
      respond({
        'categories.deleteImpact': () => {
          throw new RpcError('actual', 'boom');
        },
      });
      const deleting = editCategory(screen(), GROCERIES, anchor());
      await answerCallout('delete');
      expect((await answerDialog('close')).instruction).toBe('Something went wrong');
      await deleting;
      expect(host.calls('categories.delete')).toEqual([]);
    });

    it('edits a master category with the reserved names', async () => {
      const b = screen();
      const editing = editGroup(b, BILLS, anchor());
      await flushPromises();
      const props = useCallouts().open[0]?.props ?? {};
      expect(props).toMatchObject({
        kind: 'group',
        title: 'Edit master category',
        others: ['Income', 'Everyday Expenses'],
      });
      expect(props).not.toHaveProperty('locked');
      expect(props['reserved']).toContain('Hidden Categories');
      await (props['save'] as (name: string) => Promise<boolean>)('Housing');
      expect(host.calls('categories.updateGroup')[0]).toMatchObject({
        id: 'g-bills',
        name: 'Housing',
        reserved: props['reserved'],
      });
      await answerCallout('hide');
      await editing;
      expect(host.calls('categories.updateGroup')[1]).toEqual({ id: 'g-bills', hidden: true });
    });

    it('deletes a new master category on Cancel, and an existing one once confirmed', async () => {
      const added = editGroup(screen(), BILLS, anchor(), true);
      await answerCallout('cancel');
      await added;
      expect(host.calls('categories.deleteGroup')).toEqual([{ id: 'g-bills' }]);

      const deleting = editGroup(screen(), BILLS, anchor());
      await answerCallout('delete');
      const confirm = await answerDialog('delete');
      await deleting;
      expect(confirm.instruction).toBe(
        "Permanently delete master category 'Bills' and all of its sub-categories?",
      );
      expect(host.calls('categories.deleteGroup')).toHaveLength(2);
    });

    it('adds a group at the top and opens its popover on the new name', async () => {
      const b = screen();
      const created: CategoryGroup = {
        ...BILLS,
        id: 'g-new',
        name: 'New Category Group',
        categories: [],
      };
      b.tree.unshift(created);
      respond({ 'categories.createGroup': () => ({ id: 'g-new' }) });
      const name = document.createElement('span');
      name.dataset['budgetName'] = 'g:g-new';
      document.body.append(name);
      const scrollTop = vi.fn();
      const adding = addGroup(b, scrollTop);
      const popover = await answerCallout('done');
      await adding;
      expect(host.calls('categories.createGroup')).toEqual([{ name: 'New Category Group' }]);
      expect(scrollTop).toHaveBeenCalled();
      expect(popover.options.anchor).toBe(name);
      expect(popover.props['isNew']).toBe(true);
    });

    it('adds a category at the end of a collapsed group, expanding it first', async () => {
      const b = screen({ collapsed: new Set(['g-bills']) });
      b.tree[2]?.categories.push({ ...RENT, id: 'c-new', name: 'New Category' });
      respond({ 'categories.create': () => ({ id: 'c-new' }) });
      const name = document.createElement('span');
      name.dataset['budgetName'] = 'c:c-new';
      name.scrollIntoView = vi.fn();
      document.body.append(name);
      const adding = addCategory(b, 'g-bills');
      const popover = await answerCallout('done');
      await adding;
      expect(b.toggleGroup).toHaveBeenCalledWith('g-bills', true);
      expect(host.calls('categories.create')).toEqual([
        { groupId: 'g-bills', name: 'New Category', unique: true },
      ]);
      expect(popover.props).toMatchObject({ kind: 'category', isNew: true });
    });

    it('adds nothing when the create fails', async () => {
      respond({
        'categories.create': () => {
          throw new RpcError('offline', 'down');
        },
        'categories.createGroup': () => {
          throw new RpcError('offline', 'down');
        },
      });
      const category = addCategory(screen(), 'g-bills');
      expect((await answerDialog('close')).instruction).toBe("You're offline");
      await category;
      const group = addGroup(screen(), () => undefined);
      await answerDialog('close');
      await group;
      expect(useCallouts().open).toEqual([]);
    });
  });

  describe('notes (09 §6.3)', () => {
    const note = async (
      result: string,
      typed: string | null,
      initial: string | null = 'Due on the 1st',
      canEdit = true,
    ) => {
      const save = vi.fn(() => Promise.resolve());
      const editing = editNote(anchor(), 'Rent', initial, save, canEdit);
      await flushPromises();
      const callout = useCallouts().open[0];
      expect(callout?.component).toBe(NoteCallout);
      if (typed !== null) (callout?.props['update'] as (v: string) => void)(typed);
      await answerCallout(result);
      await editing;
      return save;
    };

    it('saves the trimmed text on Done or an outside click, and "" on Delete', async () => {
      expect(await note('done', '  Due on the 5th ')).toHaveBeenCalledWith('Due on the 5th');
      expect(await note('clickOutside', 'Paid')).toHaveBeenCalledWith('Paid');
      expect(await note('delete', null)).toHaveBeenCalledWith('');
    });

    it('saves nothing unchanged, cancelled, or read-only', async () => {
      expect(await note('done', ' Due on the 1st ')).not.toHaveBeenCalled();
      expect(await note('cancel', 'Changed')).not.toHaveBeenCalled();
      expect(await note('done', 'Changed', null, false)).not.toHaveBeenCalled();
      expect(await note('done', '', null)).not.toHaveBeenCalled();
    });

    it("writes an entity's note to Actual", async () => {
      await saveEntityNote('c-rent')('Paid');
      expect(host.calls('notes.set')).toEqual([{ id: 'c-rent', text: 'Paid' }]);
    });
  });

  describe('overspending and hidden categories (09 §6.4–6.5)', () => {
    it('changes the carryover flag only when it changes', async () => {
      const set = async (result: string, categoryId = 'c-rent', b = screen()) => {
        const changing = overspending(b, anchor(), MONTH, categoryId);
        const callout = await answerCallout(result);
        await changing;
        return callout;
      };
      const callout = await set('on');
      expect(callout.component).toBe(OverspendingCallout);
      expect(callout.props).toEqual({ carryover: true });
      expect(callout.options.title).toBe('Overspending Settings');
      await set('close');
      expect(host.calls('budget.setCarryover')).toEqual([]);
      await set('off');
      expect(host.calls('budget.setCarryover')).toEqual([
        { month: MONTH, categoryId: 'c-rent', flag: false },
      ]);
    });

    it('unhides what was picked in the hidden categories popover', async () => {
      const showing = showHidden(screen(), anchor());
      const callout = await answerCallout(
        JSON.stringify({ categoryIds: ['c-rent'], groupIds: [] }),
      );
      await showing;
      expect(callout.component).toBe(HiddenCategoriesCallout);
      // Income groups have no hidden categories to show.
      expect((callout.props['groups'] as CategoryGroup[]).map((g) => g.id)).toEqual([
        'g-everyday',
        'g-bills',
      ]);
      expect(host.calls('categories.setHidden')).toEqual([
        { categoryIds: ['c-rent'], groupIds: [], hidden: false },
      ]);
    });
  });

  describe('transactions popovers (09 §5.1, §6.6)', () => {
    const outflows = async (
      target: Parameters<typeof showOutflows>[2],
      result: string,
      rows: CalloutTransaction[],
      b = screen(),
    ) => {
      respond({ 'transactions.forCategoryMonth': () => rows });
      const showing = showOutflows(b, anchor(), target, MONTH);
      await flushPromises();
      const callout = useCallouts().open.length > 0 ? await answerCallout(result) : null;
      await showing;
      return callout;
    };

    it("explains an empty category's outflows, and stops when told", async () => {
      const b = screen();
      const callout = await outflows(
        { kind: 'category', category: GROCERIES, group: EVERYDAY },
        'dontShow',
        [],
        b,
      );
      expect(callout?.component).toBe(EmptyOutflowCallout);
      expect(callout?.props['text']).toContain("**'Groceries'** in October");
      expect(b.patchView).toHaveBeenCalledWith({ showEmptyOutflowTooltip: false });
      expect(
        await outflows(
          { kind: 'group', group: EVERYDAY },
          'close',
          [],
          screen({ showEmptyOutflowTooltip: false }),
        ),
      ).toBeNull();
    });

    it('lists the outflows with what was spent', async () => {
      const one = await outflows(
        { kind: 'category', category: GROCERIES, group: EVERYDAY },
        'close',
        [row()],
      );
      expect(one?.component).toBe(TransactionsCallout);
      expect(one?.options.title).toBe('Groceries');
      expect(one?.props['summary']).toBe('You spent 25.00 in 1 transaction:');
      expect(host.calls('transactions.forCategoryMonth')[0]).toEqual({
        target: 'c-groceries',
        month: MONTH,
      });
      const group = await outflows({ kind: 'group', group: EVERYDAY }, 'close', [row(), row()]);
      expect(group?.props['summary']).toBe('You spent 50.00 in 2 transactions:');
      const none = await outflows({ kind: 'uncategorized' }, 'close', []);
      expect(none?.props['summary']).toBe(
        'You spent 0.00 in 0 transactions with no category assigned:',
      );
      expect(none?.options.title).toBe('Uncategorized Transactions');
      expect((await outflows({ kind: 'all' }, 'close', [row()]))?.options.title).toBe('Outflows');
    });

    it('jumps to a row, and shows all the rows in their account or All Accounts', async () => {
      useBudgetSettings().cloudFileId = 'c1';
      vi.mocked(window.app.shell.settings).patchBudget.mockResolvedValue({
        ...DEFAULT_BUDGET_SETTINGS,
      });
      await outflows({ kind: 'all' }, 'jump:0', [row({ isSplitLine: true, transactionId: 'p1' })]);
      expect(useJump().pending).toEqual({ accountId: 'chk', transactionId: 'p1', expand: true });

      await outflows({ kind: 'category', category: GROCERIES, group: EVERYDAY }, 'show', [row()]);
      expect(useAppStore().activeAccountId).toBe('chk');
      expect(useRegisterSession().view('chk').search).toMatch(/Groceries/);

      await outflows({ kind: 'all' }, 'show', [row(), row({ id: 't2', accountId: 'sav' })]);
      expect(useAppStore().activeAccountId).toBe('all');
      // The date filter covers the rows' months.
      const patches = vi
        .mocked(window.app.shell.settings)
        .patchBudget.mock.calls.map(([, p]) => p as Partial<BudgetSettings>);
      expect(patches.some((p) => p.register?.accounts['all']?.dateFilter !== undefined)).toBe(true);
    });

    it("lists the month's income, with what was held from last month", async () => {
      const income = async (over: Record<string, number>, rows: CalloutTransaction[]) => {
        respond({ 'transactions.incomeForMonth': () => rows });
        const showing = showIncome(screen(), anchor(), monthView(MONTH, {}, over));
        const callout = await answerCallout('close');
        await showing;
        return callout;
      };
      const none = await income({ incomeHeldFromPrev: 0 }, []);
      expect(none.options.title).toBe('Income for October');
      expect(none.props).toMatchObject({
        summary: 'No transactions have been categorized as "Income for October"',
        lines: [],
        held: null,
      });
      const some = await income(
        { income: 3000_00, incomeHeldFromPrev: 500_00, incomeReceived: 2500_00 },
        [row({ amount: 2500_00 })],
      );
      expect(some.props['summary']).toBe(
        '**3,000.00** total income was categorized as "Income for October"',
      );
      expect(some.props['lines']).toEqual([
        '500.00 was received in September',
        '2,500.00 was received in October',
      ]);
      expect(some.props['held']).toEqual({ label: 'Held from September', amount: 500_00 });
    });
  });

  describe('Quick Budget (09 §5.5)', () => {
    const stats = (h12: number): QuickBudgetStats => ({ month: MONTH, h12, categories: {} });
    let menu: ContextMenuItem[] = [];

    const choose = async (
      choice: string | null,
      opts: { h12?: number; b?: ReturnType<typeof screen>; heldForNext?: number } = {},
    ) => {
      respond({ 'budget.quickBudgetStats': () => stats(opts.h12 ?? 12) });
      vi.mocked(window.app.shell).showContextMenu.mockImplementationOnce((items) => {
        menu = items;
        return Promise.resolve(choice);
      });
      const b = opts.b ?? screen();
      return quickBudgetMenu(
        b,
        monthView(MONTH, {}, { heldForNext: opts.heldForNext ?? 0, toBudget: 200_00 }),
        anchor(),
      );
    };
    const ids = (): string[] => menu.map((i) => i.id);

    it('offers the averages there is history for, and Hold on an envelope budget', async () => {
      await choose(null);
      expect(ids()).toEqual([
        'h1',
        'lastBudgeted',
        'lastOutflows',
        'average3',
        'averageYear',
        'scheduled',
        'balanceTo0',
        'h2',
        'zero',
        'sep',
        'hold',
      ]);
      expect(menu.find((i) => i.id === 'averageYear')?.label).toBe(
        '   Average outflows for the last year',
      );
      await choose(null, { h12: 5, heldForNext: 100_00 });
      expect(menu.find((i) => i.id === 'averageYear')?.label).toBe(
        '   Average outflows for the last year (only 5 months available)',
      );
      expect(ids()).toContain('resetHold');
      await choose(null, { h12: 1, b: screen({ canEdit: false }) });
      expect(ids()).not.toContain('average3');
      expect(menu.find((i) => i.id === 'hold')?.enabled).toBe(false);
      expect(menu.find((i) => i.id === 'zero')?.enabled).toBe(false);
    });

    it('confirms a fill, then budgets the visible expense categories', async () => {
      const b = screen();
      const filling = choose('lastBudgeted', { b });
      const confirm = await answerDialog('fill');
      await filling;
      expect(confirm.instruction).toBe(
        "Fill in empty budget cells with the amounts budgeted in Sep '26?",
      );
      expect(b.commitAmounts).toHaveBeenCalledWith(MONTH, expect.any(Array));

      const cancelled = choose('zero', { b });
      const zero = await answerDialog('cancel');
      await cancelled;
      expect(zero.instruction).toBe('Budget 0.00 for *every* category this month?');
      expect(b.commitAmounts).toHaveBeenCalledTimes(1);
    });

    it('words each fill', async () => {
      const instruction = async (which: string, h12 = 12): Promise<string> => {
        const filling = choose(which, { h12 });
        const options = await answerDialog('cancel');
        await filling;
        return options.instruction;
      };
      expect(await instruction('lastOutflows')).toBe(
        "Fill in empty budget cells with the outflows from Sep '26?",
      );
      expect(await instruction('average3')).toBe(
        'Fill in empty budget cells with average outflows for the last 3 months?',
      );
      expect(await instruction('average3', 1)).toBe(
        "Fill in empty budget cells with the average outflows of Sep '26?",
      );
      expect(await instruction('averageYear')).toBe(
        'Fill in empty budget cells with average outflows for the last year?',
      );
      expect(await instruction('averageYear', 7)).toBe(
        'Fill in empty budget cells with average outflows for the last 7 months?',
      );
      expect(await instruction('scheduled')).toBe(
        "Fill in empty budget cells with the total scheduled outflows for Oct '26?",
      );
      const balancing = choose('balanceTo0');
      const options = await answerDialog('cancel');
      await balancing;
      expect(options.instruction).toBe(
        'Replace all eligible budget amounts to bring their category balances to 0?',
      );
      expect(options.buttons[1]).toMatchObject({ label: 'Balance to 0.00' });
    });

    it('holds an amount for next month, and resets the hold', async () => {
      const holding = choose('hold', { heldForNext: 0 });
      const callout = await answerCallout('150000');
      await holding;
      expect(callout.component).toBe(HoldCallout);
      expect(callout.props).toMatchObject({
        month: 'October',
        next: 'November',
        available: 200_00,
        initial: 200_00,
      });
      expect(host.calls('budget.hold')).toEqual([{ month: MONTH, amount: 150000 }]);

      const cancelled = choose('hold', { heldForNext: 50_00 });
      expect((await answerCallout('cancel')).props['initial']).toBe(50_00);
      await cancelled;
      expect(host.calls('budget.hold')).toHaveLength(1);

      await choose('resetHold');
      expect(host.calls('budget.resetHold')).toEqual([{ month: MONTH }]);
    });

    it('shows nothing when the stats cannot be read', async () => {
      respond({
        'budget.quickBudgetStats': () => {
          throw new RpcError('actual', 'boom');
        },
      });
      const opening = quickBudgetMenu(screen(), monthView(MONTH), anchor());
      await answerDialog('close');
      await opening;
      expect(vi.mocked(window.app.shell).showContextMenu.mock.calls).toEqual([]);
    });

    it('fills only visible expense categories', () => {
      const b = screen();
      b.tree[2] = { ...BILLS, hidden: true };
      b.tree[1] = { ...EVERYDAY, categories: [GROCERIES, { ...FUEL, hidden: true }] };
      expect(fillableCategories(b)).toEqual(['c-groceries']);
    });
  });

  describe('moves (09 §4.3, 22 §2.4)', () => {
    it('moves a category into a group, before a category', async () => {
      await moveCategory(screen(), 'c-fuel', 'g-bills', 'c-rent');
      expect(host.calls('categories.move')).toEqual([
        { id: 'c-fuel', groupId: 'g-bills', beforeId: 'c-rent' },
      ]);
      await moveCategory(screen(), 'gone', 'g-bills', null);
      expect(host.calls('categories.move')).toHaveLength(1);
    });

    it('refuses a name the group already has, and a reorder Actual cannot do', async () => {
      const b = screen();
      b.tree[2]?.categories.push({ ...RENT, id: 'c-fuel-2', name: ' FUEL' });
      const duplicate = moveCategory(b, 'c-fuel', 'g-bills', null);
      expect((await answerDialog('ok')).instruction).toBe(
        'There is already a category named Bills : Fuel',
      );
      await duplicate;

      const reorder = moveCategory(
        screen({ moveSupport: { category: false, group: true } }),
        'c-fuel',
        'g-everyday',
        'c-groceries',
      );
      expect((await answerDialog('ok')).instruction).toBe(
        "This version of Actual doesn't let Actuality reorder categories.",
      );
      await reorder;
      expect(host.calls('categories.move')).toEqual([]);
    });

    it('explains the move errors Actual gives', async () => {
      const failed = async (e: RpcError): Promise<string> => {
        respond({
          'categories.move': () => {
            throw e;
          },
        });
        const moving = moveCategory(screen(), 'c-fuel', 'g-bills', null);
        const options = await answerDialog('ok').catch(() => answerDialog('close'));
        await moving;
        return options.instruction;
      };
      expect(
        await failed(new RpcError('actual', 'x', { code: 'internal-handler-unavailable' })),
      ).toBe("This version of Actual doesn't let Actuality reorder categories.");
      expect(await failed(new RpcError('actual', 'x', { code: 'name-duplicate' }))).toBe(
        'There is already a category named Bills : Fuel',
      );
      expect(await failed(new RpcError('actual', 'boom'))).toBe('Something went wrong');
    });

    it('moves a group, quietly falling back when Actual lacks the handler', async () => {
      await moveGroup('g-bills', 'g-everyday');
      expect(host.calls('categories.moveGroup')).toEqual([
        { id: 'g-bills', beforeId: 'g-everyday' },
      ]);
      respond({
        'categories.moveGroup': () => {
          throw new RpcError('actual', 'x', { code: 'internal-handler-unavailable' });
        },
      });
      await moveGroup('g-bills', null);
      expect(useDialogs().stack).toEqual([]);
      respond({
        'categories.moveGroup': () => {
          throw new RpcError('actual', 'boom');
        },
      });
      const moving = moveGroup('g-bills', null);
      expect((await answerDialog('close')).instruction).toBe('Something went wrong');
      await moving;
    });

    it('Move to Group… offers the other visible groups of the same kind', async () => {
      const b = screen();
      const moving = moveToGroup(b, FUEL);
      expect(useModals().stack[0]?.component).toBe(MoveToGroupDialog);
      const props = await answerModal('g-bills');
      await moving;
      expect(props['name']).toBe('Fuel');
      expect((props['groups'] as CategoryGroup[]).map((g) => g.id)).toEqual(['g-bills']);
      expect(host.calls('categories.move')).toEqual([
        { id: 'c-fuel', groupId: 'g-bills', beforeId: null },
      ]);

      const cancelled = moveToGroup(b, FUEL);
      await answerModal(null);
      await cancelled;
      expect(host.calls('categories.move')).toHaveLength(1);
    });
  });
});
