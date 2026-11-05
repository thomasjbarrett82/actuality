<script setup lang="ts">
import { liveRegions } from './announcer';
</script>

<template>
  <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ liveRegions.polite }}</div>
  <div class="visually-hidden" aria-live="assertive" aria-atomic="true">
    {{ liveRegions.assertive }}
  </div>
</template>
