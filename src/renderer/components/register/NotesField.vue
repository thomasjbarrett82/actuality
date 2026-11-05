<script setup lang="ts">
// The editor's Notes input (11 §2, §5): plain text where a `#` starts a tag. While the caret is in a tag being
// typed, the managed tags that start with it are offered (case-sensitive); ↑/↓ move, Enter or Tab accept, Esc
// closes the list. Any other tag can still be typed. Other keys go to the editor.
import { autoUpdate, computePosition, flip, offset } from '@floating-ui/dom';
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useTags } from '../../queries/budget-data';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; label: string; placeholder?: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  keydown: [e: KeyboardEvent];
  focus: [e: FocusEvent];
}>();

const id = useId();
const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const tags = useTags();
const caret = ref(0);
const dismissed = ref(false);
const active = ref(0);

/** The tag being typed at the caret: its start in the text and what follows the `#` so far. */
const typing = computed(() => {
  const m = /(?<!#)#([^#\s]*)$/.exec(props.modelValue.slice(0, caret.value));
  return m ? { start: m.index, query: m[1] ?? '' } : null;
});
const matches = computed(() => {
  const q = typing.value?.query;
  if (q === undefined) return [];
  return (tags.data.value ?? [])
    .map((t) => t.tag)
    .filter((name) => name.startsWith(q) && name !== q)
    .slice(0, 8);
});
const open = computed(() => !dismissed.value && matches.value.length > 0);
const optionId = (i: number): string => `${id}-opt-${String(i)}`;

watch([() => typing.value?.query, () => props.modelValue], () => {
  dismissed.value = false;
  active.value = 0;
});

function track(): void {
  caret.value = input.value?.selectionStart ?? props.modelValue.length;
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  caret.value = el.selectionStart ?? el.value.length;
  emit('update:modelValue', el.value);
}

function accept(name: string): void {
  const t = typing.value;
  if (!t) return;
  const value = `${props.modelValue.slice(0, t.start)}#${name}${props.modelValue.slice(caret.value)}`;
  const at = t.start + name.length + 1;
  emit('update:modelValue', value);
  caret.value = at;
  void nextTick(() => input.value?.setSelectionRange(at, at));
}

function onKeydown(e: KeyboardEvent): void {
  if (open.value) {
    const last = matches.value.length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active.value =
        e.key === 'ArrowDown' ? Math.min(active.value + 1, last) : Math.max(active.value - 1, 0);
      return;
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const name = matches.value[active.value];
      if (name !== undefined) accept(name);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissed.value = true;
      return;
    }
  }
  emit('keydown', e);
}

let stop: (() => void) | null = null;
watch(open, (isOpen) => {
  stop?.();
  stop = null;
  if (!isOpen) return;
  void nextTick(() => {
    const anchor = input.value;
    const el = popup.value;
    if (!anchor || !el) return;
    stop = autoUpdate(anchor, el, () => {
      void computePosition(anchor, el, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(1), flip()],
      }).then(({ x, y }) => {
        el.style.left = `${String(x)}px`;
        el.style.top = `${String(y)}px`;
      });
    });
  });
});
onBeforeUnmount(() => stop?.());

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <input
    v-bind="$attrs"
    ref="input"
    :value="modelValue"
    type="text"
    role="combobox"
    autocomplete="off"
    aria-autocomplete="list"
    :aria-label="label"
    :placeholder="placeholder"
    :aria-expanded="open"
    :aria-controls="`${id}-list`"
    :aria-activedescendant="open ? optionId(active) : undefined"
    @input="onInput"
    @keydown="onKeydown"
    @keyup="track"
    @click="track"
    @focus="emit('focus', $event)"
    @blur="dismissed = true"
  />
  <Teleport to="body">
    <div v-if="open" ref="popup" class="notes-tags">
      <div :id="`${id}-list`" role="listbox" :aria-label="label">
        <div
          v-for="(name, i) in matches"
          :id="optionId(i)"
          :key="name"
          class="notes-tags__option"
          role="option"
          :aria-selected="i === active"
          tabindex="-1"
          @mousedown.prevent="accept(name)"
        >
          {{ `#${name}` }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.notes-tags {
  position: fixed;
  min-width: 10rem;
  max-height: 12rem;
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  overflow: auto;
  z-index: 96;
}

.notes-tags__option {
  display: flex;
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-3);
  cursor: default;
}

.notes-tags__option[aria-selected='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
}
</style>
