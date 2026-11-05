<script setup lang="ts">
// The timeline (09 §3): ◀ [year | 12 months] ▶. Clicking a month makes it the left-most column; months
// outside the budget's range are grayed and can't be picked. The visible months share a background, the
// current month has its own, an end cap marks December when it's in view, and an indicator slides under
// the selected month. One Tab stop: ←/→ step, Home/End jump to the first/last month (22 §2.3).
import { addMonths } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { format as formatDate } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { timelineCells, timelineLabel, type TimelineLabel } from '../../budget/budget-model';
import { useBudget } from '../../budget/use-budget';
import { dateLocale } from '../../i18n';

const { t } = useI18n();
const b = useBudget();
const id = useId();
const strip = ref<HTMLElement | null>(null);
const labelSize = ref<TimelineLabel>('short');

/** The range starts 3 months before the earliest transaction. */
const firstDataMonth = computed((): Month | null => {
  const first = b.months[0];
  return first ? addMonths(first, 3) : null;
});

const model = computed(() =>
  b.selected
    ? timelineCells({
        selected: b.selected,
        count: b.count,
        current: b.current,
        months: b.months,
        firstDataMonth: firstDataMonth.value,
      })
    : { cells: [], endCap: false },
);

const label = (m: Month): string => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
  const pattern =
    labelSize.value === 'narrow' ? 'LLLLL' : labelSize.value === 'short' ? 'LLL' : 'LLLL';
  return formatDate(d, pattern, { locale: dateLocale.value });
};
const longLabel = (m: Month): string =>
  formatDate(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1), 'LLLL yyyy', {
    locale: dateLocale.value,
  });

const selectedIndex = computed(() => Number(b.selected?.slice(5, 7) ?? 1) - 1);

function onKey(e: KeyboardEvent): void {
  let handled = true;
  if (e.key === 'ArrowLeft') b.step(-1);
  else if (e.key === 'ArrowRight') b.step(1);
  else if (e.key === 'Home') b.jumpTo('first');
  else if (e.key === 'End') b.jumpTo('last');
  else handled = false;
  if (handled) e.preventDefault();
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  const el = strip.value;
  if (!el) return;
  observer = new ResizeObserver(() => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    labelSize.value = timelineLabel(el.clientWidth / rem);
  });
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="timeline">
    <button
      type="button"
      class="timeline__arrow"
      :aria-label="t('a11y.previousMonth')"
      :disabled="!b.canStepBack"
      @click="b.step(-1)"
    >
      <ChevronLeft aria-hidden="true" />
    </button>
    <div ref="strip" class="timeline__strip">
      <span class="timeline__year">{{ b.selected?.slice(0, 4) }}</span>
      <div
        class="timeline__months"
        role="listbox"
        tabindex="0"
        :aria-label="t('a11y.budgetTimeline')"
        :aria-activedescendant="b.selected ? `${id}-${b.selected}` : undefined"
        @keydown="onKey"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -- the listbox has the focus and the keys; options follow aria-activedescendant (22 §4.4) -->
        <div
          v-for="c in model.cells"
          :id="`${id}-${c.month}`"
          :key="c.month"
          role="option"
          class="timeline__month"
          :class="[
            `timeline__month--${c.style}`,
            { 'timeline__month--out': !c.inRange, 'timeline__month--nodata': c.noData },
          ]"
          :aria-selected="c.month === b.selected"
          :aria-disabled="!c.inRange"
          :aria-label="longLabel(c.month)"
          @click="c.inRange && b.select(c.month)"
        >
          {{ label(c.month) }}
        </div>
        <span v-if="model.endCap" class="timeline__cap" aria-hidden="true" />
        <span
          class="timeline__indicator"
          aria-hidden="true"
          :style="{ transform: `translateX(${String(selectedIndex * 100)}%)` }"
        />
      </div>
    </div>
    <button
      type="button"
      class="timeline__arrow"
      :aria-label="t('a11y.nextMonth')"
      :disabled="!b.canStepForward"
      @click="b.step(1)"
    >
      <ChevronRight aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  height: var(--row-h);
  background: var(--header-bg-current-end);
  color: var(--atb-future);
}

.timeline__arrow {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--row-h);
  min-width: var(--hit-min);
  padding: 0;
  border: 0;
  background: var(--header-bg-current);
  color: var(--atb-future);
  cursor: pointer;
}

.timeline__arrow:disabled {
  cursor: default;
  opacity: 0.4;
}

.timeline__arrow svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.timeline__strip {
  display: flex;
  flex: 1;
  min-width: 0;
}

.timeline__year {
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  background: var(--header-bg-current);
  font-weight: 700;
}

.timeline__months {
  position: relative;
  display: grid;
  flex: 1;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  min-width: 0;
}

.timeline__month {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--header-bg-current);
  color: var(--atb-future);
  cursor: pointer;
  font-size: var(--font-body);
  font-weight: 700;
  white-space: nowrap;
}

/* On --accent-blue, --panel-bg is the text color that passes in every palette (05 §1.10). */
.timeline__month--current {
  background: var(--accent-blue);
  color: var(--panel-bg);
}

.timeline__month--alsoVisible {
  background: color-mix(in srgb, var(--header-bg-current) 80%, var(--atb-future));
}

.timeline__month--currentSelected {
  background: color-mix(in srgb, var(--accent-blue) 90%, var(--atb-future));
  color: var(--panel-bg);
}

.timeline__month--nodata {
  color: var(--timeline-no-data-text);
}

.timeline__month--out {
  cursor: default;
  opacity: 0.45;
}

.timeline__cap {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--space-1);
  background: var(--atb-future);
}

.timeline__indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  width: calc(100% / 12);
  height: var(--space-1);
  background: var(--atb-positive);
  transition: transform 250ms ease-out;
}

.timeline__months:focus-visible {
  outline: 2px solid var(--text-on-blue);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .timeline__indicator {
    transition: none;
  }
}
</style>
