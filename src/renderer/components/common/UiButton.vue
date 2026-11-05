<script setup lang="ts">
// Standard and primary (green) buttons (05 §4). The primary button carries a check icon. `unavailable`
// looks disabled but stays focusable, so a tooltip saying why can be read (22 §4.6); the caller ignores clicks.
// `tone` colors a commit button green and Cancel red (blue / orange in the CVD palettes, 05 §1.8).
import { Check } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    primary?: boolean;
    type?: 'button' | 'submit';
    disabled?: boolean;
    unavailable?: boolean;
    tone?: 'save' | 'cancel' | undefined;
    id?: string;
  }>(),
  {
    primary: false,
    type: 'button',
    disabled: false,
    unavailable: false,
  },
);
const emit = defineEmits<{ click: [e: MouseEvent] }>();
</script>

<template>
  <button
    :id="id"
    :type="type"
    class="ui-button"
    :class="[{ 'ui-button--primary': primary }, tone && `ui-button--${tone}`]"
    :disabled="disabled"
    :aria-disabled="unavailable ? 'true' : undefined"
    @click="emit('click', $event)"
  >
    <Check v-if="primary" class="ui-button__icon" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: center;
  min-height: max(var(--control-h), var(--hit-min));
  padding: 0 var(--space-5);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  color: var(--text);
  font-size: var(--font-md);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.ui-button:disabled,
.ui-button[aria-disabled='true'] {
  color: var(--text-disabled);
  cursor: default;
}

.ui-button:hover:not(:disabled, [aria-disabled='true']) {
  border-color: var(--summary-divider);
}

.ui-button--primary {
  border-color: var(--button-primary-end);
  background: linear-gradient(var(--button-primary-start), var(--button-primary-end));
  color: var(--text-on-blue);
}

.ui-button--save {
  border-color: var(--button-save-bg);
  background: var(--button-save-bg);
  color: var(--button-tone-text);
}

.ui-button--cancel {
  border-color: var(--button-cancel-bg);
  background: var(--button-cancel-bg);
  color: var(--button-tone-text);
}

.ui-button--save:disabled,
.ui-button--save[aria-disabled='true'],
.ui-button--cancel:disabled,
.ui-button--cancel[aria-disabled='true'] {
  border-color: var(--register-border);
  background: var(--button-bg);
}

.ui-button__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
