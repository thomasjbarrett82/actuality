// Report texts (15 §8, 20 §4.1): synthetic labels, timeframe and selection summaries, period headers and
// percentages, all through i18n and the budget's formats. Amounts go through money-display, so privacy
// mode masks them everywhere they appear.
import type { WeekDay } from '@shared/budget-format';
import { parts } from '@shared/dates';
import type { Id, ISODate, Month } from '@shared/domain/types';
import { dateShort, monthShortFullYear, monthShortYear } from '@shared/format';
import type {
  AccountSelection,
  BreakdownGroupBy,
  ComparisonOptions,
  PeriodUnit,
  RangePreset,
  ReportPage,
  Selection,
  Timeframe,
} from '@shared/reporting/model';
import { comparedPeriods, isWholeMonths, type DateRange } from '@shared/reporting/periods';
import type { BasisPoints, ChangePercent, ReportLabel } from '@shared/reporting/result';
import { dateLocale, i18n } from '../i18n';
import { tr, trn } from '../register/dialogs';

export const PAGE_KEYS: Readonly<Record<ReportPage, string>> = {
  summary: 'reports.tabSummary',
  breakdown: 'reports.tabBreakdown',
  comparison: 'reports.tabComparison',
  inflowOutflow: 'reports.tabInflowOutflow',
  netWorth: 'reports.tabNetWorth',
};

export const PRESET_KEYS: Readonly<Record<RangePreset, string>> = {
  thisMonth: 'reports.presetThisMonth',
  latest3: 'reports.presetLatest3',
  thisYear: 'reports.presetThisYear',
  lastYear: 'reports.presetLastYear',
  all: 'reports.presetAll',
};

/** A row or series label as text. */
export function labelText(label: ReportLabel): string {
  switch (label.kind) {
    case 'name':
      return label.text;
    case 'transfer':
      return tr('app.transferPayee', { account: label.account });
    case 'uncategorized':
      return tr('reports.uncategorized');
    case 'noPayee':
      return tr('reports.noPayee');
    case 'allIncome':
      return tr('reports.allIncomeSources');
    case 'other':
      return trn('reports.otherItems', label.count, { count: label.count });
  }
}

/** A date range: "Aug '26–Oct '26" for whole months, else the two dates in the budget's format. */
export function rangeText(range: DateRange, dateFormat: string): string {
  if (isWholeMonths(range)) {
    const start = monthShortYear(range.start.slice(0, 7) as Month, dateLocale.value);
    const end = monthShortYear(range.end.slice(0, 7) as Month, dateLocale.value);
    return start === end ? start : tr('reports.rangeText', { start, end });
  }
  return tr('reports.rangeText', {
    start: dateShort(range.start, dateFormat),
    end: dateShort(range.end, dateFormat),
  });
}

/** The Timeframe trigger: the preset's name, or the custom range. */
export function timeframeText(timeframe: Timeframe, dateFormat: string): string {
  return timeframe.kind === 'preset'
    ? tr(PRESET_KEYS[timeframe.preset])
    : rangeText(timeframe, dateFormat);
}

export type SelectionKind = 'categories' | 'payees' | 'accounts';

const SUMMARY_KEYS: Record<SelectionKind, { all: string; none: string; count: string }> = {
  categories: {
    all: 'reports.allCategories',
    none: 'reports.noCategories',
    count: 'reports.countCategories',
  },
  payees: { all: 'reports.allPayees', none: 'reports.noPayees', count: 'reports.countPayees' },
  accounts: {
    all: 'reports.allAccounts',
    none: 'reports.noAccounts',
    count: 'reports.countAccounts',
  },
};

/** A filter trigger (15 §2.1): all, none, the single selection's name, or the number selected. */
export function selectionText(
  kind: SelectionKind,
  selection: Selection | AccountSelection,
  nameOf: (id: Id) => string | null,
): string {
  const keys = SUMMARY_KEYS[kind];
  if (selection.kind === 'all') return tr(keys.all);
  if (selection.kind === 'onBudget') return tr('reports.budgetAccounts');
  if (selection.ids.length === 0) return tr(keys.none);
  const [only] = selection.ids;
  if (selection.ids.length === 1 && only !== undefined) {
    const name = nameOf(only);
    if (name !== null) return name;
  }
  return trn(keys.count, selection.ids.length, { n: selection.ids.length });
}

/** A period header (15 §4.2): the week's first day, the month, "Q3 2026" or the year. */
export function periodText(
  period: DateRange,
  groupBy: BreakdownGroupBy,
  dateFormat: string,
): string {
  const { y, m } = parts(period.start);
  switch (groupBy) {
    case 'week':
      return dateShort(period.start, dateFormat, true);
    case 'month':
      return monthShortYear(period.start.slice(0, 7) as Month, dateLocale.value);
    case 'quarter':
      return tr('reports.quarterLabel', { quarter: Math.floor((m - 1) / 3) + 1, year: y });
    case 'year':
      return String(y);
  }
}

const THIS_PERIOD_KEYS: Readonly<Record<PeriodUnit, string>> = {
  week: 'reports.compareThisWeek',
  month: 'reports.compareThisMonth',
  quarter: 'reports.compareThisQuarter',
  year: 'reports.compareThisYear',
};

/**
 * A Compare Period name (15 §4.3): "Week of 10/18/2026", "Oct 2026", "Q4 2026" or "2026"; the period
 * holding today reads "This Month (Oct 2026)".
 */
export function comparePeriodText(
  period: DateRange,
  unit: PeriodUnit,
  today: ISODate,
  dateFormat: string,
): string {
  const name =
    unit === 'week'
      ? tr('reports.weekOf', { date: dateShort(period.start, dateFormat) })
      : unit === 'month'
        ? monthShortFullYear(period.start.slice(0, 7) as Month, dateLocale.value)
        : periodText(period, unit, dateFormat);
  return period.start <= today && today <= period.end
    ? tr(THIS_PERIOD_KEYS[unit], { period: name })
    : name;
}

/** The Compare Period trigger: the selected period's name. */
export const comparisonText = (
  options: ComparisonOptions,
  weekStart: WeekDay,
  today: ISODate,
  dateFormat: string,
): string =>
  comparePeriodText(comparedPeriods(options, weekStart).current, options.unit, today, dateFormat);

export const monthText = (month: Month): string => monthShortYear(month, dateLocale.value);

export const dateText = (date: ISODate, dateFormat: string): string => dateShort(date, dateFormat);

/** A share or coverage in basis points, as a localized percentage (one decimal). */
export function percentText(bp: BasisPoints, signed = false): string {
  return new Intl.NumberFormat(i18n.global.locale.value, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {}),
  }).format(bp / 10_000);
}

/** Change % (15 §4.3): a signed percentage, "New", or zero. */
export function changePercentText(change: ChangePercent): string {
  if (change.kind === 'new') return tr('reports.changeNew');
  return percentText(change.kind === 'zero' ? 0 : change.value, true);
}
