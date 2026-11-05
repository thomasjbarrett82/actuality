<script setup lang="ts">
// A line chart (15 §4.3, §4.5): one line per series over shared x positions, with the zero line placed by
// the 15 §4.5 rule. A null value breaks the line, so unobserved points are never drawn as zero. Each
// series carries a marker shape (and a dash when set), so lines differ by more than color.
import { computed } from 'vue';
import { labelEvery, linePath, xPoints, yScale } from '../../reports/chart-geometry';
import type { ChartSeries } from '../../reports/use-chart';
import type { ChartTip } from '../../reports/view-types';
import ChartFrame from './ChartFrame.vue';

const props = withDefaults(
  defineProps<{
    count: number;
    xLabel: (i: number) => string;
    series: ChartSeries[];
    format: (v: number) => string;
    label: string;
    description: string;
    height?: number;
  }>(),
  { height: 280 },
);

const PAD = { left: 72, right: 16, top: 12, bottom: 28 };
/** Inline, so a printout of the SVG keeps it (16 §3). */
const AXIS = { fill: 'var(--text-muted)', fontSize: 'var(--font-sm)' };

const values = computed(() =>
  props.series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
);

const layout = (width: number) => ({
  scale: yScale(values.value, PAD.top, props.height - PAD.bottom),
  x: xPoints(props.count, PAD.left, width - PAD.right),
});

const indexAt = (x: number, width: number): number | null => {
  if (props.count === 0) return null;
  const step = props.count > 1 ? (width - PAD.left - PAD.right) / (props.count - 1) : 1;
  const i = Math.round((x - PAD.left) / step);
  return Math.min(Math.max(0, i), props.count - 1);
};
const xAt = (i: number, width: number): number => layout(width).x(i);

function tip(i: number): ChartTip | null {
  if (i < 0 || i >= props.count) return null;
  return {
    title: props.xLabel(i),
    rows: props.series.map((s) => {
      const v = s.values[i];
      return {
        key: s.key,
        label: s.label,
        value: v === null || v === undefined ? '—' : props.format(v),
        color: s.color,
        shape: s.shape,
        ...(s.dashed !== undefined ? { dashed: s.dashed } : {}),
      };
    }),
  };
}

/** Marker positions: the last observed point and a few along the way. */
function markers(s: ChartSeries): number[] {
  const every = labelEvery(props.count, 8);
  return s.values.flatMap((v, i) => {
    if (v === null) return [];
    const last = i === s.values.length - 1 || s.values[i + 1] === null;
    return i % every === 0 || last ? [i] : [];
  });
}

const MARK: Record<string, string> = {
  circle: 'M-4,0a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
  square: 'M-4,-4h8v8h-8Z',
  triangle: 'M0,-5L5,4L-5,4Z',
  diamond: 'M0,-5L5,0L0,5L-5,0Z',
  cross: 'M-1.5,-5h3v3.5h3.5v3h-3.5v3.5h-3v-3.5h-3.5v-3h3.5Z',
  ring: 'M-4,0a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
  bar: 'M-5,-1.5h10v3h-10Z',
};
</script>

<template>
  <ChartFrame
    :label="label"
    :description="description"
    :height="height"
    :count="count"
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
      <template v-for="i in count" :key="`x${i}`">
        <text
          v-if="(i - 1) % labelEvery(count, Math.floor(width / 80)) === 0"
          :style="AXIS"
          :x="layout(width).x(i - 1)"
          :y="height - 8"
          text-anchor="middle"
        >
          {{ xLabel(i - 1) }}
        </text>
      </template>
      <g v-for="s in series" :key="s.key">
        <path
          :d="linePath(s.values, layout(width).x, layout(width).scale.y)"
          fill="none"
          :style="{ stroke: s.color, strokeWidth: 2, strokeDasharray: s.dashed ? '6 4' : 'none' }"
        />
        <path
          v-for="i in markers(s)"
          :key="i"
          :d="MARK[s.shape]"
          :transform="`translate(${layout(width).x(i)},${layout(width).scale.y(s.values[i] ?? 0)})`"
          :style="
            s.shape === 'ring'
              ? { fill: 'var(--panel-bg)', stroke: s.color, strokeWidth: 2 }
              : { fill: s.color }
          "
        />
      </g>
    </template>
  </ChartFrame>
</template>
