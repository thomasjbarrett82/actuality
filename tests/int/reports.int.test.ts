// Reports against a real server (21 §3 journeys 11–13, §5): on the Typical fixture,
// Inflow vs Outflow equals independent ActualQL facts (split lines once, Starting Balances and closed
// accounts out, signed sums), Net Worth ends at each account's balance, and the reports read the local
// data offline. On the Large fixture (20k transactions) each report's job and DTO stay under 1 s and 1 MB.
import { firstDayOfYear, monthBounds } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { DEFAULT_FILTERS, type CommonFilters, type ReportRequest } from '@shared/reporting/model';
import type { InflowOutflowReport, NetWorthReport, SummaryReport } from '@shared/reporting/result';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { FIXTURE_MONTHS } from '../fixtures/fixture-facts';
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

// The reports' clock is the last day of the fixture's last month, so every fixture transaction is in the past.
const TODAY = monthBounds(FIXTURE_MONTHS.at(-1) as Month).last;
const CLOCK = { today: TODAY, weekStart: 0 as const };
const RANGE: CommonFilters['timeframe'] = {
  kind: 'custom',
  start: monthBounds(FIXTURE_MONTHS[0] as Month).first,
  end: TODAY,
};
const FILTERS: CommonFilters = { ...DEFAULT_FILTERS, timeframe: RANGE };

/**
 * One sign-in and one host for both fixtures: the server rate-limits requests, and the whole integration
 * suite shares its allowance (README).
 */
interface Opened {
  actual: ActualApi;
  fixtures: ActualTestFixtures;
  host: HostStack;
  budgets: { typical: string; large: string };
  cleanup: () => Promise<void>;
}

async function open(dir: string, net: NetworkSwitch): Promise<Opened> {
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  const { actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures'));
  const token = await loginWithPassword(SERVER, PASSWORD);
  const upload = async (name: string): Promise<string> => {
    const zip = readFileSync(join(import.meta.dirname, `../fixtures/budgets/${name}`));
    return (await fixtures.uploadBudgetZip(SERVER, token, new Uint8Array(zip))).cloudFileId ?? '';
  };
  const budgets = { typical: await upload('typical.zip'), large: await upload('large.zip') };
  const host = hostStack(actual, join(dir, 'a'), { probe: (url) => net.probe(url) });
  await host.connection.connect(SERVER, PASSWORD, false);
  return {
    actual,
    fixtures,
    host,
    budgets,
    cleanup: async () => {
      host.connection.dispose();
      await actual.shutdown().catch(() => undefined);
      for (const id of Object.values(budgets)) await fixtures.deleteServerBudget(SERVER, token, id);
    },
  };
}

type Row = { amount: number; category: string | null; account: string; date: string };

describe.skipIf(!HAS_SERVER)('Reports against a real server (15, 21 §5)', () => {
  const dir = tempDir();
  let net: NetworkSwitch;
  let o: Opened;

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    o = await open(dir, net);
    await o.host.connection.openBudget(o.budgets.typical);
  }, 600_000);

  afterAll(async () => {
    net.up();
    await o.cleanup();
  });

  /** Every side in open on-budget accounts, from an independent query: split lines, no parents. */
  async function facts(): Promise<Row[]> {
    const { data } = (await o.fixtures.api.aqlQuery(
      o.fixtures.api
        .q('transactions')
        .filter({
          'account.offbudget': false,
          'account.closed': false,
          starting_balance_flag: false,
          date: { $gte: RANGE.kind === 'custom' ? RANGE.start : '', $lte: TODAY },
        })
        .select(['amount', 'category', 'account', 'date'])
        .options({ splits: 'inline' }),
    )) as { data: Row[] };
    return data;
  }

  it('sums signed inflow and outflow like the independent facts (21 §3 journeys 11, 13)', async () => {
    const report = (await o.host.reports.get({
      ...CLOCK,
      kind: 'inflowOutflow',
      filters: FILTERS,
    })) as InflowOutflowReport;
    const groups = await o.actual.getCategoryGroups();
    const income = new Set(
      groups.flatMap((g) => g.categories.filter((c) => c.isIncome).map((c) => c.id)),
    );
    let inflow = 0;
    let outflow = 0;
    for (const r of await facts()) {
      if (r.category !== null && income.has(r.category)) inflow += r.amount;
      else outflow += r.amount;
    }
    expect(report.inflow.total.total).toBe(inflow);
    expect(report.outflow.total.total).toBe(outflow);
    expect(report.net.total).toBe(inflow + outflow);
    const summary = (await o.host.reports.get({
      ...CLOCK,
      kind: 'summary',
      filters: FILTERS,
    })) as SummaryReport;
    expect([summary.inflow, summary.outflow]).toEqual([inflow, outflow]);
  });

  it('ends Net Worth at each open account balance through today (21 §3 journey 14)', async () => {
    const report = (await o.host.reports.get({
      ...CLOCK,
      kind: 'netWorth',
      filters: { timeframe: RANGE, accounts: { kind: 'all' } },
    })) as NetWorthReport;
    const { data } = (await o.fixtures.api.aqlQuery(
      o.fixtures.api
        .q('transactions')
        .filter({ 'account.closed': false, date: { $lte: TODAY } })
        .groupBy('account')
        .select(['account', { total: { $sum: '$amount' } }]),
    )) as { data: { account: string; total: number }[] };
    const want = new Map(data.map((d) => [d.account, d.total]));
    expect(report.accounts.length).toBeGreaterThan(0);
    for (const a of report.accounts) expect(a.end, a.key).toBe(want.get(a.key) ?? 0);
    expect(report.accounts.some((a) => a.offBudget)).toBe(true);
  });

  it('reads the local data offline, with the same result (03 §5.3)', async () => {
    const request: ReportRequest = {
      ...CLOCK,
      kind: 'breakdown',
      filters: FILTERS,
      options: { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: null },
    };
    const online = await o.host.reports.get(request);
    net.down();
    await o.host.connection.syncNow().catch(() => undefined);
    expect(o.host.connection.state.state).not.toBe('Online');
    expect(await o.host.reports.get(request)).toEqual(online);
    net.up();
    await o.host.connection.retry('manual').catch(() => undefined);
  });

  describe('on the Large fixture', () => {
    beforeAll(async () => {
      await o.host.connection.openBudget(o.budgets.large);
    }, 600_000);

    const requests: ReportRequest[] = [
      {
        ...CLOCK,
        kind: 'summary',
        filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'preset', preset: 'all' } },
      },
      {
        ...CLOCK,
        kind: 'breakdown',
        filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'preset', preset: 'all' } },
        options: { groupBy: 'week', stackBy: 'payee', drillGroupId: null },
      },
      {
        ...CLOCK,
        kind: 'comparison',
        filters: {
          categories: DEFAULT_FILTERS.categories,
          payees: DEFAULT_FILTERS.payees,
          accounts: DEFAULT_FILTERS.accounts,
        },
        options: { unit: 'year', start: firstDayOfYear(TODAY) },
      },
      {
        ...CLOCK,
        kind: 'inflowOutflow',
        filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'preset', preset: 'all' } },
      },
      {
        ...CLOCK,
        kind: 'netWorth',
        filters: { timeframe: { kind: 'preset', preset: 'all' }, accounts: { kind: 'all' } },
      },
    ];

    it('aggregates 20k transactions under 1 s with a DTO under 1 MB', async () => {
      for (const request of requests) {
        await o.host.reports.get(request);
        const started = performance.now();
        const json = JSON.stringify(await o.host.reports.get(request));
        const ms = performance.now() - started;
        expect(ms, `${request.kind}: ${ms.toFixed(0)} ms`).toBeLessThan(1_000);
        expect(json.length, `${request.kind}: ${String(json.length)} bytes`).toBeLessThan(
          1_000_000,
        );
      }
    });
  });
});
