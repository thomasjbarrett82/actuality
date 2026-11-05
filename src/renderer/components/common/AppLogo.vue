<script setup lang="ts">
// The app logo (05 §5): the mark of resources/icons/svg/actuality-logo-{light,dark}.svg, drawn inline so
// its two tones come from --logo-peak and --logo-base and follow the palette. Decorative: callers give the
// name in text. Size it with width/height.
</script>

<template>
  <svg class="app-logo" viewBox="14 13 72 72" aria-hidden="true" focusable="false">
    <polygon class="app-logo__base" points="24.71,67 75.29,67 82,80 18,80" />
    <polygon class="app-logo__peak" points="50,18 70.13,57 29.87,57" />
  </svg>
</template>

<style scoped>
.app-logo polygon {
  stroke-width: 4;
  stroke-linejoin: round;
}

.app-logo__base {
  fill: var(--logo-base);
  stroke: var(--logo-base);
}

.app-logo__peak {
  fill: var(--logo-peak);
  stroke: var(--logo-peak);
}
</style>
