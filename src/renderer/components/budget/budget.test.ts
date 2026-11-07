// The Budget screen (09): the header lines, cell editing with Tab / ↑ / ↓ navigation
// (wrapping, skipping collapsed groups), Esc, the calculator, the per-cell and month Quick Budget, the
// offline rules, hide / unhide, the transactions popover and moves with their refusals (09 §9 criteria
// 3–5).
import { APP_NAME } from '@shared/app';
import type { BudgetMonthView, Month } from '@shared/domain/types';
import { DEFAULT_APP_SETTINGS, DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJump } from '../../register/jump';
import BudgetPanel from '../../screens/shell/BudgetPanel.vue';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useCallouts } from '../../stores/callouts';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useSettings } from '../../stores/settings';
import {
  answerDialog,
  budgetResponses,
  GROUPS,
  mockHost,
  monthView,
  ONLINE,
  type Responses,
} from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import CalloutHost from '../common/CalloutHost.vue';
import DialogHost from '../common/DialogHost.vue';

const OCT = '2026-10' as Month;
const MONTHS = ['2026-09', '2026-10', '2026-11'] as Month[];

let view: BudgetMonthView;
let host: ReturnType<typeof mockHost>;

function responses(extra: Responses = {}): Responses {
  return {
    'categories.tree': () => GROUPS,
    'prefs.synced': () => ({}),
    ...budgetResponses(MONTHS, (m) => (m === OCT ? view : monthView(m))),
    'budget.quickBudgetStats': () => ({
      month: OCT,
      h12: 4,
      categories: {
        'c-groceries': {
          budgeted: 0,
          lastBudgeted: 40_000,
          lastOutflows: 38_000,
          average3: 35_000,
          averageYear: 30_000,
          scheduled: 0,
          balanceTo0: 1_000,
        },
        'c-fuel': {
          budgeted: 7_000,
          lastBudgeted: 8_000,
          lastOutflows: 6_000,
          average3: 5_000,
          averageYear: 4_000,
          scheduled: 0,
          balanceTo0: 0,
        },
        'c-rent': {
          budgeted: 0,
          lastBudgeted: 0,
          lastOutflows: 0,
          average3: 0,
          averageYear: 0,
          scheduled: 150_000,
          balanceTo0: 0,
        },
      },
    }),
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 12));
  view = monthView(
    OCT,
    {
      'c-groceries': { budgeted: 0, activity: -5_000, balance: -5_000, hasTransactions: true },
      'c-fuel': { budgeted: 7_000, activity: 0, balance: 7_000 },
      'c-rent': { budgeted: 150_000, activity: -150_000, balance: 0, hasTransactions: true },
    },
    {
      notBudgetedPrev: 100_000,
      overspentPrev: -12_000,
      income: 300_000,
      incomeReceived: 300_000,
      toBudget: 231_000,
    },
  );
  host = mockHost(responses());
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
  const settings = useBudgetSettings();
  settings.cloudFileId = 'c1';
  settings.settings = structuredClone(DEFAULT_BUDGET_SETTINGS);
  vi.spyOn(window.app.shell.settings, 'patchBudget').mockImplementation((_id, p) =>
    Promise.resolve({ ...settings.settings, ...(p as object) }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

async function open(): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(
    {
      components: { BudgetPanel, CalloutHost, DialogHost },
      template: '<BudgetPanel :shown="true" /><CalloutHost /><DialogHost />',
    },
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  for (let i = 0; i < 4; i++) await flushPromises();
  return w;
}

const budgeted = (w: VueWrapper, categoryId: string) =>
  w
    .findAll('[data-budget-cell="budgeted"]')
    .find(
      (c) =>
        c.attributes('aria-label')?.startsWith('October Budgeted') &&
        c.element
          .closest(`[data-row-index]`)
          ?.querySelector(`[data-budget-name="c:${categoryId}"]`),
    );
const input = (w: VueWrapper) => w.find<HTMLInputElement>('.budgeted__input');
const setAmountCalls = () => host.calls('budget.setAmount');

async function edit(w: VueWrapper, categoryId: string): Promise<void> {
  await budgeted(w, categoryId)?.trigger('click');
  await flushPromises();
}

async function key(w: VueWrapper, k: string, opts: KeyboardEventInit = {}): Promise<void> {
  await input(w).trigger('keydown', { key: k, ...opts });
  await flushPromises();
  await flushPromises();
}

describe('Budget screen (09)', () => {
  it('shows the month header lines and the identity’s result (09 §5.1)', async () => {
    const w = await open();
    const header = w.get('[data-month-header="2026-10"]');
    expect(header.text()).toContain('1,000.00Not Budgeted in Sep');
    expect(header.text()).toContain('-120.00Overspent in Sep');
    expect(header.text()).toContain('+3,000.00Income for Oct');
    expect(header.text()).toContain('2,310.00');
    expect(header.text()).toContain('Available to Budget');
    expect(header.text()).not.toContain('Other adjustments');
    expect(header.attributes('aria-label')).toContain('Available to Budget: 2,310.00.');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('privacy mode masks every amount, visible and spoken, and turning it off restores them (06 §7)', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: true };
    const w = await open();
    const labels = (): string =>
      [...document.body.querySelectorAll('[aria-label]')]
        .map((e) => e.getAttribute('aria-label'))
        .join('|');
    expect(w.findAll('.money-mask').length).toBeGreaterThan(10);
    expect(w.text()).not.toMatch(/\d\.\d\d\b/);
    expect(labels()).not.toMatch(/\d\.\d\d\b/);
    expect(w.get('[data-month-header="2026-10"]').attributes('aria-label')).toContain(
      'Available to Budget: Hidden amount.',
    );
    expect(await axe(document.body)).toHaveNoViolations();

    useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: false };
    await flushPromises();
    expect(w.find('.money-mask').exists()).toBe(false);
    expect(w.get('[data-month-header="2026-10"]').text()).toContain('2,310.00');
  });

  it('shows an Other adjustments line when Actual’s numbers don’t add up (09 §2)', async () => {
    view = { ...view, otherAdjustments: -500 };
    const w = await open();
    expect(w.get('[data-month-header="2026-10"]').text()).toContain('-5.00Other adjustments');
  });

  it('shows Outflows blank when 0 without transactions and Balance as a pill when negative (09 §5.4)', async () => {
    const w = await open();
    const row = (id: string) =>
      w.get(`[data-budget-name="c:${id}"]`).element.closest('[data-row-index]');
    expect(row('c-fuel')?.querySelector('.budget-grid__activity')?.textContent.trim()).toBe('');
    expect(row('c-groceries')?.querySelector('.budget-grid__amount--negative')?.textContent).toBe(
      '-50.00',
    );
    expect(row('c-rent')?.querySelector('.budget-grid__amount--zero')?.textContent).toBe('0.00');
  });

  it('← and → step the month, and 0 goes back to the current month, while no cell has focus (09 §7)', async () => {
    const w = await open();
    const press = async (k: string): Promise<void> => {
      w.get('[data-budget-scroll]').element.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
      for (let i = 0; i < 3; i++) await flushPromises();
    };
    const selected = (): string | null => useBudgetSettings().settings.budget.lastSelectedMonth;
    await press('ArrowLeft');
    expect(selected()).toBe('2026-09');
    await press('0');
    expect(selected()).toBe(OCT);
  });

  describe('editing a Budgeted cell (09 §5.4, §9 criterion 3)', () => {
    it('commits with Enter and moves down; Tab wraps; Shift+Tab goes back', async () => {
      const w = await open();
      await edit(w, 'c-groceries');
      expect(input(w).element.value).toBe('');
      await input(w).setValue('50');
      await key(w, 'Enter');
      expect(setAmountCalls()).toEqual([{ month: OCT, categoryId: 'c-groceries', amount: 5_000 }]);
      // Now on Fuel, then Rent, then back to Groceries.
      expect(input(w).element.value).toBe('70.00');
      await key(w, 'Tab');
      expect(input(w).element.value).toBe('1500.00');
      await key(w, 'Tab');
      expect(input(w).element.getAttribute('aria-label')).toBe('October Budgeted');
      await key(w, 'Tab', { shiftKey: true });
      expect(input(w).element.value).toBe('1500.00');
      expect(setAmountCalls()).toHaveLength(1);
    });

    it('Shift+Enter moves up to the previous category', async () => {
      const w = await open();
      await edit(w, 'c-fuel');
      await key(w, 'Enter', { shiftKey: true });
      expect(
        input(w)
          .element.closest('[data-row-index]')
          ?.querySelector('[data-budget-name="c:c-groceries"]'),
      ).not.toBeNull();
    });

    it('skips the categories of collapsed groups', async () => {
      useBudgetSettings().settings.budget.collapsedGroups = ['g-bills'];
      const w = await open();
      await edit(w, 'c-fuel');
      await key(w, 'ArrowDown');
      expect(
        input(w)
          .element.closest('[data-row-index]')
          ?.querySelector('[data-budget-name="c:c-groceries"]'),
      ).not.toBeNull();
    });

    it('Esc discards typed text and keeps focus; unchanged text leaves the cell', async () => {
      const w = await open();
      await edit(w, 'c-fuel');
      await input(w).setValue('99');
      await key(w, 'Escape');
      expect(input(w).exists()).toBe(false);
      expect(document.activeElement?.getAttribute('data-budget-cell')).toBe('budgeted');
      await edit(w, 'c-fuel');
      await key(w, 'Escape');
      expect(document.activeElement?.hasAttribute('data-budget-scroll')).toBe(true);
      expect(setAmountCalls()).toEqual([]);
    });

    it('reverts invalid text and writes nothing for an unchanged value', async () => {
      const w = await open();
      await edit(w, 'c-fuel');
      await input(w).setValue('abc');
      await key(w, 'Enter');
      await edit(w, 'c-fuel');
      await input(w).setValue('70');
      await key(w, 'Enter');
      expect(setAmountCalls()).toEqual([]);
    });

    it('opens the calculator on + with the current value; OK commits the result at once', async () => {
      // The write lands when the test says so, and the next read returns it.
      let land = (): void => {};
      host = mockHost(
        responses({
          'budget.setAmount': () =>
            new Promise<null>((resolve) => {
              land = () => {
                const fuel = view.groups
                  .flatMap((g) => g.categories)
                  .find((c) => c.id === 'c-fuel');
                if (fuel) Object.assign(fuel, { budgeted: 7_500, balance: 7_500 });
                resolve(null);
              };
            }),
        }),
      );
      const w = await open();
      const balance = (): string | null | undefined =>
        budgeted(w, 'c-fuel')
          ?.element.parentElement?.querySelector('.budget-grid__balance')
          ?.textContent.trim();
      await edit(w, 'c-fuel');
      await key(w, '+');
      const calc =
        document.querySelector<HTMLElement>('[role="dialog"][aria-label="Calculator"]') ??
        document.querySelector<HTMLElement>('.budgeted__popup [role="dialog"]');
      expect(calc).not.toBeNull();
      for (const k of ['5', 'Enter'])
        calc?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      await flushPromises();
      // Written without leaving the cell, Balance shown at once; the editor stays open, text selected.
      expect(setAmountCalls()).toEqual([{ month: OCT, categoryId: 'c-fuel', amount: 7_500 }]);
      expect(balance()).toBe('75.00');
      const field = input(w).element;
      expect(field.value).toBe('75.00');
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
      land();
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(balance()).toBe('75.00');
      // Leaving the cell afterwards writes nothing more.
      await key(w, 'Enter');
      expect(setAmountCalls()).toHaveLength(1);
    });

    it('types a minus sign on a zero value instead of opening the calculator', async () => {
      const w = await open();
      await edit(w, 'c-groceries');
      await key(w, '-');
      expect(document.querySelector('.budgeted__popup')).toBeNull();
    });

    it('F2 opens the Quick Budget list; Enter sets the highlighted amount (09 §5.4)', async () => {
      const w = await open();
      await edit(w, 'c-groceries');
      await key(w, 'F2');
      const list = document.querySelector<HTMLElement>('.budgeted__popup [role="listbox"]');
      expect(
        [...(list?.querySelectorAll('[role="option"]') ?? [])].map((o) => o.textContent.trim()),
      ).toEqual([
        'Amount budgeted last month:400.00',
        'Outflows last month:380.00',
        'Average outflows for last 3 months:350.00',
        'Average outflows for last year (only 4 months available):300.00',
        'Total scheduled outflows this month:0.00',
        'Balance to 0.00:10.00',
        'Show calculator',
      ]);
      list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flushPromises();
      await flushPromises();
      expect(setAmountCalls()).toEqual([{ month: OCT, categoryId: 'c-groceries', amount: 38_000 }]);
    });

    describe('closing the popup without a selection (09 §5.4)', () => {
      const popup = () => document.querySelector<HTMLElement>('.budgeted__popup');
      const list = () => document.querySelector<HTMLElement>('.budgeted__popup [role="listbox"]');
      const calculator = () => document.querySelector<HTMLElement>('.budgeted__popup .calc');
      const settle = async (): Promise<void> => {
        await flushPromises();
        await flushPromises();
      };
      const press = async (target: Element): Promise<void> => {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await settle();
      };
      /** Starts editing Fuel (70.00) with the list open. */
      async function openList(): Promise<VueWrapper> {
        const w = await open();
        await edit(w, 'c-fuel');
        await key(w, 'F2');
        expect(list()).not.toBeNull();
        return w;
      }

      it('an outside click closes it, sets no amount from the list and leaves the cell', async () => {
        const w = await openList();
        await press(document.body);
        expect(popup()).toBeNull();
        expect(input(w).exists()).toBe(false);
        expect(setAmountCalls()).toEqual([]);
      });

      it('an outside click commits what was typed in the field', async () => {
        const w = await open();
        await edit(w, 'c-fuel');
        await input(w).setValue('99');
        await key(w, 'F2');
        await press(document.body);
        expect(popup()).toBeNull();
        expect(setAmountCalls()).toEqual([{ month: OCT, categoryId: 'c-fuel', amount: 9_900 }]);
      });

      it('clicking another Budgeted cell closes it and edits that cell', async () => {
        const w = await openList();
        const other = budgeted(w, 'c-groceries');
        if (!other) throw new Error('no Groceries cell');
        await press(other.element);
        await edit(w, 'c-groceries');
        expect(popup()).toBeNull();
        expect(
          input(w)
            .element.closest('[data-row-index]')
            ?.querySelector('[data-budget-name="c:c-groceries"]'),
        ).not.toBeNull();
      });

      it('focus moving to another control closes it and leaves the cell', async () => {
        const w = await openList();
        const other = document.createElement('button');
        document.body.append(other);
        try {
          list()?.dispatchEvent(
            new FocusEvent('focusout', { bubbles: true, relatedTarget: other }),
          );
          await settle();
          expect(popup()).toBeNull();
          expect(input(w).exists()).toBe(false);
        } finally {
          other.remove();
        }
      });

      it('switching to another application closes it', async () => {
        const w = await openList();
        // The OS window lost focus: activeElement doesn't change, and focusout has no relatedTarget.
        const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        try {
          list()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          await settle();
          expect(popup()).toBeNull();
          expect(input(w).exists()).toBe(false);
        } finally {
          hasFocus.mockRestore();
        }
      });

      it('focus moving back to the field closes it and keeps editing', async () => {
        const w = await openList();
        list()?.dispatchEvent(
          new FocusEvent('focusout', { bubbles: true, relatedTarget: input(w).element }),
        );
        await settle();
        expect(popup()).toBeNull();
        expect(input(w).exists()).toBe(true);
        expect(document.activeElement).toBe(input(w).element);
      });

      it('the arrow closes the list it opened and keeps editing', async () => {
        const w = await open();
        await edit(w, 'c-fuel');
        const arrow = w.get('.budgeted__arrow');
        await arrow.trigger('click');
        await settle();
        expect(list()).not.toBeNull();
        await press(arrow.element);
        expect(list()).not.toBeNull();
        await arrow.trigger('click');
        await settle();
        expect(popup()).toBeNull();
        expect(document.activeElement).toBe(input(w).element);
      });

      it('a press inside it keeps it open', async () => {
        await openList();
        const option = list()?.querySelector('[role="option"]');
        if (!option) throw new Error('no options');
        await press(option);
        expect(list()).not.toBeNull();
      });

      it('stays open when the list gives way to the calculator', async () => {
        await openList();
        const items = list()?.querySelectorAll<HTMLElement>('[role="option"]');
        const list0 = list();
        items?.[items.length - 1]?.click();
        // Removing the focused list drops focus with no relatedTarget.
        list0?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await settle();
        expect(calculator()).not.toBeNull();
      });

      it('an outside click closes the calculator and discards the calculation', async () => {
        const w = await open();
        await edit(w, 'c-fuel');
        await key(w, '+');
        calculator()?.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
        await press(document.body);
        expect(popup()).toBeNull();
        expect(input(w).exists()).toBe(false);
        expect(setAmountCalls()).toEqual([]);
      });

      it('Esc returns to the field, and later presses no longer act for the closed popup', async () => {
        const w = await openList();
        list()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect(popup()).toBeNull();
        expect(document.activeElement).toBe(input(w).element);
        await press(document.body);
        expect(input(w).exists()).toBe(true);
      });
    });
  });

  it('fills empty cells from the month Quick Budget menu after the confirmation (09 §5.5)', async () => {
    const showMenu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValue('average3');
    const w = await open();
    await w.get('[aria-label="Quick Budget"]').trigger('click');
    await flushPromises();
    const menu = showMenu.mock.calls[0]?.[0] ?? [];
    expect(menu.map((i) => i.label ?? '—')).toEqual([
      'Fill in all empty budget cells with:',
      '   Budget values used last month',
      '   Outflows last month',
      '   Average outflows for the last 3 months',
      '   Average outflows for the last year (only 4 months available)',
      '   Total scheduled outflows this month',
      '   Balance to 0.00',
      'Fill in all budget cells with:',
      '   0.00 (Zero all budgeted amounts for this month)',
      '—',
      'Hold for next month…',
    ]);
    const options = await answerDialog('fill');
    expect(options.instruction).toBe(
      'Fill in empty budget cells with average outflows for the last 3 months?',
    );
    expect(options.content).toBe('This operation cannot be undone.');
    // Only the categories budgeted at 0 that have a value: Groceries (Rent's average is 0).
    expect(host.calls('budget.setAmounts')).toEqual([
      { month: OCT, entries: [{ categoryId: 'c-groceries', amount: 35_000 }] },
    ]);
  });

  it('reports failures loading month Quick Budget stats', async () => {
    host = mockHost(
      responses({
        'budget.quickBudgetStats': () => {
          throw new Error('stats unavailable');
        },
      }),
    );
    const w = await open();
    await w.get('[aria-label="Quick Budget"]').trigger('click');
    await flushPromises();
    expect(useDialogs().stack.at(-1)?.options.instruction).toBe('Something went wrong');
  });

  it('reports failures loading per-cell Quick Budget stats', async () => {
    host = mockHost(
      responses({
        'budget.quickBudgetStats': () => {
          throw new Error('stats unavailable');
        },
      }),
    );
    const w = await open();
    await edit(w, 'c-groceries');
    await key(w, 'F2');
    expect(useDialogs().stack.at(-1)?.options.instruction).toBe('Something went wrong');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValue('zero');
    const w = await open();
    await w.get('[aria-label="Quick Budget"]').trigger('click');
    const options = await answerDialog('cancel');
    expect(options.instruction).toBe('Budget 0.00 for *every* category this month?');
    expect(host.calls('budget.setAmounts')).toEqual([]);
  });

  describe('offline (09 §9 criterion 4)', () => {
    beforeEach(() => {
      useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    });

    it('keeps cells read-only and disables the popovers’ Done', async () => {
      const w = await open();
      await edit(w, 'c-fuel');
      expect(input(w).exists()).toBe(false);
      await w.get('[data-budget-name="c:c-fuel"]').trigger('click');
      await flushPromises();
      const done = [...document.querySelectorAll<HTMLButtonElement>('.callout button')].find(
        (b) => b.textContent.trim() === 'Done',
      );
      expect(done?.disabled).toBe(true);
    });
  });

  it('hides a category from its popover, and unhides it from Hidden Categories (09 §9 criterion 5)', async () => {
    const w = await open();
    await w.get('[data-budget-name="c:c-fuel"]').trigger('click');
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('.callout button')]
      .find((b) => b.textContent.trim() === 'Hide this category')
      ?.click();
    await flushPromises();
    expect(host.calls('categories.update')).toEqual([{ id: 'c-fuel', hidden: true }]);
  });

  it('reports failures when hiding a row from its context menu', async () => {
    host = mockHost(
      responses({
        'categories.update': () => {
          throw new Error('hide unavailable');
        },
      }),
    );
    vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValue('hide');
    const w = await open();
    await w.get('[data-budget-name="c:c-fuel"]').trigger('contextmenu');
    await flushPromises();
    expect(useDialogs().stack.at(-1)?.options.instruction).toBe('Something went wrong');
  });

  it('unhides a hidden category from Hidden Categories (09 §6.5)', async () => {
    const groups = structuredClone(GROUPS);
    const fuel = groups[1]?.categories[1];
    if (fuel) fuel.hidden = true;
    host = mockHost(responses({ 'categories.tree': () => groups }));
    const w = await open();
    expect(w.find('[data-budget-name="c:c-fuel"]').exists()).toBe(false);
    await w.get('.budget-grid__unhide').trigger('click');
    await flushPromises();
    const links = [...document.querySelectorAll<HTMLButtonElement>('.callout button')];
    expect(links.map((l) => l.textContent.trim())).toEqual(['Everyday Expenses:', 'Fuel']);
    links[1]?.click();
    await flushPromises();
    expect(host.calls('categories.setHidden')).toEqual([
      { categoryIds: ['c-fuel'], groupIds: [], hidden: false },
    ]);
  });

  it('lists a category’s transactions and jumps to one (09 §6.6)', async () => {
    host = mockHost(
      responses({
        'transactions.forCategoryMonth': () => [
          {
            id: 't1',
            transactionId: 't1',
            accountId: 'chk',
            accountName: 'Checking',
            date: '2026-10-05',
            payeeName: 'Kroger',
            transferAccountName: null,
            isSplitLine: false,
            notes: 'weekly',
            parentNotes: '',
            amount: -5_000,
          },
        ],
      }),
    );
    const w = await open();
    const row = w.get('[data-budget-name="c:c-groceries"]').element.closest('[data-row-index]');
    row?.querySelector<HTMLElement>('.budget-grid__activity')?.click();
    await flushPromises();
    expect(host.calls('transactions.forCategoryMonth')).toEqual([
      { target: 'c-groceries', month: OCT },
    ]);
    const callout = document.querySelector('.callout');
    expect(callout?.textContent).toContain('You spent 50.00 in 1 transaction:');
    expect(callout?.textContent).toContain('Kroger');
    callout?.querySelector<HTMLElement>('[data-callout-row]')?.click();
    await flushPromises();
    expect(useJump().pending).toEqual({ accountId: 'chk', transactionId: 't1' });
  });

  it('shows the empty-outflow help for a category without outflows (09 §6.6)', async () => {
    host = mockHost(responses({ 'transactions.forCategoryMonth': () => [] }));
    const w = await open();
    const row = w.get('[data-budget-name="c:c-fuel"]').element.closest('[data-row-index]');
    row?.querySelector<HTMLElement>('.budget-grid__activity')?.click();
    await flushPromises();
    expect(useCallouts().open[0]?.options.title).toBe('How to Enter an Outflow');
  });

  describe('moves (09 §4.3, 22 §2.4)', () => {
    it('moves a category with Alt+↓', async () => {
      const w = await open();
      await w
        .get('[data-budget-name="c:c-groceries"]')
        .trigger('keydown', { key: 'ArrowDown', altKey: true });
      await flushPromises();
      expect(host.calls('categories.move')).toEqual([
        { id: 'c-groceries', groupId: 'g-everyday', beforeId: null },
      ]);
    });

    it('refuses a reorder without the category-move handler', async () => {
      host = mockHost(
        responses({ 'categories.moveSupport': () => ({ category: false, group: false }) }),
      );
      const w = await open();
      await w
        .get('[data-budget-name="c:c-groceries"]')
        .trigger('keydown', { key: 'ArrowDown', altKey: true });
      await flushPromises();
      expect(host.calls('categories.move')).toEqual([]);
      expect(useDialogs().stack[0]?.options.instruction).toBe(
        `This version of Actual doesn't let ${APP_NAME} reorder categories.`,
      );
    });
  });
});
