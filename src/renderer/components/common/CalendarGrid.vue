<script setup lang="ts">
// The DateField's calendar (11 §3, 05 §6): month/year arrows over a `grid` of days (22 §4.4). One Tab
// stop for the grid; arrows move by day/week, PageUp/PageDown by month (Shift: by year), Home/End to the
// week's start/end, Enter/Space picks; DateField owns Esc. Month and weekday names come from the UI
// language; the first weekday from the budget, else the UI language (07 §4).
import {
  addDays,
  addMonths,
  daysInMonth,
  monthOf,
  monthParts,
  parts,
  toISODate,
} from '@shared/dates';
import type { ISODate } from '@shared/domain/types';
import { monthHeader } from '@shared/format';
import { format as formatDate } from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale, weekStartsOn } from '../../i18n';

const props = withDefaults(
  defineProps<{ modelValue: ISODate; today: ISODate; focusOnMount?: boolean }>(),
  {
    focusOnMount: true,
  },
);
const emit = defineEmits<{ pick: [date: ISODate] }>();
const { t } = useI18n();
const id = useId();
const active = ref<ISODate>(props.modelValue);
const dayId = (d: ISODate): string => `${id}-${d}`;

watch(
  () => props.modelValue,
  (d) => {
    active.value = d;
  },
);

const month = computed(() => monthOf(active.value));

const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    // 2023-01-01 was a Sunday.
    const day = new Date(2023, 0, 1 + ((i + weekStartsOn.value) % 7));
    return {
      short: formatDate(day, 'EEEEEE', { locale: dateLocale.value }),
      long: formatDate(day, 'EEEE', { locale: dateLocale.value }),
    };
  }),
);

const weeks = computed((): (ISODate | null)[][] => {
  const { y, m } = monthParts(month.value);
  const first = new Date(y, m - 1, 1).getDay();
  const lead = (first - weekStartsOn.value + 7) % 7;
  const cells: (ISODate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(toISODate(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
});

/** The full date, with the day as the plain number the button shows: "1", not "1st" (WCAG 2.5.3). */
function longLabel(date: ISODate): string {
  const { y, m, d } = parts(date);
  return new Intl.DateTimeFormat(dateLocale.value.code, { dateStyle: 'full' }).format(
    new Date(y, m - 1, d),
  );
}

function shiftMonths(n: number): void {
  const { d } = parts(active.value);
  const target = addMonths(month.value, n);
  const { y, m } = monthParts(target);
  active.value = toISODate(y, m, Math.min(d, daysInMonth(y, m)));
}

async function focusActive(): Promise<void> {
  await nextTick();
  document.getElementById(dayId(active.value))?.focus();
}

function onKey(e: KeyboardEvent): void {
  const weekday = (new Date(...ymd(active.value)).getDay() - weekStartsOn.value + 7) % 7;
  const moves: Record<string, () => void> = {
    ArrowLeft: () => (active.value = addDays(active.value, -1)),
    ArrowRight: () => (active.value = addDays(active.value, 1)),
    ArrowUp: () => (active.value = addDays(active.value, -7)),
    ArrowDown: () => (active.value = addDays(active.value, 7)),
    Home: () => (active.value = addDays(active.value, -weekday)),
    End: () => (active.value = addDays(active.value, 6 - weekday)),
    PageUp: () => {
      shiftMonths(e.shiftKey ? -12 : -1);
    },
    PageDown: () => {
      shiftMonths(e.shiftKey ? 12 : 1);
    },
  };
  const move = moves[e.key];
  if (move) {
    e.preventDefault();
    move();
    void focusActive();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    emit('pick', active.value);
  }
}

function ymd(date: ISODate): [number, number, number] {
  const { y, m, d } = parts(date);
  return [y, m - 1, d];
}

onMounted(() => {
  if (props.focusOnMount) void focusActive();
});
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- the dialog takes the grid keys (22 §4.4) -->
  <div class="calendar" role="dialog" :aria-labelledby="`${id}-month`" @keydown="onKey">
    <div class="calendar__header">
      <button
        type="button"
        class="calendar__nav"
        :aria-label="t('a11y.previousYear')"
        @click="shiftMonths(-12)"
      >
        <ChevronsLeft class="calendar__icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="calendar__nav"
        :aria-label="t('a11y.previousMonth')"
        @click="shiftMonths(-1)"
      >
        <ChevronLeft class="calendar__icon" aria-hidden="true" />
      </button>
      <h2 :id="`${id}-month`" class="calendar__month" aria-live="polite">
        {{ monthHeader(month, dateLocale) }}
      </h2>
      <button
        type="button"
        class="calendar__nav"
        :aria-label="t('a11y.nextMonth')"
        @click="shiftMonths(1)"
      >
        <ChevronRight class="calendar__icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="calendar__nav"
        :aria-label="t('a11y.nextYear')"
        @click="shiftMonths(12)"
      >
        <ChevronsRight class="calendar__icon" aria-hidden="true" />
      </button>
    </div>
    <table class="calendar__grid" role="grid" :aria-labelledby="`${id}-month`">
      <thead>
        <tr>
          <th v-for="w in weekdays" :key="w.long" scope="col" :abbr="w.long">{{ w.short }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(week, i) in weeks" :key="i">
          <td
            v-for="(day, j) in week"
            :key="j"
            :aria-selected="day === modelValue ? 'true' : undefined"
          >
            <button
              v-if="day"
              :id="dayId(day)"
              type="button"
              class="calendar__day"
              :class="{ 'is-today': day === today, 'is-selected': day === modelValue }"
              :tabindex="day === active ? 0 : -1"
              :aria-label="longLabel(day)"
              :aria-current="day === today ? 'date' : undefined"
              @click="emit('pick', day)"
            >
              {{ parts(day).d }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.calendar {
  padding: var(--space-3);
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
}

.calendar__header {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.calendar__month {
  flex: 1;
  margin: 0;
  font-size: var(--font-md);
  font-weight: 600;
  text-align: center;
}

.calendar__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.calendar__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.calendar__grid {
  border-collapse: collapse;
}

.calendar__grid th {
  padding: var(--space-1);
  color: var(--text-subtle);
  font-size: var(--font-sm);
  font-weight: 400;
}

.calendar__grid td {
  padding: 0;
  text-align: center;
}

.calendar__day {
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.calendar__day:hover {
  background: var(--button-bg);
}

.calendar__day.is-today {
  border-color: var(--accent-blue);
  font-weight: 700;
}

.calendar__day.is-selected {
  background: var(--accent-blue);
  color: var(--panel-bg);
}
</style>
