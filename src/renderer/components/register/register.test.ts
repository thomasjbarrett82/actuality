// The register panel and its inline editor with a mocked host (10, 11): rows and
// notifiers, selection and starting an edit, the editor's fields and keys (date, check #, amounts, Tab
// order), its button rows, payee auto-fill and checks, the category list and Add New Category, split mode,
// committing, cancelling, the offline refusal and the open-edit rule.
import type { Transaction } from '@shared/domain/types';
import { HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import { RpcError } from '@shared/rpc/protocol';
import { DEFAULT_APP_SETTINGS, DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRegisterSession } from '../../register/view-state';
import RegisterPanel from '../../screens/shell/RegisterPanel.vue';
import { useAppStore } from '../../stores/app';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
import {
  account,
  answerDialog,
  GROUPS,
  line,
  mockHost,
  ONLINE,
  payee,
  transaction,
  type Responses,
} from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';

const CHECKING = account({
  id: 'chk',
  name: 'Checking',
  attention: { count: 2, maxLevel: 'forReview' },
  balances: { cleared: 10000, uncleared: -5210, working: 4790, reconciled: 0 },
});
const SAVINGS = account({ id: 'sav', name: 'Savings' });
const PAYEES = [
  payee({ id: 'p-kroger', name: 'Kroger', autoCategoryId: 'c-groceries' }),
  payee({ id: 'p-shell', name: 'Shell' }),
  payee({ id: 'tp-sav', name: '', transferAccountId: 'sav' }),
];

const TAGS = [
  { id: 'tg1', tag: 'Trip2025', color: '#3D8FD6', description: null },
  { id: 'tg2', tag: 'trip', color: null, description: null },
  { id: 'tg3', tag: 'rent', color: '#222222', description: 'Housing' },
];

let rows: Transaction[];
let host: ReturnType<typeof mockHost>;
let queryClient: QueryClient;

function responses(extra: Responses = {}): Responses {
  return {
    'accounts.list': () => [CHECKING, SAVINGS],
    'categories.tree': () => GROUPS,
    'payees.list': () => PAYEES,
    'tags.list': () => TAGS,
    'prefs.synced': () => ({}),
    'transactions.list': () => rows,
    'transactions.commit': (p: { id?: string }) => ({ id: p.id ?? 'new-1' }),
    'transactions.lastForPayee': () => ({
      last: { categoryId: 'c-fuel', notes: 'last notes', amount: -999 },
      ruleCategoryId: 'c-groceries',
    }),
    'transactions.nextCheckNumber': () => '102',
    'payees.renameImpact': () => ({ total: 0, renameable: 0, uncategorized: 0 }),
    ...extra,
  };
}

// happy-dom lays nothing out: give elements a size so the virtualized grid renders its rows.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => 1000,
});

beforeEach(() => {
  rows = [
    transaction({
      id: 't1',
      accountId: 'chk',
      date: '2026-10-02',
      amount: 10000,
      payeeId: 'p-shell',
      payeeName: 'Shell',
      categoryId: 'c-salary',
      cleared: 'C',
    }),
    transaction({
      id: 't2',
      accountId: 'chk',
      date: '2026-10-01',
      amount: -5210,
      payeeId: 'p-kroger',
      payeeName: 'Kroger',
      categoryId: 'c-groceries',
      notes: 'weekly',
    }),
    transaction({
      id: 't3',
      accountId: 'chk',
      date: '2026-10-03',
      amount: -300,
      payeeId: 'p-shell',
      payeeName: 'Shell',
      categoryId: 'c-fuel',
      needsReview: true,
      errorLevel: 'forReview',
    }),
  ];
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

async function open(accountId = 'chk'): Promise<VueWrapper> {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(RegisterPanel, {
    props: { accountId, shown: true },
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  await flushPromises();
  return w;
}

const rowEl = (w: VueWrapper, id: string) => w.get(`[data-row-id="${id}"]`);
const cell = (w: VueWrapper, id: string, col: string) => rowEl(w, id).get(`[data-col="${col}"]`);
const editor = (w: VueWrapper) => w.find('[data-editor]');
const field = (w: VueWrapper, name: string) =>
  w.get(`[data-editor] [data-main] [data-field="${name}"] input`);
const shownIds = (w: VueWrapper): string[] =>
  w.findAll('[data-row-id]').map((r) => r.attributes('data-row-id') ?? '');

async function startEdit(w: VueWrapper, id: string, col = 'notes'): Promise<void> {
  await cell(w, id, col).trigger('click');
  await cell(w, id, col).trigger('click');
  await flushPromises();
}

async function type(el: ReturnType<VueWrapper['get']>, text: string): Promise<void> {
  (el.element as HTMLInputElement).value = text;
  await el.trigger('input');
}

describe('the grid (10 §1–2, §5, §7)', () => {
  it('shows the rows in date order, with the notifiers and the summary', async () => {
    const w = await open();
    expect(shownIds(w)).toEqual(['t3', 't1', 't2']);
    expect(w.text()).toContain('1 transaction needs approval');
    expect(w.text()).toContain('Cleared Balance');
    expect(w.text()).toContain('47.90');
    expect(w.get('[role="treegrid"]').attributes('aria-multiselectable')).toBe('true');
  });
  it('re-sorts on a header click and saves the sort per account', async () => {
    const w = await open();
    await w
      .findAll('.reg-grid__sort')
      .find((b) => b.text().startsWith('Payee'))
      ?.trigger('click');
    await flushPromises();
    expect(shownIds(w)).toEqual(['t2', 't1', 't3']);
    expect(useBudgetSettings().settings.register.accounts['chk']?.mainSort).toEqual([
      { field: 'payee', desc: false },
    ]);
  });
  it('Shift+click adds sort levels, shown with their numbers; a plain click resets (10 §2)', async () => {
    const w = await open();
    const header = (label: string) =>
      w.findAll('.reg-grid__sort').find((b) => b.text().startsWith(label));
    const saved = () => useBudgetSettings().settings.register.accounts['chk']?.mainSort;
    await header('Payee')?.trigger('click', { shiftKey: true });
    await flushPromises();
    expect(saved()).toEqual([
      { field: 'date', desc: true },
      { field: 'payee', desc: false },
    ]);
    expect(header('Payee')?.text()).toContain('2');
    const payeeHeader = header('Payee')?.element.closest('[role="columnheader"]');
    expect(payeeHeader?.getAttribute('aria-sort')).toBeNull();
    expect(payeeHeader?.getAttribute('aria-description')).toBe('Sort level 2, ascending');
    expect(
      header('Date')?.element.closest('[role="columnheader"]')?.getAttribute('aria-sort'),
    ).toBe('descending');
    await header('Payee')?.trigger('keydown.enter', { shiftKey: true });
    await flushPromises();
    expect(saved()).toEqual([
      { field: 'date', desc: true },
      { field: 'payee', desc: true },
    ]);
    await header('Category')?.trigger('click');
    await flushPromises();
    expect(saved()).toEqual([{ field: 'category', desc: false }]);
    expect(header('Category')?.text()).not.toMatch(/\d/);
  });
  it('header clicks are ignored while reconciling, and the saved keys are kept (13 §6.2)', async () => {
    useRegisterSession().view('chk').reconcile = {
      statementDate: '2026-10-31',
      target: 0,
      savedSearch: '',
    };
    const w = await open();
    await w
      .findAll('.reg-grid__sort')
      .find((b) => b.text().startsWith('Payee'))
      ?.trigger('click', { shiftKey: true });
    await flushPromises();
    expect(useBudgetSettings().settings.register.accounts['chk']?.mainSort).toBeUndefined();
  });
  it('Shift+F10 on a focused header opens the column chooser, as a right-click does (10 §2, 22 §4)', async () => {
    const w = await open();
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('notes');
    const payee = w.findAll('.reg-grid__sort').find((b) => b.text().startsWith('Payee'));
    (payee?.element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }));
    await flushPromises();
    expect(menu.mock.calls[0]?.[0].map((i) => i.label ?? '-')).toEqual([
      'Check',
      'Cleared',
      'Notes',
      'Running Balance',
      '-',
      'Apply current settings to all existing accounts',
    ]);
    expect(
      useBudgetSettings().settings.register.accounts['chk']?.mainColumns?.find(
        (c) => c.field === 'notes',
      )?.visible,
    ).toBe(false);
    expect(rowEl(w, 't2').find('[data-col="notes"]').exists()).toBe(false);
    // A right-click on a header gives the same menu, and there is no gear button.
    menu.mockResolvedValueOnce(null);
    await w.get('[role="columnheader"]').trigger('contextmenu');
    expect(menu).toHaveBeenCalledTimes(2);
    expect(menu.mock.calls[1]?.[0]).toEqual(
      menu.mock.calls[0]?.[0].map((i) => (i.id === 'notes' ? { ...i, checked: false } : i)),
    );
    expect(w.find('[aria-label="Choose columns"]').exists()).toBe(false);
  });
  it('a notifier applies its search', async () => {
    const w = await open();
    await w
      .findAll('.notifier')
      .find((n) => n.text().includes('approval'))
      ?.trigger('click');
    expect(useRegisterSession().view('chk').search).toBe('Is:Reminder,');
  });
  it('passes axe', async () => {
    const w = await open();
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });
  it('privacy mode masks every amount and its accessible name; editing still works (06 §7)', async () => {
    useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: true };
    const w = await open();
    const labels = [...(w.element as HTMLElement).querySelectorAll('[aria-label]')].map((e) =>
      e.getAttribute('aria-label'),
    );
    expect(w.findAll('.money-mask').length).toBeGreaterThan(3);
    expect(w.text()).not.toMatch(/\d\.\d\d\b/);
    expect(labels.join('|')).not.toMatch(/\d\.\d\d\b/);
    expect(labels).toContain('Hidden amount');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
    // The editor's pre-filled amount stays masked until the user types in it, then shows the real value.
    await startEdit(w, 't1');
    expect(editor(w).exists()).toBe(true);
    const inputs = w.findAll<HTMLInputElement>('[data-editor] [data-main] input');
    const values = (): string[] => inputs.map((i) => i.element.value);
    expect(values()).toContain(HIDDEN_AMOUNT_TEXT);
    expect(values().join('|')).not.toMatch(/\d\.\d\d/);
    const amount = inputs.find((i) => i.element.value === HIDDEN_AMOUNT_TEXT);
    await amount?.trigger('keydown', { key: 'End' });
    expect(values().some((v) => /\d\.\d\d/.test(v))).toBe(true);
  });
});

describe('selection and starting an edit (10 §9, 11 §1)', () => {
  it('a click selects; a click on the only selected row edits the clicked cell', async () => {
    const w = await open();
    await cell(w, 't2', 'notes').trigger('click');
    expect(rowEl(w, 't2').attributes('aria-selected')).toBe('true');
    expect(editor(w).exists()).toBe(false);
    await cell(w, 't2', 'notes').trigger('click');
    await flushPromises();
    expect(editor(w).exists()).toBe(true);
    expect(document.activeElement).toBe(field(w, 'notes').element);
  });
  it('Ctrl+click and Shift+click extend the selection', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await cell(w, 't3', 'payee').trigger('click', { shiftKey: true });
    expect(useRegisterSession().view('chk').selection).toEqual(new Set(['t2', 't1', 't3']));
    await cell(w, 't1', 'payee').trigger('click', { ctrlKey: true });
    expect(useRegisterSession().view('chk').selection).toEqual(new Set(['t2', 't3']));
    expect(w.text()).toContain('Edit (2) Transactions');
    expect(w.text()).toContain('Selected Total (2)');
  });
  it('doesn’t open the editor offline', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await open();
    await startEdit(w, 't2');
    expect(editor(w).exists()).toBe(false);
    // Focusable with aria-disabled, so the offline tooltip can be read (22 §4.6).
    for (const button of [w.get('.toolbar__add'), w.get('.toolbar__transfer')]) {
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.attributes('aria-disabled')).toBe('true');
      expect(button.attributes('aria-describedby')).toBeDefined();
      await button.trigger('click');
    }
    await flushPromises();
    expect(editor(w).exists()).toBe(false);
  });
});

describe('the grid keys (10 §9)', () => {
  /** A key pressed with focus in the grid. */
  async function press(w: VueWrapper, key: string, init: KeyboardEventInit = {}): Promise<void> {
    rowEl(w, 't1')
      .element.closest('[tabindex]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );
    await flushPromises();
  }
  const selection = (): Set<string> => useRegisterSession().view('chk').selection;

  it('C shows Categorize As on its own and categorizes the selection', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce('cat:c-fuel');
    await press(w, 'c');
    const items = menu.mock.calls[0]?.[0] ?? [];
    expect(items.at(-1)?.id).toBe('cat:none');
    expect(items.slice(0, -1).every((i) => i.id.startsWith('group:'))).toBe(true);
    expect(host.calls('transactions.categorize')).toEqual([{ ids: ['t2'], categoryId: 'c-fuel' }]);
    expect(host.calls('transactions.setCleared')).toEqual([]);
  });
  it('A shows Move to account on its own', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    const menu = vi.spyOn(window.app.shell, 'showContextMenu').mockResolvedValueOnce(null);
    await press(w, 'a');
    expect(menu.mock.calls[0]?.[0].map((i) => i.id)).toEqual(['move:sav']);
  });
  it('L toggles cleared on the selection, as Ctrl+Shift+C does', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await press(w, 'l');
    await press(w, 'C', { ctrlKey: true, shiftKey: true });
    expect(host.calls('transactions.setCleared')).toEqual([
      { ids: ['t2'], state: 'C' },
      { ids: ['t2'], state: 'C' },
    ]);
  });
  it('V approves the selection; Ctrl+K doesn’t', async () => {
    const w = await open();
    await cell(w, 't3', 'payee').trigger('click');
    await press(w, 'k', { ctrlKey: true });
    expect(host.calls('transactions.approve')).toEqual([]);
    await press(w, 'v');
    expect(host.calls('transactions.approve')).toEqual([{ ids: ['t3'] }]);
  });
  it('Ctrl+A selects every row, and clears the selection when every row is selected', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await press(w, 'a', { ctrlKey: true });
    expect(selection()).toEqual(new Set(['t2', 't1', 't3']));
    await press(w, 'a', { ctrlKey: true });
    expect(selection()).toEqual(new Set());
  });
  it('J and K move the selection down and up', async () => {
    const w = await open();
    await cell(w, 't3', 'payee').trigger('click');
    await press(w, 'j');
    expect(selection()).toEqual(new Set(['t1']));
    await press(w, 'j');
    await press(w, 'k');
    expect(selection()).toEqual(new Set(['t1']));
  });
  it.each([
    ['e', 'date'],
    ['p', 'payee'],
    ['n', 'notes'],
    ['m', 'outflow'],
  ])('%s edits the selected transaction, starting in %s', async (key, name) => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await press(w, key);
    expect(editor(w).exists()).toBe(true);
    expect(
      document.activeElement
        ?.closest('[data-editor] [data-main] [data-field]')
        ?.getAttribute('data-field'),
    ).toBe(name);
  });
  it('M starts in Inflow for a deposit', async () => {
    const w = await open();
    await cell(w, 't1', 'payee').trigger('click');
    await press(w, 'm');
    expect(document.activeElement).toBe(field(w, 'inflow').element);
  });
  it('E with two selected asks for the new date (Change Date…)', async () => {
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await cell(w, 't1', 'payee').trigger('click', { ctrlKey: true });
    await press(w, 'e');
    const dialog = await answerDialog(null);
    expect(dialog.instruction).toBe('Change the date of 2 transactions?');
    expect(editor(w).exists()).toBe(false);
  });
  it('T opens a new transaction editor', async () => {
    const w = await open();
    await press(w, 't');
    expect(editor(w).exists()).toBe(true);
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.text()),
    ).toEqual(['Save and add another', 'Save', 'Cancel']);
  });
  it('D deletes the selection; Ctrl+Z then undoes it while Undo shows', async () => {
    host = mockHost(
      responses({
        'transactions.delete': () => ({ token: 'tok', count: 1 }),
        'transactions.undo': () => ({ ids: { t2: 't2' } }),
      }),
    );
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    await press(w, 'd');
    expect(host.calls('transactions.delete')).toEqual([{ ids: ['t2'] }]);
    await press(w, 'z', { ctrlKey: true });
    expect(host.calls('transactions.undo')).toEqual([{ token: 'tok' }]);
    await press(w, 'z', { ctrlKey: true });
    expect(host.calls('transactions.undo')).toHaveLength(1);
  });
  it('ignores the row keys with focus in the toolbar', async () => {
    host = mockHost(responses({ 'transactions.delete': () => ({ token: 'tok', count: 1 }) }));
    const w = await open();
    await cell(w, 't2', 'payee').trigger('click');
    const button = w.get('.toolbar button').element;
    for (const key of ['d', 'Delete', 'l'])
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flushPromises();
    expect(host.calls('transactions.delete')).toHaveLength(0);
    expect(host.calls('transactions.setCleared')).toHaveLength(0);
  });
  it('ignores the letters offline', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await open();
    await cell(w, 't3', 'payee').trigger('click');
    for (const key of ['l', 'v', 'd']) await press(w, key);
    expect(host.calls('transactions.setCleared')).toEqual([]);
    expect(host.calls('transactions.approve')).toEqual([]);
    expect(host.calls('transactions.delete')).toEqual([]);
  });
});

describe('the editor (11 §1–3, §9)', () => {
  it('commits with Enter (Done) and closes', async () => {
    const w = await open();
    await startEdit(w, 't2');
    await type(field(w, 'notes'), 'weekly shop');
    await field(w, 'notes').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({
      id: 't2',
      notes: 'weekly shop',
      amount: -5210,
    });
    expect(editor(w).exists()).toBe(false);
  });
  it('Ctrl+Enter saves and closes from any field, even an auto-complete', async () => {
    const w = await open();
    await startEdit(w, 't2');
    await type(field(w, 'notes'), 'weekly shop');
    await field(w, 'payee').trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: 't2', notes: 'weekly shop' });
    expect(editor(w).exists()).toBe(false);
  });
  it('Shift+Enter saves and edits the transaction above, in the same field', async () => {
    const w = await open();
    const [above, edited] = shownIds(w);
    await startEdit(w, edited ?? '');
    await type(field(w, 'notes'), 'moved up');
    await field(w, 'notes').trigger('keydown', { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: edited, notes: 'moved up' });
    expect(document.activeElement).toBe(field(w, 'notes').element);
    const was = rows.find((r) => r.id === above)?.notes ?? '';
    expect((field(w, 'notes').element as HTMLInputElement).value).toBe(was);
  });
  it('Shift+Enter in an auto-complete with its list closed moves up too', async () => {
    const w = await open();
    const [, edited] = shownIds(w);
    await startEdit(w, edited ?? '');
    await type(field(w, 'notes'), 'moved up');
    await field(w, 'payee').trigger('keydown', { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: edited, notes: 'moved up' });
    expect(document.activeElement).toBe(field(w, 'payee').element);
  });
  it('Shift+Enter on the top transaction saves and closes', async () => {
    const w = await open();
    const [top] = shownIds(w);
    await startEdit(w, top ?? '');
    await type(field(w, 'notes'), 'top');
    await field(w, 'notes').trigger('keydown', { key: 'Enter', shiftKey: true });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: top, notes: 'top' });
    expect(editor(w).exists()).toBe(false);
  });
  it('Esc reverts the focused field first, then cancels the edit', async () => {
    const w = await open();
    await startEdit(w, 't2');
    await field(w, 'notes').trigger('focus');
    await type(field(w, 'notes'), 'changed');
    await field(w, 'notes').trigger('keydown', { key: 'Escape' });
    expect((field(w, 'notes').element as HTMLInputElement).value).toBe('weekly');
    expect(editor(w).exists()).toBe(true);
    await field(w, 'notes').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(editor(w).exists()).toBe(false);
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('shows Done and Cancel for an approved transaction, and the approve row for one needing review', async () => {
    const w = await open();
    await startEdit(w, 't2');
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.text()),
    ).toEqual(['Done', 'Cancel']);
    // Done is save-toned (green, blue in CVD) and Cancel cancel-toned (red, orange in CVD) (11 §2).
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.classes().find((c) => c.startsWith('ui-small-button--'))),
    ).toEqual(['ui-small-button--save', 'ui-small-button--cancel']);
    await editor(w).findAll('.editor__buttons button')[1]?.trigger('click');
    await flushPromises();
    await startEdit(w, 't3');
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.text()),
    ).toEqual(['Approve and find next', 'Approve', 'Delete', 'Cancel']);
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.classes().find((c) => c.startsWith('ui-small-button--'))),
    ).toEqual([
      'ui-small-button--save',
      'ui-small-button--save',
      'ui-small-button--cancel',
      'ui-small-button--cancel',
    ]);
  });
  it('Approve approves explicitly', async () => {
    const w = await open();
    await startEdit(w, 't3');
    await editor(w).findAll('.editor__buttons button')[1]?.trigger('click');
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: 't3', needsReview: false });
  });
  it('steps the date with + and - and jumps with t', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    const w = await open();
    await startEdit(w, 't2', 'date');
    const date = field(w, 'date');
    await date.trigger('keydown', { key: '+' });
    await date.trigger('keydown', { key: '+' });
    await date.trigger('keydown', { key: '-' });
    await flushPromises();
    await date.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ date: '2026-10-02' });
    vi.useRealTimers();
  });
  it('enters, increments and decrements the check number', async () => {
    useBudgetSettings().settings.register.accounts['chk'] = {
      mainColumns: [{ field: 'check', visible: true, width: 5.75 }],
    };
    const w = await open();
    await startEdit(w, 't2', 'check');
    const check = field(w, 'check');
    await check.trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect((check.element as HTMLInputElement).value).toBe('102');
    await check.trigger('keydown', { key: '+' });
    await flushPromises();
    expect((check.element as HTMLInputElement).value).toBe('103');
    await type(check, '1');
    await check.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect((check.element as HTMLInputElement).value).toBe('1');
    await check.trigger('keydown', { key: 'n', altKey: true });
    await flushPromises();
    expect((check.element as HTMLInputElement).value).toBe('102');
  });
  it('sets the amount from either column: inflow positive, outflow negative, a negative outflow is an inflow', async () => {
    const w = await open();
    await startEdit(w, 't2', 'outflow');
    await type(field(w, 'outflow'), '-12');
    await field(w, 'outflow').trigger('blur');
    await flushPromises();
    expect((field(w, 'inflow').element as HTMLInputElement).value).toBe('12.00');
    expect((field(w, 'outflow').element as HTMLInputElement).value).toBe('');
    await type(field(w, 'inflow'), '');
    await field(w, 'inflow').trigger('blur');
    await type(field(w, 'outflow'), '7.5');
    await field(w, 'outflow').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ amount: -750 });
  });
  it('skips Outflow when Tab leaves Notes in an income category (11 §2)', async () => {
    const w = await open();
    await startEdit(w, 't1');
    await field(w, 'notes').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(field(w, 'inflow').element);
  });
  it('wraps Tab from the last button to the first field', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const buttons = editor(w).findAll('.editor__buttons button');
    const last = buttons.at(-1);
    (last?.element as HTMLElement).focus();
    await last?.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(field(w, 'date').element);
  });
  it('puts Cleared after Inflow in the tab order (11 §2)', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const cleared = editor(w).get('.editor__cleared');
    const order = editor(w)
      .findAll<HTMLElement>('input:not([disabled]), button')
      .map((x) => x.element)
      .filter((x) => x.tabIndex >= 0);
    const at = (el: Element): number => order.indexOf(el as HTMLElement);
    expect(at(cleared.element)).toBeGreaterThan(at(field(w, 'inflow').element));
  });
  it('Space or Enter on the Cleared toggle toggles it without pressing the default button (11 §9)', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const cleared = editor(w).get('.editor__cleared');
    (cleared.element as HTMLElement).focus();
    await cleared.trigger('keydown', { key: 'Enter' });
    // A focused button turns Enter and Space into a click.
    await cleared.trigger('click');
    expect(cleared.attributes('aria-label')).toBe('Cleared');
    expect(host.calls('transactions.commit')).toHaveLength(0);
    await cleared.trigger('click');
    expect(cleared.attributes('aria-label')).toBe('Uncleared');
  });
  it('keeps a Reconciled Cleared toggle focusable but inert (11 §2)', async () => {
    rows = rows.map((r) => (r.id === 't2' ? { ...r, cleared: 'R' } : r));
    const w = await open();
    await startEdit(w, 't2');
    const cleared = editor(w).get('.editor__cleared');
    expect(cleared.attributes('disabled')).toBeUndefined();
    expect(cleared.attributes('aria-disabled')).toBe('true');
    expect(cleared.attributes('aria-label')).toBe('Reconciled');
    await cleared.trigger('click');
    expect(cleared.attributes('aria-label')).toBe('Reconciled');
  });
  it('blocks a click outside a changed edit and makes the buttons glow (10 §9)', async () => {
    const w = await open();
    await startEdit(w, 't2');
    await type(field(w, 'notes'), 'changed');
    await cell(w, 't1', 'payee').trigger('pointerdown');
    await cell(w, 't1', 'payee').trigger('click');
    await flushPromises();
    expect(editor(w).exists()).toBe(true);
    expect(editor(w).find('.editor__buttons.is-glowing').exists()).toBe(true);
  });
  it('a click outside closes the amount calculator; the typed amount then blocks it as a change (09 §5.4, 10 §9)', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const outflow = field(w, 'outflow');
    await type(outflow, '25.00');
    await outflow.trigger('keydown', { key: '+' });
    await flushPromises();
    const calculator = () => document.querySelector('[role="dialog"][aria-label="Calculator"]');
    expect(calculator()).not.toBeNull();
    await cell(w, 't1', 'payee').trigger('pointerdown');
    await flushPromises();
    expect(calculator()).toBeNull();
    expect((outflow.element as HTMLInputElement).value).toBe('25.00');
    expect(editor(w).exists()).toBe(true);
    expect(editor(w).find('.editor__buttons.is-glowing').exists()).toBe(true);
  });
  it('keeps the editor and the input when the host refuses the commit offline (11 §10 criterion 4)', async () => {
    host.spy.mockImplementation((method, params) => {
      if (method === 'transactions.commit')
        return Promise.reject(new RpcError('offline', 'offline'));
      const f = responses()[method] as ((p: unknown) => unknown) | undefined;
      return Promise.resolve((f ? f(params) : null) as never);
    });
    const w = await open();
    await startEdit(w, 't2');
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    await type(field(w, 'notes'), 'my input');
    await field(w, 'notes').trigger('keydown', { key: 'Enter' });
    expect((await answerDialog('close')).instruction).toBe("You're offline");
    expect(editor(w).exists()).toBe(true);
    expect((field(w, 'notes').element as HTMLInputElement).value).toBe('my input');
  });
});

describe('new transactions (11 §1, §3)', () => {
  it('Add opens a new transaction editor as the first row; saving it blank just closes it', async () => {
    const w = await open();
    rowEl(w, 't2').element.closest('section')?.dispatchEvent(new Event('focus'));
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    expect(editor(w).exists()).toBe(true);
    expect(w.findAll('.reg-grid__item')[0]?.find('[data-editor]').exists()).toBe(true);
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.text()),
    ).toEqual(['Save and add another', 'Save', 'Cancel']);
    expect(
      editor(w)
        .findAll('.editor__buttons button')
        .map((b) => b.classes().find((c) => c.startsWith('ui-small-button--'))),
    ).toEqual(['ui-small-button--save', 'ui-small-button--save', 'ui-small-button--cancel']);
    await editor(w).findAll('.editor__buttons button')[1]?.trigger('click');
    await flushPromises();
    expect(editor(w).exists()).toBe(false);
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('lays out the toolbar: actions on the left, filters on the right (10 §1, §3)', async () => {
    const w = await open();
    const parts = [
      'toolbar__add',
      'toolbar__transfer',
      'toolbar__spacer',
      'toolbar__reconciled',
      'search',
    ];
    const found = w.get('.toolbar').element.querySelectorAll(parts.map((c) => `.${c}`).join(', '));
    expect([...found].map((el) => parts.find((c) => el.classList.contains(c)))).toEqual(parts);
  });
  it('auto-fills the category from the payee’s rule, and notes and amount when enabled (11 §4.3)', async () => {
    const w = await open();
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    await type(field(w, 'payee'), 'kroger');
    await field(w, 'payee').trigger('keydown', { key: 'Tab' });
    await flushPromises();
    expect((field(w, 'payee').element as HTMLInputElement).value).toBe('Kroger');
    expect((field(w, 'category').element as HTMLInputElement).value).toBe(
      'Everyday Expenses: Groceries',
    );
    expect((field(w, 'notes').element as HTMLInputElement).value).toBe('');
    expect(host.calls('transactions.lastForPayee')[0]).toEqual({ payeeId: 'p-kroger' });
  });
  it('Save and add another opens a fresh editor and keeps the date', async () => {
    const w = await open();
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    await type(field(w, 'notes'), 'first');
    await editor(w).findAll('.editor__buttons button')[0]?.trigger('click');
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ notes: 'first', cleared: 'U' });
    expect(editor(w).exists()).toBe(true);
    expect((field(w, 'notes').element as HTMLInputElement).value).toBe('');
  });
  it('offers Transfer only when another open account exists (10 §3)', async () => {
    host = mockHost(responses({ 'accounts.list': () => [CHECKING, { ...SAVINGS, closed: true }] }));
    const w = await open();
    expect(w.find('.toolbar__transfer').exists()).toBe(false);
    expect(w.find('.toolbar__add').exists()).toBe(true);
  });
  it('Transfer pre-fills the transfer prefix', async () => {
    const w = await open();
    await w.get('.toolbar__transfer').trigger('click');
    await flushPromises();
    expect((field(w, 'payee').element as HTMLInputElement).value).toBe('Transfer : ');
  });
});

describe('payee checks (11 §4.1)', () => {
  async function newWithPayee(text: string): Promise<VueWrapper> {
    const w = await open();
    await w.get('.toolbar__add').trigger('click');
    await flushPromises();
    await type(field(w, 'payee'), text);
    await field(w, 'payee').trigger('keydown', { key: 'Tab' });
    return w;
  }
  it('refuses an unknown transfer account', async () => {
    const w = await newWithPayee('Transfer : Nowhere');
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe('Invalid Payee');
    expect(asked.content).toBe(
      '"Transfer : Nowhere" is not a valid account name. If a payee starts with "Transfer :", it must be followed by a valid account name.',
    );
    expect((field(w, 'payee').element as HTMLInputElement).value).toBe('');
  });
  it('clears a bare transfer prefix on blur without an error', async () => {
    const w = await open();
    await w.get('.toolbar__transfer').trigger('click');
    await flushPromises();
    await field(w, 'payee').trigger('blur');
    await flushPromises();
    expect(useDialogs().stack).toHaveLength(0);
    expect((field(w, 'payee').element as HTMLInputElement).value).toBe('');
  });
  it('refuses a transfer to the account itself', async () => {
    await newWithPayee('Transfer : Checking');
    expect((await answerDialog('close')).instruction).toBe(
      "You can't transfer from an account to itself.",
    );
  });
  it('makes an on-budget transfer: no category, "(Category not needed)"', async () => {
    const w = await newWithPayee('transfer : savings');
    await flushPromises();
    expect((field(w, 'payee').element as HTMLInputElement).value).toBe('Transfer : Savings');
    expect(field(w, 'category').attributes('placeholder')).toBe('(Category not needed)');
    expect(field(w, 'category').attributes('disabled')).toBeDefined();
  });
});

describe('a transfer a split elsewhere created (11 §2)', () => {
  it('refuses a new account and keeps the old one', async () => {
    rows.push(
      transaction({
        id: 't4',
        accountId: 'chk',
        date: '2026-10-04',
        amount: 2500,
        payeeId: 'tp-sav',
        payeeName: 'Savings',
        transferAccountId: 'sav',
        transferSide: {
          id: 'line-1',
          accountId: 'sav',
          date: '2026-10-04',
          cleared: 'U',
          isSplitLine: true,
        },
      }),
    );
    const w = await open('all');
    await startEdit(w, 't4');
    await type(field(w, 'account'), 'Savings');
    await field(w, 'account').trigger('keydown', { key: 'Tab' });
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe('This account cannot be changed');
    expect(asked.content).toBe(
      'This transaction is a transfer from a split transaction, so its account cannot be changed. You can modify this transaction from the side of the split transaction.',
    );
    await flushPromises();
    expect((field(w, 'account').element as HTMLInputElement).value).toBe('Checking');
    await field(w, 'notes').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    for (const call of host.calls('transactions.commit'))
      expect(call).toMatchObject({ accountId: 'chk' });
  });
});

describe('the category field (11 §4.2)', () => {
  it('opens Add New Category for an unknown name, and takes the new category', async () => {
    const w = await open();
    await startEdit(w, 't2', 'category');
    await type(field(w, 'category'), 'Bills: Water');
    await field(w, 'category').trigger('keydown', { key: 'Tab' });
    await flushPromises();
    const modals = useModals();
    const top = modals.stack.at(-1);
    expect(top?.props).toMatchObject({ groupName: 'Bills', name: 'Water' });
    modals.close(top?.id ?? 0, { id: 'c-water', text: 'Bills: Water' });
    await flushPromises();
    await field(w, 'notes').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ categoryId: 'c-water' });
  });
  it('refuses a new category in the Income group', async () => {
    const w = await open();
    await startEdit(w, 't2', 'category');
    await type(field(w, 'category'), 'Income: Bonus');
    await field(w, 'category').trigger('keydown', { key: 'Tab' });
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe('Please choose a different category name');
    expect(asked.content).toContain('New income categories must be created in the Income group');
  });
  it('enters split mode with two empty lines, and refuses to split a transfer', async () => {
    const w = await open();
    await startEdit(w, 't2', 'category');
    await type(field(w, 'category'), 'Split (Multiple Categories)...');
    await field(w, 'category').trigger('keydown', { key: 'Tab' });
    await flushPromises();
    expect(w.findAll('[data-editor] [data-line]')).toHaveLength(2);
    expect(w.text()).toContain('Amount remaining to assign:');
    await w.findAll('[data-editor] .editor__trash')[0]?.trigger('click');
    expect(w.findAll('[data-editor] [data-line]')).toHaveLength(1);
  });
});

describe('the open-edit rule (11 §1)', () => {
  it('cancels an unchanged edit silently when navigating away', async () => {
    const w = await open();
    await startEdit(w, 't2');
    expect(useAppStore().navigate('register', 'sav')).toBe(true);
    await flushPromises();
    expect(editor(w).exists()).toBe(false);
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('commits a changed edit before navigating away', async () => {
    const w = await open();
    await startEdit(w, 't2');
    await type(field(w, 'notes'), 'changed');
    expect(useAppStore().navigate('register', 'sav')).toBe(false);
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ notes: 'changed' });
    expect(useAppStore().activeAccountId).toBe('sav');
  });
});

describe('tags in notes (10 §6.2, 11 §5)', () => {
  /** The search applies after a short pause (10 §3). */
  const debounced = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushPromises();
  };
  beforeEach(() => {
    rows = rows.map((r) =>
      r.id === 't2'
        ? { ...r, notes: 'weekly #Trip2025 #trip', tags: ['Trip2025', 'trip'] }
        : r.id === 't3'
          ? { ...r, notes: '', tags: [] }
          : r,
    );
  });
  it('shows each tag as a colored pill with its name, and the review marker for a transaction that needs approval', async () => {
    const w = await open();
    const pills = cell(w, 't2', 'notes').findAll('.note-pill');
    expect(pills.map((p) => p.text())).toEqual(['#Trip2025', '#trip']);
    // A stored #RRGGBB color is used with the stronger of black and white text; no color uses the palette's default.
    expect(pills[0]?.attributes('style')).toContain('background: #3D8FD6');
    expect(pills[0]?.attributes('style')).toContain('color: #000000');
    expect(pills[1]?.attributes('style') ?? '').not.toContain('background');
    expect(pills[0]?.attributes('aria-label')).toBe('Filter by tag #Trip2025');
    expect(cell(w, 't3', 'notes').text()).toContain('#needs-review');
    expect(cell(w, 't3', 'notes').findAll('button')).toHaveLength(0);
  });
  it('a pill filters the register to that exact tag', async () => {
    const w = await open();
    await cell(w, 't2', 'notes').findAll('.note-pill')[1]?.trigger('click');
    expect(useRegisterSession().view('chk').search).toBe('Tag: trip,');
    await debounced();
    expect(shownIds(w)).toEqual(['t2']);
  });
  it('searches the Tag: keyword case-sensitively', async () => {
    const w = await open();
    useRegisterSession().view('chk').search = 'Tag: trip2025,';
    await debounced();
    expect(shownIds(w)).toEqual([]);
    useRegisterSession().view('chk').search = 'Tag: Trip2025,';
    await debounced();
    expect(shownIds(w)).toEqual(['t2']);
  });
  it('offers the managed tags while a tag is being typed in Notes, and Tab accepts one', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const notes = field(w, 'notes');
    (notes.element as HTMLInputElement).focus();
    await type(notes, 'weekly #ren');
    (notes.element as HTMLInputElement).setSelectionRange(11, 11);
    await notes.trigger('keyup');
    await flushPromises();
    const options = document.body.querySelectorAll('.notes-tags [role="option"]');
    expect([...options].map((o) => o.textContent.trim())).toEqual(['#rent']);
    await notes.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    expect((notes.element as HTMLInputElement).value).toBe('weekly #rent');
    expect(host.calls('transactions.commit')).toHaveLength(0);
    expect(document.body.querySelector('.notes-tags')).toBeNull();
  });
  it('lets an unknown tag be typed and saved as ordinary note text', async () => {
    const w = await open();
    await startEdit(w, 't2');
    const notes = field(w, 'notes');
    await type(notes, 'weekly #Brand-New');
    await notes.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('transactions.commit')[0]).toMatchObject({ notes: 'weekly #Brand-New' });
  });
});

describe('split lines (10 §2, §4; 11 §7.2)', () => {
  const debounced = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushPromises();
  };
  const lineRows = (w: VueWrapper) => w.findAll('[data-line-parent="t4"]');
  const toggle = (w: VueWrapper) => cell(w, 't4', 'payee').get('.reg-disclosure');
  beforeEach(() => {
    rows.push(
      transaction({
        id: 't4',
        accountId: 'chk',
        date: '2026-09-30',
        amount: -3000,
        payeeId: 'p-kroger',
        payeeName: 'Kroger',
        notes: 'shopping',
        subtransactions: [
          line({
            id: 'l1',
            parentId: 't4',
            amount: -2000,
            categoryId: 'c-groceries',
            notes: 'milk #trip',
          }),
          line({
            id: 'l2',
            parentId: 't4',
            amount: -1000,
            payeeId: 'tp-sav',
            transferAccountId: 'sav',
            notes: 'to savings',
          }),
        ],
      }),
    );
  });

  it('shows a split collapsed, and its lines with their texts when expanded', async () => {
    const w = await open();
    expect(cell(w, 't4', 'category').text()).toBe('Split (Multiple Categories)...');
    expect(lineRows(w)).toHaveLength(0);
    expect(toggle(w).attributes('aria-expanded')).toBe('false');
    await toggle(w).trigger('click');
    const [groceries, transfer] = lineRows(w);
    expect(lineRows(w)).toHaveLength(2);
    expect(toggle(w).attributes('aria-expanded')).toBe('true');
    expect(groceries?.text()).toContain('Groceries');
    expect(groceries?.text()).toContain('milk #trip');
    // A line to an on-budget account is a transfer that needs no category (10 §2.2).
    expect(transfer?.text()).toContain('Transfer : Savings');
    expect(transfer?.text()).toContain('(Category not needed)');
    await toggle(w).trigger('click');
    expect(lineRows(w)).toHaveLength(0);
  });

  it("opens a split a search matches only in part, dimming the other lines, and puts the user's expand state back after", async () => {
    const w = await open();
    await toggle(w).trigger('click');
    const view = useRegisterSession().view('chk');
    view.search = 'Tag: trip,';
    await debounced();
    expect(shownIds(w)).toEqual(['t4']);
    // Collapsing during the search doesn't hide the lines that explain the match.
    await toggle(w).trigger('click');
    expect(lineRows(w).map((r) => r.classes('is-context'))).toEqual([false, true]);
    view.search = '';
    await debounced();
    expect(shownIds(w)).toEqual(['t3', 't1', 't2', 't4']);
    expect(view.expanded.has('t4')).toBe(true);
    expect(lineRows(w)).toHaveLength(2);
  });

  it("hides a split's lines while it's being edited", async () => {
    const w = await open();
    await toggle(w).trigger('click');
    expect(lineRows(w)).toHaveLength(2);
    await startEdit(w, 't4');
    expect(editor(w).exists()).toBe(true);
    expect(lineRows(w)).toHaveLength(0);
  });
});

describe('Approve and find next (11 §2)', () => {
  const approveAndNext = async (w: VueWrapper): Promise<void> => {
    const button = editor(w)
      .findAll('.editor__buttons button')
      .find((b) => b.text() === 'Approve and find next');
    await button?.trigger('click');
    await flushPromises();
  };

  it('approves and edits the next transaction needing review, wrapping to the top', async () => {
    rows = rows.map((r) =>
      r.id === 't2' ? { ...r, needsReview: true, errorLevel: 'forReview' } : r,
    );
    const w = await open();
    // t2 is the bottom row; the next one needing review is t3, at the top.
    await startEdit(w, 't2');
    await approveAndNext(w);
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: 't2', needsReview: false });
    expect(editor(w).exists()).toBe(true);
    expect((field(w, 'outflow').element as HTMLInputElement).value).toBe('3.00');
  });

  it('closes the editor when nothing else needs review', async () => {
    const w = await open();
    await startEdit(w, 't3');
    await approveAndNext(w);
    expect(host.calls('transactions.commit')[0]).toMatchObject({ id: 't3', needsReview: false });
    expect(editor(w).exists()).toBe(false);
  });
});

describe('the open editor and new data (10 §2)', () => {
  it("keeps the row order while editing, adding new rows at the end; re-sorts when it's closed", async () => {
    const w = await open();
    await startEdit(w, 't2');
    rows = [
      ...rows.filter((r) => r.id !== 't1'),
      transaction({ id: 't5', accountId: 'chk', date: '2026-10-09', amount: -100 }),
    ];
    await queryClient.invalidateQueries();
    await flushPromises();
    // The edited row (t2) is the editor; t5 is newer than t3 but waits at the end.
    expect(shownIds(w)).toEqual(['t3', 't5']);
    await field(w, 'notes').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(editor(w).exists()).toBe(false);
    expect(shownIds(w)).toEqual(['t5', 't3', 't2']);
  });
});
