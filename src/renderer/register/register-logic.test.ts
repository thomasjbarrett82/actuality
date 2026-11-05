// The register's renderer logic (10 §2–8, 11 §1–4): payee and category text, the drop-down filters, search
// suggestions, saved view state, the delete warnings and dialogs, move and categorize checks, and the
// actions menu's enabled items.
import type { TransferSide } from '@shared/domain/types';
import { ENGLISH_WORDS } from '@shared/search/words';
import type { ContextMenuItem } from '@shared/shell-api';
import { flushPromises } from '@vue/test-utils';
import { enUS } from 'date-fns/locale/en-US';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AutoCompleteEntry } from '../components/common/autocomplete-list';
import { useDialogs } from '../stores/dialogs';
import {
  account,
  answerDialog,
  GROUPS,
  line,
  mockHost,
  payee,
  transaction,
} from '../testing/fixtures';
import {
  categorizeAs,
  changeDate,
  deleteTransactions,
  deleteWarnings,
  moveToAccount,
  undoText,
} from './actions';
import {
  blankEdit,
  changesOf,
  cloneEdit,
  isBlankNew,
  resolveCategory,
  resolvePayee,
  toCommit,
} from './editable';
import { categoryEntries, categoryFilter, payeeEntries, payeeFilter } from './entries';
import { actionsMenu, type MenuContext } from './menu';
import { applySuggestion, currentToken, programmatic, quotedSearch, suggestions } from './search';
import {
  initialColumns,
  presetRange,
  readDateFilter,
  saveColumns,
  sortOf,
  useRegisterSession,
  writeDateFilter,
} from './view-state';

const ACCOUNTS = [
  account({ id: 'chk', name: 'Checking' }),
  account({ id: 'sav', name: 'Savings' }),
  account({ id: 'old', name: 'Old', closed: true }),
];
const PAYEES = [
  payee({ id: 'p1', name: 'Kroger' }),
  payee({ id: 'p2', name: 'Shell', enabled: false }),
  payee({ id: 'tp', name: '', transferAccountId: 'sav' }),
];
const PREFIXES = ['Transfer :'];
const labels = (entries: AutoCompleteEntry[]): string[] => entries.map((e) => e.label);

describe('payee text (11 §4.1)', () => {
  it('resolves transfers whitespace- and case-insensitively', () => {
    expect(resolvePayee('transfer:savings', PREFIXES, PAYEES, ACCOUNTS)).toMatchObject({
      kind: 'transfer',
      account: { id: 'sav' },
    });
    expect(resolvePayee('Transfer : Nowhere', PREFIXES, PAYEES, ACCOUNTS)).toEqual({
      kind: 'invalidTransfer',
      name: 'Transfer : Nowhere',
    });
    expect(resolvePayee('Transfer : Old', PREFIXES, PAYEES, ACCOUNTS).kind).toBe('invalidTransfer');
  });
  it('normalizes to the stored capitalization', () => {
    expect(resolvePayee(' kroger ', PREFIXES, PAYEES, ACCOUNTS)).toEqual({
      kind: 'payee',
      name: 'Kroger',
      payee: PAYEES[0],
    });
    expect(resolvePayee('Aldi', PREFIXES, PAYEES, ACCOUNTS)).toEqual({
      kind: 'payee',
      name: 'Aldi',
      payee: null,
    });
    expect(resolvePayee('  ', PREFIXES, PAYEES, ACCOUNTS)).toEqual({ kind: 'none' });
  });
  it('lists enabled payees, then the transfer heading and open accounts except its own', () => {
    const entries = payeeEntries(PAYEES, ACCOUNTS, 'chk', {
      heading: 'Transfer to/from account:',
      transfer: (a) => `Transfer : ${a}`,
    });
    expect(labels(entries)).toEqual(['Kroger', 'Transfer to/from account:', 'Transfer : Savings']);
  });
  it('lists only other open accounts for a transfer', () => {
    const entries = payeeEntries(
      PAYEES,
      ACCOUNTS,
      'chk',
      {
        heading: 'Transfer to/from account:',
        transfer: (a) => `Transfer : ${a}`,
      },
      true,
    );
    expect(labels(entries)).toEqual(['Transfer to/from account:', 'Transfer : Savings']);
  });
  it('filters by contains, or by account name after a complete transfer prefix', () => {
    const entries = payeeEntries(PAYEES, ACCOUNTS, null, {
      heading: 'H',
      transfer: (a) => `Transfer : ${a}`,
    });
    const f = payeeFilter('Transfer :');
    expect(labels(f(entries, 'ger'))).toEqual(['Kroger']);
    expect(labels(f(entries, 'Tr'))).toEqual(['H', 'Transfer : Checking', 'Transfer : Savings']);
    expect(labels(f(entries, 'transfer : sav'))).toEqual(['H', 'Transfer : Savings']);
  });
});

describe('category text (11 §4.2)', () => {
  it('resolves empty, the split item, "Group: Category", and a name in display order', () => {
    expect(resolveCategory('', 'Split (Multiple Categories)...', GROUPS)).toEqual({ kind: 'none' });
    expect(
      resolveCategory('split (multiple categories)...', 'Split (Multiple Categories)...', GROUPS),
    ).toEqual({ kind: 'split' });
    expect(resolveCategory('everyday expenses: fuel', 'S', GROUPS)).toEqual({
      kind: 'category',
      id: 'c-fuel',
      text: 'Everyday Expenses: Fuel',
    });
    expect(resolveCategory('Income: salary', 'S', GROUPS)).toMatchObject({ id: 'c-salary' });
    expect(resolveCategory('rent', 'S', GROUPS)).toEqual({
      kind: 'category',
      id: 'c-rent',
      text: 'Bills: Rent',
    });
  });
  it('asks for a new category when nothing matches, keeping the group it named', () => {
    expect(resolveCategory('Bills: Water', 'S', GROUPS)).toEqual({
      kind: 'new',
      groupName: 'Bills',
      name: 'Water',
      isIncomeGroup: false,
    });
    expect(resolveCategory('Income: Bonus', 'S', GROUPS)).toMatchObject({
      kind: 'new',
      isIncomeGroup: true,
    });
    expect(resolveCategory('Water', 'S', GROUPS)).toEqual({
      kind: 'new',
      groupName: '',
      name: 'Water',
      isIncomeGroup: false,
    });
  });
  it('lists the split item, the income heading, then each visible expense group', () => {
    const entries = categoryEntries(GROUPS, { split: 'Split (Multiple Categories)...' });
    expect(labels(entries)).toEqual([
      'Split (Multiple Categories)...',
      'Income:',
      'Income: Salary',
      'Everyday Expenses:',
      'Everyday Expenses: Groceries',
      'Everyday Expenses: Fuel',
      'Bills:',
      'Bills: Rent',
    ]);
  });
  it('filters by prefix: the name, "Group: Name", or a group prefix plus a category prefix', () => {
    const entries = categoryEntries(GROUPS, {});
    expect(labels(categoryFilter(entries, 'fu'))).toEqual([
      'Everyday Expenses:',
      'Everyday Expenses: Fuel',
    ]);
    expect(labels(categoryFilter(entries, 'ev: gr'))).toEqual([
      'Everyday Expenses:',
      'Everyday Expenses: Groceries',
    ]);
    expect(labels(categoryFilter(entries, 'bil'))).toEqual(['Bills:', 'Bills: Rent']);
    expect(labels(categoryFilter(entries, 'ent'))).toEqual([]);
  });
});

describe('the editable transaction (11 §1, §6)', () => {
  it('knows a blank new transaction', () => {
    const e = blankEdit('chk', '2026-10-20');
    expect(isBlankNew(e)).toBe(true);
    expect(isBlankNew({ ...e, notes: 'x' })).toBe(false);
  });
  it('tells which fields changed', () => {
    const e = blankEdit('chk', '2026-10-20');
    const d = cloneEdit(e);
    expect(changesOf(d, e).any).toBe(false);
    d.cleared = 'C';
    expect(changesOf(d, e)).toMatchObject({ any: true, approving: false });
    d.notes = 'x #tag';
    expect(changesOf(d, e)).toMatchObject({ notes: true, approving: true });
  });
  it('builds the commit: existing payee by name, a new name, or a transfer', () => {
    const e = {
      ...blankEdit('chk', '2026-10-20'),
      payeeText: 'kroger',
      checkNumber: ' 12 ',
      notes: ' m ',
    };
    expect(toCommit(e, PAYEES, false)).toMatchObject({
      payee: { kind: 'existing', id: 'p1' },
      checkNumber: '12',
      notes: 'm',
    });
    expect(toCommit({ ...e, payeeText: 'Aldi' }, PAYEES, false).payee).toEqual({
      kind: 'new',
      name: 'Aldi',
    });
    expect(toCommit({ ...e, transferAccountId: 'sav' }, PAYEES, true)).toMatchObject({
      payee: { kind: 'transfer', accountId: 'sav' },
      clearOtherSide: true,
    });
  });
});

describe('search suggestions (10 §4)', () => {
  const ctx = {
    words: ENGLISH_WORDS,
    dateFormat: 'MM/dd/yyyy',
    numberFormat: 'comma-dot' as const,
    today: '2026-10-20' as const,
    locale: enUS,
    allAccounts: false,
    accounts: ACCOUNTS,
    payeeNames: ['Kroger', 'Kroger Fuel'],
    categoryLabels: ['Everyday Expenses: Groceries'],
    tagNames: ['Trip2025', 'trip', 'rent'],
  };
  it('offers dates, amounts, Income, tags, Is:, payees, categories and Find, in order', () => {
    const html = suggestions('10/5', ctx).map((s) => s.html);
    expect(html.slice(0, 4)).toEqual([
      'Dates (*Enter dates as MM/DD/YYYY*)',
      'On **10/05/2026**',
      'On or before **10/05/2026**',
      'On or after **10/05/2026**',
    ]);
    const amounts = suggestions('12', ctx).map((s) => s.html);
    expect(amounts).toEqual(
      expect.arrayContaining([
        'Outflow equals **12**',
        'Inflow less or equal to **12**',
        'Find "**12**" in any field',
      ]),
    );
    expect(suggestions('Kro', ctx).map((s) => s.value)).toEqual(
      expect.arrayContaining(['Payee: Kroger', 'Payee: Kroger Fuel', 'Kro', 'Notes: Kro']),
    );
    const empty = suggestions('', ctx).map((s) => s.value);
    expect(empty).toEqual(
      expect.arrayContaining(['Is: Approved', 'Is: Cleared or Reconciled', 'Is: Error']),
    );
    expect(empty).not.toContain('Tag: trip');
    // Tags that contain the typed text are offered once something is typed.
    const typed = suggestions('tri', ctx).map((s) => s.value);
    expect(typed).toContain('Tag: trip');
    expect(typed).not.toContain('Tag: rent');
    expect(empty.indexOf('Is: Unreconciled')).toBeLessThan(empty.indexOf('Is: Error'));
  });
  it('lists accounts before Income in All Accounts', () => {
    const values = suggestions('', { ...ctx, allAccounts: true }).map((s) => s.value);
    expect(values.indexOf('Account: Checking')).toBeLessThan(values.indexOf('Income: '));
  });
  it('replaces the token being typed and adds ", "', () => {
    expect(currentToken('Payee: Kroger, tr', 'comma-dot')).toEqual({
      before: 'Payee: Kroger, ',
      token: 'tr',
    });
    expect(applySuggestion('Payee: Kroger, tr', 'Tag: trip', 'comma-dot')).toBe(
      'Payee: Kroger, Tag: trip, ',
    );
    expect(applySuggestion('kro', 'Payee: Kroger', 'comma-dot')).toBe('Payee: Kroger, ');
    expect(applySuggestion('', 'Income: ', 'comma-dot')).toBe('Income: ');
  });
  it('writes programmatic searches and quotes the search without its trailing comma', () => {
    expect(programmatic.is(ENGLISH_WORDS, 'error')).toBe('Is:Error,');
    expect(programmatic.payee(ENGLISH_WORDS, 'Kroger')).toBe('Payee: Kroger,');
    expect(quotedSearch('Payee: Kroger, ')).toBe('Payee: Kroger');
  });
});

describe('saved view state (10 §2–3, §10)', () => {
  it('re-evaluates date presets for today, and keeps custom ranges', () => {
    expect(presetRange('latest3', '2026-01-15')).toEqual({
      preset: 'latest3',
      from: '2025-11',
      to: '2026-01',
    });
    expect(presetRange('lastYear', '2026-01-15')).toEqual({
      preset: 'lastYear',
      from: '2025-01',
      to: '2025-12',
    });
    expect(
      readDateFilter({ label: 'thisMonth', start: '2020-01', end: '2020-01' }, '2026-10-20'),
    ).toEqual({
      preset: 'thisMonth',
      from: '2026-10',
      to: '2026-10',
    });
    const custom = { preset: 'custom' as const, from: '2026-02' as const, to: '2026-04' as const };
    expect(readDateFilter(writeDateFilter(custom), '2026-10-20')).toEqual(custom);
    expect(readDateFilter(undefined, '2026-10-20').preset).toBe('all');
  });
  it('copies widths, not visibility, from an account with the same visible columns', () => {
    const shown = initialColumns({}, 'chk').map((c) =>
      c.field === 'payee' ? { ...c, width: 20 } : c,
    );
    const accounts = { sav: { mainColumns: shown } };
    expect(initialColumns(accounts, 'chk').find((c) => c.field === 'payee')?.width).toBe(20);
    const other = shown.map((c) => (c.field === 'check' ? { ...c, visible: true } : c));
    expect(
      initialColumns({ sav: { mainColumns: other } }, 'chk').find((c) => c.field === 'payee')
        ?.width,
    ).toBe(13.5);
  });
  it('copies saved widths to accounts with the same visible columns, or everything to all', () => {
    const base = initialColumns({}, 'chk');
    const accounts = {
      sav: { mainColumns: base },
      cash: { mainColumns: base.map((c) => (c.field === 'check' ? { ...c, visible: true } : c)) },
    };
    const wider = base.map((c) => (c.field === 'notes' ? { ...c, width: 9 } : c));
    const saved = saveColumns(accounts, 'chk', wider);
    expect(saved['sav']?.mainColumns?.find((c) => c.field === 'notes')?.width).toBe(9);
    expect(saved['cash']?.mainColumns?.find((c) => c.field === 'notes')?.width).toBe(11.5);
    const all = saveColumns(accounts, 'chk', wider, ['chk', 'sav', 'cash']);
    expect(all['cash']?.mainColumns?.find((c) => c.field === 'check')?.visible).toBe(false);
  });
  it('reads the saved sort keys, including a single key from an earlier version', () => {
    expect(sortOf(undefined)).toEqual([{ field: 'date', desc: true }]);
    expect(sortOf({ mainSort: { field: 'payee', desc: true } })).toEqual([
      { field: 'payee', desc: true },
    ]);
    expect(
      sortOf({
        mainSort: [
          { field: 'payee', desc: true },
          { field: 'nonsense', desc: false },
          { field: 'balance', desc: false },
          { field: 'payee', desc: false },
          { field: 'notes', desc: false },
        ],
      }),
    ).toEqual([
      { field: 'payee', desc: true },
      { field: 'notes', desc: false },
    ]);
    expect(sortOf({ mainSort: [{ field: 'nonsense', desc: true }] })).toEqual([
      { field: 'date', desc: true },
    ]);
    const five = ['date', 'payee', 'category', 'notes', 'cleared'].map((field) => ({
      field,
      desc: false,
    }));
    expect(sortOf({ mainSort: five })).toHaveLength(4);
  });
});

describe('delete (10 §8)', () => {
  let host: ReturnType<typeof mockHost>;
  beforeEach(() => {
    host = mockHost({ 'transactions.delete': () => ({ token: 'tok', count: 1 }) });
  });
  const plain = transaction({ id: 'a', accountId: 'chk' });
  const reconciled = transaction({ id: 'r', accountId: 'chk', cleared: 'R' });
  const transfer = transaction({
    id: 'x',
    accountId: 'chk',
    transferAccountId: 'sav',
    transferSide: {
      id: 'y',
      accountId: 'sav',
      date: '2026-10-01',
      cleared: 'R',
      isSplitLine: false,
    },
  });
  const fromSplit = transaction({
    id: 'f',
    accountId: 'chk',
    transferAccountId: 'sav',
    transferSide: {
      id: 'l',
      accountId: 'sav',
      date: '2026-10-01',
      cleared: 'U',
      isSplitLine: true,
    },
  });
  const splitWithTransfer = transaction({
    id: 's',
    accountId: 'chk',
    subtransactions: [line({ id: 'l1', parentId: 's', transferAccountId: 'sav' })],
  });

  it('builds the messages in order, joined into the confirmation', () => {
    expect(deleteWarnings([plain])).toEqual([]);
    expect(deleteWarnings([reconciled, transfer, fromSplit, splitWithTransfer])).toEqual([
      '1 of the selected transactions has been reconciled. Deleting a reconciled transaction will bring the reconciliation out of balance',
      '1 of the selected transactions is a transfer where the other side has been reconciled. Deleting a reconciled transfer will bring the reconciliation out of balance',
      'One of the transactions selected for deletion is a transfer from a split transaction. This transaction will not be deleted. You must delete this transaction from within the split transaction.',
      '2 of the selected transactions are transfers. Deleting a transfer will delete its counterpart transaction in another account.',
    ]);
  });
  it('deletes without asking when there’s nothing to warn about, and offers Undo', async () => {
    await expect(deleteTransactions([plain])).resolves.toBe(1);
    expect(host.calls('transactions.delete')[0]).toEqual({ ids: ['a'] });
    const undo = useRegisterSession().state.undo;
    expect(undo).toEqual({ token: 'tok', kind: 'deleted', count: 1 });
    expect(undoText(undo ?? { token: '', kind: 'deleted', count: 3 })).toBe(
      'Deleted 1 transaction',
    );
    expect(undoText({ token: '', kind: 'moved', count: 2, account: 'Savings' })).toBe(
      "Moved 2 transactions to 'Savings'",
    );
  });
  it('asks first when there is something to warn about; Cancel deletes nothing', async () => {
    const done = deleteTransactions([reconciled, plain]);
    const asked = await answerDialog('cancel');
    expect(asked.instruction).toBe('Delete 2 transactions?');
    expect(asked.buttons).toEqual([
      'cancel',
      { id: 'delete', label: 'Delete Transactions', isDefault: true },
    ]);
    await expect(done).resolves.toBe(0);
    expect(host.calls('transactions.delete')).toHaveLength(0);
  });
  it('leaves out transfers a split created; all of them is "Could not delete"', async () => {
    const done = deleteTransactions([fromSplit, plain]);
    await answerDialog('delete');
    await done;
    expect(host.calls('transactions.delete')[0]).toEqual({ ids: ['a'] });
    const none = deleteTransactions([fromSplit]);
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe('Could not delete transaction(s)');
    await expect(none).resolves.toBe(0);
  });
});

describe('move to account (10 §6.1)', () => {
  let host: ReturnType<typeof mockHost>;
  beforeEach(() => {
    host = mockHost({ 'transactions.moveToAccount': () => ({ token: 'm', count: 1 }) });
  });
  const SAV = ACCOUNTS[1] ?? account({ id: 'sav', name: 'Savings' });
  it('refuses a transfer into the target', async () => {
    const done = moveToAccount(
      [transaction({ id: 'x', accountId: 'chk', transferAccountId: 'sav' })],
      SAV,
    );
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe(
      "Not all of these transactions can be moved to account 'Savings'",
    );
    expect(asked.content).toContain('is a transfer transaction into account');
    await expect(done).resolves.toBe(0);
  });
  /** The transfer side a split in Old created, here in Checking. */
  const splitCreated = (id: string) =>
    transaction({
      id,
      accountId: 'chk',
      transferAccountId: 'old',
      transferSide: {
        id: `${id}-line`,
        accountId: 'old',
        date: '2026-10-01',
        cleared: 'U',
        isSplitLine: true,
      },
    });
  it('refuses the whole selection when one is a transfer a split created', async () => {
    const done = moveToAccount(
      [transaction({ id: 'a', accountId: 'chk' }), splitCreated('f')],
      SAV,
    );
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe(
      "Not all of these transactions can be moved to account 'Savings'",
    );
    expect(asked.content).toBe(
      'At least one of these transactions is a transfer from a split transaction, so none of the transactions will be moved. You must change its account from within the split transaction.',
    );
    await expect(done).resolves.toBe(0);
    expect(host.calls('transactions.moveToAccount')).toHaveLength(0);
  });
  it('refuses more than one reconciled transaction', async () => {
    const r = (id: string) => transaction({ id, accountId: 'chk', cleared: 'R' });
    const done = moveToAccount([r('a'), r('b')], SAV);
    expect((await answerDialog('close')).content).toContain(
      'Some of these transactions have been reconciled',
    );
    await done;
  });
  it('asks about one reconciled transaction, defaulting to No', async () => {
    const done = moveToAccount([transaction({ id: 'a', accountId: 'chk', cleared: 'R' })], SAV);
    const asked = await answerDialog('yes');
    expect(asked).toMatchObject({
      instruction: 'Reconciled Transaction',
      footer: 'Changing a Reconciled Transaction',
    });
    expect(asked.buttons[1]).toEqual({
      id: 'no',
      label: 'No, cancel this change',
      isDefault: true,
    });
    await expect(done).resolves.toBe(1);
    expect(useRegisterSession().state.undo).toEqual({
      token: 'm',
      kind: 'moved',
      count: 1,
      account: 'Savings',
    });
  });
});

describe('Change Date (10 §6.1, X25)', () => {
  let host: ReturnType<typeof mockHost>;
  beforeEach(() => {
    host = mockHost({ 'transactions.setDate': () => ({ token: 'd', count: 2 }) });
  });
  const DATES = { today: '2026-10-20' as const, dateFormat: 'MM/dd/yyyy', accounts: ACCOUNTS };
  const two = [
    transaction({ id: 'a', accountId: 'chk' }),
    transaction({ id: 'b', accountId: 'chk' }),
  ];
  it('asks for a date, sets it on every row and offers Undo', async () => {
    const done = changeDate(two, DATES);
    const asked = await answerDialog('change', false, '2026-11-05');
    expect(asked.instruction).toBe('Change the date of 2 transactions?');
    expect(asked.dateField).toMatchObject({
      placeholder: '10/20/2026',
      requiredBy: 'change',
    });
    expect(asked.buttons).toEqual([
      { id: 'change', label: 'Change Date', isDefault: true },
      'cancel',
    ]);
    await expect(done).resolves.toEqual(['a', 'b']);
    expect(host.calls('transactions.setDate')).toEqual([{ ids: ['a', 'b'], date: '2026-11-05' }]);
    const notice = useRegisterSession().state.undo;
    expect(notice).toEqual({ token: 'd', kind: 'dated', count: 2 });
    expect(notice && undoText(notice)).toBe('Changed the date of 2 transactions');
    expect(undoText({ token: 'd', kind: 'dated', count: 1 })).toBe(
      'Changed the date of 1 transaction',
    );
  });
  it('does nothing when cancelled', async () => {
    const done = changeDate(two, DATES);
    await answerDialog('cancel');
    await expect(done).resolves.toEqual([]);
    expect(host.calls('transactions.setDate')).toHaveLength(0);
  });
  it('refuses more than one reconciled transaction before asking for a date', async () => {
    const r = (id: string) => transaction({ id, accountId: 'chk', cleared: 'R' });
    const done = changeDate([r('a'), r('b')], DATES);
    const asked = await answerDialog('close');
    expect(asked.instruction).toBe('Not all of these transactions can be changed');
    expect(asked.content).toBe(
      'Some of these transactions have been reconciled, so you will need to change the date of any already reconciled transactions individually',
    );
    await expect(done).resolves.toEqual([]);
    expect(host.calls('transactions.setDate')).toHaveLength(0);
  });
  it('asks about one reconciled transaction, defaulting to No', async () => {
    const rows = [transaction({ id: 'a', accountId: 'chk', cleared: 'R' }), ...two.slice(1)];
    const done = changeDate(rows, DATES);
    await answerDialog('change', false, '2026-11-05');
    const asked = await answerDialog('no');
    expect(asked).toMatchObject({
      instruction: 'Reconciled Transaction',
      content:
        'This transaction has already been reconciled. Modifying its date may bring the reconciliation out of balance.\nDo you still want to save this change?',
      footer: 'Changing a Reconciled Transaction',
    });
    await expect(done).resolves.toEqual([]);
    expect(host.calls('transactions.setDate')).toHaveLength(0);
  });
});

describe('Change Date with a reconciled other side (10 §6.1, 11 §6 step 2)', () => {
  let host: ReturnType<typeof mockHost>;
  beforeEach(() => {
    host = mockHost({ 'transactions.setDate': () => ({ token: 'd', count: 2 }) });
  });
  const accounts = [
    ...ACCOUNTS,
    account({ id: 'rec', name: 'Reconciled', lastReconciledDate: '2026-10-31' }),
  ];
  const DATES = { today: '2026-10-20' as const, dateFormat: 'MM/dd/yyyy', accounts };
  const side = (id: string): TransferSide => ({
    id,
    accountId: 'rec',
    date: '2026-10-01',
    cleared: 'R',
    isSplitLine: false,
  });
  const rows = [
    transaction({ id: 'a', accountId: 'chk', transferAccountId: 'rec', transferSide: side('a2') }),
    transaction({
      id: 'b',
      accountId: 'chk',
      subtransactions: [
        line({ id: 'b1', parentId: 'b', transferAccountId: 'rec', transferSide: side('b2') }),
      ],
    }),
  ];
  it('asks the editor’s question once, and clears other sides dated after their reconciliation', async () => {
    const done = changeDate(rows, DATES);
    await answerDialog('change', false, '2026-11-05');
    const asked = await answerDialog('yes');
    expect(asked).toMatchObject({
      instruction: 'Reconciled Transaction',
      content:
        'The other side of this transfer has already been reconciled. Modifying the date may bring the reconciliation out of balance.\nDo you still want to save this change?',
      footer: 'Changing a Transfer to a Reconciled Transaction',
    });
    expect(asked.buttons[1]).toMatchObject({ id: 'no', isDefault: true });
    await expect(done).resolves.toEqual(['a', 'b']);
    expect(host.calls('transactions.setDate')).toEqual([
      { ids: ['a', 'b'], date: '2026-11-05', clearReconciled: ['a2', 'b2'] },
    ]);
  });
  it('keeps other sides Reconciled for a date on or before their reconciliation', async () => {
    const done = changeDate(rows, DATES);
    await answerDialog('change', false, '2026-10-31');
    await answerDialog('yes');
    await done;
    expect(host.calls('transactions.setDate')).toEqual([{ ids: ['a', 'b'], date: '2026-10-31' }]);
  });
  it('changes nothing on No', async () => {
    const done = changeDate(rows, DATES);
    await answerDialog('change', false, '2026-11-05');
    await answerDialog('no');
    await expect(done).resolves.toEqual([]);
    expect(host.calls('transactions.setDate')).toHaveLength(0);
  });
  it('clears a reconciled transaction and its own other side after one question, as the editor', async () => {
    const own = transaction({
      id: 'r',
      accountId: 'rec',
      cleared: 'R',
      transferAccountId: 'chk',
      transferSide: { ...side('r2'), accountId: 'chk' },
    });
    const chk = accounts.map((a) =>
      a.id === 'chk' ? { ...a, lastReconciledDate: '2026-10-15' as const } : a,
    );
    const done = changeDate([own, transaction({ id: 'n', accountId: 'chk' })], {
      ...DATES,
      accounts: chk,
    });
    await answerDialog('change', false, '2026-11-05');
    expect((await answerDialog('yes')).footer).toBe('Changing a Reconciled Transaction');
    await expect(done).resolves.toEqual(['r', 'n']);
    expect(host.calls('transactions.setDate')).toEqual([
      { ids: ['r', 'n'], date: '2026-11-05', clearReconciled: ['r', 'r2'] },
    ]);
  });
  it('keeps a reconciled transaction Reconciled for a date on or before its reconciliation', async () => {
    const own = transaction({ id: 'r', accountId: 'rec', cleared: 'R' });
    const done = changeDate([own, transaction({ id: 'n', accountId: 'chk' })], DATES);
    await answerDialog('change', false, '2026-10-30');
    await answerDialog('yes');
    await done;
    expect(host.calls('transactions.setDate')).toEqual([{ ids: ['r', 'n'], date: '2026-10-30' }]);
  });
  it('doesn’t ask when the reconciled other side is itself selected', async () => {
    const other = transaction({ id: 'a2', accountId: 'rec', cleared: 'C' });
    const done = changeDate([rows[0] ?? other, other], DATES);
    await answerDialog('change', false, '2026-11-05');
    await expect(done).resolves.toEqual(['a', 'a2']);
  });
});

describe('Categorize As (10 §6.1)', () => {
  it('warns that splits are skipped, then categorizes the rest', async () => {
    const host = mockHost({});
    const split = transaction({
      id: 's',
      accountId: 'chk',
      subtransactions: [line({ id: 'l', parentId: 's' })],
    });
    const done = categorizeAs([split, transaction({ id: 'a', accountId: 'chk' })], 'c-fuel');
    const asked = await answerDialog('continue');
    expect(asked.instruction).toBe('The selected split transaction(s) will not be recategorized.');
    expect(asked.content).toBe(
      'Split transactions cannot be recategorized in bulk.  The 1 selected split transactions will be skipped by this operation.',
    );
    await done;
    expect(host.calls('transactions.categorize')[0]).toEqual({ ids: ['a'], categoryId: 'c-fuel' });
  });
});

describe('the actions menu (10 §6.1)', () => {
  const item = (items: ContextMenuItem[], id: string): ContextMenuItem | undefined =>
    items.find((i) => i.id === id);
  const ctx = (
    rows: ReturnType<typeof transaction>[],
    canEdit = true,
    reconciling = false,
  ): MenuContext => ({
    rows,
    account: ACCOUNTS[0] ?? null,
    accounts: ACCOUNTS,
    groups: GROUPS,
    canEdit,
    title: true,
    today: '2026-10-20',
    dateFormat: 'MM/dd/yyyy',
    reconciling,
  });
  it('enables items by the selection', () => {
    const rows = [
      transaction({
        id: 'a',
        accountId: 'chk',
        needsReview: true,
        payeeId: 'p1',
        payeeName: 'Kroger',
      }),
    ];
    const menu = actionsMenu(ctx(rows));
    expect(menu[0]).toEqual({ id: 'title', label: '1 selected transaction:', enabled: false });
    expect(item(menu, 'cleared')?.enabled).toBe(true);
    expect(item(menu, 'uncleared')?.enabled).toBe(false);
    expect(item(menu, 'approve')?.enabled).toBe(true);
    expect(item(menu, 'rename')?.enabled).toBe(true);
    expect(item(menu, 'match')?.enabled).toBe(false);
    expect(item(menu, 'recurring')?.enabled).toBe(true);
    // Move to scheduler… only for a transaction dated after today (10 §6.1).
    expect(item(menu, 'scheduler')?.enabled).toBe(false);
    expect(
      item(
        actionsMenu(ctx([transaction({ id: 'f', accountId: 'chk', date: '2026-10-21' })])),
        'scheduler',
      )?.enabled,
    ).toBe(true);
    expect(item(menu, 'move')?.submenu?.map((m) => m.label)).toEqual(['Savings']);
    expect(item(menu, 'categorize')?.submenu?.map((m) => m.label)).toEqual([
      'Income',
      'Everyday Expenses',
      'Bills',
      '(No Category)',
    ]);
  });
  it('offers Match for two in one account with the same amount', () => {
    const two = [
      transaction({ id: 'a', accountId: 'chk', amount: -5 }),
      transaction({ id: 'b', accountId: 'chk', amount: -5 }),
    ];
    expect(item(actionsMenu(ctx(two)), 'match')?.enabled).toBe(true);
  });
  it('disables Move to account when every row is a transfer a split created (10 §6.1)', () => {
    const fromSplitRow = transaction({
      id: 'f',
      accountId: 'chk',
      transferAccountId: 'old',
      transferSide: {
        id: 'l',
        accountId: 'old',
        date: '2026-10-01',
        cleared: 'U',
        isSplitLine: true,
      },
    });
    expect(item(actionsMenu(ctx([fromSplitRow])), 'move')?.enabled).toBe(false);
    const mixed = [fromSplitRow, transaction({ id: 'a', accountId: 'chk' })];
    expect(item(actionsMenu(ctx(mixed)), 'move')?.enabled).toBe(true);
  });
  it('offers Change Date… for two or more, not while reconciling (10 §6.1)', () => {
    const one = [transaction({ id: 'a', accountId: 'chk' })];
    const two = [...one, transaction({ id: 'b', accountId: 'chk' })];
    expect(item(actionsMenu(ctx(one)), 'date')).toBeUndefined();
    expect(item(actionsMenu(ctx(two)), 'date')).toEqual({
      id: 'date',
      label: 'Change Date...',
      enabled: true,
    });
    expect(item(actionsMenu(ctx(two, false)), 'date')?.enabled).toBe(false);
    expect(item(actionsMenu(ctx(two, true, true)), 'date')).toBeUndefined();
  });
  it('offers Create a new rule... for exactly one transaction (23 §2.2)', () => {
    const one = [transaction({ id: 'a', accountId: 'chk' })];
    const two = [...one, transaction({ id: 'b', accountId: 'chk' })];
    expect(item(actionsMenu(ctx(one)), 'createRule')).toEqual({
      id: 'createRule',
      label: 'Create a new rule...',
      enabled: true,
    });
    expect(item(actionsMenu(ctx(two)), 'createRule')?.enabled).toBe(false);
  });
  it('disables every item that changes data offline (10 §11 criterion 5)', () => {
    const rows = [transaction({ id: 'a', accountId: 'chk', needsReview: true })];
    const menu = actionsMenu(ctx(rows, false));
    for (const id of [
      'cleared',
      'approve',
      'reject',
      'categorize',
      'rename',
      'createRule',
      'recurring',
      'scheduler',
      'move',
      'delete',
    ])
      expect(item(menu, id)?.enabled, id).toBe(false);
    expect(item(menu, 'payeeSettings')?.enabled).toBe(true);
  });
});

it('keeps dialogs quiet when nothing is asked', async () => {
  await flushPromises();
  expect(useDialogs().stack).toHaveLength(0);
});
