<script setup lang="ts">
// Drop-down button: a button with ▾ at the right (05 §4); a menu button (22 §4.4): aria-haspopup and
// aria-expanded, opened by click, Enter, Space or ↓.
import { ChevronDown } from 'lucide-vue-next';

withDefaults(
  defineProps<{ expanded?: boolean; disabled?: boolean; popup?: 'menu' | 'dialog' | 'listbox' }>(),
  {
    expanded: false,
    disabled: false,
    popup: 'menu',
  },
);
/** `open` carries the button, for a callout to anchor to. */
const emit = defineEmits<{ open: [anchor: HTMLElement] }>();

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    emit('open', e.currentTarget as HTMLElement);
  }
}

function onClick(e: MouseEvent): void {
  emit('open', e.currentTarget as HTMLElement);
}
</script>

<template>
  <button
    type="button"
    class="ui-menu-button"
    :aria-haspopup="popup"
    :aria-expanded="expanded"
    :disabled="disabled"
    @click="onClick"
    @keydown="onKey"
  >
    <slot />
    <ChevronDown class="ui-menu-button__arrow" aria-hidden="true" />
  </button>
</template>

<style scoped>
.ui-menu-button {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: max(var(--control-h), var(--hit-min));
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  color: var(--text);
  font-size: var(--font-md);
  font-weight: 600;
  cursor: pointer;
}

.ui-menu-button:disabled {
  color: var(--text-disabled);
  cursor: default;
}

.ui-menu-button__arrow {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
