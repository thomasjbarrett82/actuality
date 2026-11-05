// Reports CSV and Print (15 §7, 16 §2.4, §3): golden CSVs for every report and its options,
// privacy masking, the save dialog's cancel, the host write and its errors, and the print document.
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import { HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import { reportCsv } from '@shared/reporting/csv';
import { REPORT_FIXTURE, TODAY } from '@shared/reporting/fixture';
import { DEFAULT_FILTERS, DEFAULT_NET_WORTH, type ReportRequest } from '@shared/reporting/model';
import { buildReport } from '@shared/reporting/reports';
import { RpcError } from '@shared/rpc/protocol';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../stores/settings';
import { answerDialog, mockHost } from '../testing/fixtures';
import { exportDocument, type ExportContext } from './export-tables';
import { exportReportCsv, printReport } from './report-flow';

const clock = { today: TODAY, weekStart: 0 as const };
const { categories, payees, accounts } = DEFAULT_FILTERS;
const COMPARISON_FILTERS = { categories, payees, accounts };
/** The Timeframe trigger a request's page would show, or Spending Comparison's Compare Period. */
function timeframeOf(request?: ReportRequest): string {
  if (request?.kind === 'comparison') return 'This Month (Oct 2026)';
  return request?.filters.timeframe.kind === 'custom' ? "Sep '26–Oct '26" : 'Latest 3 Months';
}

/** The context a request's page would show: its trigger texts and Net Worth options. */
const ctx = (page: ExportContext['page'], request?: ReportRequest): ExportContext => ({
  page,
  dateFormat: 'MM/dd/yyyy',
  filters: {
    categories: 'All Categories',
    timeframe: timeframeOf(request),
    payees: 'All Payees',
    accounts: request?.filters.accounts.kind === 'all' ? 'All Accounts' : 'Budget Accounts',
  },
  netWorth: request?.kind === 'netWorth' ? { mode: 'multiline' } : { ...DEFAULT_NET_WORTH },
});

const CASES: { name: string; request: ReportRequest }[] = [
  { name: 'summary', request: { ...clock, kind: 'summary', filters: DEFAULT_FILTERS } },
  {
    name: 'breakdown-group',
    request: {
      ...clock,
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: null },
    },
  },
  {
    name: 'breakdown-drill-payee',
    request: {
      ...clock,
      kind: 'breakdown',
      filters: DEFAULT_FILTERS,
      options: { groupBy: 'quarter', stackBy: 'payee', drillGroupId: 'g-food' },
    },
  },
  {
    name: 'comparison',
    request: {
      ...clock,
      kind: 'comparison',
      filters: COMPARISON_FILTERS,
      options: { unit: 'month', start: '2026-10-01' },
    },
  },
  {
    name: 'inflow-outflow',
    request: { ...clock, kind: 'inflowOutflow', filters: DEFAULT_FILTERS },
  },
  {
    name: 'net-worth',
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

const pageOf = (r: ReportRequest): ExportContext['page'] => r.kind;

describe('report CSV (16 §2.4)', () => {
  for (const { name, request } of CASES) {
    it(`matches the golden ${name}.csv`, async () => {
      const doc = exportDocument(
        buildReport(REPORT_FIXTURE, request),
        ctx(pageOf(request), request),
      );
      await expect(reportCsv(doc, DEFAULT_MONEY_SETTINGS, false)).toMatchFileSnapshot(
        `./golden/${name}.csv`,
      );
    });
  }

  it('masks every amount with privacy mode on, keeping labels and percentages', () => {
    const [summary] = CASES;
    if (!summary) throw new Error('no case');
    const doc = exportDocument(buildReport(REPORT_FIXTURE, summary.request), ctx('summary'));
    const masked = reportCsv(doc, DEFAULT_MONEY_SETTINGS, true);
    expect(masked).toContain(HIDDEN_AMOUNT_TEXT);
    expect(masked).not.toMatch(/\d+\.\d\d/);
    expect(masked).toContain('"Total Inflow"');
    expect(masked).toContain('76.6%');
  });
});

describe('report export and print flows (15 §7)', () => {
  let host: ReturnType<typeof mockHost>;
  const [, breakdown] = CASES;
  if (!breakdown) throw new Error('no case');
  const doc = () =>
    exportDocument(buildReport(REPORT_FIXTURE, breakdown.request), ctx('breakdown'));

  beforeEach(() => {
    host = mockHost({ 'export.reportCsv': () => null });
  });

  it('writes nothing when the save dialog is cancelled', async () => {
    await exportReportCsv(doc(), DEFAULT_MONEY_SETTINGS, { report: 'Breakdown', range: 'x' });
    expect(host.calls('export.reportCsv')).toEqual([]);
  });

  it('writes the CSV to the chosen path, masked in privacy mode', async () => {
    vi.mocked(window.app.shell.files).saveFile.mockResolvedValue('/out/r.csv');
    useSettings().app = { ...useSettings().app, privacyMode: true };
    await exportReportCsv(doc(), DEFAULT_MONEY_SETTINGS, {
      report: 'Spending Breakdown',
      range: '2026-08-01–2026-10-31',
    });
    expect(vi.mocked(window.app.shell.files).saveFile.mock.calls[0]?.[0].defaultName).toBe(
      'Actuality Spending Breakdown 2026-08-01–2026-10-31.csv',
    );
    const [params] = host.calls('export.reportCsv') as { path: string; content: string }[];
    expect(params?.path).toBe('/out/r.csv');
    expect(params?.content).toContain(HIDDEN_AMOUNT_TEXT);
  });

  it('reports a locked file', async () => {
    vi.mocked(window.app.shell.files).saveFile.mockResolvedValue('/out/r.csv');
    host = mockHost({
      'export.reportCsv': () => {
        throw new RpcError('internal', 'busy', { code: 'file-locked' });
      },
    });
    const done = exportReportCsv(doc(), DEFAULT_MONEY_SETTINGS, { report: 'B', range: 'x' });
    await flushPromises();
    const dialog = await answerDialog('close');
    await done;
    expect(dialog.icon).toBe('error');
  });

  it('prints the report with its filters, chart and every table row', async () => {
    const chart = document.createElement('div');
    chart.innerHTML = '<svg role="img" aria-label="Spending"></svg>';
    await printReport(doc(), DEFAULT_MONEY_SETTINGS, 'Spending Breakdown', [chart]);
    const [args] = vi.mocked(window.app.shell).printPreview.mock.calls[0] ?? [];
    expect(args?.html).toContain('<h1>Spending Breakdown</h1>');
    expect(args?.html).toContain('Latest 3 Months');
    expect(args?.html).toContain('aria-label="Spending"');
    expect(args?.html).toContain('--report-series-1:#006fae');
    expect(args?.html).toContain('Total Spending');
    expect(args?.pdfName).toBe('Spending Breakdown.pdf');
  });
});
