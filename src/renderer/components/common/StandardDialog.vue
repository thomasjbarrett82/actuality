<script setup lang="ts">
// A standard dialog (17 §2): modal, inside the app window; gradient header with the title and ✕, content,
// and a footer button row. Esc cancels; Enter submits unless focus is in a multi-line text area. Focus is
// trapped and returns on close (22 §3).
import { X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { trapFocus } from '../../a11y/focus';
import { keyboard } from '../../keyboard/dispatcher';

const props = withDefaults(
  defineProps<{
    title: string;
    width?: 'sm' | 'md' | 'lg' | 'xl';
    /** A CSS length; default: sized by content. */ height?: string;
  }>(),
  { width: 'md' },
);
const emit = defineEmits<{ cancel: []; submit: [] }>();
const { t } = useI18n();
const id = useId();
const root = ref<HTMLElement | null>(null);
const widthVar = computed(() =>
  props.width === 'md' ? 'var(--dialog-w)' : `var(--dialog-w-${props.width})`,
);

let release: ((fallback?: () => HTMLElement | null) => void) | null = null;
let popScope: (() => void) | null = null;

onMounted(() => {
  if (!root.value) return;
  release = trapFocus(
    root.value,
    root.value.querySelector<HTMLElement>('[autofocus], input, select, textarea'),
  );
  popScope = keyboard.push(
    (e) => {
      if (e.key === 'Escape') {
        emit('cancel');
        return true;
      }
      if (
        e.key === 'Enter' &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLButtonElement) &&
        // A field that handles Enter itself (an inline rename, an auto-complete that commits on Enter).
        !(e.target instanceof Element && e.target.closest('[data-own-enter]'))
      ) {
        emit('submit');
        return true;
      }
      return false;
    },
    { modal: true },
  );
});

onBeforeUnmount(() => {
  popScope?.();
  release?.();
});
</script>

<template>
  <div class="std-backdrop">
    <div
      ref="root"
      class="std-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      :style="{ width: widthVar, height }"
    >
      <header class="std-dialog__header">
        <h2 :id="`${id}-title`" class="std-dialog__title">{{ title }}</h2>
        <button
          type="button"
          class="std-dialog__close"
          :aria-label="t('taskDialog.CloseLabel')"
          @click="emit('cancel')"
        >
          <X class="std-dialog__close-icon" aria-hidden="true" />
        </button>
      </header>
      <div class="std-dialog__content"><slot /></div>
      <footer class="std-dialog__footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.std-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--overlay-shadow) 45%, transparent);
  z-index: 90;
}

.std-dialog {
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 2 * var(--space-6));
  max-height: 90vh;
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  box-shadow: 0 0.6rem 2rem color-mix(in srgb, var(--overlay-shadow) 60%, transparent);
  color: var(--text);
}

.std-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--bar-h);
  padding: 0 var(--space-3) 0 var(--space-5);
  background: linear-gradient(var(--callout-bg-start), var(--callout-bg-end));
  border-bottom: 1px solid var(--register-border);
}

.std-dialog__title {
  margin: 0;
  font-size: var(--font-md);
  font-weight: 600;
}

.std-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.std-dialog__close-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.std-dialog__content {
  overflow: auto;
  padding: var(--space-6) var(--space-5);
}

.std-dialog__footer {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  align-items: center;
  min-height: var(--bar-h-lg);
  padding: var(--space-2) var(--space-5);
  border-top: 1px solid var(--register-border);
  background: var(--register-gray-bg);
}
</style>
