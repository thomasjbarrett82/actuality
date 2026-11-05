// The budget service on the fake API (09 §2, §5.5, §6.4): month views, the range
// guard on writes, batched fills, the hold, Quick Budget stats with scheduled outflows, and the carryover
// extension.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawCategoryGroup } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { BudgetService } from './budget';
import { MetadataRepository } from './metadata';

const category = (id: string, groupId: string, isIncome = false) => ({
  id,
  name: id,
  groupId,
  isIncome,
  hidden: false,
  sortOrder: 1,
});

const GROUPS = (): RawCategoryGroup[] => [
  {
    id: 'g-food',
    name: 'Food',
    isIncome: false,
    hidden: false,
    sortOrder: 1,
    categories: [category('c-groc', 'g-food'), category('c-dine', 'g-food')],
  },
  {
    id: 'g-inc',
    name: 'Income',
    isIncome: true,
    hidden: false,
    sortOrder: 2,
    categories: [category('c-inc', 'g-inc', true)],
  },
];

const ACCOUNTS: RawAccount[] = [
  {
    id: 'a-check',
    name: 'Checking',
    offbudget: false,
    closed: false,
    sortOrder: 1,
    accountGroupId: null,
  },
  {
    id: 'a-house',
    name: 'House',
    offbudget: true,
    closed: false,
    sortOrder: 2,
    accountGroupId: null,
  },
];

describe('BudgetService (09 §2, §5.5, §6.4)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: BudgetService;
  /** The service's "today". */
  let now: Date;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    actual = new FakeActual();
    actual.months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      groups: GROUPS(),
      accounts: ACCOUNTS,
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a-check',
          date: '2026-08-02',
          amount: 300_000,
          category: 'c-inc',
        }),
        rawTransaction({
          id: 't2',
          account: 'a-check',
          date: '2026-08-05',
          amount: -20_000,
          category: 'c-groc',
        }),
        rawTransaction({
          id: 't3',
          account: 'a-check',
          date: '2026-09-05',
          amount: -40_000,
          category: 'c-groc',
        }),
        rawTransaction({ id: 't4', account: 'a-check', date: '2026-10-05', amount: -2_500 }),
        rawTransaction({ id: 't5', account: 'a-house', date: '2026-10-06', amount: -9_999 }),
      ],
    });
    budget().budgeted.set('c-groc:2026-08', 30_000);
    budget().budgeted.set('c-groc:2026-09', 30_000);
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
    now = new Date(2026, 9, 20);
    service = new BudgetService(actual, queue, conn, new MetadataRepository(actual), () => now);
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  describe('month (09 §2)', () => {
    it('builds the view with hasTransactions and the Uncategorized row', async () => {
      const v = await service.month('2026-10');
      expect(v.uncategorized).toEqual({ activity: -2_500, hasTransactions: true });
      expect(v.groups[0]?.categories.find((c) => c.id === 'c-groc')?.hasTransactions).toBe(false);
      const sep = await service.month('2026-09');
      expect(sep.groups[0]?.categories.find((c) => c.id === 'c-groc')).toMatchObject({
        budgeted: 30_000,
        activity: -40_000,
        hasTransactions: true,
      });
    });

    it('holds the header identity in every month', async () => {
      for (const m of actual.months) {
        const v = await service.month(m);
        expect(v.otherAdjustments, m).toBe(0);
      }
    });

    it('treats the first month of the range as having no previous month', async () => {
      const v = await service.month('2026-07');
      expect(v.notBudgetedPrev).toBe(0);
    });

    it('refuses months outside the range with validation', async () => {
      await expect(service.month('2027-01')).rejects.toMatchObject({ code: 'validation' });
    });

    it('says whether uncategorized transactions exist in any month', async () => {
      expect(await service.uncategorized()).toEqual({ exists: true });
    });
  });

  describe('writes (09 §2, §5.4–5.5)', () => {
    it('sets an amount', async () => {
      await service.setAmount('2026-10', 'c-groc', 12_345);
      expect(budget().budgeted.get('c-groc:2026-10')).toBe(12_345);
    });

    it('refuses every budget write for a month outside the range', async () => {
      const out = '2027-01';
      await expect(service.setAmount(out, 'c-groc', 1)).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(
        service.setAmounts(out, [{ categoryId: 'c-groc', amount: 1 }]),
      ).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(service.setCarryover(out, 'c-groc', true)).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(service.hold(out, 1)).rejects.toMatchObject({ code: 'validation' });
      await expect(service.resetHold(out)).rejects.toMatchObject({ code: 'validation' });
      expect(budget().budgeted.has(`c-groc:${out}`)).toBe(false);
    });

    it('refuses carryover and amounts on income categories', async () => {
      await expect(service.setCarryover('2026-10', 'c-inc', true)).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(service.setAmount('2026-10', 'c-inc', 5)).rejects.toMatchObject({
        code: 'validation',
      });
    });

    it('writes a fill in one batch', async () => {
      await service.setAmounts('2026-10', [
        { categoryId: 'c-groc', amount: 1 },
        { categoryId: 'c-dine', amount: 2 },
      ]);
      expect(actual.batches).toBe(1);
      expect(budget().budgeted.get('c-dine:2026-10')).toBe(2);
    });

    it('replaces an existing hold, and resets it', async () => {
      await service.hold('2026-10', 5_000);
      await service.hold('2026-10', 7_000);
      expect((await service.month('2026-10')).heldForNext).toBe(7_000);
      await service.resetHold('2026-10');
      expect((await service.month('2026-10')).heldForNext).toBe(0);
    });

    it('sets carryover from a month on (S-10)', async () => {
      await service.setCarryover('2026-10', 'c-groc', true);
      expect(budget().carryover.get('c-groc:2026-12')).toBe(true);
      expect(budget().carryover.get('c-groc:2026-09')).toBeUndefined();
    });
  });

  describe('quickBudgetStats (09 §5.5)', () => {
    it('gives last month’s values, the averages over the valid history and Balance to 0', async () => {
      budget().budgeted.set('c-groc:2026-10', 10_000);
      const stats = await service.quickBudgetStats('2026-10');
      // Starting month 2026-09; 09 and 08 have real data, 07 has none.
      expect(stats.h12).toBe(2);
      expect(stats.categories['c-groc']).toMatchObject({
        budgeted: 10_000,
        lastBudgeted: 30_000,
        lastOutflows: 40_000,
        average3: 30_000,
        averageYear: 0,
        // Balance: 20 000 carried from August… overspent in September, so 0 carried; 10 000 now.
        balanceTo0: 0,
      });
      expect(stats.categories['c-inc']).toBeUndefined();
    });

    it('counts scheduled outflows from next_date to the month’s end, splits by line', async () => {
      budget().schedules.push(
        {
          id: 's-gym',
          account: 'a-check',
          payee: null,
          completed: false,
          nextDate: '2026-11-15',
          amount: -5_000,
          amountOp: 'is',
          date: { frequency: 'weekly', interval: 1, start: '2026-11-01', endMode: 'never' },
          ruleId: 'r-gym',
        },
        {
          id: 's-split',
          account: 'a-check',
          payee: null,
          completed: false,
          nextDate: '2026-11-03',
          amount: { num1: -3_000, num2: -4_000 },
          amountOp: 'isbetween',
          date: '2026-11-03',
          ruleId: 'r-split',
        },
        {
          id: 's-pay',
          account: 'a-check',
          payee: null,
          completed: false,
          nextDate: '2026-11-01',
          amount: 300_000,
          amountOp: 'is',
          date: '2026-11-01',
          ruleId: null,
        },
      );
      budget().rules.push(
        {
          id: 'r-gym',
          stage: null,
          conditionsOp: 'and',
          conditions: [],
          actions: [
            { op: 'link-schedule', value: 's-gym' },
            { op: 'set', field: 'category', value: 'c-dine' },
          ],
        },
        {
          id: 'r-split',
          stage: null,
          conditionsOp: 'and',
          conditions: [],
          actions: [
            {
              op: 'set-split-amount',
              value: -1_000,
              options: { splitIndex: 1, method: 'fixed-amount' },
            },
            { op: 'set', field: 'category', value: 'c-groc', options: { splitIndex: 1 } },
            {
              op: 'set-split-amount',
              value: null,
              options: { splitIndex: 2, method: 'remainder' },
            },
            { op: 'set', field: 'category', value: 'c-dine', options: { splitIndex: 2 } },
          ],
        },
      );
      // Weekly from 11-01, as Actual returns them from today on.
      actual.upcomingDates = (_config, count) =>
        ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06'].slice(
          0,
          count,
        );
      const stats = await service.quickBudgetStats('2026-11');
      // Gym: 11-15, 11-22, 11-29 (from next_date) → 15 000; split: 2 000 of the 3 000 to Dining.
      expect(stats.categories['c-dine']?.scheduled).toBe(17_000);
      expect(stats.categories['c-groc']?.scheduled).toBe(1_000);
    });

    it('counts the overdue occurrences before the handler’s dates from today (12 §5)', async () => {
      budget().schedules.push({
        id: 's-gym',
        account: 'a-check',
        payee: null,
        completed: false,
        // Not posted since 10-27, so 11-03 is overdue too.
        nextDate: '2026-10-27',
        amount: -5_000,
        amountOp: 'is',
        date: { frequency: 'weekly', interval: 1, start: '2026-10-06', endMode: 'never' },
        ruleId: 'r-gym',
      });
      budget().rules.push({
        id: 'r-gym',
        stage: null,
        conditionsOp: 'and',
        conditions: [],
        actions: [{ op: 'set', field: 'category', value: 'c-dine' }],
      });
      // Actual's handler lists dates from today (11-05) on.
      actual.upcomingDates = (_config, count) =>
        ['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01'].slice(0, count);
      now = new Date(2026, 10, 5);
      const stats = await service.quickBudgetStats('2026-11');
      // 11-03 (overdue), 11-10, 11-17, 11-24.
      expect(stats.categories['c-dine']?.scheduled).toBe(20_000);
    });

    it('counts only next_date without the upcoming-dates handler (12 §5)', async () => {
      actual.missingHandlers.add('schedule/get-upcoming-dates');
      budget().schedules.push({
        id: 's-gym',
        account: 'a-check',
        payee: null,
        completed: false,
        nextDate: '2026-11-15',
        amount: -5_000,
        amountOp: 'is',
        date: { frequency: 'weekly', interval: 1, start: '2026-11-01', endMode: 'never' },
        ruleId: 'r-gym',
      });
      budget().rules.push({
        id: 'r-gym',
        stage: null,
        conditionsOp: 'and',
        conditions: [],
        actions: [{ op: 'set', field: 'category', value: 'c-dine' }],
      });
      const stats = await service.quickBudgetStats('2026-11');
      expect(stats.categories['c-dine']?.scheduled).toBe(5_000);
    });
  });

  describe('carryover extension (09 §6.4)', () => {
    const seenEnd = (): unknown =>
      (JSON.parse(budget().notes.get('ad:budget') ?? '{}') as { carryoverSeenEnd?: string })
        .carryoverSeenEnd;

    it('stores bounds.end the first time and changes nothing', async () => {
      await conn.write('t', [], () => service.extendCarryover());
      expect(seenEnd()).toBe('2027-01');
      expect(actual.carryoverCalls).toEqual([]);
    });

    it('re-applies carryover from the stored end once the range has grown', async () => {
      budget().notes.set('ad:budget', JSON.stringify({ v: 1, carryoverSeenEnd: '2026-11' }));
      budget().carryover.set('c-groc:2026-11', true);
      budget().carryover.set('c-dine:2026-11', false);
      await conn.write('t', [], () => service.extendCarryover());
      expect(actual.carryoverCalls).toEqual(['2026-11:c-groc:true']);
      expect(budget().carryover.get('c-groc:2026-12')).toBe(true);
      expect(seenEnd()).toBe('2027-01');
    });

    it('does nothing when the range hasn’t moved', async () => {
      budget().notes.set('ad:budget', JSON.stringify({ v: 1, carryoverSeenEnd: '2027-01', x: 1 }));
      await conn.write('t', [], () => service.extendCarryover());
      expect(actual.carryoverCalls).toEqual([]);
    });
  });
});
