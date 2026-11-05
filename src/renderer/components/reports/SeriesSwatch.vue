<script setup lang="ts">
// A series' legend and table mark (15 §8): its color and a shape, so color is never the only cue. A dashed
// series shows its dash.
import type { Shape } from '../../reports/use-chart';

defineProps<{ color: string; shape: Shape; dashed?: boolean | undefined }>();
</script>

<template>
  <svg class="swatch" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <line
      v-if="dashed !== undefined"
      x1="0"
      y1="8"
      x2="16"
      y2="8"
      :style="{ stroke: color }"
      stroke-width="2"
      :stroke-dasharray="dashed ? '3 2' : undefined"
    />
    <circle v-if="shape === 'circle'" cx="8" cy="8" r="5" :style="{ fill: color }" />
    <rect
      v-else-if="shape === 'square'"
      x="3"
      y="3"
      width="10"
      height="10"
      :style="{ fill: color }"
    />
    <path v-else-if="shape === 'triangle'" d="M8 2 L14 13 L2 13 Z" :style="{ fill: color }" />
    <path v-else-if="shape === 'diamond'" d="M8 1 L15 8 L8 15 L1 8 Z" :style="{ fill: color }" />
    <path
      v-else-if="shape === 'cross'"
      d="M6 2 H10 V6 H14 V10 H10 V14 H6 V10 H2 V6 H6 Z"
      :style="{ fill: color }"
    />
    <circle
      v-else-if="shape === 'ring'"
      cx="8"
      cy="8"
      r="4.5"
      fill="none"
      stroke-width="3"
      :style="{ stroke: color }"
    />
    <rect v-else x="2" y="6" width="12" height="4" :style="{ fill: color }" />
  </svg>
</template>

<style scoped>
.swatch {
  flex: none;
  width: 0.9rem;
  height: 0.9rem;
  vertical-align: -0.1rem;
}
</style>
