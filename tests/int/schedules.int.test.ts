// Schedules against a real server (12 §6): the 13 frequencies round-trip and their
// occurrences come from Actual; Actual's own schedule service posts a missed schedule once, with the
// template (splits too, and a transfer with its mirror); a custom pattern survives an edit; every Schedule
// dialog field round-trips; Find matching uses Actual's own conditions, and Save links and unlinks; Enter
// now and Skip; a matching entry is linked and restored; rules don't re-run on updates; drafts from
// register transactions; the write gate.
//
// The process runs in America/Los_Angeles, west of UTC, so a mix-up between a local and a UTC day in
// Actual or the app shows on every machine. (Up to 26.10.0 Actual dated a new schedule's first occurrence
// from a UTC midnight; 26.11.0 uses the local day.)
process.env['TZ'] = 'America/Los_Angeles';

import { APP_NAME } from '@shared/app';
import { addDays, today } from '@shared/dates';
import type { Frequency, ISODate, RecurConfig } from '@shared/domain/types';
import { decode } from '@shared/metadata/notes-codec';
import type { CommitEdit, ScheduleEdit } from '@shared/rpc/host-api';
import { FREQUENCIES, toScheduleDate } from '@shared/schedule/frequency';
import { occurrencesBefore } from '@shared/schedule/occurrences';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { SchedulesService } from '../../src/host/services/schedules';
import { installNetworkSwitch, type NetworkSwitch } from './network';
import {
  bootstrap,
  HAS_SERVER,
  hostStack,
  PASSWORD,
  SERVER,
  tempDir,
  type HostStack,
} from './setup';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAS_SERVER)('schedules against a real server (12 §6)', () => {
  const realTz = process.env['TZ'];
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let budgetId: string;
  let host: HostStack;
  let checking: string;
  let savings: string;
  let rent: string;
  let food: string;
  let fun: string;
  let landlord: string;
  let gym: string;
  const day = (n: number): ISODate => addDays(today(new Date()), n);
  const every = (frequency: Frequency, start: ISODate): ISODate | RecurConfig =>
    toScheduleDate(frequency, start);

  type Row = {
    id: string;
    account: string;
    amount: number;
    date: string;
    notes: string | null;
    payee: string | null;
    category: string | null;
    cleared: boolean;
    schedule: string | null;
    transfer_id: string | null;
    is_parent: boolean;
    parent_id: string | null;
  };
  const rows = async (filter: Record<string, unknown>): Promise<Row[]> =>
    (
      (await fixtures.api.aqlQuery(
        fixtures.api
          .q('transactions')
          .filter(filter)
          .select([
            'id',
            'account',
            'amount',
            'date',
            'notes',
            'payee',
            'category',
            'cleared',
            'schedule',
            'transfer_id',
            'is_parent',
            'parent_id',
          ])
          .options({ splits: 'all' }),
      )) as { data: Row[] }
    ).data;
  const raw = async (id: string) => (await actual.getSchedules()).find((s) => s.id === id);
  const ruleOf = async (id: string) => {
    const s = await raw(id);
    return (await actual.getRules()).find((r) => r.id === s?.ruleId);
  };

  const edit = (e: Partial<ScheduleEdit>): ScheduleEdit => ({
    name: '',
    accountId: checking,
    date: every('Monthly', day(1)),
    payee: { kind: 'existing', id: landlord },
    categoryId: rent,
    notes: 'Rent #home',
    amountOp: 'is',
    amount: -100_000,
    postsTransaction: true,
    ...e,
  });
  const commit = (e: Partial<CommitEdit>): CommitEdit => ({
    accountId: checking,
    date: day(0),
    amount: -1000,
    payee: { kind: 'none' },
    categoryId: null,
    notes: '',
    checkNumber: null,
    needsReview: false,
    cleared: 'U',
    ...e,
  });

  async function device(name: string): Promise<HostStack> {
    const stack = hostStack(actual, join(dir, name), { probe: (url) => net.probe(url) });
    await stack.connection.connect(SERVER, PASSWORD, false);
    await stack.connection.openBudget(budgetId);
    return stack;
  }

  /** Waits for Actual's schedule service, which runs fire-and-forget after the sync (12 §2). */
  async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const v = await read();
      if (done(v) || Date.now() > deadline) return v;
      await sleep(250);
    }
  }

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    token = await loginWithPassword(SERVER, PASSWORD);
    budgetId =
      (
        await fixtures.createServerBudget(
          SERVER,
          token,
          `${APP_NAME} schedules ${String(Date.now())}`,
        )
      ).cloudFileId ?? '';
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, budgetId);
    });
    host = await device('a');
    checking = (
      await host.accounts.create({
        name: 'Checking',
        onBudget: true,
        balance: 0,
      })
    ).id;
    savings = (
      await host.accounts.create({
        name: 'Savings',
        onBudget: true,
        balance: 0,
      })
    ).id;
    const group = await host.categories.createGroup('Bills');
    rent = (await host.categories.create({ groupId: group.id, name: 'Rent' })).id;
    food = (await host.categories.create({ groupId: group.id, name: 'Food' })).id;
    fun = (await host.categories.create({ groupId: group.id, name: 'Fun' })).id;
    landlord = await host.queue.run('payee', () => actual.createPayee('Landlord'), {
      kind: 'write',
    });
    gym = await host.queue.run('payee', () => actual.createPayee('Gym'), { kind: 'write' });
  });

  afterAll(async () => {
    host.connection.dispose();
    for (const c of cleanup.reverse()) await c();
    process.env['TZ'] = realTz;
  });

  it('round-trips the 13 frequencies, with Actual’s occurrence dates (criterion 1)', async () => {
    const from = day(1);
    for (const frequency of FREQUENCIES) {
      const { id } = await host.schedules.save(edit({ date: every(frequency, from) }));
      const shown = (await host.schedules.list(checking)).find((s) => s.id === id);
      expect(shown?.frequency, frequency).toBe(frequency);
      expect(shown?.nextDate, frequency).toBe(from);
      const stored = (await raw(id))?.date as ISODate | RecurConfig;
      const preview = await host.schedules.preview({ date: stored, count: 5 });
      // Once is a plain date; the others' occurrences are Actual's own.
      expect(preview, frequency).toEqual(
        frequency === 'Once' ? [from] : await actual.getUpcomingDates(stored, 5),
      );
      expect(preview[0], frequency).toBe(from);
      await host.schedules.delete([id]);
    }
  });

  it('computes occurrences as Actual does, for the overdue ones its handler can’t list (12 §5)', async () => {
    // Started in the past, so counts and phases run from before today, as an overdue schedule's do.
    const configs: RecurConfig[] = [
      ...FREQUENCIES.filter((f) => f !== 'Once').map((f) => every(f, day(-45)) as RecurConfig),
      { frequency: 'monthly', interval: 1, start: '2026-01-31', endMode: 'never' },
      { frequency: 'yearly', interval: 1, start: '2024-02-29', endMode: 'never' },
      { frequency: 'daily', interval: 3, start: day(-10), endMode: 'never' },
      {
        frequency: 'monthly',
        interval: 1,
        start: '2026-01-01',
        endMode: 'never',
        patterns: [
          { type: 'TU', value: 2 },
          { type: 'FR', value: -1 },
        ],
      },
      {
        frequency: 'monthly',
        interval: 1,
        start: '2026-01-01',
        endMode: 'after_n_occurrences',
        endOccurrences: 30,
        patterns: [
          { type: 'day', value: 1 },
          { type: 'MO', value: 1 },
        ],
      },
      {
        frequency: 'weekly',
        interval: 1,
        start: day(-20),
        endMode: 'on_date',
        endDate: day(28),
      },
      {
        frequency: 'monthly',
        interval: 1,
        start: '2026-02-28',
        endMode: 'never',
        skipWeekend: true,
        weekendSolveMode: 'after',
      },
      {
        frequency: 'monthly',
        interval: 1,
        start: '2026-02-28',
        endMode: 'never',
        skipWeekend: true,
        weekendSolveMode: 'before',
      },
    ];
    // The port's dates from today on must be the handler's.
    const far = day(30 * 366);
    for (const config of configs) {
      const actuals = await host.schedules.preview({ date: config, count: 6 });
      expect(occurrencesBefore(config, far, day(0)).slice(0, 6), JSON.stringify(config)).toEqual(
        actuals,
      );
    }
  });

  it('Actual’s service posts a missed and a due schedule once, with its template (criteria 2, 5)', async () => {
    // A repeating schedule's first occurrence is today or later (26.11.0), so the missed one is a Once
    // dated yesterday. The app's clock is yesterday when it saves it, so it passes the "not before today"
    // check. The others repeat monthly from today, so they are due.
    const yesterday = new SchedulesService(actual, host.queue, host.connection, () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    });
    const missed = await yesterday.save(
      edit({ date: every('Once', day(-1)), notes: 'Late fee', amount: -2500 }),
    );
    const plain = await host.schedules.save(edit({ date: every('Monthly', day(0)) }));
    const split = await host.schedules.save(
      edit({
        date: every('Monthly', day(0)),
        payee: { kind: 'existing', id: gym },
        categoryId: null,
        notes: 'Gym',
        amount: -3000,
        lines: [
          { amount: -1000, transferAccountId: null, categoryId: food, notes: 'shake' },
          { amount: -2000, transferAccountId: null, categoryId: fun, notes: '' },
        ],
      }),
    );
    const transfer = await host.schedules.save(
      edit({
        date: every('Monthly', day(0)),
        payee: { kind: 'transfer', accountId: savings },
        categoryId: null,
        notes: 'Save',
        amount: -5000,
      }),
    );
    expect((await raw(missed.id))?.nextDate).toBe(day(-1));
    expect((await raw(plain.id))?.nextDate).toBe(day(0));

    // A device with a fresh cache: its first sync of the day runs Actual's service. Saving the
    // schedules may already have run it on this device (12 §2); either way each occurrence posts once.
    await host.connection.syncNow();
    host.connection.dispose();
    host = await device('b');
    const late = await waitFor(
      () => rows({ schedule: missed.id }),
      (r) => r.length > 0,
    );
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ date: day(-1), amount: -2500, cleared: false });
    const posted = await waitFor(
      () => rows({ schedule: plain.id }),
      (r) => r.length > 0,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      date: day(0),
      category: rent,
      cleared: false,
      amount: -100_000,
    });
    expect(decode(posted[0]?.notes)).toEqual({
      notes: 'Rent #home',
      checkNumber: null,
      needsReview: true,
    });
    const [shown] = await host.read
      .transactions(checking)
      .then((ts) => ts.filter((t) => t.scheduleId === plain.id));
    expect(shown?.errorLevel).toBe('forReview');
    // The post pays today's occurrence; Actual moves next_date past it on a later day.
    expect((await raw(plain.id))?.nextDate).toBe(day(0));

    // Criterion 5: a split schedule posts as a split with the template's lines.
    const parent = (
      await waitFor(
        () => rows({ schedule: split.id }),
        (r) => r.some((x) => x.is_parent),
      )
    ).find((r) => r.is_parent);
    expect(parent?.amount).toBe(-3000);
    const lines = await rows({ parent_id: parent?.id });
    expect(lines.map((l) => [l.amount, l.category]).sort()).toEqual(
      [
        [-1000, food],
        [-2000, fun],
      ].sort(),
    );

    // A transfer schedule posts with its mirror in the other account.
    const side = (
      await waitFor(
        () => rows({ schedule: transfer.id, account: checking }),
        (r) => r[0]?.transfer_id != null,
      )
    )[0];
    expect(side).toMatchObject({ amount: -5000 });
    expect(side?.transfer_id).not.toBeNull();
    const [mirror] = await rows({ id: side?.transfer_id });
    expect(mirror).toMatchObject({ account: savings, amount: 5000 });

    // Re-opening the same day posts nothing more.
    await host.connection.closeBudget(false);
    await host.connection.openBudget(budgetId);
    await sleep(3000);
    expect(await rows({ schedule: plain.id })).toHaveLength(1);
    expect(await rows({ schedule: missed.id })).toHaveLength(1);
  });

  it('keeps a custom pattern, next_date and other actions when its payee is edited (criterion 3)', async () => {
    const config = { frequency: 'weekly', interval: 3, start: day(2), endMode: 'never' };
    const id = await host.queue.run(
      'custom',
      () =>
        fixtures.api.createSchedule({
          name: 'Custom web schedule',
          posts_transaction: false,
          payee: landlord,
          account: checking,
          amount: -777,
          amountOp: 'isapprox',
          date: config,
        } as never),
      { kind: 'write' },
    );
    const rule = await ruleOf(id);
    if (!rule) throw new Error('no rule');
    const extra = { op: 'set', field: 'cleared', value: true, type: 'boolean' };
    await host.queue.run(
      'rule',
      () => actual.updateRule({ ...rule, actions: [...rule.actions, extra] }),
      {
        kind: 'write',
      },
    );
    await host.schedules.skip([id]);
    const listed = (await host.schedules.list(checking)).find((s) => s.id === id);
    expect(listed).toMatchObject({
      frequency: 'custom',
      postsTransaction: false,
      name: 'Custom web schedule',
    });
    const skippedTo = listed?.nextDate;
    expect(skippedTo).not.toBe(day(2));
    // The dialog sends the schedule's own values back (12 §3.1).
    await host.schedules.save(
      edit({
        id,
        name: listed?.name ?? '',
        date: listed?.raw.date as RecurConfig,
        payee: { kind: 'existing', id: gym },
        amountOp: 'isapprox',
        amount: -777,
        postsTransaction: false,
      }),
    );
    const after = await raw(id);
    expect(after?.payee).toBe(gym);
    expect(after?.date).toMatchObject(config);
    expect(after?.nextDate).toBe(skippedTo);
    expect(after?.postsTransaction).toBe(false);
    expect(after?.name).toBe('Custom web schedule');
    const actions = (await ruleOf(id))?.actions ?? [];
    expect(actions).toContainEqual(expect.objectContaining({ op: 'link-schedule', value: id }));
    expect(actions).toContainEqual(expect.objectContaining({ op: 'set', field: 'cleared' }));
    await host.schedules.delete([id]);
  });

  it('round-trips every Schedule dialog field through Actual (criterion 7)', async () => {
    const config: RecurConfig = {
      frequency: 'monthly',
      interval: 2,
      start: day(3),
      endMode: 'after_n_occurrences',
      endOccurrences: 6,
      patterns: [
        { type: 'day', value: 15 },
        { type: 'day', value: -1 },
        { type: 'FR', value: -1 },
      ],
      skipWeekend: true,
      weekendSolveMode: 'before',
    };
    const { id } = await host.schedules.save(
      edit({
        name: 'Dialog schedule',
        date: config,
        amountOp: 'isbetween',
        amount: -90_000,
        amount2: -110_000,
        postsTransaction: false,
      }),
    );
    expect(await raw(id)).toMatchObject({
      name: 'Dialog schedule',
      postsTransaction: false,
      amountOp: 'isbetween',
      amount: { num1: -90_000, num2: -110_000 },
      date: config,
    });
    const listed = (await host.schedules.list(checking)).find((s) => s.id === id);
    expect(listed).toMatchObject({ amount: -90_000, amount2: -110_000, frequency: 'custom' });
    expect(await host.schedules.preview({ date: config, count: 5 })).toEqual(
      await actual.getUpcomingDates(config, 5),
    );
    expect(listed?.nextDate).toBe((await actual.getUpcomingDates(config, 1))[0]);

    const onDate: RecurConfig = { ...config, endMode: 'on_date', endDate: day(200) };
    await host.schedules.save(
      edit({
        id,
        name: '',
        date: onDate,
        amountOp: 'isapprox',
        amount: -5000,
        postsTransaction: true,
      }),
    );
    expect(await raw(id)).toMatchObject({
      name: null,
      postsTransaction: true,
      amountOp: 'isapprox',
      amount: -5000,
      date: onDate,
    });

    // A taken name, and a recurrence with no dates left, are refused before anything is written.
    await host.schedules.save(edit({ id, name: 'Taken' }));
    await expect(host.schedules.save(edit({ name: 'Taken' }))).rejects.toMatchObject({
      details: { code: 'name-taken' },
    });
    const ended: RecurConfig = {
      ...config,
      start: day(-90),
      endMode: 'on_date',
      endDate: day(-30),
    };
    await expect(host.schedules.save(edit({ date: ended }))).rejects.toMatchObject({
      details: { code: 'no-upcoming' },
    });
    expect((await actual.getSchedules()).filter((s) => s.name === 'Taken')).toHaveLength(1);
    await host.schedules.delete([id]);
  });

  it("finds matches with Actual's conditions; Save links and unlinks them (criterion 8)", async () => {
    // Weekly from 20 days ago: occurrences at -20, -13, -6, +1.
    const config = every('Weekly', day(-20)) as RecurConfig;
    const near = await host.transactions.commit(
      commit({ date: day(-12), amount: -6543, payee: { kind: 'existing', id: gym } }),
    );
    const far = await host.transactions.commit(
      commit({ date: day(-9), amount: -6543, payee: { kind: 'existing', id: gym } }),
    );
    const otherAmount = await host.transactions.commit(
      commit({ date: day(-13), amount: -6544, payee: { kind: 'existing', id: gym } }),
    );
    const q = {
      accountId: checking,
      payee: { kind: 'existing', id: gym },
      date: config,
      amountOp: 'is',
      amount: -6543,
    } as const;
    const found = (await host.schedules.matches(q))?.map((m) => m.id) ?? [];
    expect(found).toContain(near.id);
    expect(found).not.toContain(far.id);
    expect(found).not.toContain(otherAmount.id);
    const approx = (await host.schedules.matches({ ...q, amountOp: 'isapprox' }))?.map((m) => m.id);
    expect(approx).toContain(otherAmount.id);

    const { id } = await host.schedules.save(
      edit({
        date: config,
        payee: { kind: 'existing', id: gym },
        amount: -6543,
        postsTransaction: false,
        link: [near.id],
      }),
    );
    expect((await rows({ id: near.id }))[0]?.schedule).toBe(id);
    expect((await host.schedules.linked(id)).map((m) => m.id)).toEqual([near.id]);
    // Linked rows aren't offered again.
    expect((await host.schedules.matches(q))?.map((m) => m.id)).not.toContain(near.id);
    await host.schedules.save(
      edit({
        id,
        date: config,
        payee: { kind: 'existing', id: gym },
        amount: -6543,
        postsTransaction: false,
        unlink: [near.id],
      }),
    );
    expect((await rows({ id: near.id }))[0]?.schedule).toBeNull();
    expect(await host.schedules.linked(id)).toEqual([]);
    await host.schedules.delete([id]);
  });

  it('Enter now adds one approved, linked transaction and advances; Skip advances alone (criterion 4)', async () => {
    const { id } = await host.schedules.save(
      edit({
        date: every('Monthly', day(5)),
        payee: { kind: 'existing', id: gym },
        amount: -4444,
        notes: 'Now',
      }),
    );
    const config = (await raw(id))?.date;
    const [first, second, third] = await actual.getUpcomingDates(config, 3);
    expect(first).toBe(day(5));
    const { ids } = await host.schedules.enterNow([id]);
    expect(ids).toHaveLength(1);
    const linked = await rows({ schedule: id });
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ id: ids[0], date: day(5), amount: -4444, category: rent });
    expect(decode(linked[0]?.notes)).toMatchObject({
      notes: 'Now',
      needsReview: false,
    });
    expect((await raw(id))?.nextDate).toBe(second);
    await host.schedules.skip([id]);
    expect((await raw(id))?.nextDate).toBe(third);
    expect(await rows({ schedule: id })).toHaveLength(1);
  });

  it('links a matching entry and keeps what the user entered; updates don’t re-run rules (§2)', async () => {
    const { id } = await host.schedules.save(
      edit({
        date: every('Monthly', day(3)),
        payee: { kind: 'existing', id: landlord },
        amount: -4321,
        categoryId: food,
        notes: 'scheduled #Scheduled',
      }),
    );
    const result = await host.transactions.commit(
      commit({
        date: day(2),
        amount: -4321,
        payee: { kind: 'existing', id: landlord },
        categoryId: fun,
        notes: 'mine #own #Own',
        checkNumber: '5',
      }),
    );
    expect(result.matched).toEqual({ scheduleId: id, payeeId: landlord });
    const [row] = await rows({ id: result.id });
    expect(row).toMatchObject({ schedule: id, category: fun });
    expect(decode(row?.notes)).toEqual({
      notes: 'mine #own #Own',
      checkNumber: '5',
      needsReview: false,
    });

    // An update that makes another transaction match isn't linked: Actual runs rules only on create.
    const other = await host.transactions.commit(
      commit({
        date: day(2),
        amount: -4321,
        payee: { kind: 'existing', id: gym },
        categoryId: fun,
      }),
    );
    await host.transactions.commit(
      commit({
        id: other.id,
        date: day(2),
        amount: -4321,
        payee: { kind: 'existing', id: landlord },
        categoryId: fun,
      }),
    );
    const [updated] = await rows({ id: other.id });
    expect(updated).toMatchObject({ schedule: null, category: fun });
    expect(decode(updated?.notes).needsReview).toBe(false);
  });

  it('drafts schedules from register transactions; Add writes them, Move deletes the original (criterion 9)', async () => {
    const past = await host.transactions.commit(
      commit({
        date: day(-40),
        amount: -2500,
        payee: { kind: 'existing', id: gym },
        categoryId: fun,
        notes: 'monthly',
      }),
    );
    const before = (await actual.getSchedules()).length;
    const recurring = await host.schedules.draftFromTransaction(past.id, 'recurring');
    expect(recurring).toMatchObject({ categoryId: fun, notes: 'monthly', amount: -2500 });
    expect((recurring.date as RecurConfig).start > day(0)).toBe(true);
    expect((await actual.getSchedules()).length).toBe(before);
    const made = await host.schedules.save(
      edit({
        date: recurring.date,
        payee: { kind: 'existing', id: gym },
        categoryId: fun,
        notes: recurring.notes,
        amount: recurring.amount,
      }),
    );
    const s = (await host.schedules.list(checking)).find((x) => x.id === made.id);
    expect(s).toMatchObject({ frequency: 'Monthly', categoryId: fun, notes: 'monthly' });
    expect(await rows({ id: past.id })).toHaveLength(1);

    const future = await host.transactions.commit(
      commit({ date: day(10), amount: -900, payee: { kind: 'existing', id: gym }, notes: 'later' }),
    );
    const move = await host.schedules.draftFromTransaction(future.id, 'move');
    expect(move.date).toBe(day(10));
    expect(await rows({ id: future.id })).toHaveLength(1);
    const moved = await host.schedules.save(
      edit({
        date: move.date,
        payee: { kind: 'existing', id: gym },
        notes: move.notes,
        amount: move.amount,
        moveFrom: future.id,
      }),
    );
    expect((await host.schedules.list(checking)).find((x) => x.id === moved.id)).toMatchObject({
      frequency: 'Once',
      nextDate: day(10),
    });
    expect(await rows({ id: future.id })).toHaveLength(0);
  });

  it('rejects every schedule write while offline (03 §5)', async () => {
    const { id } = await host.schedules.save(edit({ date: every('Monthly', day(20)) }));
    const tx = await host.transactions.commit(commit({ date: day(-1), amount: -321 }));
    net.down();
    await host.connection.syncNow().catch(() => undefined);
    expect(host.connection.state.state).toBe('OfflineReadOnly');
    const writes = [
      () => host.schedules.save(edit({ date: every('Monthly', day(21)) })),
      () => host.schedules.save(edit({ id, date: every('Monthly', day(20)), link: [tx.id] })),
      () => host.schedules.delete([id]),
      () => host.schedules.enterNow([id]),
      () => host.schedules.skip([id]),
      () => host.schedules.moveToAccount([id], savings),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'offline' });
    net.up();
    await host.connection.retry('manual');
    expect(await raw(id)).toBeDefined();
    expect((await rows({ id: tx.id }))[0]?.schedule).toBeNull();
  });
});
