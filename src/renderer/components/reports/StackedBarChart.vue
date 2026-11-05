<script setup lang="ts">
// A stacked-period chart (15 §4.2): one bar per period, its series stacked from the zero line (spending
// up, refunds that exceed spending down), and the total as a line with markers. An unobserved future
// period has no bar or point. A selectable series' segments drill down on click; the legend and table
// offer the same action from the keyboard.
import { computed } from 'vue';
import { bands, labelEvery, linePath, yScale } from '../../reports/chart-geometry';
import type { ChartSeries } from '../../reports/use-chart';
import type { ChartTip } from '../../reports/view-types';
import ChartFrame from './ChartFrame.vue';

const props = defineProps<{
  labels: string[];
  series: ChartSeries[];
  total: (number | null)[];
  totalLabel: string;
  format: (v: number) => string;
  label: string;
  description: string;
  /** Series keys whose segments can be selected. */
  selectable?: string[];
}>();
const emit = defineEmits<{ select: [key: string] }>();

const HEIGHT = 300;
/** Inline, so a printout of the SVG keeps it (16 §3). */
const AXIS = { fill: 'var(--text-muted)', fontSize: 'var(--font-sm)' };
const PAD = { left: 72, right: 16, top: 12, bottom: 28 };
const n = computed(() => props.labels.length);

/** Each period's segments, stacked away from zero by sign. */
const stacks = computed(() =>
  props.labels.map((_, i) => {
    let up = 0;
    let down = 0;
    return props.series.flatMap((s) => {
      const v = s.values[i];
      if (v === null || v === undefined || v === 0) return [];
      const from = v > 0 ? up : down;
      if (v > 0) up += v;
      else down += v;
      return [{ key: s.key, color: s.color, from, to: from + v }];
    });
  }),
);

const extent = computed(() => [
  ...stacks.value.flatMap((st) => st.map((seg) => seg.to)),
  ...props.total.filter((v): v is number => v !== null),
]);

const layout = (width: number) => {
  const scale = yScale(extent.value, PAD.top, HEIGHT - PAD.bottom);
  const band = bands(n.value, PAD.left, width - PAD.right);
  return { scale, band, barWidth: Math.max(2, Math.min(56, band.width * 0.6)) };
};

const indexAt = (x: number, width: number): number | null => {
  const { band } = layout(width);
  const i = Math.floor((x - PAD.left) / band.width);
  return i >= 0 && i < n.value ? i : null;
};
const xAt = (i: number, width: number): number => layout(width).band.center(i);

function tip(i: number): ChartTip | null {
  const title = props.labels[i];
  if (title === undefined) return null;
  const rows = props.series.map((s) => {
    const v = s.values[i];
    return {
      key: s.key,
      label: s.label,
      value: v === null || v === undefined ? '—' : props.format(v),
      color: s.color,
      shape: s.shape,
    };
  });
  const t = props.total[i];
  rows.push({
    key: 'total',
    label: props.totalLabel,
    value: t === null || t === undefined ? '—' : props.format(t),
    color: 'var(--text)',
    shape: 'ring',
  });
  return { title, rows };
}

const selectable = (key: string): boolean => props.selectable?.includes(key) === true;
</script>

<template>
  <ChartFrame
    :label="label"
    :description="description"
    :height="HEIGHT"
    :count="n"
    :index-at="indexAt"
    :x-at="xAt"
    :tip="tip"
  >
    <template #default="{ width }">
      <g v-for="tick in layout(width).scale.ticks" :key="tick">
        <line
          :style="{ stroke: tick === 0 ? 'var(--report-zero-line)' : 'var(--report-grid)' }"
          :x1="PAD.left"
          :x2="width - PAD.right"
          :y1="layout(width).scale.y(tick)"
          :y2="layout(width).scale.y(tick)"
        />
        <text
          :style="AXIS"
          :x="PAD.left - 6"
          :y="layout(width).scale.y(tick)"
          text-anchor="end"
          dy="0.35em"
        >
          {{ format(tick) }}
        </text>
      </g>
      <g v-for="(stack, i) in stacks" :key="i">
        <rect
          v-for="seg in stack"
          :key="seg.key"
          :class="{ selectable: selectable(seg.key) }"
          :x="layout(width).band.center(i) - layout(width).barWidth / 2"
          :y="Math.min(layout(width).scale.y(seg.from), layout(width).scale.y(seg.to))"
          :width="layout(width).barWidth"
          :height="Math.abs(layout(width).scale.y(seg.from) - layout(width).scale.y(seg.to))"
          :style="{ fill: seg.color }"
          @click="selectable(seg.key) && emit('select', seg.key)"
        />
        <text
          v-if="i % labelEvery(n, Math.floor(width / 70)) === 0"
          :style="AXIS"
          :x="layout(width).band.center(i)"
          :y="HEIGHT - 8"
          text-anchor="middle"
        >
          {{ labels[i] }}
        </text>
      </g>
      <path
        :style="{ stroke: 'var(--text)', strokeWidth: 1.5 }"
        :d="linePath(total, layout(width).band.center, layout(width).scale.y)"
        fill="none"
      />
      <template v-for="(t, i) in total" :key="`t${i}`">
        <circle
          v-if="t !== null"
          :style="{ fill: 'var(--panel-bg)', stroke: 'var(--text)', strokeWidth: 2 }"
          :cx="layout(width).band.center(i)"
          :cy="layout(width).scale.y(t)"
          r="4"
        />
      </template>
    </template>
  </ChartFrame>
</template>

<style scoped>
.selectable {
  cursor: pointer;
}
</style>
