<script setup lang="ts">
// Link button: underlined --link text, optional icon (05 §4). With `href` it is a link (http/https open in
// the OS browser, 02 §6); without, a button (22 §4.4).
import type { Component } from 'vue';

const props = withDefaults(
  defineProps<{ href?: string; icon?: Component; danger?: boolean; disabled?: boolean }>(),
  { danger: false, disabled: false },
);
const emit = defineEmits<{ click: [e: MouseEvent] }>();

function onClick(e: MouseEvent): void {
  if (props.href) {
    e.preventDefault();
    void window.app.shell.openExternal(props.href);
  }
  emit('click', e);
}
</script>

<template>
  <a
    v-if="href"
    :href="href"
    class="ui-link"
    :class="{ 'ui-link--danger': danger }"
    @click="onClick"
  >
    <component :is="icon" v-if="icon" class="ui-link__icon" aria-hidden="true" />
    <slot />
  </a>
  <button
    v-else
    type="button"
    class="ui-link"
    :class="{ 'ui-link--danger': danger }"
    :disabled="disabled"
    @click="onClick"
  >
    <component :is="icon" v-if="icon" class="ui-link__icon" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.ui-link {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--link);
  font-size: var(--font-sm);
  text-decoration: underline;
  cursor: pointer;
}

.ui-link:disabled {
  color: var(--text-disabled);
  cursor: default;
}

.ui-link--danger {
  color: var(--link-danger);
}

.ui-link__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
