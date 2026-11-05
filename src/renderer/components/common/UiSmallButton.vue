<script setup lang="ts">
// Small etched text button: Rename, Save, Done/Cancel in editors (05 §4). `tone` colors the editor's
// commit buttons green and Cancel red (blue / orange in the CVD palettes, 05 §1.8).
withDefaults(defineProps<{ disabled?: boolean; tone?: 'save' | 'cancel' | undefined }>(), {
  disabled: false,
});
const emit = defineEmits<{ click: [e: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="ui-small-button"
    :class="tone && `ui-small-button--${tone}`"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-small-button {
  min-height: max(var(--control-h-sm), var(--hit-min));
  padding: 0 var(--space-4);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text-strong);
  font-size: var(--font-body);
  font-weight: 600;
  cursor: pointer;
}

.ui-small-button--save {
  border-color: var(--button-save-bg);
  background: var(--button-save-bg);
  color: var(--button-tone-text);
}

.ui-small-button--cancel {
  border-color: var(--button-cancel-bg);
  background: var(--button-cancel-bg);
  color: var(--button-tone-text);
}

.ui-small-button:disabled {
  border-color: var(--register-border);
  background: var(--button-bg);
  color: var(--text-disabled);
  cursor: default;
}
</style>
