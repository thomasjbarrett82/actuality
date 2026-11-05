<script setup lang="ts">
// The Reports screen (15): the "Reports" heading, which labels the main region and takes focus on
// navigation (22 §3–4); the five tabs (manual activation: ←/→ and Home/End move focus, Enter/Space
// activate); the active page's filter bar; and the active report with explicit, announced loading, error
// and empty states. Only the active report is requested. File ▸ Export and Print act on it (15 §7).
import { today as todayOf } from '@shared/dates';
import { NO_PAYEE, REPORT_PAGES, UNCATEGORIZED, type ReportPage } from '@shared/reporting/model';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { commands } from '../../commands';
import UiButton from '../../components/common/UiButton.vue';
import BreakdownView from '../../components/reports/BreakdownView.vue';
import ComparisonView from '../../components/reports/ComparisonView.vue';
import InflowOutflowView from '../../components/reports/InflowOutflowView.vue';
import NetWorthView from '../../components/reports/NetWorthView.vue';
import ReportFilterBar from '../../components/reports/ReportFilterBar.vue';
import SummaryView from '../../components/reports/SummaryView.vue';
import { weekStartsOn } from '../../i18n';
import { useAccounts, useBudgetFormat, useCategories, usePayees } from '../../queries/budget-data';
import { exportDocument } from '../../reports/export-tables';
import {
  comparisonText,
  PAGE_KEYS,
  rangeText,
  selectionText,
  timeframeText,
} from '../../reports/labels';
import { exportMenu, exportReportCsv, printReport } from '../../reports/report-flow';
import { useReportsView } from '../../reports/state';
import { useActiveReport } from '../../reports/use-report';
import PanelHeading from './PanelHeading.vue';

const { t } = useI18n();
const view = useReportsView();
const format = useBudgetFormat();
const query = useActiveReport();
const accounts = useAccounts();
const categories = useCategories();
const payees = usePayees();

const tabs = ref<HTMLElement[]>([]);
const panel = ref<HTMLElement | null>(null);
const tabId = (page: ReportPage): string => `reports-tab-${page}`;

/** The result for the active tab, never another tab's. */
const report = computed(() => {
  const data = query.data.value;
  return data && data.kind === view.tab ? data : null;
});
const loading = computed(() => report.value === null && query.isFetching.value);
const failed = computed(() => query.isError.value && report.value === null);
const refreshing = computed(() => report.value !== null && query.isFetching.value);
const reportName = computed(() => t(PAGE_KEYS[view.tab]));

function activate(page: ReportPage): void {
  view.tab = page;
}

function onTabKey(e: KeyboardEvent, i: number): void {
  const n = REPORT_PAGES.length;
  const next =
    e.key === 'ArrowRight'
      ? (i + 1) % n
      : e.key === 'ArrowLeft'
        ? (i - 1 + n) % n
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? n - 1
            : null;
  if (next === null) return;
  e.preventDefault();
  tabs.value[next]?.focus();
}

watch(
  () => [query.status.value, query.isFetching.value, view.tab] as const,
  ([status, fetching], before) => {
    if (fetching && report.value === null)
      announce(t('reports.loading', { report: reportName.value }));
    else if (status === 'error' && !fetching)
      announce(t('reports.announceFailed', { report: reportName.value }), 'assertive');
    else if (status === 'success' && !fetching && before[1])
      announce(t('reports.announceLoaded', { report: reportName.value }));
  },
);

// Saved definitions drop ids of categories, payees and accounts that are gone (19 §2).
watch(
  () => [accounts.data.value, categories.data.value, payees.data.value] as const,
  ([a, c, p]) => {
    if (!a || !c || !p) return;
    const known = new Set<string>([
      UNCATEGORIZED,
      NO_PAYEE,
      ...a.map((x) => x.id),
      ...c.flatMap((g) => g.categories.map((x) => x.id)),
      ...p.map((x) => x.id),
    ]);
    void view.prune(known).catch(() => undefined);
  },
  { immediate: true },
);

// ------------------------------------------------------------------------------------------ export

const triggers = computed(() => {
  const f = view.filtersOf(view.tab);
  const name = (list: { id: string; name: string }[] | undefined) => (id: string) =>
    list?.find((x) => x.id === id)?.name ?? null;
  const cats = (categories.data.value ?? []).flatMap((g) => g.categories);
  return {
    categories: selectionText('categories', f.categories, name(cats)),
    timeframe:
      view.tab === 'comparison'
        ? comparisonText(
            view.comparison,
            weekStartsOn.value,
            todayOf(new Date()),
            format.value.dateFormat,
          )
        : timeframeText(f.timeframe, format.value.dateFormat),
    payees: selectionText('payees', f.payees, name(payees.data.value)),
    accounts: selectionText('accounts', f.accounts, name(accounts.data.value)),
  };
});

function documentOf() {
  const r = report.value;
  if (!r) return null;
  return exportDocument(r, {
    page: view.tab,
    dateFormat: format.value.dateFormat,
    filters: triggers.value,
    netWorth: view.netWorth,
  });
}

async function runCsv(): Promise<void> {
  const r = report.value;
  const doc = documentOf();
  if (!r || !doc) return;
  const range = r.kind === 'comparison' ? r.current : r.range;
  await exportReportCsv(doc, format.value.money, {
    report: reportName.value,
    range: rangeText(range, 'yyyy-MM-dd'),
  });
}

async function runPrint(): Promise<void> {
  const doc = documentOf();
  if (!doc) return;
  await nextTick();
  const charts = [...(panel.value?.querySelectorAll('[data-print-chart]') ?? [])];
  await printReport(doc, format.value.money, reportName.value, charts);
}

async function onExport(): Promise<void> {
  const choice = await exportMenu();
  if (choice === 'csv') await runCsv();
  else if (choice === 'print') await runPrint();
}

const cleanups: (() => void)[] = [];
onMounted(() => {
  cleanups.push(
    commands.register('file.export', runCsv),
    commands.register('file.print', runPrint),
  );
});
onBeforeUnmount(() => {
  for (const c of cleanups) c();
});
</script>

<template>
  <section class="reports">
    <PanelHeading id="reports-heading" :text="t('navigation.reports')" ready />
    <div class="reports__tabs" role="tablist" :aria-label="t('reports.tabListLabel')">
      <button
        v-for="(page, i) in REPORT_PAGES"
        :id="tabId(page)"
        :key="page"
        ref="tabs"
        type="button"
        role="tab"
        class="reports__tab"
        :aria-selected="view.tab === page"
        aria-controls="reports-tabpanel"
        :tabindex="view.tab === page ? 0 : -1"
        @click="activate(page)"
        @keydown="onTabKey($event, i)"
      >
        {{ t(PAGE_KEYS[page]) }}
      </button>
    </div>
    <ReportFilterBar
      :page="view.tab"
      :date-format="format.dateFormat"
      :can-export="report !== null"
      @export="onExport"
    />
    <div
      id="reports-tabpanel"
      ref="panel"
      class="reports__panel"
      role="tabpanel"
      :aria-labelledby="tabId(view.tab)"
      :aria-busy="loading || refreshing ? 'true' : undefined"
    >
      <p v-if="refreshing" class="reports__refreshing" role="status">
        {{ t('reports.refreshing') }}
      </p>
      <div v-if="loading" class="reports__state" role="status">
        {{ t('reports.loading', { report: reportName }) }}
      </div>
      <div v-else-if="failed" class="reports__state reports__state--error" role="alert">
        <p>{{ t('reports.error', { report: reportName }) }}</p>
        <UiButton @click="query.refetch()">{{ t('reports.retry') }}</UiButton>
      </div>
      <template v-else-if="report">
        <SummaryView
          v-if="report.kind === 'summary'"
          :report="report"
          :money="format.money"
          :date-format="format.dateFormat"
        />
        <BreakdownView
          v-else-if="report.kind === 'breakdown'"
          :report="report"
          :money="format.money"
          :date-format="format.dateFormat"
        />
        <ComparisonView
          v-else-if="report.kind === 'comparison'"
          :report="report"
          :money="format.money"
          :date-format="format.dateFormat"
        />
        <InflowOutflowView
          v-else-if="report.kind === 'inflowOutflow'"
          :report="report"
          :money="format.money"
          :date-format="format.dateFormat"
        />
        <NetWorthView
          v-else
          :report="report"
          :money="format.money"
          :date-format="format.dateFormat"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.reports {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 100%;
  padding: 0 var(--space-6) var(--space-6);
  box-sizing: border-box;
}

.reports :deep(.panel-heading) {
  padding-inline: 0;
}

.reports__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  border-bottom: 1px solid var(--grid-line-h);
}

.reports__tab {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--font-lg);
  cursor: pointer;
}

.reports__tab[aria-selected='true'] {
  border-bottom-color: var(--accent-blue);
  color: var(--text-strong);
  font-weight: 600;
}

.reports__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.reports__state {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
  margin: var(--space-7) 0;
  color: var(--text-muted);
}

.reports__state--error {
  color: var(--text-danger);
}

.reports__state p {
  margin: 0;
}

.reports__refreshing {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}
</style>
