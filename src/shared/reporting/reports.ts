// The five report calculations (15 §4–6) over normalized sides. Calculations aggregate signed
// transaction sides: outflows stay negative, refunds and credits in non-income categories stay positive
// and reduce net outflow, and negative income sides reduce net inflow. Spending Breakdown and Comparison
// negate their aggregate sums for display. Future periods are null and count zero towards totals and
// average numerators, but stay in average denominators.
import { addDays, daysBetween, monthBounds } from '../dates';
import type { Id, ISODate, Money } from '../domain/types';
import { basisPoints, divideRound } from '../money';
import {
  earliestDate,
  flowSides,
  indexOf,
  isIncomeSide,
  selectedAccounts,
  type ReportIndex,
  type ReportInput,
  type ReportSide,
} from './input';
import type { BreakdownOptions, CommonFilters, FlowFilters, ReportRequest } from './model';
import { latestMoneyAge, moneyAgeByMonth, moneyAgePoints } from './money-age';
import {
  comparedPeriods,
  dayCount,
  isFutureMonth,
  monthsOfRange,
  periodIndex,
  periodsOf,
  resolveTimeframe,
  type DateRange,
  type Period,
} from './periods';
import type {
  BreakdownReport,
  BreakdownSeries,
  ChangePercent,
  ComparisonReport,
  ComparisonRow,
  ExpandableRow,
  InflowOutflowReport,
  NetWorthAccount,
  NetWorthPoint,
  NetWorthReport,
  ReportLabel,
  ReportResult,
  ReportRow,
  SeriesColor,
  SummaryReport,
  SummarySlice,
} from './result';

/** Category group colors cycle through these; Uncategorized always uses series 5 (05 §1.11). */
const GROUP_COLORS: readonly SeriesColor[] = [1, 2, 3, 4, 6];
const UNCATEGORIZED_COLOR: SeriesColor = 5;
/** Ranked series take these by rank. */
const RANK_COLORS: readonly SeriesColor[] = [1, 2, 3, 4, 6];
/** Breakdown's individual series; the rest share Other (15 §4.2). */
const TOP_SERIES = 5;
/** Summary's individual pie slices (15 §4.1). */
const TOP_SLICES = 4;

const name = (text: string): ReportLabel => ({ kind: 'name', text });
const UNCATEGORIZED_KEY = 'uncategorized';
const negate = (amount: Money): Money => (amount === 0 ? 0 : -amount);

// ------------------------------------------------------------------------------------------ helpers

/** Per-period sums: a key's values, with how many sides fed it. */
class Sums {
  readonly values: Money[];
  count = 0;
  constructor(periods: number) {
    this.values = new Array<Money>(periods).fill(0);
  }
  add(period: number, amount: Money): void {
    this.values[period] = (this.values[period] ?? 0) + amount;
    this.count++;
  }
}

class Table {
  private readonly sums = new Map<string, Sums>();
  constructor(private readonly periods: number) {}
  add(key: string, period: number, amount: Money): void {
    let s = this.sums.get(key);
    if (!s) {
      s = new Sums(this.periods);
      this.sums.set(key, s);
    }
    s.add(period, amount);
  }
  get(key: string): Sums | undefined {
    return this.sums.get(key);
  }
  keys(): string[] {
    return [...this.sums.keys()];
  }
}

/** A row from per-period sums: future periods null, the average over every period. */
function rowOf(
  key: string,
  label: ReportLabel,
  values: readonly Money[],
  future: readonly boolean[],
): ReportRow {
  const shown = values.map((v, i) => (future[i] ? null : v));
  const total = shown.reduce<Money>((a, v) => a + (v ?? 0), 0);
  return { key, label, values: shown, total, average: divideRound(total, values.length) };
}

function spendingPresentation(row: ReportRow): ReportRow {
  return {
    ...row,
    values: row.values.map((value) => (value === null ? null : negate(value))),
    average: negate(row.average),
    total: negate(row.total),
  };
}

function addRows(
  key: string,
  label: ReportLabel,
  rows: readonly ReportRow[],
  n: number,
  future: readonly boolean[],
): ReportRow {
  const values = new Array<Money>(n).fill(0);
  for (const r of rows) r.values.forEach((v, i) => (values[i] = (values[i] ?? 0) + (v ?? 0)));
  return rowOf(key, label, values, future);
}

const labelText = (l: ReportLabel): string =>
  l.kind === 'name' ? l.text : l.kind === 'transfer' ? l.account : '';

/** Largest spending first: most negative total, then by label and key for a stable order. */
function byTotal(a: ReportRow, b: ReportRow): number {
  if (a.total !== b.total) return a.total - b.total;
  const la = labelText(a.label);
  const lb = labelText(b.label);
  if (la !== lb) return la < lb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function payeeLabel(index: ReportIndex, payeeId: Id | null): ReportLabel {
  if (payeeId === null) return { kind: 'noPayee' };
  const p = index.payee.get(payeeId);
  if (!p) return { kind: 'noPayee' };
  if (p.transferAccountId) {
    return { kind: 'transfer', account: index.account.get(p.transferAccountId)?.name ?? p.name };
  }
  return name(p.name);
}

/** The group of a spending side, or null for Uncategorized (no category, or one that's gone). */
function groupOf(index: ReportIndex, side: ReportSide): Id | null {
  return side.categoryId === null ? null : (index.category.get(side.categoryId)?.groupId ?? null);
}

/** A category group's stable color, by its place among the spending groups (15 §4.2). */
function groupColors(index: ReportIndex): Map<Id, SeriesColor> {
  const out = new Map<Id, SeriesColor>();
  index.input.groups
    .filter((g) => !g.isIncome)
    .forEach((g, i) => out.set(g.id, GROUP_COLORS[i % GROUP_COLORS.length] ?? 1));
  return out;
}

/**
 * Observed sides only (15 §2.2): a side dated after today hasn't happened yet, so a future period, and the
 * rest of the current one, contribute nothing.
 */
function observed(
  sides: readonly ReportSide[],
  periods: readonly Period[],
  today: ISODate,
): { side: ReportSide; period: number }[] {
  const out: { side: ReportSide; period: number }[] = [];
  for (const side of sides) {
    if (side.date > today) continue;
    const p = periodIndex(periods, side.date);
    if (p !== -1 && !periods[p]?.future) out.push({ side, period: p });
  }
  return out;
}

function monthPeriods(range: DateRange, today: ISODate): Period[] {
  return monthsOfRange(range).map((m) => {
    const b = monthBounds(m);
    const start = b.first > range.start ? b.first : range.start;
    return { start, end: b.last < range.end ? b.last : range.end, future: start > today };
  });
}

/**
 * Account balances at each date (end of day): every side through the date, Starting Balances included
 * (15 §4.5). `dates` sorted ascending; the result's rows follow it.
 */
function balancesAt(
  sides: readonly ReportSide[],
  accounts: ReadonlySet<Id>,
  dates: readonly ISODate[],
): Map<Id, Money>[] {
  const running = new Map<Id, Money>();
  const out: Map<Id, Money>[] = [];
  let i = 0;
  for (const date of dates) {
    for (; i < sides.length; i++) {
      const s = sides[i];
      if (!s || s.date > date) break;
      if (accounts.has(s.accountId))
        running.set(s.accountId, (running.get(s.accountId) ?? 0) + s.amount);
    }
    out.push(new Map(running));
  }
  return out;
}

const sumOf = (balances: ReadonlyMap<Id, Money>, ids: Iterable<Id>): Money => {
  let total: Money = 0;
  for (const id of ids) total += balances.get(id) ?? 0;
  return total;
};

const minDate = (a: ISODate, b: ISODate): ISODate => (a < b ? a : b);

/**
 * The balance snapshot a range starts from (15 §4.5): the end of the day before it, or today when that
 * day is still to come, so a range starting in the future never counts future-dated sides (15 §2.2).
 */
const startSnapshot = (range: DateRange, today: ISODate): ISODate =>
  minDate(addDays(range.start, -1), today);

// ------------------------------------------------------------------------------------------ Summary

function summary(
  index: ReportIndex,
  filters: CommonFilters,
  range: DateRange,
  today: ISODate,
): SummaryReport {
  const periods = monthPeriods(range, today);
  const months = monthsOfRange(range);
  const sides = observed(flowSides(index, filters, range), periods, today);
  let inflow: Money = 0;
  let outflow: Money = 0;
  for (const { side } of sides) {
    if (isIncomeSide(index, side)) inflow += side.amount;
    else outflow += side.amount;
  }
  const net = inflow + outflow;

  // Budgeted Net Worth: open on-budget accounts, whatever the filters.
  const onBudget = selectedAccounts(index, { kind: 'onBudget' });
  const startDate = startSnapshot(range, today);
  const trendDates = months.map((m) => minDate(monthBounds(m).last, today));
  const dates = [...new Set([startDate, today, ...trendDates])].sort();
  const snapshots = balancesAt(index.input.sides, onBudget, dates);
  const at = (date: ISODate): Money => sumOf(snapshots[dates.indexOf(date)] ?? new Map(), onBudget);

  // Top spending category groups: the four largest; Other holds the rest and Uncategorized.
  const colors = groupColors(index);
  const byGroup = new Map<string, Money>();
  for (const { side } of sides) {
    if (isIncomeSide(index, side)) continue;
    const key = groupOf(index, side) ?? UNCATEGORIZED_KEY;
    byGroup.set(key, (byGroup.get(key) ?? 0) + side.amount);
  }
  const spending = [...byGroup.entries()].filter(([, v]) => v < 0);
  const basis = spending.reduce<Money>((a, [, v]) => a + v, 0);
  const ranked = spending
    .filter(([k]) => k !== UNCATEGORIZED_KEY)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  const top = ranked.slice(0, TOP_SLICES);
  const rest = spending.filter(([k]) => !top.some(([t]) => t === k));
  const slices: SummarySlice[] = top.map(([key, amount]) => ({
    key,
    label: name(index.group.get(key)?.name ?? ''),
    amount,
    share: basisPoints(-amount, basis),
    color: colors.get(key) ?? 1,
  }));
  if (rest.length > 0) {
    const amount = rest.reduce<Money>((a, [, v]) => a + v, 0);
    slices.push({
      key: 'other',
      label: { kind: 'other', count: rest.length },
      amount,
      share: basisPoints(-amount, basis),
      color: 'other',
    });
  }

  const points = moneyAgePoints(moneyAgeByMonth(index, index.input.sides, today), months, today);
  return {
    kind: 'summary',
    range,
    months,
    inflow,
    outflow,
    net,
    averageInflow: divideRound(inflow, months.length),
    averageOutflow: divideRound(outflow, months.length),
    averageNet: divideRound(net, months.length),
    netWorth: {
      current: at(today),
      start: at(startDate),
      startDate,
      trend: months.map((month, i) => ({
        month,
        value: isFutureMonth(month, today) ? null : at(trendDates[i] ?? today),
      })),
    },
    topGroups: { slices, total: basis },
    moneyAge: { latest: latestMoneyAge(points), points },
  };
}

// ------------------------------------------------------------------------------------------ Breakdown

function breakdown(
  index: ReportIndex,
  filters: CommonFilters,
  options: BreakdownOptions,
  range: DateRange,
  clock: { today: ISODate; weekStart: ReportRequest['weekStart'] },
): BreakdownReport {
  const periods = periodsOf(range, options.groupBy, clock.weekStart, clock.today);
  const future = periods.map((p) => p.future);
  const drillGroup = options.drillGroupId ? index.group.get(options.drillGroupId) : undefined;
  const drill = drillGroup && !drillGroup.isIncome ? drillGroup : undefined;
  const colors = groupColors(index);
  const table = new Table(periods.length);
  const labels = new Map<string, { label: ReportLabel; kind: BreakdownSeries['kind'] }>();

  for (const { side, period } of observed(flowSides(index, filters, range), periods, clock.today)) {
    if (isIncomeSide(index, side)) continue;
    const group = groupOf(index, side);
    if (drill && group !== drill.id) continue;
    let key: string;
    switch (options.stackBy) {
      case 'categoryGroup':
        if (drill) {
          key = side.categoryId ?? UNCATEGORIZED_KEY;
          if (!labels.has(key))
            labels.set(key, { label: name(index.category.get(key)?.name ?? ''), kind: 'category' });
        } else if (group === null) {
          key = UNCATEGORIZED_KEY;
          labels.set(key, { label: { kind: 'uncategorized' }, kind: 'uncategorized' });
        } else {
          key = group;
          if (!labels.has(key))
            labels.set(key, { label: name(index.group.get(group)?.name ?? ''), kind: 'group' });
        }
        break;
      case 'payee':
        key = side.payeeId ?? 'none';
        if (!labels.has(key))
          labels.set(key, { label: payeeLabel(index, side.payeeId), kind: 'payee' });
        break;
      case 'account':
        key = side.accountId;
        if (!labels.has(key))
          labels.set(key, { label: name(index.account.get(key)?.name ?? ''), kind: 'account' });
        break;
    }
    table.add(key, period, side.amount);
  }

  const rows = table
    .keys()
    .map((key) => {
      const info = labels.get(key) ?? { label: name(''), kind: 'payee' as const };
      return { row: rowOf(key, info.label, table.get(key)?.values ?? [], future), kind: info.kind };
    })
    .sort((a, b) => byTotal(a.row, b.row));
  const displayedRows = rows.map(({ row, kind }) => ({ row: spendingPresentation(row), kind }));
  const series: BreakdownSeries[] = displayedRows
    .slice(0, TOP_SERIES)
    .map(({ row, kind }, rank) => ({
      ...row,
      kind,
      color:
        kind === 'group'
          ? (colors.get(row.key) ?? 1)
          : kind === 'uncategorized'
            ? UNCATEGORIZED_COLOR
            : (RANK_COLORS[rank] ?? 1),
      drillable: kind === 'group',
      members: [],
    }));
  const others = displayedRows.slice(TOP_SERIES).map((r) => r.row);
  if (others.length > 0) {
    const other = addRows(
      'other',
      { kind: 'other', count: others.length },
      others,
      periods.length,
      future,
    );
    series.push({ ...other, kind: 'other', color: 'other', drillable: false, members: others });
  }
  const total = addRows(
    'total',
    name(''),
    displayedRows.map((r) => r.row),
    periods.length,
    future,
  );
  return {
    kind: 'breakdown',
    range,
    groupBy: options.groupBy,
    stackBy: options.stackBy,
    periods,
    drill: drill ? { groupId: drill.id, label: name(drill.name) } : null,
    series,
    total,
  };
}

// ------------------------------------------------------------------------------------------ Comparison

function changePercent(current: Money, previous: Money): ChangePercent {
  if (previous === 0) return current === 0 ? { kind: 'zero' } : { kind: 'new' };
  return { kind: 'percent', value: basisPoints(current - previous, previous) };
}

function comparisonRow(
  key: string,
  label: ReportLabel,
  current: Money,
  previous: Money,
  children: ComparisonRow[] = [],
): ComparisonRow {
  return {
    key,
    label,
    current,
    previous,
    change: current - previous,
    changePercent: changePercent(current, previous),
    children,
  };
}

function comparison(
  index: ReportIndex,
  filters: FlowFilters,
  { current, previous }: { current: DateRange; previous: DateRange },
  today: ISODate,
): ComparisonReport {
  const length = dayCount(current);
  const observedDays =
    current.start > today ? 0 : Math.min(length, daysBetween(current.start, today) + 1);
  const partial = observedDays < length;
  const previousDays = partial ? Math.min(observedDays, dayCount(previous)) : dayCount(previous);
  const currentDaily = new Array<Money>(observedDays).fill(0);
  const previousDaily = new Array<Money>(previousDays).fill(0);
  const byCategory = new Map<string, { current: Money; previous: Money }>();

  for (const side of flowSides(index, filters, { start: previous.start, end: current.end })) {
    if (isIncomeSide(index, side)) continue;
    const inCurrent = side.date >= current.start;
    const offset = daysBetween(inCurrent ? current.start : previous.start, side.date);
    if (offset >= (inCurrent ? observedDays : previousDays)) continue;
    const daily = inCurrent ? currentDaily : previousDaily;
    daily[offset] = (daily[offset] ?? 0) + side.amount;
    const key =
      side.categoryId !== null && index.category.has(side.categoryId)
        ? side.categoryId
        : UNCATEGORIZED_KEY;
    const s = byCategory.get(key) ?? { current: 0, previous: 0 };
    if (inCurrent) s.current += side.amount;
    else s.previous += side.amount;
    byCategory.set(key, s);
  }

  const rows: ComparisonRow[] = [];
  for (const g of index.input.groups) {
    if (g.isIncome) continue;
    const children = g.categories.flatMap((c) => {
      const s = byCategory.get(c.id);
      return s ? [comparisonRow(c.id, name(c.name), negate(s.current), negate(s.previous))] : [];
    });
    if (children.length === 0) continue;
    const cur = children.reduce<Money>((a, r) => a + r.current, 0);
    const prev = children.reduce<Money>((a, r) => a + r.previous, 0);
    rows.push(comparisonRow(g.id, name(g.name), cur, prev, children));
  }
  const unc = byCategory.get(UNCATEGORIZED_KEY);
  if (unc)
    rows.push(
      comparisonRow(
        UNCATEGORIZED_KEY,
        { kind: 'uncategorized' },
        negate(unc.current),
        negate(unc.previous),
      ),
    );
  const total = comparisonRow(
    'total',
    name(''),
    rows.reduce<Money>((a, r) => a + r.current, 0),
    rows.reduce<Money>((a, r) => a + r.previous, 0),
  );
  const cumulative = (daily: readonly Money[]): Money[] => {
    let run: Money = 0;
    return daily.map((v) => (run += v));
  };
  return {
    kind: 'comparison',
    current,
    previous,
    observedDays,
    partial,
    cumulative: {
      current: cumulative(currentDaily).map(negate),
      previous: cumulative(previousDaily).map(negate),
    },
    rows,
    total,
  };
}

// ------------------------------------------------------------------------------------------ Inflow vs Outflow

function inflowOutflow(
  index: ReportIndex,
  filters: CommonFilters,
  range: DateRange,
  today: ISODate,
): InflowOutflowReport {
  const periods = monthPeriods(range, today);
  const months = monthsOfRange(range);
  const future = periods.map((p) => p.future);
  const n = periods.length;
  const sources = new Table(n);
  const transfers = new Table(n);
  const categories = new Table(n);
  const sourceLabels = new Map<string, ReportLabel>();

  for (const { side, period } of observed(flowSides(index, filters, range), periods, today)) {
    if (isIncomeSide(index, side)) {
      if (side.transferAccountId !== null)
        transfers.add(side.categoryId ?? '', period, side.amount);
      else {
        const key = side.payeeId ?? 'none';
        sources.add(key, period, side.amount);
        if (!sourceLabels.has(key)) sourceLabels.set(key, payeeLabel(index, side.payeeId));
      }
      continue;
    }
    const key =
      side.categoryId !== null && index.category.has(side.categoryId)
        ? side.categoryId
        : UNCATEGORIZED_KEY;
    categories.add(key, period, side.amount);
  }

  const row = (t: Table, key: string, label: ReportLabel): ReportRow =>
    rowOf(key, label, t.get(key)?.values ?? [], future);

  const payeeRows = sources
    .keys()
    .map((k) => row(sources, k, sourceLabels.get(k) ?? { kind: 'noPayee' }))
    .sort((a, b) => b.total - a.total || (labelText(a.label) < labelText(b.label) ? -1 : 1));
  const sourcesRow: ExpandableRow | null =
    payeeRows.length > 0
      ? { ...addRows('sources', { kind: 'allIncome' }, payeeRows, n, future), children: payeeRows }
      : null;
  const transferRows: ReportRow[] = [];
  for (const g of index.input.groups)
    for (const c of g.categories)
      if (c.isIncome && transfers.get(c.id)) transferRows.push(row(transfers, c.id, name(c.name)));
  const inflowTotal = addRows(
    'inflow',
    name(''),
    [...(sourcesRow ? [sourcesRow] : []), ...transferRows],
    n,
    future,
  );

  const groups: ExpandableRow[] = [];
  for (const g of index.input.groups) {
    if (g.isIncome) continue;
    const children = g.categories.flatMap((c) =>
      categories.get(c.id) ? [row(categories, c.id, name(c.name))] : [],
    );
    if (children.length === 0) continue;
    groups.push({ ...addRows(g.id, name(g.name), children, n, future), children });
  }
  const uncategorized = categories.get(UNCATEGORIZED_KEY)
    ? row(categories, UNCATEGORIZED_KEY, { kind: 'uncategorized' })
    : null;
  const outflowTotal = addRows(
    'outflow',
    name(''),
    [...(uncategorized ? [uncategorized] : []), ...groups],
    n,
    future,
  );
  return {
    kind: 'inflowOutflow',
    range,
    months,
    future,
    inflow: { sources: sourcesRow, transfers: transferRows, total: inflowTotal },
    outflow: { uncategorized, groups, total: outflowTotal },
    net: addRows('net', name(''), [inflowTotal, outflowTotal], n, future),
  };
}

// ------------------------------------------------------------------------------------------ Net Worth

const MID_MONTH_DAY = 15;

/**
 * Mid-month and month-end points clipped to the range, plus today when it falls inside the range between
 * them, so the chart ends at the balance the heading and legend show (15 §4.5).
 */
function netWorthPoints(range: DateRange, today: ISODate): NetWorthPoint[] {
  const out: NetWorthPoint[] = [];
  const inRange = today >= range.start && today <= range.end;
  let todayPlaced = false;
  const placeToday = (before: ISODate): void => {
    if (!inRange || todayPlaced || today > before) return;
    todayPlaced = true;
    if (today < before) out.push({ date: today, kind: 'today', future: false });
  };
  for (const m of monthsOfRange(range)) {
    const end = minDate(monthBounds(m).last, range.end);
    const mid = `${m}-${String(MID_MONTH_DAY)}` as ISODate;
    if (mid >= range.start && mid < end) {
      placeToday(mid);
      out.push({ date: mid, kind: 'mid', future: mid > today });
    }
    placeToday(end);
    out.push({ date: end, kind: 'end', future: end > today });
  }
  return out;
}

function netWorth(
  index: ReportIndex,
  filters: Pick<CommonFilters, 'accounts'>,
  range: DateRange,
  today: ISODate,
): NetWorthReport {
  const months = monthsOfRange(range);
  const points = netWorthPoints(range, today);
  const latestDate = minDate(range.end, today);
  const startDate = startSnapshot(range, today);
  const selected = selectedAccounts(index, filters.accounts);
  const monthEnds = months.map((m) => minDate(monthBounds(m).last, range.end));
  const dates = [
    ...new Set([startDate, latestDate, ...points.map((p) => p.date), ...monthEnds]),
  ].sort();
  const snapshots = balancesAt(index.input.sides, selected, dates);
  const balance = (id: Id, date: ISODate): Money => snapshots[dates.indexOf(date)]?.get(id) ?? 0;

  const ordered = index.input.accounts
    .filter((a) => selected.has(a.id))
    .sort((a, b) => Number(a.offBudget) - Number(b.offBudget) || a.sortIndex - b.sortIndex);
  const accounts: NetWorthAccount[] = ordered.map((a) => {
    const end = balance(a.id, latestDate);
    const start = balance(a.id, startDate);
    return {
      key: a.id,
      label: name(a.name),
      offBudget: a.offBudget,
      values: points.map((p) => (p.future ? null : balance(a.id, p.date))),
      monthEnd: monthEnds.map((d) => (d > today ? null : balance(a.id, d))),
      start,
      end,
      change: end - start,
    };
  });
  const add = (pick: (a: NetWorthAccount) => Money | null, isFuture: boolean): Money | null =>
    isFuture ? null : accounts.reduce<Money>((s, a) => s + (pick(a) ?? 0), 0);
  const start = accounts.reduce<Money>((s, a) => s + a.start, 0);
  const end = accounts.reduce<Money>((s, a) => s + a.end, 0);
  return {
    kind: 'netWorth',
    range,
    months,
    points,
    latestDate,
    accounts,
    total: {
      key: 'total',
      label: name(''),
      values: points.map((p, i) => add((a) => a.values[i] ?? null, p.future)),
      monthEnd: monthEnds.map((d, i) => add((a) => a.monthEnd[i] ?? null, d > today)),
      start,
      end,
      change: end - start,
    },
  };
}

// ------------------------------------------------------------------------------------------ entry point

/**
 * One report from its normalized input (15 §4–6). `input.sides` holds all history (Money Age and balances
 * need it), sorted by date.
 */
export function buildReport(input: ReportInput, request: ReportRequest): ReportResult {
  const index = indexOf(input);
  // Comparison's Compare Period is a calendar period of its own, never the Timeframe (15 §4.3).
  if (request.kind === 'comparison')
    return comparison(
      index,
      request.filters,
      comparedPeriods(request.options, request.weekStart),
      request.today,
    );
  const range = resolveTimeframe(request.filters.timeframe, request.today, earliestDate(input));
  switch (request.kind) {
    case 'summary':
      return summary(index, request.filters, range, request.today);
    case 'breakdown':
      return breakdown(index, request.filters, request.options, range, request);
    case 'inflowOutflow':
      return inflowOutflow(index, request.filters, range, request.today);
    case 'netWorth':
      return netWorth(index, request.filters, range, request.today);
  }
}
