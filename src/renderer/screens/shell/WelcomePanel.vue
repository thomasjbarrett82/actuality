<script setup lang="ts">
// The Welcome panel (06 §2): shown when no screen is selected yet.
import { APP_NAME } from '@shared/app';
import { useI18n } from 'vue-i18n';
import AppLogo from '../../components/common/AppLogo.vue';

const { t } = useI18n();
</script>

<template>
  <section class="welcome" aria-labelledby="welcome-heading">
    <AppLogo class="welcome__logo" />
    <h1 id="welcome-heading" class="visually-hidden" tabindex="-1" data-panel-heading>
      {{ APP_NAME }}
    </h1>
    <p class="welcome__text">{{ t('app.welcomeSelect') }}</p>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-6);
  background: var(--panel-bg);
  color: var(--text-subtle);
}

.welcome__logo {
  width: 6rem;
  height: 6rem;
}

.welcome__text {
  max-width: var(--dialog-text-w);
  margin: 0;
  font-size: var(--font-lg);
  text-align: center;
}
</style>
