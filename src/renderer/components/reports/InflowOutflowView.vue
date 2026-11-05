<script setup lang="ts">
// Inflow vs Outflow (15 §4.4): an expandable table with each month, Average and Total. Inflow: income
// payees under All Income Sources and transfer inflows under their income categories, then Total Inflow.
// Outflow: Uncategorized and the category groups, then Total Outflow; Net Income last. Groups start
// collapsed; Expand All and Collapse All open or close them all. Rows without data are hidden, and an
// empty section says so.
import type { MoneySettings } from '@shared/money';
import type { ExpandableRow, InflowOutflowReport, ReportRow } from '@shared/reporting/result';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { labelText, monthText, rangeText } from '../../reports/labels';
import type { TableCell, TableRow } from '../../reports/view-types';
import UiButton from '../common/UiButton.vue';
import ReportTable from './ReportTable.vue';

const props = defineProps<{
  report: InflowOutflowReport;
  money: MoneySettings;
  dateFormat: string;
}>();
const { t } = useI18n();

const cells = (r: ReportRow): TableCell[] => [
  ...r.values.map((v) => ({ kind: 'money' as const, value: v })),
  { kind: 'money' as const, value: r.average },
  { kind: 'money' as const, value: r.total },
];
const blank = computed<TableCell[]>(() =>
  Array.from({ length: props.report.months.length + 2 }, () => ({ kind: 'text', text: '' })),
);
const plain = (r: ReportRow): TableRow => ({
  key: r.key,
  label: labelText(r.label),
  cells: cells(r),
});
const expandable = (r: ExpandableRow): TableRow => ({
  ...plain(r),
  tone: 'group',
  children: r.children.map(plain),
});

const rows = computed<TableRow[]>(() => {
  const r = props.report;
  const inflow: TableRow[] = [
    ...(r.inflow.sources ? [expandable(r.inflow.sources)] : []),
    ...r.inflow.transfers.map(plain),
  ];
  const outflow: TableRow[] = [
    ...(r.outflow.uncategorized ? [plain(r.outflow.uncategorized)] : []),
    ...r.outflow.groups.map(expandable),
  ];
  const empty = (key: string, text: string): TableRow => ({ key, label: text, cells: blank.value });
  return [
    { key: 'inflow-head', label: t('reports.inflow'), tone: 'section', cells: blank.value },
    ...(inflow.length > 0 ? inflow : [empty('inflow-empty', t('reports.noInflow'))]),
    {
      key: 'inflow-total',
      label: t('reports.totalInflow'),
      tone: 'total',
      cells: cells(r.inflow.total),
    },
    { key: 'outflow-head', label: t('reports.outflow'), tone: 'section', cells: blank.value },
    ...(outflow.length > 0 ? outflow : [empty('outflow-empty', t('reports.noOutflow'))]),
    {
      key: 'outflow-total',
      label: t('reports.totalOutflow'),
      tone: 'total',
      cells: cells(r.outflow.total),
    },
    { key: 'net', label: t('reports.netIncome'), tone: 'total', cells: cells(r.net) },
  ];
});

const groupKeys = computed(() =>
  rows.value.filter((r) => r.children && r.children.length > 0).map((r) => r.key),
);
const expanded = ref<string[]>([]);
const range = computed(() => rangeText(props.report.range, props.dateFormat));
</script>

<template>
  <div class="io">
    <div class="io__head">
      <p class="io__note">{{ range }}</p>
      <div v-if="groupKeys.length > 0" class="io__actions">
        <UiButton @click="expanded = [...groupKeys]">{{ t('reports.expandAll') }}</UiButton>
        <UiButton @click="expanded = []">{{ t('reports.collapseAll') }}</UiButton>
      </div>
    </div>
    <ReportTable
      v-model:expanded="expanded"
      :caption="t('reports.tabInflowOutflow')"
      :columns="[
        t('reports.colCategoryOrPayee'),
        ...report.months.map(monthText),
        t('reports.average'),
        t('reports.total'),
      ]"
      :rows="rows"
      :money="money"
    />
  </div>
</template>

<style scoped>
.io {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.io__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
}

.io__note {
  margin: 0;
  color: var(--text-muted);
}

.io__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
