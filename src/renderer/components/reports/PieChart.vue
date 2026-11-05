<script setup lang="ts">
// The Top Spending Category Groups pie (15 §4.1): slices by share, each with its color and the legend's
// shape. The legend below it is a table with every slice's name and share, so the chart is never the
// only way to the data.
import { computed } from 'vue';
import { slicePath } from '../../reports/chart-geometry';
import type { PieSlice } from '../../reports/view-types';

const props = defineProps<{ slices: PieSlice[]; label: string; description: string }>();

const SIZE = 140;
const paths = computed(() => {
  const total = props.slices.reduce((s, x) => s + x.share, 0) || 1;
  let angle = 0;
  return props.slices.map((s) => {
    const a0 = angle;
    angle += (s.share / total) * Math.PI * 2;
    return {
      key: s.key,
      color: s.color,
      d: slicePath(SIZE / 2, SIZE / 2, SIZE / 2 - 2, a0, angle),
    };
  });
});
</script>

<template>
  <svg
    class="pie"
    role="img"
    :aria-label="label"
    v-bind="{ 'aria-description': description }"
    :viewBox="`0 0 ${SIZE} ${SIZE}`"
    :width="SIZE"
    :height="SIZE"
  >
    <path
      v-for="p in paths"
      :key="p.key"
      :d="p.d"
      :style="{ fill: p.color, stroke: 'var(--panel-bg)', strokeWidth: 1.5 }"
    />
  </svg>
</template>

<style scoped>
.pie {
  flex: none;
}
</style>
