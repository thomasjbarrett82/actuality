<script setup lang="ts">
// The blue canvas (07): full-window start screens in a centered column that narrows to fit the window
// and scrolls when taller than it. The wordmark tops every screen but Loading.
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import AppWordmark from '../../components/common/AppWordmark.vue';
import { keyboard } from '../../keyboard/dispatcher';
import { useStart } from '../../stores/start';
import BudgetListScreen from './BudgetListScreen.vue';
import BudgetSetupScreen from './BudgetSetupScreen.vue';
import ConnectScreen from './ConnectScreen.vue';
import LoadingScreen from './LoadingScreen.vue';
import OpenBudgetScreen from './OpenBudgetScreen.vue';
import PreferencesScreen from './PreferencesScreen.vue';

const start = useStart();
const screens: Record<string, Component> = {
  connect: ConnectScreen,
  budgets: BudgetListScreen,
  open: OpenBudgetScreen,
  loading: LoadingScreen,
  setup: BudgetSetupScreen,
  properties: BudgetSetupScreen,
  preferences: PreferencesScreen,
};
const current = computed(() => screens[start.screen] ?? ConnectScreen);

const root = ref<HTMLElement | null>(null);
let unregister: (() => void) | null = null;
onMounted(() => {
  if (root.value) unregister = keyboard.registerRegion('start', 10, root.value);
});
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <main ref="root" class="canvas">
    <div class="canvas__column">
      <AppWordmark v-if="start.screen !== 'loading'" class="canvas__wordmark" />
      <component :is="current" :key="start.screen" />
    </div>
  </main>
</template>

<style scoped>
.canvas {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--app-bg);
  color: var(--text-on-blue);
}

.canvas__column {
  width: min(var(--canvas-col-w), 100% - 2 * var(--space-6));
  margin: 0 auto;
  padding: var(--space-7) 0;
}

/* The on-blue mark (resources/icons/svg/actuality-logo-sidebar-*.svg); the lettering is --text-on-blue. */
.canvas__wordmark {
  --logo-peak: var(--text-on-blue);
  --logo-base: var(--logo-on-blue-base);

  display: block;
  width: min(18rem, 100%);
  margin: 0 auto var(--space-7);
}
</style>
