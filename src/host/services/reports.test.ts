// The reports service on the fake API (03 §8 `reports.get`, 15 §6–7): one read job per
// request, strict params, split lines with their parent's payee, transfers by payee, offline reads and no
// writes.
import { DEFAULT_FILTERS } from '@shared/reporting/model';
import type { InflowOutflowReport, NetWorthReport } from '@shared/reporting/result';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../connection';
import { createHandlers, dispatch, type Services } from '../dispatch';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { ReportsService } from './reports';

const CLOCK = { today: '2026-10-20', weekStart: 0 } as const;
const { categories, payees, accounts } = DEFAULT_FILTERS;
const FLOW_FILTERS = { categories, payees, accounts };
const COMPARE_MONTH = { unit: 'month', start: '2026-10-01' } as const;

describe('ReportsService (03 §8, 15 §7)', () => {
  let actual: FakeActual;
  let queue: JobQueue;
  let conn: Connection;
  let reports: ReportsService;

  beforeEach(async () => {
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [
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
          offbudget: true,
          closed: false,
          sortOrder: 2,
          accountGroupId: null,
        },
        {
          id: 'a3',
          name: 'Old',
          offbudget: false,
          closed: true,
          sortOrder: 3,
          accountGroupId: null,
        },
      ],
      groups: [
        {
          id: 'gi',
          name: 'Income',
          isIncome: true,
          hidden: false,
          sortOrder: 0,
          categories: [
            { id: 'ci', name: 'Pay', groupId: 'gi', isIncome: true, hidden: false, sortOrder: 1 },
          ],
        },
        {
          id: 'g1',
          name: 'Bills',
          isIncome: false,
          hidden: false,
          sortOrder: 1,
          categories: [
            { id: 'c1', name: 'Rent', groupId: 'g1', isIncome: false, hidden: false, sortOrder: 1 },
            {
              id: 'c2',
              name: 'Power',
              groupId: 'g1',
              isIncome: false,
              hidden: false,
              sortOrder: 2,
            },
          ],
        },
      ],
      payees: [
        { id: 'p-job', name: 'Job', transferAcct: null },
        { id: 'p-shop', name: 'Shop', transferAcct: null },
        { id: 'p-a1', name: 'Checking', transferAcct: 'a1' },
        { id: 'p-a2', name: 'Savings', transferAcct: 'a2' },
      ],
      transactions: [
        rawTransaction({
          id: 't0',
          account: 'a1',
          date: '2026-09-01',
          amount: 5_000,
          startingBalance: true,
        }),
        rawTransaction({
          id: 't1',
          account: 'a1',
          date: '2026-09-02',
          amount: 10_000,
          payee: 'p-job',
          category: 'ci',
        }),
        {
          ...rawTransaction({
            id: 't2',
            account: 'a1',
            date: '2026-10-02',
            amount: -3_000,
            payee: 'p-shop',
          }),
          isParent: true,
          subtransactions: [
            rawTransaction({
              id: 't2a',
              account: 'a1',
              date: '2026-10-02',
              amount: -2_000,
              category: 'c1',
              parentId: 't2',
            }),
            rawTransaction({
              id: 't2b',
              account: 'a1',
              date: '2026-10-02',
              amount: -1_000,
              category: 'c2',
              parentId: 't2',
            }),
          ],
        },
        rawTransaction({
          id: 't3',
          account: 'a1',
          date: '2026-10-05',
          amount: -4_000,
          payee: 'p-a2',
        }),
        rawTransaction({
          id: 't4',
          account: 'a2',
          date: '2026-10-05',
          amount: 4_000,
          payee: 'p-a1',
        }),
        rawTransaction({
          id: 't5',
          account: 'a3',
          date: '2026-10-06',
          amount: -999,
          category: 'c1',
        }),
      ],
    });
    queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    reports = new ReportsService(actual, queue, conn);
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
  });

  const handlers = (): ReturnType<typeof createHandlers> =>
    createHandlers({ connection: conn, reports } as unknown as Services);

  it('builds the report in one read job, from split lines with their parent payee', async () => {
    const run = vi.spyOn(queue, 'run');
    const r = (await reports.get({
      ...CLOCK,
      kind: 'inflowOutflow',
      filters: DEFAULT_FILTERS,
    })) as InflowOutflowReport;
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[2]).toEqual({ kind: 'read' });
    expect(r.inflow.total.total).toBe(10_000);
    // The split counts its lines once; the transfer side goes to Uncategorized; the closed account is out.
    expect(r.outflow.groups[0]?.children.map((c) => [c.key, c.total])).toEqual([
      ['c1', -2_000],
      ['c2', -1_000],
    ]);
    expect(r.outflow.uncategorized?.total).toBe(-4_000);
    const payees = (await reports.get({
      ...CLOCK,
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'payee', drillGroupId: null },
    })) as { series: { key: string; total: number }[] };
    expect(payees.series.map((s) => [s.key, s.total])).toEqual([
      ['p-a2', 4_000],
      ['p-shop', 3_000],
    ]);
  });

  it('reads balances with the Starting Balance for Net Worth', async () => {
    const r = (await reports.get({
      ...CLOCK,
      kind: 'netWorth',
      filters: { timeframe: { kind: 'preset', preset: 'thisMonth' }, accounts: { kind: 'all' } },
    })) as NetWorthReport;
    expect(r.accounts.map((a) => [a.key, a.start, a.end])).toEqual([
      ['a1', 15_000, 8_000],
      ['a2', 0, 4_000],
    ]);
  });

  it('validates params strictly through dispatch', async () => {
    const bad = [
      { ...CLOCK, kind: 'custom', filters: DEFAULT_FILTERS },
      { ...CLOCK, kind: 'summary', filters: { ...DEFAULT_FILTERS, extra: 1 } },
      {
        ...CLOCK,
        kind: 'summary',
        filters: {
          ...DEFAULT_FILTERS,
          timeframe: { kind: 'custom', start: '2026-10-31', end: '2026-10-01' },
        },
      },
      { ...CLOCK, kind: 'breakdown', filters: DEFAULT_FILTERS, options: { groupBy: 'day' } },
      { ...CLOCK, kind: 'netWorth', filters: DEFAULT_FILTERS, options: {} },
      { today: '2026-13-01', weekStart: 0, kind: 'summary', filters: DEFAULT_FILTERS },
      // Comparison has a Compare Period, never a Timeframe or a custom range (15 §4.3).
      { ...CLOCK, kind: 'comparison', filters: DEFAULT_FILTERS, options: COMPARE_MONTH },
      { ...CLOCK, kind: 'comparison', filters: FLOW_FILTERS },
      {
        ...CLOCK,
        kind: 'comparison',
        filters: FLOW_FILTERS,
        options: { ...COMPARE_MONTH, end: '2026-10-31' },
      },
      {
        ...CLOCK,
        kind: 'comparison',
        filters: FLOW_FILTERS,
        options: { unit: 'day', start: '2026-10-01' },
      },
    ];
    for (const params of bad)
      await expect(dispatch(handlers(), 'reports.get', params)).rejects.toMatchObject({
        code: 'validation',
      });
    await expect(
      dispatch(handlers(), 'reports.get', { ...CLOCK, kind: 'summary', filters: DEFAULT_FILTERS }),
    ).resolves.toMatchObject({ kind: 'summary' });
    await expect(
      dispatch(handlers(), 'reports.get', {
        ...CLOCK,
        kind: 'comparison',
        filters: FLOW_FILTERS,
        options: COMPARE_MONTH,
      }),
    ).resolves.toMatchObject({ kind: 'comparison' });
  });

  it('reads offline from the local data and never writes', async () => {
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    expect(conn.state.state).toBe('OfflineReadOnly');
    const before = actual.calls.length;
    const r = await reports.get({ ...CLOCK, kind: 'summary', filters: DEFAULT_FILTERS });
    expect(r.kind).toBe('summary');
    expect(actual.calls.slice(before)).toEqual([]);
  });

  it('refuses without an open budget', async () => {
    await conn.closeBudget(false);
    expect(() => reports.get({ ...CLOCK, kind: 'summary', filters: DEFAULT_FILTERS })).toThrow(
      /No budget/,
    );
  });
});
