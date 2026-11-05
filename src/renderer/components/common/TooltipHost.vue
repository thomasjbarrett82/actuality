<script setup lang="ts">
// The visible tooltip (17 §4): a small --tooltip-bg rectangle with a 1 px --tooltip-border border, `sm`
// text, multi-line. Screen readers get the text through aria-describedby instead, so this is aria-hidden.
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { nextTick, ref, watch } from 'vue';
import { hideTooltip, tooltipState } from './tooltip';

const el = ref<HTMLElement | null>(null);
let stop: (() => void) | null = null;

watch(
  () => [tooltipState.visible, tooltipState.anchor] as const,
  async ([visible, anchor]) => {
    stop?.();
    stop = null;
    if (!visible || !anchor) return;
    await nextTick();
    const tip = el.value;
    if (!tip) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    stop = autoUpdate(anchor, tip, () => {
      void computePosition(anchor, tip, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(rem * 0.4), flip(), shift({ padding: rem * 0.5 })],
      }).then(({ x, y }) => {
        tip.style.left = `${String(x)}px`;
        tip.style.top = `${String(y)}px`;
      });
    });
  },
);

function leave(): void {
  tooltipState.hovered = false;
  hideTooltip();
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events -- hovering the visible tooltip keeps it open (WCAG 1.4.13); keyboard users get the text through aria-describedby -->
  <div
    v-if="tooltipState.visible"
    ref="el"
    class="tooltip"
    aria-hidden="true"
    @mouseenter="tooltipState.hovered = true"
    @mouseleave="leave"
  >
    {{ tooltipState.text }}
  </div>
</template>

<style scoped>
.tooltip {
  position: fixed;
  max-width: 30rem;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--tooltip-border);
  background: var(--tooltip-bg);
  color: var(--text);
  font-size: var(--font-sm);
  white-space: pre-line;
  z-index: 300;
}
</style>
