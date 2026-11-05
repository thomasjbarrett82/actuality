// Reports actions (15 §2–3, §7): the filter pickers, the Saved Filters menu and its dialogs, and the
// active report's CSV and Print. Every picker is a draft committed by Done; every status is announced.
// CSV goes through the native save dialog and the host (16 §2.4); Print through the print preview
// (16 §3). Neither crosses the main/preload shell boundary any other way.
import type { Id, ISODate } from '@shared/domain/types';
import { safeFileName } from '@shared/export/export-format';
import { reportCsv, type ExportDocument } from '@shared/reporting/csv';
import type {
  AccountSelection,
  ComparisonOptions,
  ReportPage,
  Selection,
  Timeframe,
} from '@shared/reporting/model';
import { announce } from '../a11y/announcer';
import { BELOW_LEFT } from '../components/common/callout-placement';
import { escapeRichText } from '../components/common/rich-text';
import ComparePeriodCallout from '../components/reports/ComparePeriodCallout.vue';
import ReportTimeframeCallout from '../components/reports/ReportTimeframeCallout.vue';
import SaveFilterDialog from '../components/reports/SaveFilterDialog.vue';
import SavedFiltersCallout from '../components/reports/SavedFiltersCallout.vue';
import SelectionCallout from '../components/reports/SelectionCallout.vue';
import { exportError } from '../export/export-flow';
import { weekStartsOn } from '../i18n';
import { esc, PRINT_PALETTES, printAmount, printDocument } from '../print/print-view';
import { tr } from '../register/dialogs';
import { host } from '../rpc/host-client';
import { useAppStore } from '../stores/app';
import { useCallouts } from '../stores/callouts';
import { useDialogs } from '../stores/dialogs';
import { useLoadingOverlay } from '../stores/loading';
import { useModals } from '../stores/modals';
import { useSettings } from '../stores/settings';
import { PAGE_KEYS } from './labels';
import { useReportsView } from './state';
import type { PickerEntry } from './view-types';

// ------------------------------------------------------------------------------------------ pickers

/** Opens a picker for a page's selection filter; applies the result on Done. */
export async function pickSelection(
  page: ReportPage,
  which: 'categories' | 'payees' | 'accounts',
  anchor: HTMLElement,
  entries: PickerEntry[],
  title: string,
  onBudget?: Id[],
): Promise<void> {
  const view = useReportsView();
  const result = await useCallouts().show(
    SelectionCallout,
    {
      entries,
      selected: view.filtersOf(page)[which],
      ...(onBudget ? { onBudget } : {}),
      searchLabel: tr('reports.searchLabel', { filter: title }),
    },
    { anchor, title, placements: BELOW_LEFT },
  );
  if (!result.startsWith('{')) return;
  const selection = JSON.parse(result) as Selection | AccountSelection;
  view.setFilters(page, { [which]: selection });
  announce(tr('reports.announceFilters', { report: tr(PAGE_KEYS[page]) }));
}

/** The years the Timeframe callout offers: twenty back through next year. */
const YEARS_BACK = 20;

export async function pickTimeframe(
  page: ReportPage,
  anchor: HTMLElement,
  today: ISODate,
): Promise<void> {
  const view = useReportsView();
  const year = Number(today.slice(0, 4));
  const result = await useCallouts().show(
    ReportTimeframeCallout,
    {
      current: view.filtersOf(page).timeframe,
      fromYear: year - YEARS_BACK,
      toYear: year + 1,
      today,
    },
    {
      anchor,
      title: tr('reports.filterTimeframe'),
      placements: BELOW_LEFT,
      width: 'popover-w-lg',
    },
  );
  if (!result.startsWith('{')) return;
  view.setFilters(page, { timeframe: JSON.parse(result) as Timeframe });
  announce(tr('reports.announceFilters', { report: tr(PAGE_KEYS[page]) }));
}

/** Spending Comparison's Compare Period (15 §4.3): page-specific, so it never touches the linked filters. */
export async function pickComparePeriod(
  anchor: HTMLElement,
  today: ISODate,
  dateFormat: string,
): Promise<void> {
  const view = useReportsView();
  const result = await useCallouts().show(
    ComparePeriodCallout,
    { current: view.comparison, today, weekStart: weekStartsOn.value, dateFormat },
    { anchor, title: tr('reports.filterComparePeriod'), placements: BELOW_LEFT },
  );
  if (!result.startsWith('{')) return;
  view.setComparison(JSON.parse(result) as ComparisonOptions);
  announce(tr('reports.announceFilters', { report: tr(PAGE_KEYS.comparison) }));
}

export function useLinked(page: ReportPage): void {
  useReportsView().useLinked(page);
  announce(tr('reports.announceLinked', { report: tr(PAGE_KEYS[page]) }));
}

// ------------------------------------------------------------------------------------------ saved filters

async function askName(
  title: string,
  button: string,
  initial: string,
  taken: string[],
): Promise<string | null> {
  return useModals().open<string>(SaveFilterDialog, { title, button, initial, taken });
}

/** The Saved Filters menu (15 §3): load, replace, rename, delete, or save the current selections. */
export async function savedFiltersMenu(page: ReportPage, anchor: HTMLElement): Promise<void> {
  const view = useReportsView();
  const list = view.saved(page);
  const match = view.matching(page);
  const result = await useCallouts().show(
    SavedFiltersCallout,
    { names: list.map((d) => d.name), match: match ? list.indexOf(match) : -1 },
    { anchor, title: tr('reports.savedFilters'), placements: BELOW_LEFT },
  );
  const names = list.map((d) => d.name);
  if (result === 'save') {
    const name = await askName(tr('reports.saveTitle'), tr('reports.saveButton'), '', names);
    if (name === null) return;
    await view.save(page, name);
    announce(tr('reports.announceSaved', { name }));
    return;
  }
  const [action, at] = result.split(':');
  const def = list[Number(at)];
  if (!def) return;
  switch (action) {
    case 'load':
      view.load(def);
      announce(tr('reports.announceSavedLoaded', { name: def.name }));
      return;
    case 'replace':
      await view.replace(page, def.name);
      announce(tr('reports.announceReplaced', { name: def.name }));
      return;
    case 'rename': {
      const name = await askName(
        tr('reports.renameTitle'),
        tr('reports.renameButton'),
        def.name,
        names.filter((n) => n !== def.name),
      );
      if (name !== null) await view.rename(page, def.name, name);
      return;
    }
    case 'delete': {
      const { button } = await useDialogs().showTaskDialog({
        instruction: tr('reports.deleteTitle', { name: escapeRichText(def.name) }),
        content: tr('reports.deleteMessage'),
        icon: 'warning',
        buttons: [{ id: 'delete', label: tr('reports.deleteButton') }, 'cancel'],
      });
      if (button !== 'delete') return;
      await view.remove(page, def.name);
      announce(tr('reports.announceDeleted', { name: def.name }));
    }
  }
}

// ------------------------------------------------------------------------------------------ CSV and Print

/** CSV (15 §7, 16 §2.4): masked like the screen while privacy mode is on. */
export async function exportReportCsv(
  doc: ExportDocument,
  money: Parameters<typeof reportCsv>[1],
  names: { report: string; range: string },
): Promise<void> {
  const path = await window.app.shell.files.saveFile({
    title: tr('reports.csvSaveTitle'),
    defaultName: safeFileName(tr('reports.csvFileName', names)),
    filters: [{ name: tr('reports.csvFilter'), extensions: ['csv'] }],
  });
  if (!path) return;
  const content = reportCsv(doc, money, useAppStore().privacyMode);
  try {
    await useLoadingOverlay().during(
      tr('app.expExporting'),
      host.call('export.reportCsv', { path, content }),
    );
  } catch (e) {
    announce(tr('reports.csvFailed'), 'assertive');
    await exportError(e);
    return;
  }
  announce(tr('reports.csvSaved', { path }));
}

/** The report token values of the print palettes (05 §1.11): Light, or Light CVD. */
const PRINT_REPORT_VARS = {
  standard: {
    '--report-series-1': '#006fae',
    '--report-series-2': '#508200',
    '--report-series-3': '#d14238',
    '--report-series-4': '#506fd2',
    '--report-series-5': '#a05d00',
    '--report-series-6': '#9161c6',
    '--report-positive': '#508200',
    '--report-negative': '#d14238',
  },
  cvd: {
    '--report-series-1': '#006fae',
    '--report-series-2': '#0072b2',
    '--report-series-3': '#b84f00',
    '--report-series-4': '#3d63d0',
    '--report-series-5': '#a05d00',
    '--report-series-6': '#cc79a7',
    '--report-positive': '#0072b2',
    '--report-negative': '#b84f00',
  },
} as const;

const PRINT_COMMON_VARS = {
  '--report-series-other': '#666666',
  '--report-grid': '#d8d8d8',
  '--report-zero-line': '#666666',
  '--report-tooltip-bg': '#ffffe1',
  '--text': '#333333',
  '--text-muted': '#666666',
  '--panel-bg': '#ffffff',
  '--font-sm': '8pt',
};

/**
 * Print (15 §7, 16 §3): the report's name, its filters and options, each chart with its legend (the
 * screen's SVG, drawn with the Light or Light CVD report colors) and every table in full.
 */
export async function printReport(
  doc: ExportDocument,
  money: Parameters<typeof reportCsv>[1],
  report: string,
  charts: readonly Element[],
): Promise<void> {
  const cvd = useSettings().app.colorVision === 'cvd';
  const vars = { ...PRINT_COMMON_VARS, ...PRINT_REPORT_VARS[cvd ? 'cvd' : 'standard'] };
  const style = `<style>:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(
      ';',
    )}} .chart-block{break-inside:avoid;margin:2mm 0 5mm} .chart-block svg{max-width:100%;height:auto}
.chart-block ul{display:flex;flex-wrap:wrap;gap:2mm 6mm;margin:0 0 2mm;padding:0;list-style:none}
.chart-block li,.chart-block button,.chart-block span{display:inline-flex;gap:1.5mm;align-items:center;border:0;background:none;font:inherit;color:inherit;padding:0}
.chart-block svg[aria-hidden]{width:3.5mm;height:3.5mm} .visually-hidden{display:none}</style>`;
  const meta = `<dl class="meta">${doc.meta
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join('')}</dl>`;
  const chartHtml = charts.map((c) => `<div class="chart-block">${c.outerHTML}</div>`).join('');
  const tables = doc.tables
    .map((table) => {
      const head = `<tr>${table.head
        .map((h, i) => `<th${i > 0 ? ' class="num"' : ''}>${esc(h)}</th>`)
        .join('')}</tr>`;
      const body = table.rows
        .map((r) => {
          const cls = [r.tone === 'total' ? 'total' : r.tone === 'section' ? 'group' : '']
            .filter(Boolean)
            .join(' ');
          const cells = r.values
            .map((v) => {
              if (v === null) return '<td class="num">—</td>';
              if (typeof v === 'object') return `<td class="num">${esc(v.text)}</td>`;
              return `<td class="num${v < 0 ? ' neg' : ''}">${esc(printAmount(v, money))}</td>`;
            })
            .join('');
          return `<tr class="${cls}"><td class="${r.level > 0 ? 'indent' : ''}">${esc(r.label)}</td>${cells}</tr>`;
        })
        .join('');
      return `<h2>${esc(table.title)}</h2><table><colgroup><col style="width:28%"></colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
    })
    .join('');
  await window.app.shell.printPreview({
    html: printDocument(
      report,
      `${style}<h1>${esc(report)}</h1>${meta}${chartHtml}${tables}`,
      PRINT_PALETTES[cvd ? 'cvd' : 'standard'],
    ),
    pdfName: `${safeFileName(report)}.pdf`,
  });
  announce(tr('reports.printOpened'));
}

/** The Export menu (15 §7): CSV and Print only. */
export async function exportMenu(): Promise<'csv' | 'print' | null> {
  const choice = await window.app.shell.showContextMenu([
    { id: 'csv', label: tr('reports.exportCsv') },
    { id: 'print', label: tr('reports.exportPrint') },
  ]);
  return choice === 'csv' || choice === 'print' ? choice : null;
}
