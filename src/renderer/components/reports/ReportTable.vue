<script setup lang="ts">
// A report's data table (15 §7–8): the complete, accessible form of what the chart plots. Row headers name
// each row; an expandable row has a disclosure button (aria-expanded) that shows its children. Amounts go
// through <MoneyAmount>, so privacy mode masks them; an unobserved future period reads "—", named
// "Unavailable". Table cells never navigate; a drillable row has its own button.
import type { MoneySettings } from '@shared/money';
import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { TableRow } from '../../reports/view-types';
import MoneyAmount from '../common/MoneyAmount.vue';
import SeriesSwatch from './SeriesSwatch.vue';

const props = withDefaults(
  defineProps<{
    caption: string;
    /** The label column's header, then one per cell. */
    columns: string[];
    rows: TableRow[];
    money: MoneySettings;
    negativeMoneyColor?: boolean;
  }>(),
  { negativeMoneyColor: true },
);
const expanded = defineModel<string[]>('expanded', { default: () => [] });
const { t } = useI18n();

function toggle(key: string): void {
  expanded.value = expanded.value.includes(key)
    ? expanded.value.filter((k) => k !== key)
    : [...expanded.value, key];
}
</script>

<template>
  <div class="report-table">
    <table>
      <caption>
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th v-for="(c, i) in columns" :key="i" scope="col" :class="{ num: i > 0 }">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.key">
          <tr :class="row.tone ? `is-${row.tone}` : ''">
            <th scope="row" class="label">
              <span class="label__inner">
                <SeriesSwatch
                  v-if="row.swatch"
                  :color="row.swatch.color"
                  :shape="row.swatch.shape"
                  :dashed="row.swatch.dashed"
                />
                <button
                  v-if="row.children && row.children.length > 0"
                  type="button"
                  class="disclosure"
                  :aria-expanded="expanded.includes(row.key)"
                  @click="toggle(row.key)"
                >
                  <ChevronDown v-if="expanded.includes(row.key)" class="icon" aria-hidden="true" />
                  <ChevronRight v-else class="icon" aria-hidden="true" />
                  {{ row.label }}
                </button>
                <button
                  v-else-if="row.action"
                  type="button"
                  class="link"
                  :aria-label="row.action.label"
                  @click="row.action.run"
                >
                  {{ row.label }}
                </button>
                <span v-else>{{ row.label }}</span>
              </span>
            </th>
            <td v-for="(cell, i) in row.cells" :key="i" class="num">
              <template v-if="cell.kind === 'text'">{{ cell.text }}</template>
              <span v-else-if="cell.value === null" :aria-label="t('reports.unavailable')">—</span>
              <span v-else :class="{ neg: props.negativeMoneyColor && cell.value < 0 }"
                ><MoneyAmount :value="cell.value" :settings="money" symbol
              /></span>
            </td>
          </tr>
          <template v-if="row.children && expanded.includes(row.key)">
            <tr v-for="child in row.children" :key="`${row.key}/${child.key}`" class="is-child">
              <th scope="row" class="label">
                <span class="label__inner">
                  <SeriesSwatch
                    v-if="child.swatch"
                    :color="child.swatch.color"
                    :shape="child.swatch.shape"
                  />
                  <span>{{ child.label }}</span>
                </span>
              </th>
              <td v-for="(cell, i) in child.cells" :key="i" class="num">
                <template v-if="cell.kind === 'text'">{{ cell.text }}</template>
                <span v-else-if="cell.value === null" :aria-label="t('reports.unavailable')"
                  >—</span
                >
                <span v-else :class="{ neg: props.negativeMoneyColor && cell.value < 0 }"
                  ><MoneyAmount :value="cell.value" :settings="money" symbol
                /></span>
              </td>
            </tr>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.report-table {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
}

table {
  width: 100%;
  border-collapse: collapse;
}

caption {
  padding: var(--space-3) var(--space-3) var(--space-2);
  color: var(--text-strong);
  font-size: var(--font-lg);
  font-weight: 600;
  text-align: start;
}

th,
td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--grid-line-h);
  white-space: nowrap;
}

thead th {
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-weight: 600;
  text-align: start;
  text-transform: uppercase;
}

.num {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.label {
  font-weight: 400;
  text-align: start;
}

.label__inner {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.is-group .label,
.is-section .label {
  font-weight: 600;
}

.is-total th,
.is-total td {
  border-top: 2px solid var(--register-border);
  font-weight: 700;
}

.is-section th {
  background: var(--grid-header-bg);
  color: var(--text-on-blue);
}

.is-section td {
  background: var(--grid-header-bg);
  color: var(--text-on-blue);
}

.is-child .label {
  padding-inline-start: var(--space-7);
}

.neg {
  color: var(--money-negative-strong);
}

.is-section .neg {
  color: inherit;
}

.disclosure,
.link {
  display: inline-flex;
  align-items: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.disclosure {
  gap: var(--space-1);
  min-width: 0;
  font-weight: inherit;
}

.link {
  min-width: 0;
  color: var(--link);
  text-decoration: underline;
}

.icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
