<script setup lang="ts">
// Auto-complete field (11 §4): type to filter, ↑/↓ move, Enter/Tab accept, Esc closes. The rest of the
// best match is typed ahead and selected; the matched text is bold. Headings can't be selected; header and
// footer slots sit above and below the list. A combobox with a listbox popup (22 §4.4).
import { autoUpdate, computePosition, flip, offset, size } from '@floating-ui/dom';
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import {
  bestMatch,
  containsFilter,
  groups,
  highlight,
  itemsOf,
  type AutoCompleteEntry,
  type AutoCompleteFilter,
  type AutoCompleteItem,
} from './autocomplete-list';

/** `shiftEnter` accepts without moving focus on: the form moves up (11 §9). */
export type CommitReason = 'enter' | 'shiftEnter' | 'tab' | 'blur';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    entries: readonly AutoCompleteEntry[];
    label: string;
    filter?: AutoCompleteFilter;
    /** The drop-down's minimum width as a CSS length, e.g. '15.5rem' for payees (11 §4). */
    minWidth?: string;
    emptyText?: string;
    placeholder?: string;
    disabled?: boolean;
    /** With no type-ahead match, highlight the first visible item, so Enter takes it. */
    highlightFirst?: boolean;
  }>(),
  // A function-typed prop takes its default as the value itself, not as a factory.
  { filter: containsFilter, disabled: false, highlightFirst: false },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  commit: [value: string, item: AutoCompleteItem | null, reason: CommitReason];
}>();

const id = useId();
const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const open = ref(false);
const text = ref(props.modelValue);
const query = ref('');
const activeId = ref<string | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    text.value = v;
  },
);

const visible = computed(() => props.filter(props.entries, query.value));
const visibleGroups = computed(() => groups(visible.value));
const visibleItems = computed(() => itemsOf(visible.value));
const optionId = (itemId: string): string => `${id}-opt-${itemId}`;

function show(): void {
  if (open.value || props.disabled) return;
  open.value = true;
  void nextTick(place);
}

function close(): void {
  open.value = false;
  stop?.();
  stop = null;
}

function onInput(e: Event): void {
  const typed = (e.target as HTMLInputElement).value;
  const deleting = e instanceof InputEvent && e.inputType.startsWith('delete');
  query.value = typed;
  show();
  const match = deleting ? null : bestMatch(visibleItems.value, typed);
  // Only a type-ahead match is highlighted, so text that is a prefix of an item can still be entered.
  activeId.value =
    match?.id ??
    (props.highlightFirst && typed !== '' ? (visibleItems.value[0]?.id ?? null) : null);
  if (match && match.label.length > typed.length) {
    text.value = typed + match.label.slice(typed.length);
    void nextTick(() => input.value?.setSelectionRange(typed.length, text.value.length));
  } else {
    text.value = typed;
  }
}

function move(delta: number): void {
  show();
  const items = visibleItems.value;
  if (items.length === 0) return;
  const at = items.findIndex((i) => i.id === activeId.value);
  const next =
    items[
      at === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : Math.min(Math.max(at + delta, 0), items.length - 1)
    ];
  if (!next) return;
  activeId.value = next.id;
  text.value = next.label;
  void nextTick(() => {
    popup.value
      ?.querySelector(`#${CSS.escape(optionId(next.id))}`)
      ?.scrollIntoView({ block: 'nearest' });
    input.value?.select();
  });
}

function accept(reason: CommitReason, item?: AutoCompleteItem): void {
  // The clicked or highlighted item, else an item whose name matches the text in any case (11 §4.1).
  const highlighted = open.value
    ? visibleItems.value.find((i) => i.id === activeId.value)
    : undefined;
  const typed = text.value.trim().toLocaleLowerCase();
  const exact = itemsOf(props.entries).find((e) => e.label.toLocaleLowerCase() === typed);
  const resolved = item ?? highlighted ?? exact ?? null;
  const value = resolved ? resolved.label : text.value;
  text.value = value;
  query.value = '';
  close();
  if (value !== props.modelValue) emit('update:modelValue', value);
  emit('commit', value, resolved, reason);
}

function onKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (e.altKey) show();
      else move(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      move(-1);
      break;
    case 'Enter':
      // Shift+Enter accepts too (11 §9). With the list open, focus stays; with it closed, the form
      // sees the key and moves up.
      if (e.shiftKey) {
        if (open.value) {
          e.preventDefault();
          e.stopPropagation();
        }
        accept('shiftEnter');
        break;
      }
      e.preventDefault();
      // With the list open, Enter only accepts the item (11 §4.1); the editor doesn't see it.
      if (open.value) e.stopPropagation();
      accept('enter');
      break;
    case 'Tab':
      accept('tab');
      break;
    case 'Escape':
      if (open.value) {
        e.preventDefault();
        e.stopPropagation();
        text.value = query.value || props.modelValue;
        close();
      } else if (text.value !== props.modelValue) {
        // The first Esc reverts the field; a second one is left to the form (11 §1 step 4).
        e.preventDefault();
        e.stopPropagation();
        text.value = props.modelValue;
        query.value = '';
      }
      break;
  }
}

function onBlur(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && popup.value?.contains(next)) return;
  if (open.value || text.value !== props.modelValue) accept('blur');
}

function onOptionDown(e: MouseEvent, item: AutoCompleteItem): void {
  e.preventDefault(); // keep focus in the input
  accept('enter', item);
}

let stop: (() => void) | null = null;
function place(): void {
  const anchor = input.value;
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
            el.style.minWidth = `max(${String(rects.reference.width)}px, ${props.minWidth ?? '0px'})`;
            el.style.maxHeight = `${String(Math.max(availableHeight - 8, 120))}px`;
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

defineExpose({
  focus: () => input.value?.focus(),
  close,
  open: show,
  select: () => input.value?.select(),
  /** Shows the model value again, after a commit the form refused. */
  reset: () => {
    text.value = props.modelValue;
    query.value = '';
  },
  element: () => input.value,
});
</script>

<template>
  <input
    ref="input"
    :value="text"
    class="ac__input"
    type="text"
    role="combobox"
    autocomplete="off"
    aria-autocomplete="both"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="`${id}-list`"
    :aria-activedescendant="open && activeId ? optionId(activeId) : undefined"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="onInput"
    @keydown="onKeydown"
    @blur="onBlur"
    @click="show"
  />
  <Teleport to="body">
    <div v-show="open" ref="popup" class="ac__popup">
      <div v-if="$slots['header']" class="ac__header"><slot name="header" /></div>
      <div :id="`${id}-list`" class="ac__list" role="listbox" :aria-label="label">
        <template v-for="(g, gi) in visibleGroups" :key="g.heading?.id ?? `g${gi}`">
          <div v-if="g.heading" role="group" :aria-labelledby="`${id}-h-${g.heading.id}`">
            <div :id="`${id}-h-${g.heading.id}`" class="ac__heading" role="presentation">
              {{ g.heading.label }}
            </div>
            <div
              v-for="item in g.items"
              :id="optionId(item.id)"
              :key="item.id"
              class="ac__option is-indented"
              role="option"
              tabindex="-1"
              :aria-selected="item.id === activeId"
              @mousedown="onOptionDown($event, item)"
            >
              <component :is="item.icon" v-if="item.icon" class="ac__icon" aria-hidden="true" />
              <span
                >{{ highlight(item.text ?? item.label, query).before
                }}<strong>{{ highlight(item.text ?? item.label, query).match }}</strong
                >{{ highlight(item.text ?? item.label, query).after }}</span
              >
            </div>
          </div>
          <template v-else>
            <div
              v-for="item in g.items"
              :id="optionId(item.id)"
              :key="item.id"
              class="ac__option"
              role="option"
              tabindex="-1"
              :aria-selected="item.id === activeId"
              @mousedown="onOptionDown($event, item)"
            >
              <component :is="item.icon" v-if="item.icon" class="ac__icon" aria-hidden="true" />
              <span
                >{{ highlight(item.text ?? item.label, query).before
                }}<strong>{{ highlight(item.text ?? item.label, query).match }}</strong
                >{{ highlight(item.text ?? item.label, query).after }}</span
              >
            </div>
          </template>
        </template>
        <div v-if="emptyText && itemsOf(entries).length === 0" class="ac__empty">
          {{ emptyText }}
        </div>
      </div>
      <div v-if="$slots['footer']" class="ac__footer"><slot name="footer" /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.ac__input {
  width: 100%;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.ac__popup {
  position: fixed;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  z-index: 96;
}

.ac__header,
.ac__footer {
  padding: var(--space-2) var(--space-3);
  background: var(--register-gray-bg);
  font-size: var(--font-sm);
}

.ac__header {
  border-bottom: 1px solid var(--register-border);
  font-weight: 600;
}

.ac__footer {
  border-top: 1px solid var(--register-border);
}

.ac__list {
  flex: 1;
  overflow: auto;
}

.ac__heading {
  padding: var(--space-1) var(--space-3);
  color: var(--text-subtle);
  font-weight: 700;
}

.ac__option {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-3);
  cursor: default;
}

.ac__option.is-indented {
  padding-left: var(--space-6);
}

.ac__option[aria-selected='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
}

.ac__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.ac__empty {
  padding: var(--space-3);
  color: var(--text-subtle);
  font-style: italic;
  white-space: normal;
}
</style>
