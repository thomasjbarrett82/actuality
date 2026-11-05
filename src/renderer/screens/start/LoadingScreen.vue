<script setup lang="ts">
// The Loading screen (07 §5): the logo spinner and a message, centered on the blue canvas. After 10 s a Cancel link
// returns to the Budget List; the open in progress is closed once it finishes.
import { useI18n } from 'vue-i18n';
import AppSpinner from '../../components/common/AppSpinner.vue';
import UiLink from '../../components/common/UiLink.vue';
import { useStart } from '../../stores/start';

const { t } = useI18n();
const start = useStart();
</script>

<template>
  <section class="loading-screen" role="status" aria-live="polite">
    <AppSpinner class="loading-screen__spinner" />
    <p class="loading-screen__text">{{ start.loadingText }}</p>
    <UiLink
      v-if="start.loadingCancelable"
      class="loading-screen__cancel"
      @click="start.cancelLoading()"
    >
      {{ t('app.loadingCancel') }}
    </UiLink>
  </section>
</template>

<style scoped>
.loading-screen {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.loading-screen__spinner {
  width: var(--control-h-lg);
  height: var(--control-h-lg);
}

.loading-screen__text {
  margin: 0;
  font-size: var(--font-2xl);
  text-align: center;
}

.loading-screen__cancel {
  color: var(--text-on-blue);
}
</style>
