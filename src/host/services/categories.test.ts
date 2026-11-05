// Category writes on the fake API (09 §4.1, §4.3, §6.1–6.2, §6.5): new groups and
// categories with unique names in the app's positions, renames, hiding, deleting with its impact, and moves
// with and without the internal move handlers (03 §3).
import { RpcError } from '@shared/rpc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNAVAILABLE_HANDLER, type RawCategoryGroup } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { CategoriesService, uniqueName } from './categories';
import { MetadataRepository } from './metadata';

const cat = (id: string, groupId: string, sortOrder: number, name = id) => ({
  id,
  name,
  groupId,
  isIncome: false,
  hidden: false,
  sortOrder,
});

const GROUPS = (): RawCategoryGroup[] => [
  {
    id: 'g-bills',
    name: 'Bills',
    isIncome: false,
    hidden: false,
    sortOrder: 16384,
    categories: [cat('c-rent', 'g-bills', 1, 'Rent'), cat('c-phone', 'g-bills', 2, 'Phone')],
  },
  {
    id: 'g-food',
    name: 'Food',
    isIncome: false,
    hidden: false,
    sortOrder: 32768,
    categories: [cat('c-groc', 'g-food', 1, 'Groceries'), cat('c-phone2', 'g-food', 2, 'Phone')],
  },
];

describe('CategoriesService (09 §4, §6)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: CategoriesService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };
  const names = (groupId: string) =>
    budget()
      .groups.find((g) => g.id === groupId)
      ?.categories.map((c) => c.name);

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.months = ['2026-09', '2026-10'];
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      groups: GROUPS(),
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          offbudget: false,
          closed: false,
          sortOrder: 1,
          accountGroupId: null,
        },
      ],
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a1',
          date: '2026-10-02',
          amount: -4_000,
          category: 'c-rent',
        }),
        rawTransaction({
          id: 't2',
          account: 'a1',
          date: '2026-10-03',
          amount: -1_000,
          category: 'c-rent',
        }),
      ],
    });
    budget().budgeted.set('c-rent:2026-09', 100);
    budget().budgeted.set('c-phone:2026-10', 100);
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
    service = new CategoriesService(actual, conn, queue, new MetadataRepository(actual));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('numbers a taken name', () => {
    expect(uniqueName('New Category', ['Rent'])).toBe('New Category');
    expect(uniqueName('New Category', ['new category', 'New Category 2'])).toBe('New Category 3');
  });

  it('creates a uniquely named group at the top (09 §4.1)', async () => {
    const first = await service.createGroup('New Master Category');
    const second = await service.createGroup('New Master Category');
    expect(second.name).toBe('New Master Category 2');
    expect(budget().groups.map((g) => g.id)).toEqual([second.id, first.id, 'g-bills', 'g-food']);
  });

  it('creates a uniquely named category at the end of its group (09 §4.3)', async () => {
    await service.create({ groupId: 'g-bills', name: 'New Category', unique: true });
    const again = await service.create({ groupId: 'g-bills', name: 'New Category', unique: true });
    expect(again.name).toBe('New Category 2');
    expect(names('g-bills')).toEqual(['Rent', 'Phone', 'New Category', 'New Category 2']);
  });

  it('renames and hides, checking a changed name only (09 §6.1)', async () => {
    await expect(service.update('c-rent', { name: 'Phone' })).rejects.toMatchObject({
      details: { code: 'name-duplicate' },
    });
    await expect(service.update('c-rent', { name: 'a:b' })).rejects.toMatchObject({
      details: { code: 'name-characters' },
    });
    await service.update('c-rent', { name: 'Rent', hidden: true });
    expect(budget().groups[0]?.categories[0]).toMatchObject({ name: 'Rent', hidden: true });
  });

  it('refuses reserved and Income group names (09 §6.2)', async () => {
    await expect(service.updateGroup('g-bills', { name: 'income' })).rejects.toMatchObject({
      details: { code: 'group-income' },
    });
    await expect(
      service.updateGroup('g-bills', { name: 'Versteckt', reserved: ['Versteckt'] }),
    ).rejects.toMatchObject({ details: { code: 'group-reserved' } });
    await service.updateGroup('g-bills', { name: 'Monthly Bills' });
    expect(budget().groups[0]?.name).toBe('Monthly Bills');
  });

  it('unhides groups and categories in one job (09 §6.5)', async () => {
    const [bills, food] = budget().groups;
    const groceries = food?.categories[0];
    if (!bills || !groceries) throw new Error('no fixture rows');
    bills.hidden = true;
    groceries.hidden = true;
    await service.setHidden(['c-groc'], ['g-bills'], false);
    expect(budget().groups[0]?.hidden).toBe(false);
    expect(budget().groups[1]?.categories[0]?.hidden).toBe(false);
  });

  it('reports what deleting would lose, then uncategorizes (09 §6.1)', async () => {
    expect(await service.deleteImpact('c-rent')).toEqual({
      budgetedMonths: 1,
      transactionCount: 2,
      transactionTotal: -5_000,
    });
    expect(await service.deleteImpact('g-bills')).toMatchObject({ budgetedMonths: 2 });
    await service.delete('c-rent');
    expect(names('g-bills')).toEqual(['Phone']);
    expect(budget().transactions.every((t) => t.category === null)).toBe(true);
  });

  it('deletes a group with its categories and their cell notes (09 §6.2, 04 §5.3)', async () => {
    budget().notes.set(
      'ad:cellnotes:2026-10',
      JSON.stringify({ v: 1, notes: { 'c-rent': 'a', 'c-phone': 'b', 'c-groc': 'c' } }),
    );
    await service.deleteGroup('g-bills');
    expect(budget().groups.map((g) => g.id)).toEqual(['g-food']);
    expect(JSON.parse(budget().notes.get('ad:cellnotes:2026-10') ?? '')).toEqual({
      v: 1,
      notes: { 'c-groc': 'c' },
    });
  });

  it('creates a category in a new group, checking both names first (09 §4.3)', async () => {
    const made = await service.create({ groupName: ' Savings ', name: ' Car ' });
    expect(made).toMatchObject({ name: 'Car' });
    expect(budget().groups.find((g) => g.id === made.groupId)).toMatchObject({ name: 'Savings' });
    expect(names(made.groupId)).toEqual(['Car']);
    const before = budget().groups.length;
    await expect(service.create({ groupName: 'bills', name: 'X' })).rejects.toMatchObject({
      details: { code: 'group-duplicate' },
    });
    await expect(service.create({ groupName: '  ', name: 'X' })).rejects.toMatchObject({
      details: { code: 'group-empty' },
    });
    await expect(service.create({ groupName: 'Fresh', name: 'a:b' })).rejects.toMatchObject({
      details: { code: 'name-characters' },
    });
    // A refused name leaves no empty group behind.
    expect(budget().groups).toHaveLength(before);
  });

  it('refuses a duplicate or empty name in an existing group, and a group that is gone', async () => {
    await expect(service.create({ groupId: 'g-bills', name: 'rent' })).rejects.toMatchObject({
      details: { code: 'name-duplicate' },
    });
    await expect(service.create({ groupId: 'g-bills', name: ' ' })).rejects.toMatchObject({
      details: { code: 'name-empty' },
    });
    await expect(service.create({ groupId: 'g-gone', name: 'X' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('refuses a group name only a number would make unique when it is reserved (09 §4.1)', async () => {
    await expect(service.createGroup('Income')).rejects.toMatchObject({
      details: { code: 'group-income' },
    });
  });

  it("keeps a new category or group where Actual put it when the move handler isn't there (03 §3)", async () => {
    const unavailable = new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER });
    vi.spyOn(actual, 'moveCategory').mockRejectedValue(unavailable);
    vi.spyOn(actual, 'moveCategoryGroup').mockRejectedValue(unavailable);
    const made = await service.create({ groupId: 'g-bills', name: 'Water' });
    expect(names('g-bills')).toContain('Water');
    expect(made.name).toBe('Water');
    const group = await service.createGroup('Extra');
    expect(budget().groups.some((g) => g.id === group.id)).toBe(true);
  });

  it('passes on any other failure of the move after a create', async () => {
    vi.spyOn(actual, 'moveCategory').mockRejectedValue(new Error('boom'));
    await expect(service.create({ groupId: 'g-bills', name: 'Water' })).rejects.toThrow('boom');
  });

  describe('moves (09 §4.3)', () => {
    it('reorders within a group and moves across groups', async () => {
      await service.move('c-phone', 'g-bills', 'c-rent');
      expect(names('g-bills')).toEqual(['Phone', 'Rent']);
      await service.move('c-rent', 'g-food', null);
      expect(names('g-food')).toEqual(['Groceries', 'Phone', 'Rent']);
    });

    it('keeps income and expense categories apart, and refuses what is gone', async () => {
      budget().groups.push({
        id: 'g-inc',
        name: 'Income',
        isIncome: true,
        hidden: false,
        sortOrder: 49152,
        categories: [{ ...cat('c-salary', 'g-inc', 1, 'Salary'), isIncome: true }],
      });
      await expect(service.move('c-rent', 'g-inc', null)).rejects.toMatchObject({
        details: { code: 'income-mismatch' },
      });
      await expect(service.move('c-salary', 'g-bills', null)).rejects.toMatchObject({
        details: { code: 'income-mismatch' },
      });
      await expect(service.move('c-gone', 'g-bills', null)).rejects.toMatchObject({
        code: 'not-found',
      });
      await expect(service.move('c-rent', 'g-gone', null)).rejects.toMatchObject({
        code: 'not-found',
      });
    });

    it('treats a move before itself as no move', async () => {
      const move = vi.spyOn(actual, 'moveCategory');
      await expect(service.move('c-rent', 'g-bills', 'c-rent')).resolves.toBeNull();
      expect(move).not.toHaveBeenCalled();
      expect(names('g-bills')).toEqual(['Rent', 'Phone']);
    });

    it('falls back when Actual reports the handler but the move is unavailable', async () => {
      vi.spyOn(actual, 'moveCategory').mockRejectedValue(
        new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }),
      );
      await service.move('c-rent', 'g-food', null);
      expect(names('g-food')).toContain('Rent');
    });

    it('refuses a group that already has a category with that name', async () => {
      await expect(service.move('c-phone', 'g-food', null)).rejects.toMatchObject({
        details: { code: 'name-duplicate' },
      });
    });

    it('without category-move: moves across groups, refuses reorders', async () => {
      actual.missingHandlers.add('category-move');
      await service.move('c-rent', 'g-food', 'c-groc');
      expect(names('g-food')).toContain('Rent');
      await expect(service.move('c-phone', 'g-bills', null)).rejects.toMatchObject({
        details: { code: 'internal-handler-unavailable' },
      });
      expect(await service.moveSupport()).toEqual({ category: false, group: true });
    });

    it('reorders groups, and reports a missing group handler', async () => {
      await service.moveGroup('g-food', 'g-bills');
      expect(budget().groups.map((g) => g.id)).toEqual(['g-food', 'g-bills']);
      actual.missingHandlers.add('category-group-move');
      await expect(service.moveGroup('g-bills', 'g-food')).rejects.toMatchObject({
        details: { code: 'internal-handler-unavailable' },
      });
    });
  });
});
