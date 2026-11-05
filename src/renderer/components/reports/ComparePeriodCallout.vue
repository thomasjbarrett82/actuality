<script setup lang="ts">
// Spending Comparison's Compare Period callout (15 §4.3): a segmented Week / Month / Quarter / Year row, a
// Period: select of calendar periods at that unit, newest first, the previous period it compares with,
// then Cancel / Done, with rules between. A draft: Done commits it. Closes with 'cancel', or the chosen
// ComparisonOptions as JSON.
import type { WeekDay } from '@shared/budget-format';
import type { ISODate } from '@shared/domain/types';
import { PERIOD_UNITS, type ComparisonOptions, type PeriodUnit } from '@shared/reporting/model';
import { comparedPeriods, periodOf, recentPeriods } from '@shared/reporting/periods';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { comparePeriodText } from '../../reports/labels';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{
  current: ComparisonOptions;
  today: ISODate;
  weekStart: WeekDay;
  dateFormat: string;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();

const UNIT_KEYS: Readonly<Record<PeriodUnit, string>> = {
  week: 'reports.periodWeek',
  month: 'reports.periodMonth',
  quarter: 'reports.periodQuarter',
  year: 'reports.periodYear',
};
/** How many periods the select offers: two years of weeks, twenty years of the rest. */
const OFFERED: Readonly<Record<PeriodUnit, number>> = {
  week: 104,
  month: 240,
  quarter: 80,
  year: 20,
};

const choice = ref<ComparisonOptions>({ ...props.current });
const periods = computed(() => comparedPeriods(choice.value, props.weekStart));

/** The select's periods, holding the chosen one even when it's older than the rest. */
const options = computed(() => {
  const { unit } = choice.value;
  const list = recentPeriods(unit, props.today, props.weekStart, OFFERED[unit]);
  const chosen = periods.value.current;
  return list.some((p) => p.start === chosen.start) ? list : [...list, chosen];
});

const text = (p: { start: ISODate; end: ISODate }): string =>
  comparePeriodText(p, choice.value.unit, props.today, props.dateFormat);

/** A new unit keeps to the same time: the period holding the chosen one's last observed day. */
function pickUnit(unit: PeriodUnit): void {
  const { end } = periods.value.current;
  const anchor = end < props.today ? end : props.today;
  choice.value = { unit, start: periodOf(anchor, unit, props.weekStart).start };
}

function pickPeriod(start: string): void {
  choice.value = { ...choice.value, start: start as ISODate };
}
</script>

<template>
  <div class="compare">
    <div class="compare__content">
      <div class="compare__units" role="radiogroup" :aria-label="t('reports.comparePeriodUnit')">
        <button
          v-for="u in PERIOD_UNITS"
          :key="u"
          type="button"
          role="radio"
          class="compare__unit"
          :aria-checked="choice.unit === u"
          @click="pickUnit(u)"
        >
          {{ t(UNIT_KEYS[u]) }}
        </button>
      </div>
      <div class="compare__periods">
        <label class="compare__row">
          <span>{{ t('reports.comparePeriodLabel') }}</span>
          <select
            class="input"
            :value="periods.current.start"
            @change="pickPeriod(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="p in options" :key="p.start" :value="p.start">{{ text(p) }}</option>
          </select>
        </label>
        <p class="compare__row compare__previous">
          <span>{{ t('reports.comparePrevious') }}</span>
          <strong>{{ text(periods.previous) }}</strong>
        </p>
      </div>
    </div>
    <div class="compare__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary @click="emit('close', JSON.stringify(choice))">{{
        t('app.editDone')
      }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
/* The content scrolls when the callout is capped to the room left (17 §3); the buttons stay. */
.compare {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--grid-line-h);
}

.compare__content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.compare__units {
  display: inline-flex;
  align-self: flex-start;
  margin: var(--space-3) 0;
  border: 1px solid var(--register-border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  overflow: hidden;
}

.compare__unit {
  min-height: var(--hit-min);
  padding: 0 var(--space-5);
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.compare__unit:hover {
  color: var(--accent-blue);
}

.compare__unit[aria-checked='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
  font-weight: 600;
}

.compare__periods {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--grid-line-h);
}

.compare__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
}

.compare__previous strong {
  color: var(--text-strong);
  font-weight: 600;
}

.compare__buttons {
  display: flex;
  flex: none;
  gap: var(--space-2);
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--grid-line-h);
}
</style>
