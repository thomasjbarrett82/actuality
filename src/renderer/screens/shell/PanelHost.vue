<script setup lang="ts">
// The panel host (06 §2): the current main-canvas screen on the white "paper" panel. Switches slide
// (350 ms). The first time Budget or a register is shown, a centered loading illustration stays until its
// first data has arrived or 1 s has passed, whichever is later, then fades out while the screen fades in
// (350 ms). Meanwhile the screen is busy and navigation is ignored (06 §3). Welcome loads nothing, and
// Reports shows its own loading, error and empty states inside the panel (15 §7), so neither has the
// illustration. After a switch, focus moves to the new panel's heading (22 §3).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSpinner from '../../components/common/AppSpinner.vue';
import { useAppStore, type MainScreen } from '../../stores/app';
import BudgetPanel from './BudgetPanel.vue';
import RegisterPanel from './RegisterPanel.vue';
import ReportsPanel from './ReportsPanel.vue';
import WelcomePanel from './WelcomePanel.vue';

const ILLUSTRATION_MIN_MS = 1000;

const { t } = useI18n();
const app = useAppStore();
const host = ref<HTMLElement | null>(null);

const kind = computed<MainScreen>(() => (app.screen === 'start' ? app.lastMain : app.screen));
const key = computed(() =>
  kind.value === 'register' ? `register:${app.activeAccountId ?? 'all'}` : kind.value,
);

/** The screen being shown for the first time: illustration up, screen hidden. */
const loading = ref(false);
const shown = ref(true);
let ready = false;
let minimumPassed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function focusHeading(): void {
  void nextTick(() => {
    host.value
      ?.querySelector<HTMLElement>(
        '.panel-host__screen:not(.panel-slide-leave-active) [data-panel-heading]',
      )
      ?.focus({ preventScroll: true });
  });
}

function finishLoading(): void {
  if (!loading.value || !ready || !minimumPassed) return;
  app.seenScreens.add(kind.value);
  loading.value = false;
  shown.value = true;
  app.busy = false;
  focusHeading();
}

function begin(screen: MainScreen): void {
  if (timer) clearTimeout(timer);
  ready = false;
  if (screen === 'welcome' || screen === 'reports' || app.seenScreens.has(screen)) {
    loading.value = false;
    shown.value = true;
    app.busy = false;
    focusHeading();
    return;
  }
  loading.value = true;
  shown.value = false;
  app.busy = true;
  minimumPassed = false;
  timer = setTimeout(() => {
    minimumPassed = true;
    finishLoading();
  }, ILLUSTRATION_MIN_MS);
}

function onReady(): void {
  ready = true;
  finishLoading();
}

watch(
  key,
  () => {
    begin(kind.value);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  app.busy = false;
});
</script>

<template>
  <div ref="host" class="panel-host" :aria-busy="loading ? 'true' : undefined">
    <Transition name="panel-slide">
      <div :key="key" class="panel-host__screen" :class="{ 'panel-host__screen--hidden': !shown }">
        <WelcomePanel v-if="kind === 'welcome'" />
        <BudgetPanel v-else-if="kind === 'budget'" :shown="shown" @ready="onReady" />
        <ReportsPanel v-else-if="kind === 'reports'" />
        <RegisterPanel
          v-else
          :account-id="app.activeAccountId ?? 'all'"
          :shown="shown"
          @ready="onReady"
        />
      </div>
    </Transition>
    <Transition name="panel-fade">
      <div v-if="loading" class="panel-host__loading" role="status">
        <AppSpinner class="panel-host__illustration" />
        <span class="visually-hidden">{{ t('a11y.loadingScreen') }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-host {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.panel-host__screen {
  position: absolute;
  inset: 0;
  overflow: auto;
  transition: opacity 350ms ease;
}

.panel-host__screen--hidden {
  opacity: 0;
}

.panel-host__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-bg);
}

.panel-host__illustration {
  width: 6rem;
  height: 6rem;
}

.panel-slide-enter-active,
.panel-slide-leave-active {
  transition:
    transform 350ms ease,
    opacity 350ms ease;
}

.panel-slide-enter-from {
  transform: translateX(100%);
}

.panel-slide-leave-to {
  transform: translateX(-30%);
  opacity: 0;
}

.panel-fade-leave-active {
  transition: opacity 350ms ease;
}

.panel-fade-leave-to {
  opacity: 0;
}
</style>
