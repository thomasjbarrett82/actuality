// The currency symbol on reports (15 §4): every amount a report shows, in its widgets, tables,
// chart axes, tooltips, accessible names and descriptions, and print, carries the budget's symbol in its
// position and spacing. Privacy mode masks the whole value instead.
import type { MoneySettings } from '@shared/money';
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import { HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import { REPORT_FIXTURE, TODAY } from '@shared/reporting/fixture';
import { DEFAULT_BREAKDOWN, DEFAULT_FILTERS, type ReportRequest } from '@shared/reporting/model';
import { buildReport } from '@shared/reporting/reports';
import type { ReportResult } from '@shared/reporting/result';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import type { VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import { exportDocument } from '../../reports/export-tables';
import { printReport } from '../../reports/report-flow';
import { useSettings } from '../../stores/settings';
import { mountApp } from '../../testing/mount';
import BreakdownView from './BreakdownView.vue';
import ComparisonView from './ComparisonView.vue';
import InflowOutflowView from './InflowOutflowView.vue';
import NetWorthView from './NetWorthView.vue';
import SummaryView from './SummaryView.vue';

/** Symbol after the amount with a space, so a bare amount can't pass for one with a symbol. */
const EUR: MoneySettings = {
  ...DEFAULT_MONEY_SETTINGS,
  numberFormat: 'dot-comma',
  currencyCode: 'EUR',
  symbolPosition: 'after',
  spaceBetweenAmountAndSymbol: true,
};
const USD: MoneySettings = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'USD' };
/** A `dot-comma` amount ("1.234,56") not followed by " €". */
const BARE_EUR = /\d,\d{2}(?! €)/;

const clock = { today: TODAY, weekStart: 0 as const };
const { categories, payees, accounts } = DEFAULT_FILTERS;
const VIEWS: { name: string; view: Component; request: ReportRequest }[] = [
  {
    name: 'Summary',
    view: SummaryView,
    request: { ...clock, kind: 'summary', filters: DEFAULT_FILTERS },
  },
  {
    name: 'Spending Breakdown',
    view: BreakdownView,
    request: { ...clock, kind: 'breakdown', filters: DEFAULT_FILTERS, options: DEFAULT_BREAKDOWN },
  },
  {
    name: 'Spending Comparison',
    view: ComparisonView,
    request: {
      ...clock,
      kind: 'comparison',
      filters: { categories, payees, accounts },
      options: { unit: 'month', start: '2026-10-01' },
    },
  },
  {
    name: 'Inflow vs Outflow',
    view: InflowOutflowView,
    request: { ...clock, kind: 'inflowOutflow', filters: DEFAULT_FILTERS },
  },
  {
    name: 'Net Worth',
    view: NetWorthView,
    request: {
      ...clock,
      kind: 'netWorth',
      filters: {
        timeframe: { kind: 'custom', start: '2026-09-01', end: '2026-10-31' },
        accounts: { kind: 'all' },
      },
    },
  },
];

const mountView = (view: Component, report: ReportResult, money: MoneySettings): VueWrapper =>
  mountApp(view, { props: { report, money, dateFormat: 'MM/dd/yyyy' } }) as VueWrapper;

/**
 * Everything the view shows or names: its text with every row expanded, its accessible names and
 * descriptions, and each chart's tooltip at every position. Percentages are left out: they follow the UI
 * locale ("+1,431.3%"), not the budget's number format.
 */
async function everythingShown(w: VueWrapper): Promise<string> {
  for (const b of w.findAll('button[aria-expanded="false"]')) await b.trigger('click');
  const parts = [w.text()];
  for (const el of w.findAll('[aria-label], [aria-description]')) {
    parts.push(el.attributes('aria-label') ?? '', el.attributes('aria-description') ?? '');
  }
  for (const chart of w.findAll('svg[role="img"][aria-describedby]')) {
    await chart.trigger('focus');
    for (let i = 0; i < 40; i++) {
      parts.push(w.find('[role="tooltip"]').text());
      await chart.trigger('keydown', { key: 'ArrowRight' });
    }
    await chart.trigger('blur');
  }
  return parts.join('\n').replace(/[-+]?[\d.,]+%/g, '%');
}

const privacy = (on: boolean): void => {
  useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: on };
};

beforeEach(() => {
  privacy(false);
});

describe('the currency symbol on reports (15 §4)', () => {
  for (const { name, view, request } of VIEWS) {
    it(`${name}: every amount carries the symbol in its position and spacing`, async () => {
      const w = mountView(view, buildReport(REPORT_FIXTURE, request), EUR);
      const shown = await everythingShown(w);
      expect(shown).toMatch(/\d,\d{2} €/);
      expect(shown).not.toMatch(BARE_EUR);
    });
  }

  it('puts a leading symbol after the minus sign, without a space', () => {
    const [summary] = VIEWS;
    if (!summary) throw new Error('no case');
    const w = mountView(summary.view, buildReport(REPORT_FIXTURE, summary.request), USD);
    const values = w.findAll('.card--value .card__value').map((v) => v.text());
    expect(values).toHaveLength(6);
    for (const v of values) expect(v).toMatch(/^[-+]?\$\d[\d,]*\.\d{2}$/);
  });

  it('masks the whole value, symbol included, in privacy mode', async () => {
    privacy(true);
    const [summary] = VIEWS;
    if (!summary) throw new Error('no case');
    const w = mountView(summary.view, buildReport(REPORT_FIXTURE, summary.request), EUR);
    const shown = await everythingShown(w);
    expect(shown).not.toContain('€');
    expect(shown).not.toMatch(/\d,\d{2}/);
    expect(shown).toContain(HIDDEN_AMOUNT_TEXT);
    expect(w.findAll('.card--value .money-mask')).toHaveLength(6);
  });

  it('prints every table amount with the symbol', async () => {
    const [, breakdown] = VIEWS;
    if (!breakdown) throw new Error('no case');
    const doc = exportDocument(buildReport(REPORT_FIXTURE, breakdown.request), {
      page: 'breakdown',
      dateFormat: 'MM/dd/yyyy',
      filters: {
        categories: 'All Categories',
        timeframe: 'Latest 3 Months',
        payees: 'All Payees',
        accounts: 'Budget Accounts',
      },
      netWorth: { mode: 'multiline' },
    });
    await printReport(doc, EUR, 'Spending Breakdown', []);
    const html = vi.mocked(window.app.shell).printPreview.mock.calls[0]?.[0].html ?? '';
    const tables = html.slice(html.indexOf('<table>'));
    expect(tables).toMatch(/\d,\d{2} €/);
    expect(tables).not.toMatch(BARE_EUR);
  });
});
