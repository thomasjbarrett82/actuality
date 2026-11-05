<script setup lang="ts">
// Month chooser (05 §6): a month/year drop-down, limited to `from`…`to` (10 §2). A select-only
// combobox with a listbox (22 §4.4): Enter/Space/Alt+↓ open, ↑/↓/Home/End move, Enter picks, Esc closes.
import { autoUpdate, computePosition, flip, offset, size } from '@floating-ui/dom';
import { monthRange } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { monthHeader } from '@shared/format';
import { ChevronDown } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { dateLocale } from '../../i18n';

const props = withDefaults(
  defineProps<{ modelValue: Month; from: Month; to: Month; label: string; disabled?: boolean }>(),
  {
    disabled: false,
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: Month] }>();

const id = useId();
const box = ref<HTMLElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const open = ref(false);
const active = ref<Month>(props.modelValue);
const months = computed(() => monthRange(props.from, props.to));
const optionId = (m: Month): string => `${id}-${m}`;

function show(): void {
  if (props.disabled) return;
  active.value = props.modelValue;
  open.value = true;
  void nextTick(() => {
    place();
    scrollToActive();
  });
}

function close(): void {
  open.value = false;
  stop?.();
  stop = null;
}

function pick(m: Month): void {
  close();
  if (m !== props.modelValue) emit('update:modelValue', m);
  box.value?.focus();
}

function scrollToActive(): void {
  popup.value
    ?.querySelector(`#${CSS.escape(optionId(active.value))}`)
    ?.scrollIntoView({ block: 'nearest' });
}

function move(to: number): void {
  const list = months.value;
  const at = list.indexOf(active.value);
  const next =
    list[
      Math.min(
        Math.max(to === Infinity ? list.length - 1 : to === -Infinity ? 0 : at + to, 0),
        list.length - 1,
      )
    ];
  if (!next) return;
  active.value = next;
  if (!open.value) emit('update:modelValue', next);
  void nextTick(scrollToActive);
}

function onKeydown(e: KeyboardEvent): void {
  const keys: Record<string, () => void> = {
    ArrowDown: () => {
      if (e.altKey && !open.value) show();
      else move(1);
    },
    ArrowUp: () => {
      if (e.altKey && open.value) pick(active.value);
      else move(-1);
    },
    Home: () => {
      move(-Infinity);
    },
    End: () => {
      move(Infinity);
    },
    Enter: () => {
      if (open.value) pick(active.value);
      else show();
    },
    ' ': () => {
      if (open.value) pick(active.value);
      else show();
    },
  };
  const action = keys[e.key];
  if (action) {
    e.preventDefault();
    action();
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if (e.key === 'Tab' && open.value) {
    pick(active.value);
  }
}

function onBlur(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && popup.value?.contains(next)) return;
  close();
}

let stop: (() => void) | null = null;
function place(): void {
  const anchor = box.value;
  const el = popup.value;
  if (!anchor || !el) return;
  stop = autoUpdate(anchor, el, () => {
    void computePosition(anchor, el, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [
        offset(1),
        flip(),
        size({
          apply({ rects, availableHeight }) {
            el.style.minWidth = `${String(rects.reference.width)}px`;
            el.style.maxHeight = `${String(Math.min(Math.max(availableHeight - 8, 120), 320))}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      el.style.left = `${String(x)}px`;
      el.style.top = `${String(y)}px`;
    });
  });
}

onBeforeUnmount(() => stop?.());
</script>

<template>
  <div
    ref="box"
    class="month-picker"
    role="combobox"
    tabindex="0"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="`${id}-list`"
    aria-haspopup="listbox"
    :aria-activedescendant="open ? optionId(active) : undefined"
    :aria-disabled="disabled || undefined"
    @click="open ? close() : show()"
    @keydown="onKeydown"
    @blur="onBlur"
  >
    <span class="month-picker__value">{{ monthHeader(modelValue, dateLocale) }}</span>
    <ChevronDown class="month-picker__arrow" aria-hidden="true" />
  </div>
  <Teleport to="body">
    <div
      v-show="open"
      :id="`${id}-list`"
      ref="popup"
      class="month-picker__list"
      role="listbox"
      :aria-label="label"
    >
      <div
        v-for="m in months"
        :id="optionId(m)"
        :key="m"
        class="month-picker__option"
        role="option"
        tabindex="-1"
        :aria-selected="m === active"
        @mousedown.prevent="pick(m)"
      >
        {{ monthHeader(m, dateLocale) }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.month-picker {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  min-width: 11rem;
  min-height: max(var(--control-h), var(--hit-min));
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  cursor: pointer;
}

.month-picker[aria-disabled='true'] {
  color: var(--text-disabled);
  cursor: default;
}

.month-picker__arrow {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.month-picker__list {
  position: fixed;
  overflow: auto;
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  z-index: 96;
}

.month-picker__option {
  display: flex;
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-3);
}

.month-picker__option[aria-selected='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
}
</style>
