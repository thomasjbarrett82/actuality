// The report DTOs `reports.get` returns (15 §4, §7; 03 §8): bounded aggregate rows and series, never the
// transaction ledger. Labels are data, not text: the renderer localizes the synthetic ones (20 §4.1).
// Amounts are integer minor units; Spending Breakdown and Comparison use the spending presentation.
// Null is an unobserved future period, shown as unavailable.
import type { Id, ISODate, Money, Month } from '../domain/types';
import type { BreakdownGroupBy, BreakdownStackBy } from './model';
import type { DateRange, Period } from './periods';

export type ReportLabel =
  | { kind: 'name'; text: string }
  | { kind: 'transfer'; account: string }
  | { kind: 'uncategorized' }
  | { kind: 'noPayee' }
  | { kind: 'allIncome' }
  | { kind: 'other'; count: number };

/** One value per period; null for an unobserved future period (15 §2.2). */
export type PeriodValues = (Money | null)[];

export interface ReportRow {
  key: string;
  label: ReportLabel;
  values: PeriodValues;
  average: Money;
  total: Money;
}

export interface ExpandableRow extends ReportRow {
  children: ReportRow[];
}

/** A series color (05 §1.11): `--report-series-{n}`, or `--report-series-other` for 'other'. */
export type SeriesColor = 1 | 2 | 3 | 4 | 5 | 6 | 'other';

/** A share in basis points (1/100 of a percent), or null when there is nothing to share. */
export type BasisPoints = number;

export interface MoneyAgePoint {
  month: Month;
  /** The average age in whole days, rounded for display; null without known-age matches. */
  days: number | null;
  /** Known-age cents matched to eligible spending, and all eligible spending cents (15 §5). */
  knownCents: Money;
  spendingCents: Money;
  /** `knownCents / spendingCents`; null in a month without eligible spending. */
  coverage: BasisPoints | null;
  future: boolean;
}

export interface SummarySlice {
  key: string;
  label: ReportLabel;
  /** Signed spending of the slice. */
  amount: Money;
  share: BasisPoints;
  color: SeriesColor;
}

export interface SummaryReport {
  kind: 'summary';
  range: DateRange;
  months: Month[];
  inflow: Money;
  outflow: Money;
  net: Money;
  averageInflow: Money;
  averageOutflow: Money;
  averageNet: Money;
  /** Budgeted Net Worth (15 §4.1): every open on-budget account, whatever the filters. */
  netWorth: {
    current: Money;
    /** The balance the day before the range starts. */
    start: Money;
    startDate: ISODate;
    /** Month-end balances in the range; null for a future month. The current month ends today. */
    trend: { month: Month; value: Money | null }[];
  };
  topGroups: { slices: SummarySlice[]; total: Money };
  moneyAge: { latest: MoneyAgePoint | null; points: MoneyAgePoint[] };
}

export interface BreakdownSeries extends ReportRow {
  kind: 'group' | 'category' | 'payee' | 'account' | 'uncategorized' | 'other';
  color: SeriesColor;
  /** A category group the user can drill into (15 §4.2). */
  drillable: boolean;
  /** The members of the Other series. */
  members: ReportRow[];
}

export interface BreakdownReport {
  kind: 'breakdown';
  range: DateRange;
  groupBy: BreakdownGroupBy;
  stackBy: BreakdownStackBy;
  periods: Period[];
  /** The drilled category group, or null for all spending. */
  drill: { groupId: Id; label: ReportLabel } | null;
  series: BreakdownSeries[];
  total: ReportRow;
}

export type ChangePercent =
  { kind: 'percent'; value: BasisPoints } | { kind: 'new' } | { kind: 'zero' };

export interface ComparisonRow {
  key: string;
  label: ReportLabel;
  current: Money;
  previous: Money;
  change: Money;
  changePercent: ChangePercent;
  children: ComparisonRow[];
}

export interface ComparisonReport {
  kind: 'comparison';
  current: DateRange;
  previous: DateRange;
  /** Days of the current range observed so far; both series and the table stop there (15 §4.3). */
  observedDays: number;
  /** True when the current range is still in progress. */
  partial: boolean;
  /** Cumulative displayed net spending by day offset from each range's start. */
  cumulative: { current: Money[]; previous: Money[] };
  rows: ComparisonRow[];
  total: ComparisonRow;
}

export interface InflowOutflowReport {
  kind: 'inflowOutflow';
  range: DateRange;
  months: Month[];
  future: boolean[];
  inflow: {
    /** Income payees under All Income Sources. */
    sources: ExpandableRow | null;
    /** Transfer inflows under their income categories. */
    transfers: ReportRow[];
    total: ReportRow;
  };
  outflow: {
    uncategorized: ReportRow | null;
    groups: ExpandableRow[];
    total: ReportRow;
  };
  net: ReportRow;
}

export interface NetWorthPoint {
  date: ISODate;
  kind: 'mid' | 'end' | 'today';
  future: boolean;
}

export interface NetWorthSeries {
  key: string;
  label: ReportLabel;
  /** Per point; null for a future point. */
  values: (Money | null)[];
  /** Per month in the range: its month-end balance (null in the future). */
  monthEnd: (Money | null)[];
  start: Money;
  end: Money;
  change: Money;
}

export interface NetWorthAccount extends NetWorthSeries {
  offBudget: boolean;
}

export interface NetWorthReport {
  kind: 'netWorth';
  range: DateRange;
  months: Month[];
  points: NetWorthPoint[];
  /** The latest available balance date: the range end, or today when it ends in the future. */
  latestDate: ISODate;
  accounts: NetWorthAccount[];
  total: NetWorthSeries;
}

export type ReportResult =
  SummaryReport | BreakdownReport | ComparisonReport | InflowOutflowReport | NetWorthReport;
