// The report calculations (15 §4–6, §9) against a small budget whose expected values were worked out by
// hand, not by running the code: signed totals, refunds, splits, transfers, Starting Balances, closed and
// off-budget accounts, future periods, top-five/Other, Comparison and the FIFO Money Age.
import { describe, expect, it } from 'vitest';
import type { ISODate } from '../domain/types';
import { REPORT_FIXTURE as input, side, TODAY } from './fixture';
import type { ReportInput } from './input';
import { indexOf } from './input';
import {
  DEFAULT_FILTERS,
  parseSavedFilters,
  type CommonFilters,
  type ReportRequest,
} from './model';
import { latestMoneyAge, moneyAgeByMonth, moneyAgePoints } from './money-age';
import { comparedPeriods, periodsOf, presetRange, recentPeriods } from './periods';
import { buildReport } from './reports';
import type { BreakdownReport, ComparisonReport, ReportResult } from './result';

const clock = { today: TODAY, weekStart: 0 as const };
const { categories, payees, accounts } = DEFAULT_FILTERS;
/** Comparison's filters: the defaults, without a Timeframe. */
const FLOW_FILTERS = { categories, payees, accounts };
/** A request without the clock, which every test shares. */
type Unclocked = ReportRequest extends infer R
  ? R extends unknown
    ? Omit<R, 'today' | 'weekStart'>
    : never
  : never;
/** The report of a request's kind. */
function run<K extends ReportRequest['kind']>(
  request: Unclocked & { kind: K },
): Extract<ReportResult, { kind: K }> {
  return buildReport(input, { ...clock, ...request }) as Extract<ReportResult, { kind: K }>;
}

describe('report periods (15 §2.2)', () => {
  it('resolves presets against today', () => {
    expect(presetRange('latest3', TODAY, null)).toEqual({
      start: '2026-08-01',
      end: '2026-10-31',
    });
    expect(presetRange('thisYear', TODAY, null)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(presetRange('all', TODAY, '2025-03-14')).toEqual({
      start: '2025-03-01',
      end: '2026-10-31',
    });
    expect(presetRange('all', TODAY, null).start).toBe('2026-10-01');
  });

  it('clips periods to the range and marks future ones', () => {
    const weeks = periodsOf({ start: '2026-10-01', end: '2026-10-20' } as never, 'week', 0, TODAY);
    expect(weeks.map((p) => [p.start, p.end])).toEqual([
      ['2026-10-01', '2026-10-03'],
      ['2026-10-04', '2026-10-10'],
      ['2026-10-11', '2026-10-17'],
      ['2026-10-18', '2026-10-20'],
    ]);
    const quarters = periodsOf(presetRange('thisYear', TODAY, null), 'quarter', 0, TODAY);
    expect(quarters.map((p) => p.future)).toEqual([false, false, false, false]);
    const months = periodsOf(presetRange('thisYear', TODAY, null), 'month', 0, TODAY);
    expect(months.filter((p) => p.future).map((p) => p.start)).toEqual([
      '2026-11-01',
      '2026-12-01',
    ]);
  });

  it('compares a calendar period with the one of the same unit before it (15 §4.3)', () => {
    const at = (unit: 'week' | 'month' | 'quarter' | 'year', start: string, weekStart: 0 | 1 = 0) =>
      comparedPeriods({ unit, start: start as ISODate }, weekStart);
    expect(at('month', '2026-10-01')).toEqual({
      current: { start: '2026-10-01', end: '2026-10-31' },
      previous: { start: '2026-09-01', end: '2026-09-30' },
    });
    expect(at('month', '2026-03-01').previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(at('quarter', '2026-01-01')).toEqual({
      current: { start: '2026-01-01', end: '2026-03-31' },
      previous: { start: '2025-10-01', end: '2025-12-31' },
    });
    expect(at('year', '2026-01-01').previous).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    // 2026-10-20 is a Tuesday: a Sunday week starts on the 18th, a Monday week on the 19th.
    expect(at('week', TODAY)).toEqual({
      current: { start: '2026-10-18', end: '2026-10-24' },
      previous: { start: '2026-10-11', end: '2026-10-17' },
    });
    expect(at('week', TODAY, 1).current).toEqual({ start: '2026-10-19', end: '2026-10-25' });
  });

  it('lists the periods through the current one, newest first', () => {
    expect(recentPeriods('quarter', TODAY, 0, 3).map((p) => p.start)).toEqual([
      '2026-10-01',
      '2026-07-01',
      '2026-04-01',
    ]);
    expect(recentPeriods('week', TODAY, 1, 2).map((p) => p.start)).toEqual([
      '2026-10-19',
      '2026-10-12',
    ]);
  });
});

describe('Summary (15 §4.1)', () => {
  const r = run({ kind: 'summary', filters: DEFAULT_FILTERS });

  it('sums signed inflow and outflow, excluding Starting Balances and closed accounts', () => {
    // 300000 + 300000 − 1000 + 300000; the off-budget savings aren't selected by default.
    expect(r.inflow).toBe(899_000);
    // Aug −120000 −15000 +2000 −15000 +15000; Sep −5000 −3000 −50000; Oct −120000 −2500. The power
    // bill dated after today hasn't happened yet.
    expect(r.outflow).toBe(-313_500);
    expect(r.net).toBe(585_500);
  });

  it('averages over every month of the range', () => {
    expect(r.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(r.averageInflow).toBe(299_667);
    expect(r.averageOutflow).toBe(-104_500);
    expect(r.averageNet).toBe(195_167);
  });

  it('counts future months in the denominator, not the numerator', () => {
    const year = run({
      kind: 'summary',
      filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'preset', preset: 'thisYear' } },
    });
    expect(year.months).toHaveLength(12);
    // The November rent is a future month: not counted.
    expect(year.outflow).toBe(-313_500);
    expect(year.averageOutflow).toBe(-26_125);
    expect(year.netWorth.trend.at(-1)?.value).toBeNull();
  });

  it('shows Budgeted Net Worth of open on-budget accounts, whatever the filters', () => {
    const filtered = run({
      kind: 'summary',
      filters: { ...DEFAULT_FILTERS, accounts: { kind: 'ids', ids: ['sav'] } },
    });
    for (const s of [r, filtered]) {
      expect(s.netWorth.current).toBe(665_500);
      expect(s.netWorth.start).toBe(80_000);
      expect(s.netWorth.trend.map((p) => p.value)).toEqual([247_000, 488_000, 665_500]);
    }
  });

  it('starts a future range from today, without the sides still to come', () => {
    // The day before December is after the October power bill and the November rent: neither counts.
    const december = run({
      kind: 'summary',
      filters: {
        ...DEFAULT_FILTERS,
        timeframe: { kind: 'custom', start: '2026-12-01', end: '2026-12-31' },
      },
    });
    expect(december.netWorth).toMatchObject({ start: 665_500, startDate: TODAY, current: 665_500 });
    expect(december.netWorth.trend.map((p) => p.value)).toEqual([null]);
  });

  it('shares spending among the top groups, Uncategorized always in Other', () => {
    expect(r.topGroups.total).toBe(-313_500);
    expect(r.topGroups.slices.map((s) => [s.key, s.amount, s.share])).toEqual([
      ['g-bills', -240_000, 7656],
      ['g-food', -23_500, 750],
      ['other', -50_000, 1595],
    ]);
    expect(r.topGroups.slices.map((s) => s.color)).toEqual([1, 2, 'other']);
  });

  it('includes Money Age, which ignores the filters', () => {
    expect(r.moneyAge.points.map((p) => p.days)).toEqual([3, 32, 63]);
    expect(r.moneyAge.latest?.month).toBe('2026-10');
    const filtered = run({
      kind: 'summary',
      filters: { ...DEFAULT_FILTERS, categories: { kind: 'ids', ids: ['rent'] } },
    });
    expect(filtered.moneyAge).toEqual(r.moneyAge);
  });
});

describe('Money Age (15 §5)', () => {
  const index = indexOf(input);
  const points = moneyAgePoints(
    moneyAgeByMonth(index, input.sides, TODAY),
    ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'] as never,
    TODAY,
  );

  it('consumes unknown opening funds first, then the oldest buckets', () => {
    // Aug: rent takes the 100000 opening funds, then 20000 two days old; groceries 15000 four days old.
    expect(points[1]).toMatchObject({
      knownCents: 35_000,
      spendingCents: 135_000,
      days: 3,
      coverage: 2593,
    });
  });

  it('weights split lines individually, ignoring pool transfers and non-spending exits', () => {
    // The card payment is internal; the clawback and the transfer to savings consume funds unseen.
    expect(points[2]).toMatchObject({ knownCents: 8_000, spendingCents: 8_000, days: 32 });
    expect(points[2]?.coverage).toBe(10_000);
    // October: the rent 63 days and the dining 70 days after the August pay; the later power bill waits.
    expect(points[3]).toMatchObject({ knownCents: 122_500, spendingCents: 122_500, days: 63 });
  });

  it('has no value without spending, nor in a future month', () => {
    expect(points[0]).toMatchObject({ days: null, coverage: null, future: false });
    expect(points[4]).toMatchObject({ days: null, future: true });
    expect(latestMoneyAge(points)?.month).toBe('2026-10');
  });

  it('processes same-day positive sides first, then by transaction id and line', () => {
    const mini: ReportInput = {
      ...input,
      sides: [
        side('chk', '2026-01-01', -100, { id: 'a', categoryId: 'rent' }),
        side('chk', '2026-01-01', 100, { id: 'z', payeeId: 'employer' }),
        side('chk', '2026-01-02', 100, { id: 'y', payeeId: 'employer' }),
        side('chk', '2026-01-03', -50, { id: 'b', categoryId: 'rent' }),
      ],
    };
    const p = moneyAgePoints(
      moneyAgeByMonth(indexOf(mini), mini.sides, TODAY),
      ['2026-01'] as never,
      TODAY,
    );
    // The same-day inflow funds the first outflow at age 0; the 3rd's 50 come from the 2nd: 1 day old.
    expect(p[0]).toMatchObject({ knownCents: 150, spendingCents: 150, days: 0 });
  });

  it('labels partial coverage when spending outruns known funds', () => {
    const mini: ReportInput = {
      ...input,
      sides: [
        side('chk', '2026-03-01', 1_000, { payeeId: 'employer' }),
        side('chk', '2026-03-11', -4_000, { categoryId: 'rent' }),
      ],
    };
    const p = moneyAgePoints(
      moneyAgeByMonth(indexOf(mini), mini.sides, TODAY),
      ['2026-03'] as never,
      TODAY,
    );
    expect(p[0]).toMatchObject({
      knownCents: 1_000,
      spendingCents: 4_000,
      days: 10,
      coverage: 2500,
    });
  });
});

describe('Spending Breakdown (15 §4.2)', () => {
  const r = run({
    kind: 'breakdown',
    filters: DEFAULT_FILTERS,
    options: { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: null },
  });

  it('presents net spending as positive while keeping refunds and transfer sides', () => {
    expect(r.series.map((s) => [s.key, s.values, s.average, s.total])).toEqual([
      ['g-bills', [120_000, 0, 120_000], 80_000, 240_000],
      ['uncategorized', [0, 50_000, 0], 16_667, 50_000],
      ['g-food', [13_000, 8_000, 2_500], 7_833, 23_500],
    ]);
    expect(r.series.map((s) => s.color)).toEqual([1, 5, 2]);
    expect(r.series.map((s) => s.drillable)).toEqual([true, false, true]);
    expect(r.total.values).toEqual([133_000, 58_000, 122_500]);
    expect(r.total.total).toBe(313_500);
  });

  it('shows a net refund as negative spending', () => {
    const refunded: ReportInput = {
      ...input,
      sides: [
        side('chk', '2026-09-05', -100, { categoryId: 'rent' }),
        side('chk', '2026-09-06', 150, { categoryId: 'rent' }),
      ],
    };
    const report = buildReport(refunded, {
      ...clock,
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: null },
    }) as BreakdownReport;
    expect(report.series[0]).toMatchObject({
      key: 'g-bills',
      values: [0, -50, 0],
      average: -17,
      total: -50,
    });
  });

  it('drills into a group, and filters it when stacking changes', () => {
    const food = run({
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: 'g-food' },
    });
    expect(food.drill?.groupId).toBe('g-food');
    expect(food.series.map((s) => [s.key, s.total])).toEqual([
      ['groceries', 18_000],
      ['dining', 5_500],
    ]);
    const payees = run({
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'payee', drillGroupId: 'g-food' },
    });
    expect(payees.series.map((s) => [s.key, s.total])).toEqual([
      ['market', 21_000],
      ['cafe', 2_500],
    ]);
  });

  it('keeps five series and puts the rest in Other with its members', () => {
    const many: ReportInput = {
      ...input,
      sides: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((p, i) =>
        side('chk', '2026-09-10', -(i + 1) * 100, { payeeId: p, categoryId: 'rent' }),
      ),
    };
    const r7 = buildReport(many, {
      ...clock,
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'payee', drillGroupId: null },
    }) as BreakdownReport;
    expect(r7.series.map((s) => s.key)).toEqual(['p7', 'p6', 'p5', 'p4', 'p3', 'other']);
    const other = r7.series.at(-1);
    expect(other?.label).toEqual({ kind: 'other', count: 2 });
    expect(other?.total).toBe(300);
    expect(other?.members.map((m) => m.key)).toEqual(['p2', 'p1']);
    expect(r7.series.map((s) => s.color)).toEqual([1, 2, 3, 4, 6, 'other']);
  });

  it('shows future periods as unavailable and averages over every period', () => {
    const year = run({
      kind: 'breakdown',
      filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'preset', preset: 'thisYear' } },
      options: { groupBy: 'quarter', stackBy: 'account', drillGroupId: null },
    });
    expect(year.periods).toHaveLength(4);
    const chk = year.series.find((s) => s.key === 'chk');
    // The current quarter is observed, but the November rent dated after today isn't.
    expect(chk?.values).toEqual([0, 0, 193_000, 120_000]);
    expect(chk?.average).toBe(78_250);
  });
});

describe('Spending Comparison (15 §4.3)', () => {
  const r = run({
    kind: 'comparison',
    filters: FLOW_FILTERS,
    options: { unit: 'month', start: '2026-10-01' },
  });

  it('compares the same elapsed days of an in-progress month with last month', () => {
    expect(r.current).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(r.previous).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(r.partial).toBe(true);
    expect(r.observedDays).toBe(20);
    expect(r.cumulative.current).toHaveLength(20);
    expect(r.cumulative.previous).toHaveLength(20);
    expect(r.cumulative.current[19]).toBe(122_500);
    expect(r.cumulative.previous[19]).toBe(8_000);
  });

  it('compares a past period whole, and a week by its days', () => {
    const september = run({
      kind: 'comparison',
      filters: FLOW_FILTERS,
      options: { unit: 'month', start: '2026-09-01' },
    });
    expect(september.previous).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(september.partial).toBe(false);
    expect(september.cumulative.current).toHaveLength(30);
    expect(september.cumulative.previous).toHaveLength(31);
    const week = run({
      kind: 'comparison',
      filters: FLOW_FILTERS,
      options: { unit: 'week', start: '2026-10-20' },
    });
    expect(week.current).toEqual({ start: '2026-10-18', end: '2026-10-24' });
    expect(week.observedDays).toBe(3);
  });

  it('lists spending presentation values and changes over absolute previous', () => {
    const food = r.rows.find((x) => x.key === 'g-food');
    expect(food).toMatchObject({ current: 2_500, previous: 8_000, change: -5_500 });
    expect(food?.changePercent).toEqual({ kind: 'percent', value: -6875 });
    expect(food?.children.map((c) => [c.key, c.change, c.changePercent])).toEqual([
      ['groceries', -5_000, { kind: 'percent', value: -10_000 }],
      ['dining', -500, { kind: 'percent', value: -1667 }],
    ]);
    expect(r.rows.find((x) => x.key === 'g-bills')?.changePercent).toEqual({ kind: 'new' });
    expect(r.total).toMatchObject({ current: 122_500, previous: 8_000, change: 114_500 });
    expect(r.total.changePercent).toEqual({ kind: 'percent', value: 143_125 });
  });

  it('computes change percentages from displayed spending, including refunds', () => {
    const mini: ReportInput = {
      ...input,
      sides: [
        side('chk', '2026-09-05', -100, { categoryId: 'rent' }),
        side('chk', '2026-10-05', -90, { categoryId: 'rent' }),
        side('chk', '2026-09-06', 0, { categoryId: 'power' }),
        side('chk', '2026-09-07', 20, { categoryId: 'groceries' }),
        side('chk', '2026-10-07', -10, { categoryId: 'groceries' }),
      ],
    };
    const c = buildReport(mini, {
      ...clock,
      kind: 'comparison',
      filters: FLOW_FILTERS,
      options: { unit: 'month', start: '2026-10-01' },
    }) as ComparisonReport;
    const bills = c.rows.find((row) => row.key === 'g-bills');
    expect(bills?.children.map((x) => x.changePercent)).toEqual([
      { kind: 'percent', value: -1000 },
      { kind: 'zero' },
    ]);
    const food = c.rows.find((row) => row.key === 'g-food');
    expect(food?.children[0]).toMatchObject({
      current: 10,
      previous: -20,
      change: 30,
      changePercent: { kind: 'percent', value: 15_000 },
    });
  });
});

describe('Inflow vs Outflow (15 §4.4)', () => {
  const r = run({ kind: 'inflowOutflow', filters: DEFAULT_FILTERS });

  it('lists income payees and signed outflow groups with Net Income', () => {
    expect(r.inflow.sources?.children.map((c) => [c.key, c.values])).toEqual([
      ['employer', [300_000, 299_000, 300_000]],
    ]);
    expect(r.inflow.total.total).toBe(899_000);
    expect(r.outflow.uncategorized?.values).toEqual([0, -50_000, 0]);
    expect(r.outflow.groups.map((g) => [g.key, g.children.map((c) => c.key), g.total])).toEqual([
      ['g-bills', ['rent'], -240_000],
      ['g-food', ['groceries', 'dining'], -23_500],
    ]);
    expect(r.outflow.total.total).toBe(-313_500);
    expect(r.net.values).toEqual([167_000, 241_000, 177_500]);
    expect(r.net.total).toBe(585_500);
  });

  it('applies the category filter to each transfer side on its own', () => {
    const cats: CommonFilters = {
      ...DEFAULT_FILTERS,
      categories: { kind: 'ids', ids: ['uncategorized'] },
      accounts: { kind: 'all' },
    };
    const t = run({ kind: 'inflowOutflow', filters: cats });
    // Both sides of the card payment, the transfer out and in to savings, and the bank interest.
    expect(t.outflow.uncategorized?.values).toEqual([0, 0, 100]);
    expect(t.outflow.groups).toEqual([]);
    expect(t.inflow.sources).toBeNull();
  });

  it('hides rows without data, keeping section totals', () => {
    const none = run({
      kind: 'inflowOutflow',
      filters: { ...DEFAULT_FILTERS, payees: { kind: 'ids', ids: [] } },
    });
    expect(none.inflow.sources).toBeNull();
    expect(none.outflow.groups).toEqual([]);
    expect(none.inflow.total.values).toEqual([0, 0, 0]);
  });
});

describe('Net Worth (15 §4.5)', () => {
  const base = {
    kind: 'netWorth' as const,
    filters: {
      timeframe: {
        kind: 'custom' as const,
        start: '2026-09-01' as ISODate,
        end: '2026-10-31' as ISODate,
      },
      accounts: { kind: 'all' as const },
    },
  };

  it('includes negative accounts and excludes closed accounts always', () => {
    const r = run(base);
    expect(r.latestDate).toBe(TODAY);
    expect(r.accounts.map((a) => [a.key, a.end])).toEqual([
      ['chk', 686_000],
      ['card', -20_500],
      ['sav', 50_100],
    ]);
    expect(r.points.map((p) => [p.date, p.kind, p.future])).toEqual([
      ['2026-09-15', 'mid', false],
      ['2026-09-30', 'end', false],
      ['2026-10-15', 'mid', false],
      ['2026-10-20', 'today', false],
      ['2026-10-31', 'end', true],
    ]);
    expect(r.total.values).toEqual([538_000, 538_000, 715_600, 715_600, null]);
    expect(r.total.monthEnd).toEqual([538_000, null]);
    expect(r.total).toMatchObject({ start: 247_000, end: 715_600, change: 468_600 });
  });

  it('includes exactly the selected open accounts, on- and off-budget alike', () => {
    const picked = run({
      ...base,
      filters: { ...base.filters, accounts: { kind: 'ids', ids: ['chk', 'sav', 'old'] } },
    });
    expect(picked.accounts.map((a) => a.key)).toEqual(['chk', 'sav']);
    expect(picked.total.end).toBe(736_100);
    const onBudget = run({
      ...base,
      filters: { ...base.filters, accounts: { kind: 'onBudget' } },
    });
    expect(onBudget.accounts.map((a) => a.key)).toEqual(['chk', 'card']);
    expect(onBudget.total.end).toBe(665_500);
  });

  it('plots today, so a balance since the last mid-month or month-end point reaches the chart', () => {
    // A loan opened after October 15: every other point is before it or still to come.
    const loan = side('card', '2026-10-18', -9_000_000);
    const r = buildReport(
      { ...input, sides: [...input.sides, loan].sort((a, b) => a.date.localeCompare(b.date)) },
      { ...clock, ...base },
    ) as Extract<ReportResult, { kind: 'netWorth' }>;
    const card = r.accounts.find((a) => a.key === 'card');
    expect(card?.values).toEqual([-18_000, -18_000, -20_500, -9_020_500, null]);
    expect(card?.end).toBe(-9_020_500);
    expect(r.total.values.at(-2)).toBe(r.total.end);
  });

  it('places no extra point when today is one already, or outside the range', () => {
    const onPoint = buildReport(input, { ...base, today: '2026-10-15', weekStart: 0 });
    expect(onPoint.kind === 'netWorth' && onPoint.points.map((p) => p.kind)).toEqual([
      'mid',
      'end',
      'mid',
      'end',
    ]);
    const past = run({
      ...base,
      filters: {
        ...base.filters,
        timeframe: { kind: 'custom', start: '2026-08-01', end: '2026-08-31' },
      },
    });
    expect(past.points.map((p) => p.date)).toEqual(['2026-08-15', '2026-08-31']);
  });

  it('starts a future range from today, so its change is zero rather than projected', () => {
    // Uncapped, the day before December would count −8000 (Oct 25) and −120000 (Nov 3) in Checking.
    const r = run({
      ...base,
      filters: {
        ...base.filters,
        timeframe: { kind: 'custom', start: '2026-12-01', end: '2026-12-31' },
      },
    });
    expect(r.accounts.map((a) => [a.key, a.start, a.end, a.change])).toEqual([
      ['chk', 686_000, 686_000, 0],
      ['card', -20_500, -20_500, 0],
      ['sav', 50_100, 50_100, 0],
    ]);
    expect(r.total).toMatchObject({ start: 715_600, end: 715_600, change: 0 });
    expect(r.total.values.every((v) => v === null)).toBe(true);
  });
});

describe('saved filters (15)', () => {
  it('drops a saved filter whose custom range has a date no calendar has', () => {
    const saved = (end: string) => ({
      page: 'summary',
      name: end,
      filters: { ...DEFAULT_FILTERS, timeframe: { kind: 'custom', start: '2026-02-01', end } },
    });
    expect(
      parseSavedFilters([saved('2026-02-28'), saved('2026-02-31')]).map((f) => f.name),
    ).toEqual(['2026-02-28']);
  });
});
