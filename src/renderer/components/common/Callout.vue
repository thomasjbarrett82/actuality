<script setup lang="ts">
// A callout (17 §3): a non-modal panel with a tail, anchored to an element. The first tail position that
// fits the viewport wins, and the panel is capped to the room on that side, its body scrolling. Closes on an outside click, Esc, or its buttons; optionally on roll-out. Focus
// moves into it on open, Tab cycles inside, and Esc / Done / Cancel return focus to the anchor (22 §3).
import { autoUpdate, computePosition } from '@floating-ui/dom';
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { focusables, keyboard } from '../../keyboard/dispatcher';
import {
  calloutMiddleware,
  DEFAULT_TAILS,
  placementsFor,
  tailFor,
  type Tail,
} from './callout-placement';
import UiButton from './UiButton.vue';

export type CalloutResult = 'done' | 'cancel' | 'clickOutside' | 'rollOut' | (string & {});

const props = withDefaults(
  defineProps<{
    anchor: HTMLElement;
    title?: string;
    variant?: 'gradient' | 'opaque' | 'help';
    placements?: readonly Tail[];
    closeOnRollOut?: boolean;
    closeOnClickOutside?: boolean;
    closeOnEsc?: boolean;
    /** A width token name, e.g. 'popover-w-lg', or a CSS length ('27rem'). Default 'popover-w'. */
    width?: string;
    /** Shows Cancel and Done (primary) buttons. */
    buttons?: boolean;
    doneDisabled?: boolean;
    /** False for messages that leave focus on the anchor, such as the Invalid date callout (11 §3). */
    takeFocus?: boolean;
  }>(),
  {
    variant: 'gradient',
    placements: () => DEFAULT_TAILS,
    closeOnRollOut: false,
    closeOnClickOutside: true,
    closeOnEsc: true,
    width: 'popover-w',
    buttons: false,
    doneDisabled: false,
    takeFocus: true,
  },
);
const emit = defineEmits<{ close: [result: CalloutResult] }>();
const { t } = useI18n();
const id = useId();
const panel = ref<HTMLElement | null>(null);
const tail = ref<HTMLElement | null>(null);
const tailSide = ref<Tail>('top');

function close(result: CalloutResult, returnFocus: boolean): void {
  if (returnFocus) props.anchor.focus();
  emit('close', result);
}

let stopUpdate: (() => void) | null = null;
let popScope: (() => void) | null = null;
let rollTimer: ReturnType<typeof setTimeout> | null = null;

async function position(): Promise<void> {
  const el = panel.value;
  const tip = tail.value;
  if (!el || !tip) return;
  const { placement, fallbacks } = placementsFor(props.placements);
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
  const result = await computePosition(props.anchor, el, {
    placement,
    strategy: 'fixed',
    middleware: calloutMiddleware(fallbacks, rem, tip, (maxWidth, maxHeight) => {
      el.style.maxWidth = `${String(Math.max(0, maxWidth))}px`;
      el.style.maxHeight = `${String(Math.max(0, maxHeight))}px`;
    }),
  });
  el.style.left = `${String(result.x)}px`;
  el.style.top = `${String(result.y)}px`;
  tailSide.value = tailFor(result.placement);
  const a = result.middlewareData.arrow;
  tip.style.left = a?.x === undefined ? '' : `${String(a.x)}px`;
  tip.style.top = a?.y === undefined ? '' : `${String(a.y)}px`;
}

function onDocumentPointer(e: PointerEvent): void {
  const target = e.target as Node | null;
  if (!target || panel.value?.contains(target) || props.anchor.contains(target)) return;
  if (props.closeOnClickOutside) close('clickOutside', false);
}

function onTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !panel.value) return;
  const items = focusables(panel.value);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function rollOut(): void {
  if (!props.closeOnRollOut) return;
  if (panel.value?.contains(document.activeElement)) return; // never close while focus is inside (22 §6)
  rollTimer = setTimeout(() => {
    close('rollOut', false);
  }, 350);
}

function rollIn(): void {
  if (rollTimer) clearTimeout(rollTimer);
  rollTimer = null;
}

onMounted(() => {
  const el = panel.value;
  if (!el) return;
  stopUpdate = autoUpdate(props.anchor, el, () => void position());
  document.addEventListener('pointerdown', onDocumentPointer, true);
  props.anchor.addEventListener('mouseleave', rollOut);
  props.anchor.addEventListener('mouseenter', rollIn);
  popScope = keyboard.push((e) => {
    if (e.key === 'Escape' && props.closeOnEsc) {
      close('cancel', true);
      return true;
    }
    return false;
  });
  if (!props.takeFocus) return;
  const first = focusables(el)[0];
  if (first) first.focus();
  else el.focus();
});

onBeforeUnmount(() => {
  stopUpdate?.();
  popScope?.();
  rollIn();
  document.removeEventListener('pointerdown', onDocumentPointer, true);
  props.anchor.removeEventListener('mouseleave', rollOut);
  props.anchor.removeEventListener('mouseenter', rollIn);
});

defineExpose({ close });
</script>

<template>
  <Teleport to="body">
    <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- roll-out closing is pointer-only; focus inside keeps it open and Esc closes it (22 §6) -->
    <div
      ref="panel"
      class="callout"
      :class="[`callout--${variant}`, `tail-${tailSide}`]"
      role="dialog"
      :aria-labelledby="title ? `${id}-title` : undefined"
      :aria-label="
        title
          ? undefined
          : (anchor.getAttribute('aria-label') ?? anchor.textContent?.trim() ?? undefined)
      "
      tabindex="-1"
      :style="{ width: /^\d/.test(width) ? width : `var(--${width})` }"
      @keydown="onTab"
      @mouseleave="rollOut"
      @mouseenter="rollIn"
    >
      <span ref="tail" class="callout__tail" aria-hidden="true" />
      <h2 v-if="title" :id="`${id}-title`" class="callout__title">{{ title }}</h2>
      <div class="callout__body"><slot /></div>
      <div v-if="buttons || $slots['buttons']" class="callout__buttons">
        <slot name="buttons">
          <UiButton @click="close('cancel', true)">{{ t('taskDialog.CancelLabel') }}</UiButton>
          <UiButton primary :disabled="doneDisabled" @click="close('done', true)">{{
            t('taskDialog.DoneLabel')
          }}</UiButton>
        </slot>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.callout {
  position: fixed;
  display: flex;
  flex-direction: column;
  overflow: visible;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--tooltip-border);
  border-radius: var(--radius);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  color: var(--text-subtle);
  z-index: 95;
}

.callout--gradient {
  background: linear-gradient(var(--callout-bg-start), var(--callout-bg-end));
}

.callout--opaque {
  background: var(--panel-bg);
}

.callout--help {
  border-color: var(--callout-help-border);
  background: var(--callout-help-bg);
  color: var(--text);
}

.callout__tail {
  position: absolute;
  width: 1.4rem;
  height: 1.4rem;
  border: 1px solid var(--tooltip-border);
  background: var(--callout-bg-start);
  transform: rotate(45deg);
}

.callout--opaque .callout__tail {
  background: var(--panel-bg);
}

.callout--help .callout__tail {
  border-color: var(--callout-help-border);
  background: var(--callout-help-bg);
}

.tail-top .callout__tail,
.tail-topLeft .callout__tail,
.tail-topRight .callout__tail {
  top: -0.7rem;
  border-right: 0;
  border-bottom: 0;
}

.tail-bottom .callout__tail,
.tail-bottomLeft .callout__tail,
.tail-bottomRight .callout__tail {
  bottom: -0.7rem;
  border-top: 0;
  border-left: 0;
}

.tail-left .callout__tail,
.tail-leftTop .callout__tail,
.tail-leftBottom .callout__tail {
  left: -0.7rem;
  border-top: 0;
  border-right: 0;
}

.tail-right .callout__tail,
.tail-rightTop .callout__tail,
.tail-rightBottom .callout__tail {
  right: -0.7rem;
  border-bottom: 0;
  border-left: 0;
}

.callout__title {
  flex: none;
  margin: 0 0 var(--space-3);
  font-size: var(--font-xl);
  font-weight: 400;
}

/* A flex column, so content with its own scrolling list (min-height: 0) shrinks to the room left. */
.callout__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.callout__buttons {
  flex: none;
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-4);
}
</style>
