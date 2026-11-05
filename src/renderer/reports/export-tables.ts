// The active report as export tables (15 §7, 16 §2.4, §3): what CSV and Print show, with every collapsed
// group and Other member included, plus the report's effective filters and options. Texts are in the UI
// language; dates use the budget's format.
import { addDays } from '@shared/dates';
import type { ExportDocument, ExportRow, ExportTable, ExportValue } from '@shared/reporting/csv';
import type { NetWorthOptions, ReportPage } from '@shared/reporting/model';
import { dayCount } from '@shared/reporting/periods';
import type { ReportResult, ReportRow } from '@shared/reporting/result';
import { tr, trn } from '../register/dialogs';
import {
  changePercentText,
  dateText,
  labelText,
  monthText,
  PAGE_KEYS,
  percentText,
  periodText,
  rangeText,
} from './labels';

/** The filter triggers' texts and the page options, already localized. */
export interface ExportContext {
  page: ReportPage;
  dateFormat: string;
  /** `timeframe` is Spending Comparison's Compare Period on that page. */
  filters: { categories: string; timeframe: string; payees: string; accounts: string };
  netWorth: NetWorthOptions;
}

const text = (s: string): ExportValue => ({ text: s });
const row = (r: ReportRow, level = 0): ExportRow => ({
  label: labelText(r.label),
  level,
  values: [...r.values, r.average, r.total],
});

function metaOf(result: ReportResult, ctx: ExportContext): [string, string][] {
  const meta: [string, string][] = [[tr('reports.report'), tr(PAGE_KEYS[ctx.page])]];
  if (result.kind === 'comparison') {
    meta.push([tr('reports.filterComparePeriod'), ctx.filters.timeframe]);
  } else {
    const resolved = rangeText(result.range, ctx.dateFormat);
    // A preset names the range it resolved to; a custom range already is one.
    meta.push([
      tr('reports.filterTimeframe'),
      ctx.filters.timeframe === resolved ? resolved : `${ctx.filters.timeframe} (${resolved})`,
    ]);
  }
  if (ctx.page !== 'netWorth') {
    meta.push([tr('reports.filterCategories'), ctx.filters.categories]);
    meta.push([tr('reports.filterPayees'), ctx.filters.payees]);
  }
  meta.push([tr('reports.filterAccounts'), ctx.filters.accounts]);
  if (result.kind === 'breakdown') {
    meta.push([tr('reports.groupBy'), tr(PERIOD_KEYS[result.groupBy])]);
    meta.push([tr('reports.stackBy'), tr(STACK_KEYS[result.stackBy])]);
    if (result.drill) meta.push([tr('reports.drilledGroup'), labelText(result.drill.label)]);
  }
  if (result.kind === 'comparison')
    meta.push([tr('reports.previous'), rangeText(result.previous, ctx.dateFormat)]);
  if (result.kind === 'netWorth') {
    meta.push([
      tr('reports.netWorthMode'),
      tr(ctx.netWorth.mode === 'single' ? 'reports.modeSingle' : 'reports.modeMultiline'),
    ]);
  }
  return meta;
}

const PERIOD_KEYS = {
  week: 'reports.periodWeek',
  month: 'reports.periodMonth',
  quarter: 'reports.periodQuarter',
  year: 'reports.periodYear',
} as const;
const TITLE_KEYS = {
  week: 'reports.breakdownTitleWeek',
  month: 'reports.breakdownTitleMonth',
  quarter: 'reports.breakdownTitleQuarter',
  year: 'reports.breakdownTitleYear',
} as const;
const STACK_KEYS = {
  categoryGroup: 'reports.stackGroup',
  payee: 'reports.stackPayee',
  account: 'reports.stackAccount',
} as const;

function tablesOf(result: ReportResult, dateFormat: string): ExportTable[] {
  switch (result.kind) {
    case 'summary': {
      const days = (n: number | null): string => (n === null ? '' : trn('reports.moneyAgeDays', n));
      return [
        {
          title: tr('reports.tabSummary'),
          head: [tr('reports.colMeasure'), tr('reports.colAmount')],
          rows: [
            ['reports.totalInflow', result.inflow],
            ['reports.totalOutflow', result.outflow],
            ['reports.netFlow', result.net],
            ['reports.avgInflow', result.averageInflow],
            ['reports.avgOutflow', result.averageOutflow],
            ['reports.avgNet', result.averageNet],
            ['reports.budgetedNetWorth', result.netWorth.current],
          ].map(([key, value]) => ({
            label: tr(key as string),
            level: 0,
            values: [value as number],
          })),
        },
        {
          title: tr('reports.budgetedNetWorthTrend'),
          head: [tr('reports.colMonth'), tr('reports.colBalance')],
          rows: [
            {
              label: dateText(result.netWorth.startDate, dateFormat),
              level: 0,
              values: [result.netWorth.start],
            },
            ...result.netWorth.trend.map((p) => ({
              label: monthText(p.month),
              level: 0,
              values: [p.value],
            })),
          ],
        },
        {
          title: tr('reports.topGroups'),
          head: [tr('reports.colCategoryGroup'), tr('reports.colShare'), tr('reports.colAmount')],
          rows: result.topGroups.slices.map((s) => ({
            label: labelText(s.label),
            level: 0,
            values: [text(percentText(s.share)), s.amount],
          })),
        },
        {
          title: tr('reports.moneyAgeTrend'),
          head: [tr('reports.colMonth'), tr('reports.colMoneyAge'), tr('reports.colCoverage')],
          rows: result.moneyAge.points.map((p) => ({
            label: monthText(p.month),
            level: 0,
            values: [text(days(p.days)), text(p.coverage === null ? '' : percentText(p.coverage))],
          })),
        },
      ];
    }
    case 'breakdown':
      return [
        {
          title: tr(TITLE_KEYS[result.groupBy]),
          head: [
            tr('reports.colItem'),
            ...result.periods.map((p) => periodText(p, result.groupBy, dateFormat)),
            tr('reports.average'),
            tr('reports.total'),
          ],
          rows: [
            ...result.series.flatMap((s) => [row(s), ...s.members.map((m) => row(m, 1))]),
            { ...row(result.total), label: tr('reports.totalSpending'), tone: 'total' as const },
          ],
        },
      ];
    case 'comparison': {
      const values = (r: (typeof result.rows)[number]): ExportValue[] => [
        r.current,
        r.previous,
        r.change,
        text(changePercentText(r.changePercent)),
      ];
      return [
        {
          title: tr('reports.comparisonTitle'),
          head: [
            tr('reports.colCategory'),
            tr('reports.current'),
            tr('reports.previous'),
            tr('reports.change'),
            tr('reports.changePercent'),
          ],
          rows: [
            ...result.rows.flatMap((g) => [
              { label: labelText(g.label), level: 0, values: values(g) },
              ...g.children.map((c) => ({
                label: labelText(c.label),
                level: 1,
                values: values(c),
              })),
            ]),
            {
              label: tr('reports.totalSpending'),
              level: 0,
              values: values(result.total),
              tone: 'total' as const,
            },
          ],
        },
        {
          title: tr('reports.comparisonCumulative'),
          head: [tr('reports.colDay'), tr('reports.current'), tr('reports.previous')],
          rows: Array.from(
            { length: Math.max(dayCount(result.current), dayCount(result.previous)) },
            (_, i) => ({
              label: tr('reports.dayN', { n: i + 1 }),
              level: 0,
              values: [result.cumulative.current[i] ?? null, result.cumulative.previous[i] ?? null],
            }),
          ),
        },
      ];
    }
    case 'inflowOutflow': {
      const blank = result.months.map(() => text(''));
      const section = (label: string): ExportRow => ({
        label,
        level: 0,
        values: [...blank, text(''), text('')],
        tone: 'section',
      });
      const sources = result.inflow.sources;
      return [
        {
          title: tr('reports.tabInflowOutflow'),
          head: [
            tr('reports.colCategoryOrPayee'),
            ...result.months.map(monthText),
            tr('reports.average'),
            tr('reports.total'),
          ],
          rows: [
            section(tr('reports.inflow')),
            ...(sources ? [row(sources), ...sources.children.map((c) => row(c, 1))] : []),
            ...result.inflow.transfers.map((r) => row(r)),
            { ...row(result.inflow.total), label: tr('reports.totalInflow'), tone: 'total' },
            section(tr('reports.outflow')),
            ...(result.outflow.uncategorized ? [row(result.outflow.uncategorized)] : []),
            ...result.outflow.groups.flatMap((g) => [row(g), ...g.children.map((c) => row(c, 1))]),
            { ...row(result.outflow.total), label: tr('reports.totalOutflow'), tone: 'total' },
            { ...row(result.net), label: tr('reports.netIncome'), tone: 'total' },
          ],
        },
      ];
    }
    case 'netWorth': {
      return [
        {
          title: tr('reports.netWorthTable'),
          head: [tr('reports.colAccount'), ...result.months.map(monthText), tr('reports.change')],
          rows: [
            ...result.accounts.map((a) => ({
              label: labelText(a.label),
              level: 0,
              values: [...a.monthEnd, a.change],
            })),
            {
              label: tr('reports.netWorth'),
              level: 0,
              values: [...result.total.monthEnd, result.total.change],
              tone: 'total' as const,
            },
          ],
        },
        {
          title: tr('reports.netWorthPoints'),
          head: [
            tr('reports.colAccount'),
            dateText(addDays(result.range.start, -1), dateFormat),
            ...result.points.map((p) => dateText(p.date, dateFormat)),
          ],
          rows: [
            ...result.accounts.map((a) => ({
              label: labelText(a.label),
              level: 0,
              values: [a.start, ...a.values],
            })),
            {
              label: tr('reports.netWorth'),
              level: 0,
              values: [result.total.start, ...result.total.values],
              tone: 'total' as const,
            },
          ],
        },
      ];
    }
  }
}

export function exportDocument(result: ReportResult, ctx: ExportContext): ExportDocument {
  return { meta: metaOf(result, ctx), tables: tablesOf(result, ctx.dateFormat) };
}
