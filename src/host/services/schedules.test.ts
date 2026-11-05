// The schedules service on the fake API (12): saving the Schedule dialog with the
// rule-action template, name, amount operators, dates and links; unchanged patterns kept; Enter now / Skip,
// moves, drafts from transactions, matching, the write gate.
import { decode } from '@shared/metadata/notes-codec';
import type { ScheduleEdit } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNAVAILABLE_HANDLER, type RawAccount } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { SchedulesService } from './schedules';

const ACCOUNTS: RawAccount[] = [
  {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    sortOrder: 1,
    accountGroupId: null,
  },
  {
    id: 'a2',
    name: 'Savings',
    offbudget: false,
    closed: false,
    sortOrder: 2,
    accountGroupId: null,
  },
];

const MONTHLY = {
  frequency: 'monthly',
  interval: 1,
  start: '2026-11-05',
  endMode: 'never',
} as const;

const edit = (over: Partial<ScheduleEdit> = {}): ScheduleEdit => ({
  name: '',
  accountId: 'a1',
  date: { ...MONTHLY },
  payee: { kind: 'existing', id: 'p-rent' },
  categoryId: 'c-rent',
  notes: 'Rent #home',
  amountOp: 'is',
  amount: -100_000,
  postsTransaction: true,
  ...over,
});

describe('SchedulesService (12)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: SchedulesService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: ACCOUNTS,
      payees: [
        { id: 'p-rent', name: 'Landlord', transferAcct: null },
        { id: 'p-a1', name: 'Checking', transferAcct: 'a1' },
        { id: 'p-a2', name: 'Savings', transferAcct: 'a2' },
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
    service = new SchedulesService(actual, queue, conn, () => new Date(2026, 9, 20));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('creates a schedule that posts, with the template on its rule (12 §1, §3)', async () => {
    const { id } = await service.save(edit());
    const raw = budget().schedules.find((s) => s.id === id);
    expect(raw).toMatchObject({ postsTransaction: true, amountOp: 'is', nextDate: '2026-11-05' });
    const rule = budget().rules.find((r) => r.id === raw?.ruleId);
    expect(rule?.actions).toEqual([
      { op: 'link-schedule', value: id },
      { op: 'set', field: 'notes', value: 'Rent #home #needs-review', type: 'string' },
      { op: 'set', field: 'category', value: 'c-rent', type: 'id' },
    ]);
    const [shown] = await service.list('a1');
    expect(shown).toMatchObject({
      frequency: 'Monthly',
      payeeId: 'p-rent',
      categoryId: 'c-rent',
      notes: 'Rent #home',
      amount: -100_000,
    });
    expect(await service.list('a2')).toEqual([]);
  });

  it('leaves out the payee condition without a payee', async () => {
    const { id } = await service.save(edit({ payee: { kind: 'none' } }));
    const raw = budget().schedules.find((s) => s.id === id);
    const rule = budget().rules.find((r) => r.id === raw?.ruleId);
    expect(rule?.conditions.some((c) => c.field === 'payee')).toBe(false);
  });

  it('clears an existing schedule payee and removes its rule condition', async () => {
    const { id } = await service.save(edit());
    await service.save(edit({ id, payee: { kind: 'none' } }));
    const raw = budget().schedules.find((s) => s.id === id);
    const rule = budget().rules.find((r) => r.id === raw?.ruleId);
    expect(raw?.payee).toBeNull();
    expect(rule?.conditions.some((c) => c.field === 'payee')).toBe(false);
  });

  it('refuses dates before today, transfers to itself and unbalanced splits', async () => {
    await expect(service.save(edit({ date: '2026-10-19' }))).rejects.toMatchObject({
      details: { code: 'date-before-today' },
    });
    await expect(
      service.save(edit({ payee: { kind: 'transfer', accountId: 'a1' } })),
    ).rejects.toMatchObject({ details: { code: 'transfer-to-self' } });
    await expect(
      service.save(
        edit({
          lines: [{ amount: -1, transferAccountId: null, categoryId: null, notes: '' }],
        }),
      ),
    ).rejects.toMatchObject({ details: { code: 'split-unbalanced' } });
  });

  it('keeps a custom pattern, its unknown fields, next_date and other actions when editing (criterion 3)', async () => {
    const config = {
      frequency: 'weekly',
      interval: 3,
      start: '2026-10-01',
      endMode: 'never',
      fromWeb: 'kept',
    };
    budget().schedules.push({
      id: 's-web',
      account: 'a1',
      payee: 'p-rent',
      completed: false,
      nextDate: '2026-10-22',
      amount: -5000,
      amountOp: 'isapprox',
      date: config,
      ruleId: 'r-web',
      postsTransaction: false,
    });
    budget().rules.push({
      id: 'r-web',
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'payee', value: 'p-rent' }],
      actions: [
        { op: 'link-schedule', value: 's-web' },
        { op: 'set', field: 'cleared', value: true },
      ],
    });
    const [listed] = await service.list('a1');
    expect(listed?.frequency).toBe('custom');
    // The dialog sends the config back as it got it (keys in any order).
    await service.save(
      edit({
        id: 's-web',
        date: {
          fromWeb: 'kept',
          endMode: 'never',
          start: '2026-10-01',
          interval: 3,
          frequency: 'weekly',
        },
        amountOp: 'isapprox',
        amount: -5000,
        postsTransaction: false,
        payee: { kind: 'new', name: 'Gym' },
      }),
    );
    const raw = budget().schedules.find((s) => s.id === 's-web');
    expect(raw?.date).toEqual(config);
    expect(raw?.nextDate).toBe('2026-10-22');
    expect(raw?.postsTransaction).toBe(false);
    expect(raw?.amountOp).toBe('isapprox');
    const gym = budget().payees.find((p) => p.name === 'Gym');
    expect(raw?.payee).toBe(gym?.id);
    expect(budget().rules.find((r) => r.id === 'r-web')?.actions).toContainEqual({
      op: 'set',
      field: 'cleared',
      value: true,
    });
  });

  it('saves the name, posts_transaction and both "is between" amounts (12 §3.1)', async () => {
    const { id } = await service.save(
      edit({
        name: '  Rent  ',
        postsTransaction: false,
        amountOp: 'isbetween',
        amount: -90_000,
        amount2: -110_000,
      }),
    );
    expect(budget().schedules.find((s) => s.id === id)).toMatchObject({
      name: 'Rent',
      postsTransaction: false,
      amountOp: 'isbetween',
      amount: { num1: -90_000, num2: -110_000 },
    });
    expect((await service.list('a1'))[0]).toMatchObject({
      name: 'Rent',
      amount: -90_000,
      amount2: -110_000,
      postsTransaction: false,
    });
    await service.save(edit({ id, name: '', postsTransaction: true }));
    expect(budget().schedules.find((s) => s.id === id)).toMatchObject({
      name: null,
      postsTransaction: true,
      amountOp: 'is',
      amount: -100_000,
    });
  });

  it('refuses a name another schedule has', async () => {
    await service.save(edit({ name: 'Rent' }));
    await expect(service.save(edit({ name: 'Rent' }))).rejects.toMatchObject({
      details: { code: 'name-taken' },
    });
  });

  it('refuses a recurring date with no occurrence from today on, or ending before it starts', async () => {
    const ended = {
      ...MONTHLY,
      start: '2026-01-05',
      endMode: 'on_date' as const,
      endDate: '2026-03-05',
    };
    actual.upcomingDates = () => [];
    await expect(service.save(edit({ date: ended }))).rejects.toMatchObject({
      details: { code: 'no-upcoming' },
    });
    await expect(
      service.save(edit({ date: { ...ended, endDate: '2025-12-31' } })),
    ).rejects.toMatchObject({ details: { code: 'end-before-start' } });
    expect(budget().schedules).toHaveLength(0);
  });

  it('accepts a recurring start date in the past', async () => {
    const { id } = await service.save(edit({ date: { ...MONTHLY, start: '2026-01-05' } }));
    expect(budget().schedules.some((s) => s.id === id)).toBe(true);
  });

  it('links and unlinks transactions in the save job (12 §3.1)', async () => {
    budget().transactions.push(
      rawTransaction({ id: 't-old', account: 'a1', date: '2026-10-05', amount: -100_000 }),
      rawTransaction({ id: 't-older', account: 'a1', date: '2026-09-05', amount: -100_000 }),
    );
    const { id } = await service.save(edit({ link: ['t-old', 't-older', 't-gone'] }));
    expect((await service.linked(id)).map((m) => m.id)).toEqual(['t-old', 't-older']);
    await service.save(edit({ id, unlink: ['t-older'] }));
    expect((await service.linked(id)).map((m) => m.id)).toEqual(['t-old']);
    expect(budget().transactions.find((t) => t.id === 't-older')?.schedule).toBeNull();
  });

  it("finds matches with the conditions Actual's schedule rule would have (12 §3.1)", async () => {
    budget().transactions.push(
      rawTransaction({
        id: 't-match',
        account: 'a1',
        date: '2026-10-06',
        amount: -100_000,
        payee: 'p-rent',
        notes: 'October ⟦chk 9⟧',
      }),
      rawTransaction({ id: 't-other', account: 'a1', date: '2026-10-06', amount: -5 }),
    );
    const q = {
      accountId: 'a1',
      payee: { kind: 'existing', id: 'p-rent' },
      date: { ...MONTHLY, start: '2026-09-05' },
      amountOp: 'is',
      amount: -100_000,
    } as const;
    expect(await service.matches(q)).toEqual([
      {
        id: 't-match',
        accountId: 'a1',
        date: '2026-10-06',
        payeeId: 'p-rent',
        notes: 'October',
        amount: -100_000,
      },
    ]);
    expect(actual.matchConditions.at(-1)).toEqual([
      { op: 'is', field: 'payee', value: 'p-rent' },
      { op: 'is', field: 'account', value: 'a1' },
      { op: 'isapprox', field: 'date', value: { ...MONTHLY, start: '2026-09-05' } },
      { op: 'is', field: 'amount', value: -100_000 },
    ]);
    await service.matches({ ...q, amountOp: 'isbetween', amount2: -90_000 });
    expect(actual.matchConditions.at(-1)?.at(-1)).toEqual({
      op: 'isbetween',
      field: 'amount',
      value: { num1: -100_000, num2: -90_000 },
    });
    expect(await service.matches({ ...q, payee: { kind: 'new', name: 'Nobody' } })).toEqual([]);
    actual.missingHandlers.add('make-filters-from-conditions');
    expect(await service.matches(q)).toBeNull();
  });

  it('enters an occurrence approved and linked, then skips to the next date (12 §6 criterion 4)', async () => {
    const { id } = await service.save(edit());
    const { ids } = await service.enterNow([id]);
    const [row] = await actual.getTransactionRows({ ids });
    expect(row).toMatchObject({
      date: '2026-11-05',
      amount: -100_000,
      payee: 'p-rent',
      category: 'c-rent',
      schedule: id,
      cleared: false,
    });
    expect(decode(row?.notes)).toMatchObject({ notes: 'Rent #home', needsReview: false });
    expect(budget().schedules.find((s) => s.id === id)?.nextDate).toBe('2026-12-05');
  });

  it('deletes a Once schedule after entering it', async () => {
    const { id } = await service.save(edit({ date: '2026-11-05' }));
    await service.enterNow([id]);
    expect(budget().schedules.some((s) => s.id === id)).toBe(false);
  });

  it('enters a split schedule as a split', async () => {
    const { id } = await service.save(
      edit({
        categoryId: null,
        lines: [
          { amount: -60_000, transferAccountId: null, categoryId: 'c-rent', notes: 'rent' },
          { amount: -40_000, transferAccountId: 'a2', categoryId: null, notes: 'save' },
        ],
      }),
    );
    const [s] = await service.list('a1');
    expect(s?.subtransactions.map((l) => [l.amount, l.transferAccountId])).toEqual([
      [-60_000, null],
      [-40_000, 'a2'],
    ]);
    const { ids } = await service.enterNow([id]);
    const lines = await actual.getTransactionRows({ parentIds: ids });
    expect(lines.map((l) => l.amount).sort()).toEqual([-40_000, -60_000].sort());
  });

  it('skips without entering; Once is unaffected', async () => {
    const { id } = await service.save(edit());
    await service.skip([id]);
    expect(budget().schedules.find((s) => s.id === id)?.nextDate).toBe('2026-12-05');
    expect(budget().transactions).toHaveLength(0);
    const once = await service.save(edit({ date: '2026-11-05' }));
    await service.skip([once.id]);
    expect(budget().schedules.find((s) => s.id === once.id)?.nextDate).toBe('2026-11-05');
    expect(await service.support()).toEqual({ skip: true, upcomingDates: true });
  });

  it('refuses to skip recurring schedules when Actual lacks the handler', async () => {
    const { id } = await service.save(edit());
    actual.missingHandlers.add('schedule/skip-next-date');
    await expect(service.skip([id])).rejects.toMatchObject({
      code: 'actual',
      details: { code: 'internal-handler-unavailable' },
    });
    expect(budget().schedules.find((s) => s.id === id)?.nextDate).toBe('2026-11-05');
  });

  it('moves schedules, but not a transfer into its own account', async () => {
    const { id } = await service.save(edit());
    await service.moveToAccount([id], 'a2');
    expect(budget().schedules.find((s) => s.id === id)?.account).toBe('a2');
    const transfer = await service.save(edit({ payee: { kind: 'transfer', accountId: 'a2' } }));
    await expect(service.moveToAccount([transfer.id], 'a2')).rejects.toMatchObject({
      details: { code: 'transfer-into-target' },
    });
  });

  it('refuses to move a split with a transfer line into the target', async () => {
    const { id } = await service.save(
      edit({
        categoryId: null,
        lines: [
          { amount: -60_000, transferAccountId: null, categoryId: 'c-rent', notes: '' },
          { amount: -40_000, transferAccountId: 'a2', categoryId: null, notes: '' },
        ],
      }),
    );
    await expect(service.moveToAccount([id], 'a2')).rejects.toMatchObject({
      details: { code: 'transfer-into-target' },
    });
    expect(budget().schedules.find((s) => s.id === id)?.account).toBe('a1');
  });

  it('drafts a recurring schedule from the first occurrence after today, writing nothing (12 §4)', async () => {
    budget().transactions.push(
      rawTransaction({
        id: 't1',
        account: 'a1',
        date: '2026-09-12',
        amount: -2500,
        payee: 'p-rent',
        category: 'c-rent',
        notes: 'gym #fitness ⟦chk 4⟧ #needs-review',
      }),
    );
    actual.upcomingDates = () => ['2026-10-12', '2026-11-12', '2026-12-12'];
    expect(await service.draftFromTransaction('t1', 'recurring')).toEqual({
      accountId: 'a1',
      date: { frequency: 'monthly', interval: 1, start: '2026-11-12', endMode: 'never' },
      payeeId: 'p-rent',
      transferAccountId: null,
      categoryId: 'c-rent',
      notes: 'gym #fitness',
      amount: -2500,
      subtransactions: [],
    });
    expect(budget().schedules).toHaveLength(0);
  });

  it('moves a future transaction to the scheduler as Once, deleting it only on save', async () => {
    budget().transactions.push(
      rawTransaction({
        id: 't2',
        account: 'a1',
        date: '2026-10-21',
        amount: -500,
        payee: 'p-rent',
      }),
      rawTransaction({ id: 't3', account: 'a1', date: '2026-10-20', amount: -500 }),
    );
    const draft = await service.draftFromTransaction('t2', 'move');
    expect(draft.date).toBe('2026-10-21');
    expect(budget().transactions.some((t) => t.id === 't2')).toBe(true);
    await service.save(edit({ date: draft.date, amount: draft.amount, moveFrom: 't2' }));
    expect((await service.list('a1'))[0]).toMatchObject({
      frequency: 'Once',
      nextDate: '2026-10-21',
    });
    expect(budget().transactions.some((t) => t.id === 't2')).toBe(false);
    await expect(service.draftFromTransaction('t3', 'move')).rejects.toMatchObject({
      details: { code: 'date-not-future' },
    });
    await expect(service.save(edit({ date: '2026-10-21', moveFrom: 't2' }))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('previews the next occurrences from Actual (12 §3.1)', async () => {
    actual.upcomingDates = (_c, count) =>
      Array.from({ length: count }, (_, i) => `2026-${String(11 + i).padStart(2, '0')}-05`);
    expect(await service.preview({ date: { ...MONTHLY }, count: 2 })).toEqual([
      '2026-11-05',
      '2026-12-05',
    ]);
    expect(await service.preview({ date: '2026-10-25', count: 5 })).toEqual(['2026-10-25']);
    expect(await service.preview({ date: '2026-10-19', count: 5 })).toEqual([]);
  });

  it('drafts the lines of a split, transfers by their payee (12 §4)', async () => {
    budget().transactions.push(
      rawTransaction({
        id: 't-split',
        account: 'a1',
        date: '2026-09-12',
        amount: -100_000,
        payee: 'p-rent',
        isParent: true,
        subtransactions: [
          rawTransaction({
            id: 't-split-1',
            account: 'a1',
            amount: -60_000,
            category: 'c-rent',
            notes: 'rent ⟦chk 7⟧',
            parentId: 't-split',
          }),
          rawTransaction({
            id: 't-split-2',
            account: 'a1',
            amount: -40_000,
            payee: 'p-a2',
            parentId: 't-split',
          }),
        ],
      }),
    );
    const draft = await service.draftFromTransaction('t-split', 'recurring');
    expect(draft.categoryId).toBeNull();
    expect(draft.subtransactions).toEqual([
      {
        amount: -60_000,
        method: 'fixed-amount',
        payeeId: null,
        transferAccountId: null,
        categoryId: 'c-rent',
        notes: 'rent',
      },
      {
        amount: -40_000,
        method: 'fixed-amount',
        payeeId: 'p-a2',
        transferAccountId: 'a2',
        categoryId: null,
        notes: '',
      },
    ]);
  });

  it('refuses to draft from a transaction that is gone or a split line', async () => {
    await expect(service.draftFromTransaction('t-gone', 'recurring')).rejects.toMatchObject({
      code: 'not-found',
    });
    budget().transactions.push(
      rawTransaction({ id: 't-line', account: 'a1', amount: -5, parentId: 't-parent' }),
    );
    await expect(service.draftFromTransaction('t-line', 'recurring')).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it("drafts from the transaction's day a month on when Actual has no dates (12 §4)", async () => {
    budget().transactions.push(
      rawTransaction({ id: 't1', account: 'a1', date: '2026-08-31', amount: -2500 }),
    );
    const start = async (): Promise<unknown> => {
      const { date } = await service.draftFromTransaction('t1', 'recurring');
      return typeof date === 'string' ? date : date.start;
    };
    // September 30 is before today (October 20); the 31st is clamped to each month's last day.
    actual.missingHandlers.add('schedule/get-upcoming-dates');
    expect(await start()).toBe('2026-10-31');
    actual.missingHandlers.clear();
    actual.upcomingDates = () => ['2026-09-30'];
    expect(await start()).toBe('2026-10-31');
    actual.upcomingDates = () => {
      throw new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER });
    };
    expect(await start()).toBe('2026-10-31');
    actual.upcomingDates = () => {
      throw new Error('boom');
    };
    await expect(start()).rejects.toThrow('boom');
  });

  it("deletes a moved split's transfer mirrors on save", async () => {
    budget().transactions.push(
      rawTransaction({
        id: 't-split',
        account: 'a1',
        date: '2026-10-25',
        amount: -100_000,
        isParent: true,
        subtransactions: [
          rawTransaction({
            id: 't-split-1',
            account: 'a1',
            amount: -60_000,
            category: 'c-rent',
            parentId: 't-split',
          }),
          rawTransaction({
            id: 't-split-2',
            account: 'a1',
            amount: -40_000,
            payee: 'p-a2',
            transferId: 't-mirror',
            parentId: 't-split',
          }),
        ],
      }),
      rawTransaction({
        id: 't-mirror',
        account: 'a2',
        date: '2026-10-25',
        amount: 40_000,
        payee: 'p-a1',
        transferId: 't-split-2',
      }),
    );
    await service.save(
      edit({
        date: '2026-10-25',
        categoryId: null,
        lines: [
          { amount: -60_000, transferAccountId: null, categoryId: 'c-rent', notes: '' },
          { amount: -40_000, transferAccountId: 'a2', categoryId: null, notes: '' },
        ],
        moveFrom: 't-split',
      }),
    );
    expect(budget().transactions).toEqual([]);
  });

  it('refuses a missing account, schedule, payee or transfer account', async () => {
    await expect(service.save(edit({ accountId: 'gone' }))).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(service.save(edit({ id: 'gone' }))).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(
      service.save(edit({ payee: { kind: 'existing', id: 'gone' } })),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      service.save(edit({ payee: { kind: 'transfer', accountId: 'gone' } })),
    ).rejects.toMatchObject({ details: { code: 'invalid-transfer' } });
    expect(budget().schedules).toHaveLength(0);
  });

  it('refuses a split that transfers, or whose lines transfer to itself or nowhere', async () => {
    const line = { amount: -100_000, categoryId: null, notes: '' };
    await expect(
      service.save(
        edit({
          payee: { kind: 'transfer', accountId: 'a2' },
          lines: [{ ...line, transferAccountId: null }],
        }),
      ),
    ).rejects.toMatchObject({ details: { code: 'split-transfer' } });
    await expect(
      service.save(edit({ lines: [{ ...line, transferAccountId: 'a1' }] })),
    ).rejects.toMatchObject({ details: { code: 'transfer-to-self' } });
    await expect(
      service.save(edit({ lines: [{ ...line, transferAccountId: 'gone' }] })),
    ).rejects.toMatchObject({ details: { code: 'invalid-transfer' } });
  });

  it('refuses a schedule whose rule is gone', async () => {
    const { id } = await service.save(edit());
    const ruleId = budget().schedules.find((s) => s.id === id)?.ruleId;
    budget().rules = budget().rules.filter((r) => r.id !== ruleId);
    await expect(service.save(edit({ id }))).rejects.toMatchObject({ code: 'internal' });
  });

  it("keeps an unchanged pattern's date, with its arrays, when editing", async () => {
    const date = {
      ...MONTHLY,
      patterns: [
        { type: 'day', value: 5 },
        { type: 'day', value: 20 },
      ],
    };
    const { id } = await service.save(edit({ date }));
    const update = vi.spyOn(actual, 'updateSchedule');
    await service.save(edit({ id, date: structuredClone(date), notes: 'changed' }));
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('date');
  });

  it('saves a recurring date without checking it when Actual has no dates', async () => {
    actual.upcomingDates = () => [];
    actual.missingHandlers.add('schedule/get-upcoming-dates');
    await service.save(edit());
    actual.missingHandlers.clear();
    actual.upcomingDates = () => {
      throw new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER });
    };
    await service.save(edit({ name: 'Second' }));
    expect(budget().schedules).toHaveLength(2);
    actual.upcomingDates = () => {
      throw new Error('boom');
    };
    await expect(service.save(edit({ name: 'Third' }))).rejects.toThrow('boom');
  });

  it('finds matches for a transfer or a new payee, and passes on errors other than a missing handler', async () => {
    const q = {
      accountId: 'a1',
      payee: { kind: 'transfer', accountId: 'a2' },
      date: { ...MONTHLY },
      amountOp: 'is',
      amount: -100_000,
    } as const;
    await service.matches(q);
    expect(actual.matchConditions.at(-1)?.[0]).toEqual({ op: 'is', field: 'payee', value: 'p-a2' });
    await service.matches({ ...q, payee: { kind: 'new', name: ' landlord ' } });
    expect(actual.matchConditions.at(-1)?.[0]).toEqual({
      op: 'is',
      field: 'payee',
      value: 'p-rent',
    });
    vi.spyOn(actual, 'scheduleMatches').mockRejectedValueOnce(new Error('boom'));
    await expect(service.matches(q)).rejects.toThrow('boom');
  });

  it('deletes schedules, passing over ids that are gone', async () => {
    const { id } = await service.save(edit());
    await service.delete([id, 'gone']);
    expect(budget().schedules).toHaveLength(0);
  });

  it('enters nothing for a schedule that is gone, completed or in a missing account', async () => {
    const { id } = await service.save(edit());
    const raw = budget().schedules.find((s) => s.id === id);
    if (!raw) throw new Error('no schedule');
    raw.account = 'gone';
    expect(await service.enterNow([id, 'gone'])).toEqual({ ids: [] });
    raw.account = 'a1';
    raw.completed = true;
    expect(await service.enterNow([id])).toEqual({ ids: [] });
    expect(budget().transactions).toHaveLength(0);
  });

  it('enters a recurring occurrence without skipping when Actual lacks the handler', async () => {
    const { id } = await service.save(edit());
    actual.missingHandlers.add('schedule/skip-next-date');
    await service.enterNow([id]);
    expect(budget().schedules.find((s) => s.id === id)?.nextDate).toBe('2026-11-05');
    actual.missingHandlers.clear();
    vi.spyOn(actual, 'skipNextDate').mockRejectedValueOnce(
      new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }),
    );
    await service.enterNow([id]);
    expect(budget().transactions).toHaveLength(2);
    vi.spyOn(actual, 'skipNextDate').mockRejectedValueOnce(new Error('boom'));
    await expect(service.enterNow([id])).rejects.toThrow('boom');
  });

  it('reads a schedule with no amount as zero', async () => {
    budget().schedules.push({
      id: 's-bare',
      account: 'a1',
      payee: null,
      completed: false,
      nextDate: '2026-11-01',
      amount: null,
      date: '2026-11-01',
    });
    expect((await service.list('all'))[0]).toMatchObject({ id: 's-bare', amount: 0 });
  });

  it('refuses a move into a closed or missing account', async () => {
    const { id } = await service.save(edit());
    await expect(service.moveToAccount([id], 'gone')).rejects.toMatchObject({
      code: 'not-found',
    });
    budget().accounts.push({
      id: 'a3',
      name: 'Old',
      offbudget: false,
      closed: true,
      sortOrder: 3,
      accountGroupId: null,
    });
    await expect(service.moveToAccount([id], 'a3')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('needs an open budget', async () => {
    await conn.closeBudget(true);
    expect(() => service.list('a1')).toThrow('No budget is open.');
    expect(() => service.save(edit())).toThrow('No budget is open.');
  });

  it('rejects every write offline (03 §5)', async () => {
    const { id } = await service.save(edit());
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    await expect(service.save(edit())).rejects.toMatchObject({ code: 'offline' });
    await expect(service.enterNow([id])).rejects.toMatchObject({ code: 'offline' });
    await expect(service.skip([id])).rejects.toMatchObject({ code: 'offline' });
    await expect(service.delete([id])).rejects.toMatchObject({ code: 'offline' });
  });
});
