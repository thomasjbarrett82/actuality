<script setup lang="ts">
// The screen host (06 §2): the blue start canvas (07) or the main canvas, sliding 350 ms between them,
// left when going forward to the budget, right when going back. The main canvas is the sidebar (08) and
// the panel host with the current screen (06 §2–3). On Reports, the page's heading labels the main region
// (22 §4.1).
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import TheSidebar from '../../components/sidebar/TheSidebar.vue';
import { keyboard } from '../../keyboard/dispatcher';
import { useAppStore } from '../../stores/app';
import StartCanvas from '../start/StartCanvas.vue';
import PanelHost from './PanelHost.vue';

const app = useAppStore();
const onStart = computed(() => app.screen === 'start');
const direction = ref<'forward' | 'back'>('forward');
watch(onStart, (now) => {
  direction.value = now ? 'back' : 'forward';
});

const panel = ref<HTMLElement | null>(null);
let unregister: (() => void) | null = null;
watch(panel, (el) => {
  unregister?.();
  unregister = el ? keyboard.registerRegion('panel', 50, el) : null;
});
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <div class="screens">
    <Transition :name="`slide-${direction}`">
      <StartCanvas v-if="onStart" class="screen" />
      <div v-else class="screen main-canvas">
        <TheSidebar />
        <main
          ref="panel"
          class="panel"
          :aria-labelledby="app.screen === 'reports' ? 'reports-heading' : undefined"
        >
          <PanelHost />
        </main>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.screens {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--app-bg);
}

.screen {
  position: absolute;
  inset: 0;
}

.main-canvas {
  display: flex;
  padding-top: var(--space-5);
  background: var(--app-bg);
}

.panel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-top-left-radius: var(--radius);
  background: var(--panel-bg);
  box-shadow: 0 0 0.6rem color-mix(in srgb, var(--overlay-shadow) 35%, transparent);
}

.slide-forward-enter-active,
.slide-forward-leave-active,
.slide-back-enter-active,
.slide-back-leave-active {
  transition: transform 350ms ease;
}

.slide-forward-enter-from,
.slide-back-leave-to {
  transform: translateX(100%);
}

.slide-forward-leave-to,
.slide-back-enter-from {
  transform: translateX(-100%);
}
</style>
