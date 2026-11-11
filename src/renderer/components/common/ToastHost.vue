<script setup lang="ts">
// The toast stack (24 §5), mounted once in App.vue outside the screens, so toasts stay put when the
// canvases slide. Bottom right, above the screens and below modal dialogs; inert while a modal is open.
// It is the "Messages" region while it holds a toast: the last F6 region (22 §2.1). Toasts never take
// focus. Esc inside one closes it, and focus returns to where F6 came from; so does closing the last one
// from the keyboard.
import { X } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { focusables, keyboard } from '../../keyboard/dispatcher';
import { useToasts } from '../../stores/toasts';
import UiButton from './UiButton.vue';

/** After every other region (sidebar 10, toolbar 40, panel 50, footer 60): the last on every screen. */
const REGION_ORDER = 100;

const { t } = useI18n();
const toasts = useToasts();
const root = ref<HTMLElement | null>(null);
const inert = computed(() => keyboard.modalOpen);
/** Where focus was before it entered the stack. */
let returnTo: HTMLElement | null = null;
let unregister: (() => void) | null = null;

watch(
  root,
  (el) => {
    unregister?.();
    unregister = el ? keyboard.registerRegion('messages', REGION_ORDER, el) : null;
  },
  { flush: 'post' },
);
onBeforeUnmount(() => {
  unregister?.();
});

function onFocusIn(e: FocusEvent): void {
  const from = e.relatedTarget;
  if (from instanceof HTMLElement && !root.value?.contains(from)) returnTo = from;
}

function restoreFocus(): void {
  const target = returnTo;
  returnTo = null;
  if (target?.isConnected) target.focus();
  else keyboard.cycleRegion(1);
}

/** Newest first, so the oldest sits at the bottom of the stack and the DOM order matches what is seen. */
const shown = computed(() => [...toasts.list].reverse());

/** Closes a toast; if focus was inside the stack, it goes to the next toast, or back where it came from. */
async function close(id: string, viaEsc: boolean): Promise<void> {
  const hadFocus = root.value?.contains(document.activeElement) === true;
  await toasts.close(id);
  if (!hadFocus) return;
  await nextTick();
  const first = root.value?.querySelector<HTMLElement>('[data-toast]');
  const next = first ? focusables(first)[0] : undefined;
  if (viaEsc || !next) restoreFocus();
  else next.focus();
}

function onKeydown(e: KeyboardEvent, id: string): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  void close(id, true);
}

async function runAction(id: string): Promise<void> {
  await toasts.list.find((x) => x.id === id)?.action?.run();
}
</script>

<template>
  <section
    v-if="toasts.list.length > 0"
    ref="root"
    class="toasts"
    :aria-label="t('a11y.messagesRegion')"
    :inert="inert"
    data-own-keys
    @focusin="onFocusIn"
  >
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- Esc closes the toast the focus is in (24 §5) -->
    <div
      v-for="toast in shown"
      :key="toast.id"
      class="toast"
      data-toast
      role="group"
      :aria-labelledby="`toast-${toast.id}-title`"
      @keydown="onKeydown($event, toast.id)"
    >
      <div class="toast__text">
        <p :id="`toast-${toast.id}-title`" class="toast__title">{{ toast.title }}</p>
        <p class="toast__message">{{ toast.message }}</p>
        <div v-if="toast.action" class="toast__actions">
          <UiButton @click="runAction(toast.id)">{{ toast.action.label }}</UiButton>
        </div>
      </div>
      <button
        type="button"
        class="toast__close"
        :aria-label="t('taskDialog.CloseLabel')"
        @click="close(toast.id, false)"
      >
        <X class="toast__close-icon" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<style scoped>
/* Above the screens, below callouts (95) and modal dialogs (90 and up). */
.toasts {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(22rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100vh - 2 * var(--space-4));
  overflow-y: auto;
  z-index: 80;
}

.toast {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  padding: var(--space-4) var(--space-3) var(--space-4) var(--space-5);
  border: 1px solid var(--tooltip-border);
  border-radius: var(--radius);
  background: linear-gradient(var(--callout-bg-start), var(--callout-bg-end));
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  color: var(--text);
}

.toast__text {
  display: grid;
  flex: 1;
  gap: var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.toast__title,
.toast__message {
  margin: 0;
}

.toast__title {
  font-size: var(--font-md);
  font-weight: 700;
}

.toast__actions {
  display: flex;
  margin-top: var(--space-1);
}

.toast__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.toast__close-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
