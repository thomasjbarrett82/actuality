// Account writes on the fake API (13 §2–5, 08 §4; 04 §3): create with Actual's own starting balance,
// rename and note, closing (and Actual's delete-when-empty), force close, and reorder within a group.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawCategoryGroup } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { AccountsService } from './accounts';
import { MetadataRepository } from './metadata';

const account = (a: Partial<RawAccount> & { id: string; name: string }): RawAccount => ({
  offbudget: false,
  closed: false,
  sortOrder: 0,
  accountGroupId: null,
  ...a,
});

const GROUPS = (): RawCategoryGroup[] => [
  {
    id: 'g-bills',
    name: 'Bills',
    isIncome: false,
    hidden: false,
    sortOrder: 16384,
    categories: [
      {
        id: 'c-rent',
        name: 'Rent',
        groupId: 'g-bills',
        isIncome: false,
        hidden: false,
        sortOrder: 1,
      },
    ],
  },
  {
    id: 'g-income',
    name: 'Income',
    isIncome: true,
    hidden: false,
    sortOrder: 32768,
    categories: [
      {
        id: 'c-income',
        name: 'Income',
        groupId: 'g-income',
        isIncome: true,
        hidden: false,
        sortOrder: 1,
      },
      {
        id: 'c-starting',
        name: 'Starting Balances',
        groupId: 'g-income',
        isIncome: true,
        hidden: false,
        sortOrder: 2,
      },
    ],
  },
];

describe('AccountsService (13 §2–5, 08 §4)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: AccountsService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };
  const mappings = (accountId: string): void => {
    budget().notes.set(
      'ad:import-mappings',
      JSON.stringify({
        v: 1,
        mappings: [
          { key: 'x|1', accountId, importNotes: true, swapPayeeNotes: false },
          { key: 'x|2', accountId: 'a-house', importNotes: true, swapPayeeNotes: false },
        ],
      }),
    );
  };
  const mappedIds = (): unknown =>
    (
      JSON.parse(budget().notes.get('ad:import-mappings') ?? '{}') as {
        mappings: { accountId: string }[];
      }
    ).mappings.map((m) => m.accountId);

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    actual = new FakeActual();
    actual.today = '2026-10-20';
    actual.months = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      groups: GROUPS(),
      accounts: [
        account({ id: 'a-check', name: 'Checking', sortOrder: 16384 }),
        account({ id: 'a-save', name: 'Savings', sortOrder: 32768 }),
        account({ id: 'a-house', name: 'House', offbudget: true, sortOrder: 16384 }),
      ],
      transactions: [
        rawTransaction({ id: 't1', account: 'a-check', amount: 12_000, cleared: true }),
        rawTransaction({ id: 't2', account: 'a-check', amount: -2_000 }),
      ],
    });
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    service = new AccountsService(actual, conn, new MetadataRepository(actual));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  describe('create (13 §2, §8 criterion 1)', () => {
    it("keeps Actual's own starting balance: today, Cleared, Starting Balances, whatever the sign", async () => {
      const { id } = await service.create({ name: ' Visa ', onBudget: true, balance: -50_000 });
      const b = budget();
      expect(b.accounts.find((a) => a.id === id)).toMatchObject({ name: 'Visa', offbudget: false });
      const starting = b.transactions.filter((t) => t.account === id);
      expect(starting).toEqual([
        expect.objectContaining({
          amount: -50_000,
          date: '2026-10-20',
          cleared: true,
          reconciled: false,
          category: 'c-starting',
          startingBalance: true,
        }),
      ]);
      expect(b.payees.find((p) => p.id === starting[0]?.payee)?.name).toBe('Starting Balance');
      // No other category, group or note.
      expect(b.groups.map((g) => g.name)).toEqual(['Bills', 'Income']);
      expect([...b.notes.keys()].filter((k) => k.startsWith('ad:'))).toEqual([]);
      expect(actual.carryoverCalls).toEqual([]);
    });

    it('has no category off-budget, and no transaction at a zero balance', async () => {
      const off = await service.create({ name: 'Brokerage', onBudget: false, balance: 100_000 });
      expect(budget().accounts.find((a) => a.id === off.id)?.offbudget).toBe(true);
      expect(budget().transactions.find((t) => t.account === off.id)?.category).toBeNull();
      const zero = await service.create({ name: 'Cash', onBudget: true, balance: 0 });
      expect(budget().transactions.some((t) => t.account === zero.id)).toBe(false);
    });

    it('refuses empty, duplicate and backtick names (13 §1)', async () => {
      const make = (name: string) => service.create({ name, onBudget: true, balance: 0 });
      await expect(make('  ')).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'name-empty' },
      });
      await expect(make('checking')).rejects.toMatchObject({
        details: { code: 'name-duplicate' },
      });
      await expect(make('a`b')).rejects.toMatchObject({ details: { code: 'name-backtick' } });
      expect(budget().accounts).toHaveLength(3);
    });
  });

  describe('update (13 §3)', () => {
    it('renames the account and saves its native note', async () => {
      await service.update('a-check', { name: 'Joint: Checking', note: 'Pay in full' });
      const b = budget();
      expect(b.accounts.find((a) => a.id === 'a-check')?.name).toBe('Joint: Checking');
      expect(b.notes.get('account-a-check')).toBe('Pay in full');
      expect([...b.notes.keys()].filter((k) => k.startsWith('ad:'))).toEqual([]);
    });

    it('validates a name only when it changed other than in letter case', async () => {
      await expect(service.update('a-check', { name: 'Savings' })).rejects.toMatchObject({
        details: { code: 'name-duplicate' },
      });
      await service.update('a-check', { name: 'CHECKING' });
      expect(budget().accounts.find((a) => a.id === 'a-check')?.name).toBe('CHECKING');
    });
  });

  describe('close and reopen (13 §4, §8 criterion 4)', () => {
    it("deletes an account with no transactions, as Actual's close does, and clears what a delete clears", async () => {
      budget().notes.set('account-a-save', 'Old note');
      mappings('a-save');
      await service.close('a-save');
      const b = budget();
      expect(b.accounts.some((a) => a.id === 'a-save')).toBe(false);
      expect(b.notes.get('account-a-save')).toBe('');
      expect(mappedIds()).toEqual(['a-house']);
    });

    it('closes an account with transactions and a zero balance, and reopens it', async () => {
      budget().transactions.push(
        rawTransaction({ id: 't3', account: 'a-house', amount: 1_000 }),
        rawTransaction({ id: 't4', account: 'a-house', amount: -1_000 }),
      );
      await service.close('a-house');
      expect(budget().accounts.find((a) => a.id === 'a-house')).toMatchObject({ closed: true });
      await service.reopen('a-house');
      expect(budget().accounts.find((a) => a.id === 'a-house')).toMatchObject({ closed: false });
    });

    it('needs a transfer account for a balance, then moves it there', async () => {
      await expect(service.close('a-check')).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'balance-not-zero' },
      });
      await service.close('a-check', 'a-house', 'c-rent');
      const b = budget();
      expect(b.accounts.find((a) => a.id === 'a-check')?.closed).toBe(true);
      const closing = b.transactions.find((t) => t.account === 'a-check' && t.amount === -10_000);
      expect(closing).toMatchObject({ category: 'c-rent', payee: 'tp-a-house' });
    });
  });

  describe('force close (13 §5, §8 criterion 4)', () => {
    it('deletes an open account with all of its transactions, its note and its import mappings', async () => {
      budget().notes.set('account-a-check', 'Old note');
      mappings('a-check');
      await service.delete('a-check');
      const b = budget();
      expect(b.accounts.some((a) => a.id === 'a-check')).toBe(false);
      expect(b.transactions.some((t) => t.account === 'a-check')).toBe(false);
      expect(b.notes.get('account-a-check')).toBe('');
      expect(mappedIds()).toEqual(['a-house']);
    });

    it('refuses a closed account, which can only be re-opened', async () => {
      const save = budget().accounts.find((a) => a.id === 'a-save');
      if (save) save.closed = true;
      await expect(service.delete('a-save')).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'account-closed' },
      });
      expect(budget().accounts.some((a) => a.id === 'a-save')).toBe(true);
    });
  });

  describe('reorder (08 §4, 04 §3)', () => {
    const order = (group: (a: RawAccount) => boolean): string[] =>
      [...budget().accounts]
        .filter(group)
        .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))
        .map((a) => a.name);
    const onBudget = (a: RawAccount): boolean => !a.offbudget && !a.closed;

    it('writes only the moved account at the midpoint, or at the ends', async () => {
      await service.create({ name: 'Cash', onBudget: true, balance: 0 });
      const cash = budget().accounts.find((a) => a.name === 'Cash');
      await service.reorder(cash?.id ?? '', 'a-save', 'onBudget');
      expect(order(onBudget)).toEqual(['Checking', 'Cash', 'Savings']);
      expect(cash?.sortOrder).toBe(24576);
      await service.reorder('a-check', null, 'onBudget');
      expect(order(onBudget)).toEqual(['Cash', 'Savings', 'Checking']);
      await service.reorder('a-check', cash?.id ?? '', 'onBudget');
      expect(order(onBudget)).toEqual(['Checking', 'Cash', 'Savings']);
      expect(budget().accounts.find((a) => a.id === 'a-check')?.sortOrder).toBe(24576 - 16384);
    });

    it('renumbers the group when neighbors are too close', async () => {
      const b = budget();
      b.accounts.push(account({ id: 'a-x', name: 'X', sortOrder: 16384.0001 }));
      await service.reorder('a-check', 'a-x', 'onBudget');
      expect(order(onBudget)).toEqual(['Checking', 'X', 'Savings']);
      // Checking was first already: dropping it there writes nothing.
      expect(b.accounts.map((a) => [a.name, a.sortOrder])).toContainEqual(['Checking', 16384]);
      await service.reorder('a-save', 'a-x', 'onBudget');
      expect(order(onBudget)).toEqual(['Checking', 'Savings', 'X']);
      await service.reorder('a-x', 'a-save', 'onBudget');
      expect(order(onBudget)).toEqual(['Checking', 'X', 'Savings']);
    });

    it('refuses a move to another group: on/off budget and closed are never changed by a drop', async () => {
      await expect(service.reorder('a-save', 'a-house', 'offBudget')).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'other-group' },
      });
      await expect(service.reorder('a-save', null, 'closed')).rejects.toMatchObject({
        details: { code: 'other-group' },
      });
      expect(budget().accounts.find((a) => a.id === 'a-save')).toMatchObject({
        offbudget: false,
        closed: false,
        sortOrder: 32768,
      });
    });
  });
});
