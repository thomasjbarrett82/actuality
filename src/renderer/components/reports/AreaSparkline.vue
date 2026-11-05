<script setup lang="ts">
// A Summary trend (15 §4.1): a small area chart of a measure over the range's months. Unobserved months
// are left out, not drawn as zero. It has a name and a description; the widget's data table holds the
// values. It spans the widget's full width.
import { computed, ref } from 'vue';
import { areaPath, linePath, xPoints, yScale } from '../../reports/chart-geometry';
import { useWidth } from '../../reports/use-chart';

const props = defineProps<{
  values: (number | null)[];
  color: string;
  label: string;
  description: string;
}>();

const HEIGHT = 96;
const box = ref<HTMLElement | null>(null);
const width = useWidth(box, 240);
const shown = computed(() => props.values.filter((v): v is number => v !== null));
const geometry = computed(() => {
  const scale = yScale(shown.value, 6, HEIGHT - 2, 2);
  const x = xPoints(props.values.length, 0, width.value);
  const base = scale.y(Math.max(scale.min, Math.min(0, scale.max)));
  return {
    area: areaPath(props.values, x, scale.y, base),
    line: linePath(props.values, x, scale.y),
  };
});
</script>

<template>
  <div ref="box" class="spark">
    <svg
      role="img"
      :aria-label="label"
      v-bind="{ 'aria-description': description }"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      :width="width"
      :height="HEIGHT"
    >
      <path :d="geometry.area" :style="{ fill: color, fillOpacity: 0.18 }" />
      <path :d="geometry.line" fill="none" :style="{ stroke: color, strokeWidth: 2 }" />
    </svg>
  </div>
</template>

<style scoped>
.spark {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.spark svg {
  display: block;
}
</style>
