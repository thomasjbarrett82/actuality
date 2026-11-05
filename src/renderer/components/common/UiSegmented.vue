<script setup lang="ts" generic="T extends string">
// Segmented control: a --radius-pill toggle (05 §4); a radio group (22 §4.4): one Tab stop, ←/→ move and
// select, roving tabindex.
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    options: { value: T; label: string }[];
    label: string;
    disabled?: boolean;
    disabledTooltip?: string;
  }>(),
  { disabled: false },
);
const model = defineModel<T>({ required: true });
const items = ref<HTMLElement[]>([]);

function move(e: KeyboardEvent, index: number): void {
  const delta =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0;
  if (delta === 0 || props.disabled) return;
  e.preventDefault();
  const next = (index + delta + props.options.length) % props.options.length;
  const option = props.options[next];
  if (option) model.value = option.value;
  items.value[next]?.focus();
}
</script>

<template>
  <div
    role="radiogroup"
    class="ui-segmented"
    :aria-label="label"
    :aria-disabled="disabled || undefined"
    :title="disabled ? disabledTooltip : undefined"
  >
    <button
      v-for="(option, i) in options"
      :key="option.value"
      ref="items"
      type="button"
      role="radio"
      class="ui-segmented__item"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :disabled="disabled"
      @click="model = option.value"
      @keydown="move($event, i)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.ui-segmented {
  display: inline-flex;
  border: 1px solid var(--register-border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  overflow: hidden;
}

.ui-segmented__item {
  min-height: max(var(--control-h), var(--hit-min));
  padding: 0 var(--space-5);
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--font-md);
  cursor: pointer;
}

.ui-segmented__item[aria-checked='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
  font-weight: 600;
}

.ui-segmented__item:disabled {
  color: var(--text-disabled);
  cursor: default;
}
</style>
