<script setup lang="ts">
// The loading spinner (05 §5): resources/spinners/actuality-spinner-navy-tile.svg drawn inline. The logo
// fills from the base up, holds, then fades and starts again. CSS keyframes instead of the file's SMIL, so
// it can follow prefers-reduced-motion: there tokens.css runs it three times slower, the one animation
// that rule keeps (22 §6). Decorative: the caller announces what is loading.
import { useId } from 'vue';

const mask = `${useId()}-mask`;
</script>

<template>
  <svg class="app-spinner" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect class="app-spinner__tile" width="100" height="100" rx="22" />
    <defs>
      <!-- Mask luminance, not a displayed color: white shows the logo, black cuts the gap. -->
      <mask :id="mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <polygon class="app-spinner__shape" points="50,18 82,80 18,80" fill="#fff" stroke="#fff" />
        <rect class="app-spinner__rise" x="0" y="57" width="100" height="10" fill="#000" />
      </mask>
    </defs>
    <g class="app-spinner__logo" :mask="`url(#${mask})`">
      <rect class="app-spinner__peak" width="100" height="100" />
      <rect class="app-spinner__base app-spinner__rise" x="0" y="67" width="100" height="100" />
    </g>
  </svg>
</template>

<style scoped>
.app-spinner__tile {
  fill: var(--app-bg-dark);
}

.app-spinner__shape {
  stroke-width: 4;
  stroke-linejoin: round;
}

.app-spinner__peak {
  fill: var(--text-on-blue);
}

.app-spinner__base {
  fill: var(--logo-tile-base);
}

/* The gap and the green both rise 55 units: the gap is 10 tall, the green 100. */
.app-spinner__rise {
  transform-box: fill-box;
  animation: app-spinner-rise 2.4s infinite;
}

mask .app-spinner__rise {
  --rise: -550%;
}

.app-spinner__base.app-spinner__rise {
  --rise: -55%;
}

.app-spinner__logo {
  animation: app-spinner-fade 2.4s linear infinite;
}

@keyframes app-spinner-rise {
  0%,
  12% {
    translate: 0 0;
    animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
  }

  62%,
  84.9% {
    translate: 0 var(--rise);
  }

  85%,
  100% {
    translate: 0 0;
  }
}

@keyframes app-spinner-fade {
  0%,
  72% {
    opacity: 1;
  }

  84%,
  86% {
    opacity: 0;
  }

  100% {
    opacity: 1;
  }
}
</style>
