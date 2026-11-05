<script setup lang="ts">
// Summary (15 §4.1): nine widgets. Six signed flow totals and monthly averages; Budgeted Net Worth with its
// month-end trend; the top spending category groups as a pie with Other; and Money Age with its monthly
// trend, coverage and method (15 §5). Every widget is centered horizontally. A value's amount is centered
// vertically, its title at the top and its timeframe at the bottom; a chart widget's title is at the top,
// its table (the trend's data, the pie's legend) at the bottom and its chart centered vertically between
// them. The widgets sit on a grid of square cells whose column count follows the window's width: a value
// takes one cell, a chart two stacked, and content scrolls inside its card rather than resizing the cell.
// Widgets have no drill-through.
import type { Money } from '@shared/domain/types';
import type { MoneySettings } from '@shared/money';
import type { SummaryReport } from '@shared/reporting/result';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyLabel, moneyText } from '../../money-display';
import { dateText, labelText, monthText, percentText, rangeText } from '../../reports/labels';
import { seriesColor, seriesShape } from '../../reports/use-chart';
import type { PieSlice } from '../../reports/view-types';
import MoneyAmount from '../common/MoneyAmount.vue';
import AreaSparkline from './AreaSparkline.vue';
import PieChart from './PieChart.vue';
import SeriesSwatch from './SeriesSwatch.vue';

const props = defineProps<{ report: SummaryReport; money: MoneySettings; dateFormat: string }>();
const { t } = useI18n();
const id = useId();

const flows = computed(() => [
  { key: 'inflow', title: t('reports.totalInflow'), value: props.report.inflow, plus: false },
  { key: 'outflow', title: t('reports.totalOutflow'), value: props.report.outflow, plus: false },
  { key: 'net', title: t('reports.netFlow'), value: props.report.net, plus: true },
  {
    key: 'avgInflow',
    title: t('reports.avgInflow'),
    value: props.report.averageInflow,
    plus: false,
  },
  {
    key: 'avgOutflow',
    title: t('reports.avgOutflow'),
    value: props.report.averageOutflow,
    plus: false,
  },
  { key: 'avgNet', title: t('reports.avgNet'), value: props.report.averageNet, plus: true },
]);

const range = computed(() => rangeText(props.report.range, props.dateFormat));
const nw = computed(() => props.report.netWorth);
const nwChange = computed<Money>(() => nw.value.current - nw.value.start);

const slices = computed<(PieSlice & { amount: Money; shape: ReturnType<typeof seriesShape> })[]>(
  () =>
    props.report.topGroups.slices.map((s) => ({
      key: s.key,
      label: labelText(s.label),
      color: seriesColor(s.color),
      shape: seriesShape(s.color),
      share: s.share,
      amount: s.amount,
    })),
);
const pieDescription = computed(() =>
  slices.value.map((s) => `${s.label} ${percentText(s.share)}`).join(', '),
);

const age = computed(() => props.report.moneyAge);
const latest = computed(() => age.value.latest);
const showMethod = ref(false);
const daysText = (days: number | null): string =>
  days === null ? '—' : t('reports.moneyAgeDays', { n: days }, days);

const nwDescription = computed(() =>
  nw.value.trend
    .map((p) =>
      p.value === null
        ? `${monthText(p.month)} ${t('reports.unavailable')}`
        : `${monthText(p.month)} ${moneyLabel(p.value, props.money, { symbol: true })}`,
    )
    .join(', '),
);
const ageDescription = computed(() =>
  age.value.points.map((p) => `${monthText(p.month)} ${daysText(p.days)}`).join(', '),
);
</script>

<template>
  <div class="summary-frame">
    <div class="summary">
      <section
        v-for="f in flows"
        :key="f.key"
        v-scroll-focus
        class="card card--value"
        :aria-labelledby="`${id}-${f.key}`"
      >
        <h2 :id="`${id}-${f.key}`" class="card__title">{{ f.title }}</h2>
        <p class="card__value" :class="{ pos: f.value > 0, neg: f.value < 0 }">
          <MoneyAmount :value="f.value" :settings="money" symbol :plus="f.plus" />
        </p>
        <p class="card__note">{{ range }}</p>
      </section>

      <section v-scroll-focus class="card card--chart" :aria-labelledby="`${id}-nw`">
        <div class="card__head">
          <div>
            <h2 :id="`${id}-nw`" class="card__title">{{ t('reports.budgetedNetWorth') }}</h2>
            <p class="card__note">{{ t('reports.budgetedNetWorthNote') }}</p>
          </div>
          <div class="card__figure">
            <p class="card__value card__value--sm" :class="{ neg: nw.current < 0 }">
              <MoneyAmount :value="nw.current" :settings="money" symbol />
            </p>
            <p class="card__note">
              {{
                t('reports.changeSince', {
                  change: moneyText(nwChange, money, { symbol: true, plus: true }),
                  date: dateText(nw.startDate, dateFormat),
                })
              }}
            </p>
          </div>
        </div>
        <div class="card__chart" data-print-chart>
          <AreaSparkline
            :values="nw.trend.map((p) => p.value)"
            color="var(--report-series-1)"
            :label="t('reports.budgetedNetWorthTrend')"
            :description="nwDescription"
          />
        </div>
        <div class="card__data">
          <table>
            <caption class="visually-hidden">
              {{
                t('reports.budgetedNetWorthTrend')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('reports.colMonth') }}</th>
                <th scope="col" class="num">{{ t('reports.colBalance') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in nw.trend" :key="p.month">
                <th scope="row">{{ monthText(p.month) }}</th>
                <td class="num">
                  <span v-if="p.value === null" :aria-label="t('reports.unavailable')">—</span>
                  <MoneyAmount v-else :value="p.value" :settings="money" symbol />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-scroll-focus class="card card--chart" :aria-labelledby="`${id}-top`">
        <h2 :id="`${id}-top`" class="card__title">{{ t('reports.topGroups') }}</h2>
        <p v-if="slices.length === 0" class="card__note">{{ t('reports.noSpending') }}</p>
        <div v-if="slices.length > 0" class="card__chart card__chart--pie" data-print-chart>
          <PieChart
            :slices="slices"
            :label="t('reports.topGroups')"
            :description="pieDescription"
          />
        </div>
        <div v-if="slices.length > 0" class="card__data" data-print-chart>
          <table>
            <caption class="visually-hidden">
              {{
                t('reports.topGroups')
              }}
            </caption>
            <thead class="visually-hidden">
              <tr>
                <th scope="col">{{ t('reports.colCategoryGroup') }}</th>
                <th scope="col">{{ t('reports.colShare') }}</th>
                <th scope="col">{{ t('reports.colAmount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in slices" :key="s.key">
                <th scope="row">
                  <SeriesSwatch :color="s.color" :shape="s.shape" />
                  {{ s.label }}
                </th>
                <td class="num">{{ percentText(s.share) }}</td>
                <td class="num"><MoneyAmount :value="s.amount" :settings="money" symbol /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-scroll-focus class="card card--chart" :aria-labelledby="`${id}-age`">
        <div class="card__head">
          <div>
            <h2 :id="`${id}-age`" class="card__title">{{ t('reports.moneyAge') }}</h2>
            <button
              type="button"
              class="card__about"
              :aria-expanded="showMethod"
              :aria-controls="`${id}-method`"
              @click="showMethod = !showMethod"
            >
              {{ t('reports.moneyAgeAbout') }}
            </button>
          </div>
          <div class="card__figure">
            <p class="card__value card__value--sm">
              {{ latest ? daysText(latest.days) : t('reports.noSpending') }}
            </p>
            <p
              v-if="latest && latest.coverage !== null && latest.coverage < 10_000"
              class="card__note"
            >
              {{ t('reports.moneyAgePartial', { coverage: percentText(latest.coverage) }) }}
            </p>
            <p v-if="latest" class="card__note">{{ monthText(latest.month) }}</p>
          </div>
        </div>
        <p v-show="showMethod" :id="`${id}-method`" class="card__method">
          {{ t('reports.moneyAgeExplain') }}
        </p>
        <div class="card__chart" data-print-chart>
          <AreaSparkline
            :values="age.points.map((p) => p.days)"
            color="var(--report-series-5)"
            :label="t('reports.moneyAgeTrend')"
            :description="ageDescription"
          />
        </div>
        <div class="card__data">
          <table>
            <caption class="visually-hidden">
              {{
                t('reports.moneyAgeTrend')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('reports.colMonth') }}</th>
                <th scope="col" class="num">{{ t('reports.colMoneyAge') }}</th>
                <th scope="col" class="num">{{ t('reports.colCoverage') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in age.points" :key="p.month">
                <th scope="row">{{ monthText(p.month) }}</th>
                <td class="num">
                  <span v-if="p.future" :aria-label="t('reports.unavailable')">—</span>
                  <template v-else>{{ daysText(p.days) }}</template>
                </td>
                <td class="num">
                  {{ p.coverage === null ? '—' : percentText(p.coverage) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.summary-frame {
  container-type: inline-size;
}

/* Rows are as tall as auto-fill makes the columns wide: the same count, floor((W + gap) / (min + gap)). */
.summary {
  --cell-min: min(14rem, 100cqi);
  --cols: max(1, round(down, (100cqi + var(--space-4)) / (var(--cell-min) + var(--space-4)), 1));

  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--cell-min), 1fr));
  grid-auto-rows: calc((100cqi - (var(--cols) - 1) * var(--space-4)) / var(--cols));
  gap: var(--space-4);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--space-4) var(--space-5);
  text-align: center;
  border: 1px solid var(--register-border);
  border-radius: var(--radius);
  background: var(--panel-bg);
}

.card > * {
  flex-shrink: 0;
}

.card--chart {
  grid-row: span 2;
}

.card__head {
  display: flex;
  flex-flow: column wrap;
  gap: var(--space-3);
  align-items: center;
  align-self: stretch;
}

.card__figure {
  text-align: center;
}

.card__title {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--font-md);
  font-weight: 600;
}

.card__value {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--font-2xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.card__value--sm {
  font-size: var(--font-xl);
}

.card__note,
.card__method {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.card__method {
  color: var(--text);
}

/* A value widget: the title at the top, the timeframe at the bottom, the amount centered in the card. */
.card--value {
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  justify-items: center;
}

.card--value .card__title {
  align-self: start;
}

.card--value .card__note {
  align-self: end;
}

.pos {
  color: var(--report-positive);
}

.neg {
  color: var(--report-negative);
}

.card__about {
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--link);
  font: inherit;
  font-size: var(--font-sm);
  text-decoration: underline;
  cursor: pointer;
}

.card__data th,
.card__data td {
  padding: var(--space-1) var(--space-2);
  font-weight: 400;
  text-align: start;
}

.card__data .num {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.card__chart,
.card__data {
  align-self: stretch;
  min-width: 0;
}

/* Free space splits around the chart: centered between the title and the table, the table at the bottom. */
.card__chart {
  margin-block: auto;
}

.card__chart--pie {
  display: flex;
  justify-content: center;
}

.card__data table {
  width: 100%;
  border-collapse: collapse;
}
</style>
