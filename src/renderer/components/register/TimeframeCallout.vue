<script setup lang="ts">
// The date filter's Timeframe callout (10 §3): the presets, From/Through month pickers over the account's
// first to last transaction month, and Cancel / Done. Filtering is by month, inclusive. Closes with
// 'cancel', or the chosen filter as JSON.
import type { Month } from '@shared/domain/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { presetRange, type DateFilter, type DatePreset } from '../../register/view-state';
import MonthPicker from '../common/MonthPicker.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ current: DateFilter; from: Month; to: Month; today: string }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();

const PRESETS: { preset: Exclude<DatePreset, 'custom'>; key: string }[] = [
  { preset: 'thisMonth', key: 'app.regDateThisMonth' },
  { preset: 'latest3', key: 'app.regDateLatest3' },
  { preset: 'thisYear', key: 'app.regDateThisYear' },
  { preset: 'lastYear', key: 'app.regDateLastYear' },
  { preset: 'all', key: 'app.regDateAll' },
];

const choice = ref<DateFilter>({ ...props.current });
const fromMonth = ref<Month>(props.current.from ?? props.from);
const toMonth = ref<Month>(props.current.to ?? props.to);
const lo = computed(() => (props.from < fromMonth.value ? props.from : fromMonth.value));
const hi = computed(() => (props.to > toMonth.value ? props.to : toMonth.value));

function pick(preset: Exclude<DatePreset, 'custom'>): void {
  const r = presetRange(preset, props.today as never);
  choice.value = r;
  if (r.from) fromMonth.value = r.from;
  if (r.to) toMonth.value = r.to;
}

function custom(): void {
  const [a, b] =
    fromMonth.value <= toMonth.value
      ? [fromMonth.value, toMonth.value]
      : [toMonth.value, fromMonth.value];
  choice.value = { preset: 'custom', from: a, to: b };
}

function done(): void {
  emit('close', JSON.stringify(choice.value));
}
</script>

<template>
  <div class="timeframe">
    <div class="timeframe__content">
      <div class="timeframe__presets" role="radiogroup" :aria-label="t('app.regTimeframe')">
        <button
          v-for="p in PRESETS"
          :key="p.preset"
          type="button"
          role="radio"
          class="timeframe__preset"
          :aria-checked="choice.preset === p.preset"
          @click="pick(p.preset)"
        >
          {{ t(p.key) }}
        </button>
      </div>
      <div class="timeframe__range">
        <span>{{ t('app.regTimeframeFrom') }}</span>
        <MonthPicker
          :model-value="fromMonth"
          :from="lo"
          :to="hi"
          :label="t('app.regTimeframeFrom')"
          @update:model-value="
            (m) => {
              fromMonth = m;
              custom();
            }
          "
        />
        <span>{{ t('app.regTimeframeThrough') }}</span>
        <MonthPicker
          :model-value="toMonth"
          :from="lo"
          :to="hi"
          :label="t('app.regTimeframeThrough')"
          @update:model-value="
            (m) => {
              toMonth = m;
              custom();
            }
          "
        />
      </div>
    </div>
    <div class="timeframe__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary @click="done">{{ t('app.editDone') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
/* Presets and range scroll when the callout is capped to the room left (17 §3); the buttons stay. */
.timeframe {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}

.timeframe__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  overflow-y: auto;
}

.timeframe__presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.timeframe__preset {
  min-height: var(--hit-min);
  padding: 0 var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text);
  cursor: pointer;
}

.timeframe__preset[aria-checked='true'] {
  border-color: var(--accent-blue);
  background: var(--accent-blue);
  color: var(--panel-bg);
}

.timeframe__range {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-2) var(--space-3);
  align-items: center;
}

.timeframe__buttons {
  display: flex;
  flex: none;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
