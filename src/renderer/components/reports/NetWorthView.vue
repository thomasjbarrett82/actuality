<script setup lang="ts">
// Net Worth (15 §4.5): Single (the accounts' total) or Multiline (one line per account, its legend with the
// ending balance); the Accounts filter alone picks the on- and off-budget accounts, whatever their balances.
// The heading shows the ending balance and the change since the range started. The table lists each
// account's month-end balances and change, and the Net Worth total; the chart's mid-month, month-end and
// today points are one disclosure away.
import { addDays } from '@shared/dates';
import type { Money } from '@shared/domain/types';
import type { MoneySettings } from '@shared/money';
import type { NetWorthAccount, NetWorthReport, SeriesColor } from '@shared/reporting/result';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyFormatter, moneyLabel, moneyText } from '../../money-display';
import { dateText, labelText, monthText, rangeText } from '../../reports/labels';
import { useReportsView } from '../../reports/state';
import { seriesColor, seriesShape, type ChartSeries } from '../../reports/use-chart';
import type { TableCell, TableRow } from '../../reports/view-types';
import MoneyAmount from '../common/MoneyAmount.vue';
import UiSegmented from '../common/UiSegmented.vue';
import LineChart from './LineChart.vue';
import ReportTable from './ReportTable.vue';
import SeriesSwatch from './SeriesSwatch.vue';

const props = defineProps<{ report: NetWorthReport; money: MoneySettings; dateFormat: string }>();
const { t } = useI18n();
const view = useReportsView();

const mode = computed({
  get: () => view.netWorth.mode,
  set: (v: 'single' | 'multiline') => {
    view.setNetWorth({ mode: v });
  },
});
const modes = computed(() => [
  { value: 'single' as const, label: t('reports.modeSingle') },
  { value: 'multiline' as const, label: t('reports.modeMultiline') },
]);

const COLORS: readonly SeriesColor[] = [1, 2, 3, 4, 5, 6];
const colorOf = (a: NetWorthAccount): SeriesColor =>
  COLORS[props.report.accounts.indexOf(a) % COLORS.length] ?? 1;

const total = computed(() => props.report.total);
const series = computed<ChartSeries[]>(() =>
  view.netWorth.mode === 'single'
    ? [
        {
          key: 'total',
          label: t('reports.netWorth'),
          color: seriesColor(1),
          shape: seriesShape(1),
          values: total.value.values,
        },
      ]
    : props.report.accounts.map((a) => ({
        key: a.key,
        label: labelText(a.label),
        color: seriesColor(colorOf(a)),
        shape: seriesShape(colorOf(a)),
        values: a.values,
      })),
);
const format = computed(() => moneyFormatter(props.money, { symbol: true }));
const pointLabel = (i: number): string => {
  const p = props.report.points[i];
  return p ? dateText(p.date, props.dateFormat) : '';
};
const range = computed(() => rangeText(props.report.range, props.dateFormat));

const monthCells = (values: (Money | null)[], change: Money): TableCell[] => [
  ...values.map((v) => ({ kind: 'money' as const, value: v })),
  { kind: 'money' as const, value: change },
];
const rows = computed<TableRow[]>(() => [
  ...props.report.accounts.map((a) => ({
    key: a.key,
    label: labelText(a.label),
    ...(view.netWorth.mode === 'multiline'
      ? { swatch: { color: seriesColor(colorOf(a)), shape: seriesShape(colorOf(a)) } }
      : {}),
    cells: monthCells(a.monthEnd, a.change),
  })),
  {
    key: 'total',
    label: t('reports.netWorth'),
    tone: 'total',
    cells: monthCells(total.value.monthEnd, total.value.change),
  },
]);
const pointRows = computed<TableRow[]>(() =>
  series.value.map((s) => ({
    key: s.key,
    label: s.label,
    swatch: { color: s.color, shape: s.shape },
    cells: s.values.map((v) => ({ kind: 'money' as const, value: v })),
  })),
);

const description = computed(() =>
  t('reports.netWorthDescription', {
    range: range.value,
    end: moneyLabel(total.value.end, props.money, { symbol: true }),
    change: moneyLabel(total.value.change, props.money, { symbol: true, plus: true }),
  }),
);
</script>

<template>
  <div class="nw">
    <section class="panel" aria-labelledby="nw-title">
      <div class="panel__head">
        <div>
          <h2 id="nw-title" class="panel__title">{{ t('reports.netWorth') }}</h2>
          <p class="panel__figure" :class="{ neg: total.end < 0 }">
            <MoneyAmount :value="total.end" :settings="money" symbol />
          </p>
          <p class="panel__note">
            {{
              t('reports.changeSince', {
                change: moneyText(total.change, money, { symbol: true, plus: true }),
                date: dateText(addDays(report.range.start, -1), dateFormat),
              })
            }}
          </p>
        </div>
        <UiSegmented v-model="mode" :options="modes" :label="t('reports.netWorthMode')" />
      </div>
      <p v-if="report.accounts.length === 0" class="empty" role="status">
        {{ t('reports.noAccountsSelected') }}
      </p>
      <template v-else>
        <div data-print-chart class="chart-block">
          <ul class="legend" :aria-label="t('reports.legend')">
            <li v-for="s in series" :key="s.key" class="legend__item">
              <SeriesSwatch :color="s.color" :shape="s.shape" />
              {{ s.label }}
              <strong>
                <MoneyAmount
                  :value="
                    s.key === 'total'
                      ? total.end
                      : (report.accounts.find((a) => a.key === s.key)?.end ?? 0)
                  "
                  :settings="money"
                  symbol
                />
              </strong>
            </li>
          </ul>
          <LineChart
            :count="report.points.length"
            :x-label="pointLabel"
            :series="series"
            :format="format"
            :label="t('reports.netWorth')"
            :description="description"
          />
        </div>
        <details class="points">
          <summary>{{ t('reports.showChartData') }}</summary>
          <ReportTable
            :caption="t('reports.netWorthPoints')"
            :columns="[t('reports.colSeries'), ...report.points.map((_, i) => pointLabel(i))]"
            :rows="pointRows"
            :money="money"
          />
        </details>
      </template>
    </section>
    <ReportTable
      v-if="report.accounts.length > 0"
      :caption="t('reports.netWorthTable')"
      :columns="[t('reports.colAccount'), ...report.months.map(monthText), t('reports.change')]"
      :rows="rows"
      :money="money"
    />
  </div>
</template>

<style scoped>
.nw {
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

.panel__title {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--font-xl);
  font-weight: 600;
}

.panel__figure {
  margin: var(--space-1) 0 0;
  color: var(--text-strong);
  font-size: var(--font-2xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.panel__note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.neg {
  color: var(--report-negative);
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

.points summary {
  min-height: var(--hit-min);
  color: var(--link);
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
