import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawTransaction } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { MetadataRepository } from './metadata';
import { ReadService, reconciledDate } from './read';

const tx = (
  patch: Partial<RawTransaction> & { id: string; account: string; amount: number },
): RawTransaction => ({
  date: '2026-10-01',
  payee: null,
  category: null,
  notes: null,
  cleared: false,
  reconciled: false,
  transferId: null,
  importedId: null,
  importedPayee: null,
  schedule: null,
  startingBalance: false,
  sortOrder: 0,
  isParent: false,
  parentId: null,
  subtransactions: [],
  ...patch,
});

describe('read services (04 §2, §6–8)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let read: ReadService;

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [
        {
          id: 'chk',
          name: 'Checking',
          offbudget: false,
          closed: false,
          sortOrder: 1,
          accountGroupId: null,
        },
        {
          id: 'sav',
          name: 'Savings',
          offbudget: false,
          closed: false,
          sortOrder: 2,
          accountGroupId: 'g1',
          lastReconciled: String(new Date(2026, 8, 30, 23, 59).getTime()),
        },
        {
          id: 'mort',
          name: 'Mortgage',
          offbudget: true,
          closed: false,
          sortOrder: 3,
          accountGroupId: null,
        },
        {
          id: 'old',
          name: 'Old',
          offbudget: false,
          closed: true,
          sortOrder: 4,
          accountGroupId: null,
        },
      ],
      payees: [
        { id: 'kroger', name: 'Kroger', transferAcct: null },
        { id: 'p-sav', name: '', transferAcct: 'sav' },
        { id: 'p-mort', name: '', transferAcct: 'mort' },
        { id: 'p-old', name: '', transferAcct: 'old' },
        { id: 'cash', name: 'Cash', transferAcct: null },
      ],
      groups: [
        {
          id: 'gb',
          name: 'Bills',
          isIncome: false,
          hidden: false,
          sortOrder: 1,
          categories: [
            {
              id: 'rent',
              name: 'Rent',
              groupId: 'gb',
              isIncome: false,
              hidden: false,
              sortOrder: 1,
            },
          ],
        },
      ],
      rules: [
        {
          id: 'r-auto',
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'payee', op: 'is', value: 'kroger' }],
          actions: [{ field: 'category', op: 'set', value: 'rent' }],
        },
        {
          id: 'r-rename',
          stage: 'pre',
          conditionsOp: 'or',
          conditions: [{ field: 'imported_payee', op: 'matches', value: '^KROGER' }],
          actions: [{ field: 'payee', op: 'set', value: 'kroger' }],
        },
      ],
      schedules: [
        { id: 's1', account: 'chk', payee: 'kroger', completed: false },
        { id: 's2', account: 'chk', payee: 'kroger', completed: true },
      ],
      transactions: [
        tx({
          id: 't1',
          account: 'chk',
          amount: -5000,
          payee: 'kroger',
          category: 'rent',
          cleared: true,
          reconciled: true,
        }),
        tx({
          id: 't2',
          account: 'chk',
          amount: -2000,
          payee: 'kroger',
          notes: 'lunch #needs-review',
          cleared: true,
        }),
        tx({ id: 't3', account: 'chk', amount: 10000, payee: 'p-sav', category: 'rent' }),
        tx({
          id: 't4',
          account: 'chk',
          amount: -3000,
          isParent: true,
          notes: 'split #Trip2025 #flag-red ⟦chk 101⟧',
          subtransactions: [
            tx({ id: 't4a', account: 'chk', amount: -1000, category: 'rent', parentId: 't4' }),
            tx({ id: 't4b', account: 'chk', amount: -2000, payee: 'p-mort', parentId: 't4' }),
          ],
        }),
        tx({ id: 't5', account: 'sav', amount: -10000, payee: 'p-sav' }),
      ],
    });
    const budget = actual.budgets.get('b1');
    budget?.notes.set('account-chk', 'Joint account');
    budget?.notes.set('rent', 'Due on the 1st');
    // `ad:account:` metadata isn't read, and changes nothing.
    budget?.notes.set(
      'ad:account:chk',
      JSON.stringify({ v: 1, type: 'Checking', lastReconciledDate: '2026-01-01' }),
    );
    budget?.notes.set('ad:payees', JSON.stringify({ v: 1, disabled: ['cash'] }));
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: true, diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    read = new ReadService(actual, queue, conn, new MetadataRepository(actual));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('decodes transactions, resolves payees and derives states', async () => {
    const list = await read.transactions('chk');
    const byId = new Map(list.map((t) => [t.id, t]));
    expect(byId.get('t1')).toMatchObject({ cleared: 'R', payeeName: 'Kroger', errorLevel: 'none' });
    expect(byId.get('t2')).toMatchObject({
      notes: 'lunch',
      needsReview: true,
      errorLevel: 'forReview',
      errorMessage: { key: 'reviewImported' },
    });
    expect(byId.get('t3')).toMatchObject({
      payeeName: 'Savings',
      transferAccountId: 'sav',
      errorLevel: 'error',
      errorMessage: { key: 'onBudgetTransferCategorized' },
    });
    const split = byId.get('t4');
    expect(split).toMatchObject({
      notes: 'split #Trip2025 #flag-red',
      tags: ['Trip2025', 'flag-red'],
      checkNumber: '101',
      categoryId: null,
    });
    expect(split?.subtransactions.map((s) => s.errorLevel)).toEqual(['none', 'needsCategory']);
    expect(split?.errorLevel).toBe('needsCategory');
    expect(await read.transactions('all')).toHaveLength(5);
  });

  it("lists a category's, a group's, every expense category's or the uncategorized rows in a month (09 §6.6)", async () => {
    const budget = actual.budgets.get('b1');
    budget?.transactions.push(
      tx({ id: 't6', account: 'chk', date: '2026-10-15', amount: -700, category: 'rent' }),
      tx({ id: 't7', account: 'chk', date: '2026-09-15', amount: -900, category: 'rent' }),
      tx({ id: 't8', account: 'mort', amount: -400, category: 'rent' }),
    );
    const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

    const rent = await read.forCategoryMonth('rent', '2026-10');
    // Newest first; split lines rather than their split; no other month and no off-budget account.
    expect(ids(rent)).toEqual(['t6', 't1', 't3', 't4a']);
    expect(rent.find((r) => r.id === 't4a')).toMatchObject({
      transactionId: 't4',
      accountName: 'Checking',
      isSplitLine: true,
      parentNotes: 'split #Trip2025 #flag-red',
    });
    expect(rent.find((r) => r.id === 't3')).toMatchObject({
      payeeName: 'Savings',
      transferAccountName: 'Savings',
      isSplitLine: false,
    });
    expect(ids(await read.forCategoryMonth('gb', '2026-10'))).toEqual(ids(rent));
    expect(ids(await read.forCategoryMonth('all', '2026-10'))).toEqual(ids(rent));

    const uncategorized = await read.forCategoryMonth('uncategorized', '2026-10');
    // t5 is an on-budget transfer, which needs no category.
    expect(ids(uncategorized).sort()).toEqual(['t2', 't4b']);
    expect(uncategorized.find((r) => r.id === 't4b')).toMatchObject({
      transferAccountName: 'Mortgage',
    });
  });

  it("lists a month's income-category rows (09 §5.1)", async () => {
    const budget = actual.budgets.get('b1');
    budget?.groups.push({
      id: 'gi',
      name: 'Income',
      isIncome: true,
      hidden: false,
      sortOrder: 2,
      categories: [
        { id: 'pay', name: 'Salary', groupId: 'gi', isIncome: true, hidden: false, sortOrder: 1 },
      ],
    });
    budget?.transactions.push(
      tx({ id: 't9', account: 'chk', amount: 250_000, payee: 'cash', category: 'pay' }),
    );
    expect(await read.incomeForMonth('2026-10')).toEqual([
      expect.objectContaining({ id: 't9', payeeName: 'Cash', amount: 250_000 }),
    ]);
    // Income stays out of 'all'.
    const all = await read.forCategoryMonth('all', '2026-10');
    expect(all.some((r) => r.id === 't9')).toBe(false);
  });

  it('gets one transaction equal to its list entry, reading only that transaction', async () => {
    const list = await read.transactions('all');
    const register = vi.spyOn(actual, 'getTransactions');
    for (const t of list) await expect(read.transaction(t.id)).resolves.toEqual(t);
    // A split line's id gives its split.
    await expect(read.transaction('t4b')).resolves.toEqual(list.find((t) => t.id === 't4'));
    await expect(read.transaction('nope')).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('lists accounts with balances, attention, metadata and notes', async () => {
    const accounts = await read.accounts();
    expect(accounts.map((a) => a.id)).toEqual(['chk', 'sav', 'mort', 'old']);
    const chk = accounts[0];
    expect(chk).toMatchObject({
      onBudget: true,
      note: 'Joint account',
      hasTransactions: true,
      scheduledCount: 1,
      attention: { count: 3, maxLevel: 'error' },
      balances: { reconciled: -5000, cleared: -7000, uncleared: 7000, working: 0 },
    });
    expect(chk?.lastReconciledDate).toBeNull();
    // Actual's `last_reconciled`, as its local calendar date (04 §3).
    expect(accounts[1]).toMatchObject({
      accountGroupId: 'g1',
      balances: { working: -10000 },
      lastReconciledDate: '2026-09-30',
    });
    expect(accounts[2]).toMatchObject({
      onBudget: false,
      hasTransactions: false,
    });
  });

  it('builds the category tree with notes', async () => {
    const [bills] = await read.categories();
    expect(bills?.categories[0]).toMatchObject({
      id: 'rent',
      note: 'Due on the 1st',
    });
  });

  it("reads Actual's last_reconciled as a local date; empty or unparsable is never", () => {
    expect(reconciledDate(String(new Date(2026, 0, 2, 0, 1).getTime()))).toBe('2026-01-02');
    for (const raw of [null, undefined, '', '  ', 'soon', String(Number.MAX_VALUE)])
      expect(reconciledDate(raw)).toBeNull();
  });

  it('lists payees with usage, enabled state and the app’s rules', async () => {
    const payees = new Map((await read.payees()).map((p) => [p.id, p]));
    expect(payees.get('kroger')).toMatchObject({
      enabled: true,
      usageCount: 4,
      autoCategoryId: 'rent',
      autoCategoryRuleId: 'r-auto',
      renameRuleId: 'r-rename',
      renameRules: [{ op: 'startsWith', value: 'KROGER' }],
    });
    expect(payees.get('cash')?.enabled).toBe(false);
    expect(payees.get('p-old')?.enabled).toBe(false);
    expect(payees.get('p-sav')?.enabled).toBe(true);
  });
});
