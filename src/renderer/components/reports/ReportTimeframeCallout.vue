<script setup lang="ts">
// The reports Timeframe callout (15 §2.2): one row of presets, then From: and To:, each a month select and
// a year select, then Cancel / Done, with rules between. A custom range is inclusive months; Done swaps a
// start later than the end. Closes with 'cancel', or the chosen Timeframe as JSON.
import { monthBounds, monthOf, monthParts, toMonth } from '@shared/dates';
import type { ISODate, Month } from '@shared/domain/types';
import { monthName } from '@shared/format';
import type { RangePreset, Timeframe } from '@shared/reporting/model';
import { presetRange } from '@shared/reporting/periods';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { PRESET_KEYS } from '../../reports/labels';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{
  current: Timeframe;
  /** The years the year selects offer, widened to hold the current range. */
  fromYear: number;
  toYear: number;
  today: ISODate;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();

const PRESETS: RangePreset[] = ['thisMonth', 'latest3', 'thisYear', 'lastYear', 'all'];

function monthsOf(timeframe: Timeframe): [Month, Month] {
  const r =
    timeframe.kind === 'custom' ? timeframe : presetRange(timeframe.preset, props.today, null);
  return [monthOf(r.start), monthOf(r.end)];
}

const choice = ref<Timeframe>(props.current);
const [initialFrom, initialTo] = monthsOf(props.current);
const ends = ref<{ from: Month; to: Month }>({ from: initialFrom, to: initialTo });

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const years = computed(() => {
  const lo = Math.min(props.fromYear, monthParts(ends.value.from).y, monthParts(ends.value.to).y);
  const hi = Math.max(props.toYear, monthParts(ends.value.from).y, monthParts(ends.value.to).y);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
});

const ENDPOINTS = [
  {
    end: 'from',
    label: 'reports.timeframeFrom',
    month: 'reports.timeframeFromMonth',
    year: 'reports.timeframeFromYear',
  },
  {
    end: 'to',
    label: 'reports.timeframeTo',
    month: 'reports.timeframeToMonth',
    year: 'reports.timeframeToYear',
  },
] as const;

function pick(preset: RangePreset): void {
  choice.value = { kind: 'preset', preset };
  // All Dates starts at the earliest transaction, which the callout doesn't know: keep the months shown.
  if (preset === 'all') return;
  const [from, to] = monthsOf(choice.value);
  ends.value = { from, to };
}

function set(end: 'from' | 'to', part: 'm' | 'y', value: string): void {
  const { y, m } = monthParts(ends.value[end]);
  ends.value = {
    ...ends.value,
    [end]: part === 'm' ? toMonth(y, Number(value)) : toMonth(Number(value), m),
  };
  const { from, to } = ends.value;
  const [a, b] = from <= to ? [from, to] : [to, from];
  choice.value = { kind: 'custom', start: monthBounds(a).first, end: monthBounds(b).last };
}

const selected = (preset: RangePreset): boolean =>
  choice.value.kind === 'preset' && choice.value.preset === preset;
</script>

<template>
  <div class="timeframe">
    <div class="timeframe__content">
      <div class="timeframe__presets" role="radiogroup" :aria-label="t('reports.filterTimeframe')">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          role="radio"
          class="timeframe__preset"
          :aria-checked="selected(p)"
          @click="pick(p)"
        >
          {{ t(PRESET_KEYS[p]) }}
        </button>
      </div>
      <div class="timeframe__range">
        <div v-for="e in ENDPOINTS" :key="e.end" class="timeframe__end">
          <span aria-hidden="true">{{ t(e.label) }}</span>
          <select
            class="input"
            :aria-label="t(e.month)"
            :value="monthParts(ends[e.end]).m"
            @change="set(e.end, 'm', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in MONTHS" :key="m" :value="m">{{ monthName(m, dateLocale) }}</option>
          </select>
          <select
            class="input"
            :aria-label="t(e.year)"
            :value="monthParts(ends[e.end]).y"
            @change="set(e.end, 'y', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>
      </div>
    </div>
    <div class="timeframe__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary @click="emit('close', JSON.stringify(choice))">{{
        t('app.editDone')
      }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
/* Presets and range scroll when the callout is capped to the room left (17 §3); the buttons stay. */
.timeframe {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--grid-line-h);
}

.timeframe__content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.timeframe__presets,
.timeframe__range {
  display: flex;
  flex-wrap: wrap;
  padding: var(--space-3) 0;
}

.timeframe__presets {
  gap: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--grid-line-h);
}

.timeframe__preset {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text);
  white-space: nowrap;
  cursor: pointer;
}

.timeframe__preset:hover {
  color: var(--accent-blue);
}

.timeframe__preset[aria-checked='true'] {
  border-bottom-color: var(--accent-blue);
  color: var(--accent-blue);
}

.timeframe__range {
  gap: var(--space-3) var(--space-5);
  align-items: center;
}

/* An endpoint's label and its two selects wrap as one unit at narrow widths or zoom. */
.timeframe__end {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--space-2);
  align-items: center;
}

.timeframe__buttons {
  display: flex;
  flex: none;
  gap: var(--space-2);
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--grid-line-h);
}
</style>
