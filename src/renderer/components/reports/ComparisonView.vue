<script setup lang="ts">
// Spending Comparison (15 §4.3): the Compare Period (the filter bar's, page-specific) against the period of
// the same unit before it. Cumulative displayed spending: a solid current line and a dashed previous one,
// both stopping at the same elapsed day while the current period is in progress. The table lists groups
// and expandable categories with Current, Previous, Change and Change %, and Total Spending.
import type { MoneySettings } from '@shared/money';
import { dayCount } from '@shared/reporting/periods';
import type { ComparisonReport, ComparisonRow } from '@shared/reporting/result';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyFormatter, moneyLabel } from '../../money-display';
import { changePercentText, labelText, rangeText } from '../../reports/labels';
import type { ChartSeries } from '../../reports/use-chart';
import type { TableRow } from '../../reports/view-types';
import LineChart from './LineChart.vue';
import ReportTable from './ReportTable.vue';
import SeriesSwatch from './SeriesSwatch.vue';

const props = defineProps<{ report: ComparisonReport; money: MoneySettings; dateFormat: string }>();
const { t } = useI18n();

const current = computed(() => rangeText(props.report.current, props.dateFormat));
const previous = computed(() => rangeText(props.report.previous, props.dateFormat));
const count = computed(() =>
  Math.max(dayCount(props.report.current), dayCount(props.report.previous)),
);
const format = computed(() => moneyFormatter(props.money, { symbol: true }));

const pad = (values: number[]): (number | null)[] =>
  Array.from({ length: count.value }, (_, i) => values[i] ?? null);
const CURRENT_COLOR = 'var(--report-series-1)';
const PREVIOUS_COLOR = 'var(--report-series-other)';
const series = computed<ChartSeries[]>(() => [
  {
    key: 'current',
    label: t('reports.seriesCurrent', { range: current.value }),
    color: CURRENT_COLOR,
    shape: 'circle',
    values: pad(props.report.cumulative.current),
    dashed: false,
  },
  {
    key: 'previous',
    label: t('reports.seriesPrevious', { range: previous.value }),
    color: PREVIOUS_COLOR,
    shape: 'square',
    values: pad(props.report.cumulative.previous),
    dashed: true,
  },
]);

const cells = (r: ComparisonRow) => [
  { kind: 'money' as const, value: r.current },
  { kind: 'money' as const, value: r.previous },
  { kind: 'money' as const, value: r.change },
  { kind: 'text' as const, text: changePercentText(r.changePercent) },
];
const rows = computed<TableRow[]>(() => [
  ...props.report.rows.map((r) => ({
    key: r.key,
    label: labelText(r.label),
    tone: 'group' as const,
    cells: cells(r),
    children: r.children.map((c) => ({ key: c.key, label: labelText(c.label), cells: cells(c) })),
  })),
  {
    key: 'total',
    label: t('reports.totalSpending'),
    tone: 'total',
    cells: cells(props.report.total),
  },
]);
const expanded = ref<string[]>([]);

const description = computed(() =>
  t('reports.comparisonDescription', {
    current: current.value,
    previous: previous.value,
    currentTotal: moneyLabel(props.report.total.current, props.money, { symbol: true }),
    previousTotal: moneyLabel(props.report.total.previous, props.money, { symbol: true }),
  }),
);
</script>

<template>
  <div class="comparison">
    <section class="panel" aria-labelledby="comparison-title">
      <div>
        <h2 id="comparison-title" class="panel__title">{{ t('reports.comparisonTitle') }}</h2>
        <p class="panel__note">
          {{ t('reports.comparingRanges', { current, previous }) }}
        </p>
        <p v-if="report.partial" class="panel__note">
          {{ t('reports.comparisonPartial', { n: report.observedDays }) }}
        </p>
      </div>
      <p v-if="report.rows.length === 0" class="empty" role="status">{{ t('reports.empty') }}</p>
      <div v-else data-print-chart class="chart-block">
        <ul class="legend" :aria-label="t('reports.legend')">
          <li v-for="s in series" :key="s.key" class="legend__item">
            <SeriesSwatch :color="s.color" :shape="s.shape" :dashed="s.dashed" />
            {{ s.label }}
          </li>
        </ul>
        <LineChart
          :count="count"
          :x-label="(i) => t('reports.dayN', { n: i + 1 })"
          :series="series"
          :format="format"
          :label="t('reports.comparisonTitle')"
          :description="description"
        />
      </div>
    </section>
    <ReportTable
      v-if="report.rows.length > 0"
      v-model:expanded="expanded"
      :caption="t('reports.comparisonTable')"
      :columns="[
        t('reports.colCategory'),
        t('reports.current'),
        t('reports.previous'),
        t('reports.change'),
        t('reports.changePercent'),
      ]"
      :rows="rows"
      :money="money"
      :negative-money-color="false"
    />
  </div>
</template>

<style scoped>
.comparison {
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
