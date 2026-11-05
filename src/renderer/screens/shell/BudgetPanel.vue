<script setup lang="ts">
// The Budget screen's panel (09): the timeline on top and the grid below, with `--space-3` padding. It
// owns the screen's state, emits `ready` once the first month views have loaded (the loading
// illustration, 06 §2), keeps "today" current across midnight, and handles ←/→ and 0 for the months
// while no cell has focus (09 §7). The heading is visually hidden (22 §4.1).
import { today } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createBudgetScreen, provideBudget } from '../../budget/use-budget';
import { commands } from '../../commands';
import BudgetGrid from '../../components/budget/BudgetGrid.vue';
import BudgetTimeline from '../../components/budget/BudgetTimeline.vue';
import { exportData } from '../../export/export-flow';
import { isTextInput, keyboard } from '../../keyboard/dispatcher';
import { printBudget } from '../../print/print-flow';
import PanelHeading from './PanelHeading.vue';

const props = defineProps<{ shown: boolean }>();
const emit = defineEmits<{ ready: [] }>();
const { t } = useI18n();
const b = createBudgetScreen();
provideBudget(b);
const root = ref<HTMLElement | null>(null);

watch(
  () => b.loaded,
  (loaded) => {
    if (loaded) emit('ready');
  },
  { immediate: true },
);

function onKey(e: KeyboardEvent): boolean {
  if (!props.shown || e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target)) return false;
  const target = e.target as HTMLElement | null;
  const outsideCells =
    target === document.body ||
    target?.matches('[data-panel-heading], [data-budget-scroll]') === true;
  if (!outsideCells) return false;
  if (e.key === 'ArrowLeft') b.step(-1);
  else if (e.key === 'ArrowRight') b.step(1);
  else if (e.key === '0') b.select(b.current);
  else return false;
  return true;
}

let dayTimer: ReturnType<typeof setInterval> | null = null;
let popKeys: (() => void) | null = null;
const commandCleanups: (() => void)[] = [];
onMounted(() => {
  popKeys = keyboard.push(onKey);
  commandCleanups.push(
    commands.register('file.export', () => exportData({ screen: 'budget' })),
    commands.register('file.print', () => printBudget(b)),
  );
  // The current month moves at midnight: the colors and the range follow (09 §3).
  dayTimer = setInterval(() => {
    const month = today(new Date()).slice(0, 7) as Month;
    if (month !== b.current) {
      b.current = month;
      void b.refresh();
    }
  }, 60_000);
});
onBeforeUnmount(() => {
  popKeys?.();
  for (const c of commandCleanups) c();
  if (dayTimer) clearInterval(dayTimer);
});
</script>

<template>
  <section ref="root" class="budget">
    <PanelHeading :text="t('navigation.budget')" :ready="shown" hidden />
    <div class="budget__toolbar" role="region" :aria-label="t('a11y.regionToolbar')">
      <BudgetTimeline />
    </div>
    <BudgetGrid v-if="b.months.length > 0" />
  </section>
</template>

<style scoped>
.budget {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-3);
  box-sizing: border-box;
}
</style>
