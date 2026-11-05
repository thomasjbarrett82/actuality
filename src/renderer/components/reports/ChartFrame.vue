<script setup lang="ts">
// A report chart's frame (15 §8, 22 §4.1): an SVG `img` with a concise name and description, sized to its
// container. One Tab stop: ←/→, Home and End move a focused position whose tooltip shows every series'
// value there; the pointer moves it too. The tooltip supplements the adjacent table, never replaces it.
import { computed, ref, useId } from 'vue';
import { useChartFocus, useWidth } from '../../reports/use-chart';
import type { ChartTip } from '../../reports/view-types';
import SeriesSwatch from './SeriesSwatch.vue';

const props = defineProps<{
  label: string;
  description: string;
  height: number;
  count: number;
  /** The position under a pointer x, or null. */
  indexAt: (x: number, width: number) => number | null;
  /** A position's x, for the tooltip and the focus line. */
  xAt: (i: number, width: number) => number;
  tip: (i: number) => ChartTip | null;
}>();

const id = useId();
const box = ref<HTMLElement | null>(null);
const width = useWidth(box);
const focus = useChartFocus(() => props.count);
const tip = computed(() => (focus.index.value === null ? null : props.tip(focus.index.value)));
const tipLeft = computed(() => {
  const i = focus.index.value;
  if (i === null) return 0;
  return props.xAt(i, width.value);
});

function onPointer(e: PointerEvent): void {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
  focus.index.value = props.indexAt(e.clientX - rect.left, width.value);
}
</script>

<template>
  <div ref="box" class="chart" :style="{ height: `${height}px` }">
    <svg
      class="chart__svg"
      role="img"
      :aria-label="label"
      :aria-describedby="`${id}-desc`"
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      tabindex="0"
      @keydown="focus.onKeydown"
      @focus="focus.onFocus"
      @blur="focus.onLeave"
      @pointermove="onPointer"
      @pointerleave="focus.onLeave"
    >
      <slot :width="width" :height="height" :focused="focus.index.value" />
      <line
        v-if="focus.index.value !== null"
        class="chart__cursor"
        :x1="tipLeft"
        :x2="tipLeft"
        y1="0"
        :y2="height"
      />
    </svg>
    <p :id="`${id}-desc`" class="visually-hidden">{{ description }}</p>
    <div
      v-if="tip"
      class="chart__tip"
      :class="{ 'chart__tip--left': tipLeft > width / 2 }"
      :style="{ left: `${tipLeft}px` }"
      role="tooltip"
    >
      <div class="chart__tip-title">{{ tip.title }}</div>
      <div v-for="r in tip.rows" :key="r.key" class="chart__tip-row">
        <SeriesSwatch :color="r.color" :shape="r.shape" :dashed="r.dashed" />
        <span class="chart__tip-label">{{ r.label }}</span>
        <span class="chart__tip-value">{{ r.value }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  min-width: 0;
}

.chart__svg {
  display: block;
  overflow: visible;
  border-radius: var(--radius-sm);
}

.chart__svg:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.chart__cursor {
  stroke: var(--report-zero-line);
  stroke-dasharray: 2 3;
  pointer-events: none;
}

.chart__tip {
  position: absolute;
  top: var(--space-2);
  z-index: 1;
  min-width: 10rem;
  max-width: 20rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--report-tooltip-bg);
  color: var(--text);
  box-shadow: 0 0.15rem 0.5rem color-mix(in srgb, var(--overlay-shadow) 30%, transparent);
  transform: translateX(var(--space-3));
  pointer-events: none;
}

.chart__tip--left {
  transform: translateX(calc(-100% - var(--space-3)));
}

.chart__tip-title {
  margin-bottom: var(--space-1);
  font-weight: 600;
}

.chart__tip-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.chart__tip-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart__tip-value {
  font-variant-numeric: tabular-nums;
}
</style>
