<script setup lang="ts">
// Spending Breakdown (15 §4.2): Group By and Stack By, the stacked-period chart with its legend, and the
// same data as a table (one row per stack item, a column per period, Average and Total). The five largest
// items have their own series; Other expands to its members. A category group drills down from its chart
// segment, legend item or row; the breadcrumb returns to all spending. Uncategorized doesn't drill.
import type { MoneySettings } from '@shared/money';
import {
  BREAKDOWN_STACK_BY,
  PERIOD_UNITS,
  type BreakdownGroupBy,
  type BreakdownStackBy,
} from '@shared/reporting/model';
import type { BreakdownReport, BreakdownSeries } from '@shared/reporting/result';
import { ChevronRight } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyFormatter, moneyLabel } from '../../money-display';
import { labelText, periodText, rangeText } from '../../reports/labels';
import { useReportsView } from '../../reports/state';
import { seriesColor, seriesShape, type ChartSeries } from '../../reports/use-chart';
import type { TableRow } from '../../reports/view-types';
import UiSegmented from '../common/UiSegmented.vue';
import ReportTable from './ReportTable.vue';
import SeriesSwatch from './SeriesSwatch.vue';
import StackedBarChart from './StackedBarChart.vue';

const props = defineProps<{ report: BreakdownReport; money: MoneySettings; dateFormat: string }>();
const { t } = useI18n();
const view = useReportsView();

const GROUP_KEYS: Record<BreakdownGroupBy, string> = {
  week: 'reports.periodWeek',
  month: 'reports.periodMonth',
  quarter: 'reports.periodQuarter',
  year: 'reports.periodYear',
};
const TITLE_KEYS: Record<BreakdownGroupBy, string> = {
  week: 'reports.breakdownTitleWeek',
  month: 'reports.breakdownTitleMonth',
  quarter: 'reports.breakdownTitleQuarter',
  year: 'reports.breakdownTitleYear',
};
const STACK_KEYS: Record<BreakdownStackBy, string> = {
  categoryGroup: 'reports.stackGroup',
  payee: 'reports.stackPayee',
  account: 'reports.stackAccount',
};
const STACKED_KEYS: Record<BreakdownStackBy, string> = {
  categoryGroup: 'reports.stackedByGroup',
  payee: 'reports.stackedByPayee',
  account: 'reports.stackedByAccount',
};

const groupBy = computed({
  get: () => view.breakdown.groupBy,
  set: (v: BreakdownGroupBy) => {
    view.setBreakdown({ groupBy: v });
  },
});
const stackBy = computed({
  get: () => view.breakdown.stackBy,
  set: (v: BreakdownStackBy) => {
    view.setBreakdown({ stackBy: v });
  },
});
const groupOptions = computed(() =>
  PERIOD_UNITS.map((v) => ({ value: v, label: t(GROUP_KEYS[v]) })),
);
const stackOptions = computed(() =>
  BREAKDOWN_STACK_BY.map((v) => ({ value: v, label: t(STACK_KEYS[v]) })),
);

const periods = computed(() =>
  props.report.periods.map((p) => periodText(p, props.report.groupBy, props.dateFormat)),
);
const range = computed(() => rangeText(props.report.range, props.dateFormat));
const drill = computed(() => props.report.drill);
const format = computed(() => moneyFormatter(props.money, { symbol: true }));

const series = computed<ChartSeries[]>(() =>
  props.report.series.map((s) => ({
    key: s.key,
    label: labelText(s.label),
    color: seriesColor(s.color),
    shape: seriesShape(s.color),
    values: s.values,
  })),
);
const drillable = computed(() => props.report.series.filter((s) => s.drillable).map((s) => s.key));

function drillInto(key: string): void {
  if (drillable.value.includes(key)) view.setBreakdown({ drillGroupId: key });
}

const columnHead = computed(() =>
  drill.value && props.report.stackBy === 'categoryGroup'
    ? t('reports.colCategory')
    : t(
        {
          categoryGroup: 'reports.colCategoryGroup',
          payee: 'reports.colPayee',
          account: 'reports.colAccount',
        }[props.report.stackBy],
      ),
);

const cells = (s: { values: (number | null)[]; average: number; total: number }) => [
  ...s.values.map((v) => ({ kind: 'money' as const, value: v })),
  { kind: 'money' as const, value: s.average },
  { kind: 'money' as const, value: s.total },
];

function rowOf(s: BreakdownSeries): TableRow {
  const label = labelText(s.label);
  return {
    key: s.key,
    label,
    swatch: { color: seriesColor(s.color), shape: seriesShape(s.color) },
    cells: cells(s),
    ...(s.members.length > 0
      ? {
          children: s.members.map((m) => ({
            key: m.key,
            label: labelText(m.label),
            cells: cells(m),
          })),
        }
      : {}),
    ...(s.drillable
      ? {
          action: {
            label: t('reports.drillInto', { name: label }),
            run: () => {
              drillInto(s.key);
            },
          },
        }
      : {}),
  };
}

const rows = computed<TableRow[]>(() => [
  ...props.report.series.map(rowOf),
  {
    key: 'total',
    label: t('reports.totalSpending'),
    tone: 'total',
    cells: cells(props.report.total),
  },
]);
const expanded = ref<string[]>([]);

const description = computed(() =>
  t('reports.breakdownDescription', {
    range: range.value,
    total: moneyLabel(props.report.total.total, props.money, { symbol: true }),
    series: series.value.map((s) => s.label).join(', '),
  }),
);
</script>

<template>
  <div class="breakdown">
    <section class="panel" :aria-labelledby="'breakdown-title'">
      <div class="panel__head">
        <div>
          <h2 id="breakdown-title" class="panel__title">{{ t(TITLE_KEYS[report.groupBy]) }}</h2>
          <p class="panel__note">
            {{ t('reports.rangeStacked', { range, stacked: t(STACKED_KEYS[report.stackBy]) }) }}
          </p>
        </div>
        <div class="panel__options">
          <UiSegmented v-model="groupBy" :options="groupOptions" :label="t('reports.groupBy')" />
          <UiSegmented v-model="stackBy" :options="stackOptions" :label="t('reports.stackBy')" />
        </div>
      </div>
      <nav class="crumbs" :aria-label="t('reports.breadcrumb')">
        <template v-if="drill">
          <button
            type="button"
            class="crumbs__link"
            @click="view.setBreakdown({ drillGroupId: null })"
          >
            {{ t('reports.allSpending') }}
          </button>
          <ChevronRight class="crumbs__icon" aria-hidden="true" />
          <span aria-current="page">{{ labelText(drill.label) }}</span>
        </template>
        <template v-else>
          <span aria-current="page" class="crumbs__here">{{ t('reports.allSpending') }}</span>
          <span v-if="drillable.length > 0" class="panel__note">{{ t('reports.drillHint') }}</span>
        </template>
      </nav>
      <p v-if="report.series.length === 0" class="empty" role="status">{{ t('reports.empty') }}</p>
      <div v-else data-print-chart class="chart-block">
        <ul class="legend" :aria-label="t('reports.legend')">
          <li v-for="s in report.series" :key="s.key">
            <button
              v-if="s.drillable"
              type="button"
              class="legend__item legend__item--link"
              :aria-label="t('reports.drillInto', { name: labelText(s.label) })"
              @click="drillInto(s.key)"
            >
              <SeriesSwatch :color="seriesColor(s.color)" :shape="seriesShape(s.color)" />
              {{ labelText(s.label) }}
            </button>
            <span v-else class="legend__item">
              <SeriesSwatch :color="seriesColor(s.color)" :shape="seriesShape(s.color)" />
              {{ labelText(s.label) }}
            </span>
          </li>
          <li>
            <span class="legend__item">
              <SeriesSwatch color="var(--text)" shape="ring" :dashed="false" />
              {{ t('reports.total') }}
            </span>
          </li>
        </ul>
        <StackedBarChart
          :labels="periods"
          :series="series"
          :total="report.total.values"
          :total-label="t('reports.total')"
          :format="format"
          :label="t(TITLE_KEYS[report.groupBy])"
          :description="description"
          :selectable="drillable"
          @select="drillInto"
        />
      </div>
    </section>
    <ReportTable
      v-if="report.series.length > 0"
      v-model:expanded="expanded"
      :caption="t('reports.breakdownTable', { stack: columnHead })"
      :columns="[columnHead, ...periods, t('reports.average'), t('reports.total')]"
      :rows="rows"
      :money="money"
      :negative-money-color="false"
    />
  </div>
</template>

<style scoped>
.breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--register-border);
  border-radius: var(--radius);
}

.panel__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-start;
  justify-content: space-between;
}

.panel__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.panel__title {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--font-xl);
  font-weight: 600;
}

.panel__note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.crumbs__here {
  font-weight: 600;
}

.crumbs__link {
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--link);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.crumbs__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.legend__item {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
}

.legend__item--link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-decoration: underline dotted;
  cursor: pointer;
}

.chart-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.empty {
  margin: var(--space-6) 0;
  color: var(--text-muted);
  text-align: center;
}
</style>
