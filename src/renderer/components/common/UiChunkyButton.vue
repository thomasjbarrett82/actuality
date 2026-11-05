<script setup lang="ts">
// Chunky button: --control-h-lg, two lines with a --icon-lg icon (Reconcile Account, Scheduled
// Transactions) (05 §4). An optional count badge shows beside the label.
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    icon: Component;
    disabled?: boolean;
    pressed?: boolean | undefined;
    count?: number;
  }>(),
  {
    disabled: false,
    pressed: undefined,
    count: 0,
  },
);
</script>

<template>
  <button type="button" class="ui-chunky" :disabled="disabled" :aria-pressed="pressed">
    <component :is="icon" class="ui-chunky__icon" aria-hidden="true" />
    <span class="ui-chunky__label"><slot /></span>
    <span v-if="count > 0" class="ui-chunky__count">{{ count }}</span>
  </button>
</template>

<style scoped>
.ui-chunky {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--control-h-lg);
  padding: 0 var(--space-4);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  color: var(--text-strong);
  font-size: var(--font-md);
  font-weight: 600;
  line-height: 1.1;
  text-align: left;
  white-space: pre-line;
  cursor: pointer;
}

.ui-chunky:disabled {
  color: var(--text-disabled);
  cursor: default;
}

.ui-chunky__icon {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.ui-chunky__count {
  min-width: var(--badge-h);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--review-badge);
  color: var(--badge-text);
  font-size: var(--font-sm);
  text-align: center;
}
</style>
