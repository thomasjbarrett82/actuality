<script setup lang="ts">
// The loading overlay box (17 §6): --overlay-bg at 90 %, white 2xl text, no spinner. The app is aria-busy
// while it shows, and its label and "Done." are announced (22 §4.5).
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { useLoadingOverlay } from '../../stores/loading';

const loading = useLoadingOverlay();
const { t } = useI18n();

watch(
  () => loading.label,
  (now, before) => {
    document.getElementById('app')?.setAttribute('aria-busy', String(now !== null));
    // Progress updates change the text in place; only the first text is announced.
    if (now && !before) announce(now);
    else if (!now && before) announce(t('a11y.loadingDone'));
  },
);
</script>

<template>
  <div v-if="loading.label" class="loading" @keydown.stop.prevent @mousedown.stop.prevent>
    <div class="loading__box">{{ loading.label }}</div>
  </div>
</template>

<style scoped>
.loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.loading__box {
  padding: var(--space-6) var(--space-7);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--overlay-bg) 90%, transparent);
  color: var(--text-on-blue);
  font-size: var(--font-2xl);
}
</style>
