<script setup lang="ts">
// Date entry (11 §3): the budget's short date format, loose parsing, Quicken-style keys and a calendar
// drop-down that opens when the user enters the field. Invalid input reverts, keeps focus and shows the
// "Invalid date" callout (announced, 22 §4.5).
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  addDays,
  dateOrder,
  daysBetween,
  firstDayOfMonth,
  firstDayOfYear,
  lastDayOfMonth,
  lastDayOfYear,
  parseLoose,
} from '@shared/dates';
import type { ISODate } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { CalendarDays } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { focusables, keyboard } from '../../keyboard/dispatcher';
import CalendarGrid from './CalendarGrid.vue';
import Callout from './Callout.vue';
import RichText from './RichText.vue';

const MAX_RANGE_DAYS = 3650;
const INPUT_PREVIEW = 12;
const MODAL = '[aria-modal="true"]';

const props = withDefaults(
  defineProps<{
    modelValue: ISODate | null;
    label: string;
    dateFormat: string;
    today: ISODate;
    /** The scheduler refuses dates before today and shows its callout above the field (11 §3). */
    scheduler?: boolean;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { scheduler: false, disabled: false, placeholder: '' },
);
const emit = defineEmits<{
  'update:modelValue': [value: ISODate | null];
  commit: [value: ISODate];
  /** While typing: the date the text would commit to, or null when it isn't a valid date. */
  typed: [value: ISODate | null];
}>();
const { t } = useI18n();

const input = ref<HTMLInputElement | null>(null);
const wrapper = ref<HTMLElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const text = ref(props.modelValue ? dateShort(props.modelValue, props.dateFormat) : '');
const open = ref(false);
const error = ref<string | null>(null);

/** The format's own separator: `-` and `.` keep their Quicken meaning only when they aren't it. */
const separator = computed(() => /[^dMy]/.exec(props.dateFormat)?.[0] ?? '/');
const order = computed(() => dateOrder(props.dateFormat));
const shown = (d: ISODate | null): string => (d ? dateShort(d, props.dateFormat) : '');

watch(
  () => props.modelValue,
  (d) => {
    text.value = shown(d);
  },
);

function validate(raw: string): { date: ISODate } | { error: string } {
  const parsed = parseLoose(raw, order.value, props.today, separator.value);
  const preview = raw.trim().slice(0, INPUT_PREVIEW);
  if (!parsed)
    return {
      error: t('register.dateFormatInvalid', {
        text: preview,
        format: props.dateFormat.toUpperCase(),
      }),
    };
  if (Math.abs(daysBetween(props.today, parsed)) > MAX_RANGE_DAYS)
    return { error: t('register.dateOutsideAllowedRange', { text: preview }) };
  if (props.scheduler && daysBetween(props.today, parsed) < 0)
    return { error: t('register.scheduledDateBeforeToday', { text: preview }) };
  return { date: parsed };
}

function onInput(): void {
  error.value = null;
  const result = text.value.trim() === '' ? null : validate(text.value);
  emit('typed', result && 'date' in result ? result.date : null);
}

function set(date: ISODate): void {
  text.value = shown(date);
  if (date !== props.modelValue) emit('update:modelValue', date);
  emit('commit', date);
}

/** Drops the typed text for the committed date. */
function revert(): void {
  text.value = shown(props.modelValue);
  emit('typed', props.modelValue);
}

/** Commits the typed text. Returns false (and shows the callout) when it's invalid. */
function commit(): boolean {
  const raw = text.value;
  if (raw.trim() === '' || raw === shown(props.modelValue)) {
    text.value = shown(props.modelValue);
    return true;
  }
  const result = validate(raw);
  if ('error' in result) {
    error.value = result.error;
    announce(
      result.error
        .replace(/<[^>]+>|\*\*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      'assertive',
    );
    text.value = shown(props.modelValue);
    closeCalendar(false);
    void nextTick(() => input.value?.select());
    return false;
  }
  set(result.date);
  return true;
}

function base(): ISODate {
  const typed = parseLoose(text.value, order.value, props.today, separator.value);
  return typed ?? props.modelValue ?? props.today;
}

function step(next: ISODate, openCalendar: boolean): void {
  set(next);
  if (openCalendar) openCalendarPopup();
  void nextTick(() => input.value?.select());
}

function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const sep = separator.value;
  const actions: Record<string, () => void> = {
    ArrowDown: () => {
      step(addDays(base(), -1), true);
    },
    ArrowUp: () => {
      step(addDays(base(), 1), true);
    },
    '+': () => {
      step(addDays(base(), 1), true);
    },
    '=': () => {
      step(addDays(base(), 1), true);
    },
    t: () => {
      step(props.today, false);
    },
    T: () => {
      step(props.today, false);
    },
    m: () => {
      step(firstDayOfMonth(base()), true);
    },
    M: () => {
      step(lastDayOfMonth(base()), true);
    },
    h: () => {
      step(lastDayOfMonth(base()), true);
    },
    H: () => {
      step(lastDayOfMonth(base()), true);
    },
    y: () => {
      step(firstDayOfYear(base()), true);
    },
    Y: () => {
      step(lastDayOfYear(base()), true);
    },
    r: () => {
      step(lastDayOfYear(base()), true);
    },
    R: () => {
      step(lastDayOfYear(base()), true);
    },
  };
  if (sep !== '-') {
    actions['-'] = () => {
      step(addDays(base(), -1), true);
    };
  }
  if (sep !== '.') {
    actions['.'] = () => {
      step(props.today, false);
    };
  }
  const action = actions[k];
  if (action) {
    e.preventDefault();
    error.value = null;
    action();
    return;
  }
  if (k === 'Enter') {
    if (!commit()) e.preventDefault();
    closeCalendar(false);
  } else if (k === 'Escape' && text.value !== shown(props.modelValue)) {
    // The first Esc reverts the field; a second one is left to the form (11 §1 step 4).
    e.preventDefault();
    e.stopPropagation();
    revert();
  } else if (k === 'Tab' && !commit()) {
    e.preventDefault();
  } else if (k === 'Tab') {
    closeCalendar(false);
  } else if (k.length === 1 && !/[\d/.\-']/.test(k) && k !== sep) {
    e.preventDefault();
  }
}

/** Set when focus will come back without the user entering the field, which opens no calendar (11 §3). */
let skipAutoOpen = false;

/** Leaving for another window (the input stays active) or a dialog over the field: focus returns by itself. */
function focusWillReturn(next: Element | null): boolean {
  if (document.activeElement === input.value) return true;
  const dialog = next?.closest(MODAL);
  return !!dialog && dialog !== input.value?.closest(MODAL);
}

function onBlur(e: FocusEvent): void {
  const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
  if (next && (wrapper.value?.contains(next) || popup.value?.contains(next))) return;
  closeCalendar(false);
  skipAutoOpen = focusWillReturn(next);
  if (!commit()) {
    skipAutoOpen = true;
    void nextTick(() => input.value?.focus());
  }
}

function onFocus(): void {
  if (skipAutoOpen) skipAutoOpen = false;
  else openCalendarPopup();
}

let stop: (() => void) | null = null;

/**
 * Esc closes the calendar before anything else sees it, inside a modal too (22 §2.2). A scope, because the
 * dispatcher takes the key in the capture phase, wherever focus is.
 */
function onCalendarKey(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape') return false;
  revert();
  closeCalendar(true);
  return true;
}

function openCalendarPopup(focusGrid = false): void {
  if (props.disabled) return;
  open.value = true;
  focusInGrid.value = focusGrid;
  // After the tick: a dialog focuses its field before pushing its own modal scope, which must stay below ours.
  void nextTick(() => {
    const anchor = wrapper.value;
    const el = popup.value;
    if (!anchor || !el) return;
    stop?.();
    const stopPosition = autoUpdate(anchor, el, () => {
      // Above the field when there's room: below it is the next field in the tab order (11 §3).
      void computePosition(anchor, el, {
        placement: 'top-start',
        strategy: 'fixed',
        middleware: [offset(2), flip(), shift()],
      }).then(({ x, y }) => {
        el.style.left = `${String(x)}px`;
        el.style.top = `${String(y)}px`;
      });
    });
    const popScope = keyboard.push(onCalendarKey);
    stop = () => {
      stopPosition();
      popScope();
    };
  });
}

const focusInGrid = ref(false);

function closeCalendar(refocus: boolean): void {
  stop?.();
  stop = null;
  open.value = false;
  if (refocus && document.activeElement !== input.value) {
    skipAutoOpen = true;
    void nextTick(() => input.value?.focus());
  }
}

function pick(date: ISODate): void {
  error.value = null;
  set(date);
  closeCalendar(true);
}

function onPopupPointer(e: PointerEvent): void {
  const target = e.target as Node | null;
  if (!open.value || !target || popup.value?.contains(target) || wrapper.value?.contains(target))
    return;
  closeCalendar(false);
  // With focus out of the input, no blur is coming to commit what was typed.
  if (document.activeElement !== input.value) commit();
}
document.addEventListener('pointerdown', onPopupPointer, true);

/** Clicks in the calendar leave focus in the field, and off its controls never drop it to the body (22 §3). */
function onPopupMousedown(e: MouseEvent): void {
  const onControl = e.target instanceof Element && e.target.closest('button') !== null;
  if (!onControl || document.activeElement === input.value) e.preventDefault();
}

/** The calendar sits at the end of the body: Tab past its ends goes back to the field, not out of a modal. */
function onPopupKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !popup.value) return;
  const stops = focusables(popup.value).filter((el) => el.getAttribute('tabindex') !== '-1');
  if (e.target === (e.shiftKey ? stops[0] : stops.at(-1))) {
    e.preventDefault();
    closeCalendar(true);
  }
}
onBeforeUnmount(() => {
  stop?.();
  document.removeEventListener('pointerdown', onPopupPointer, true);
});

defineExpose({
  commit,
  focus: () => input.value?.focus(),
  select: () => input.value?.select(),
});
</script>

<template>
  <span ref="wrapper" class="date-field">
    <input
      ref="input"
      v-model="text"
      class="date-field__input"
      type="text"
      autocomplete="off"
      :placeholder="placeholder"
      :aria-label="label"
      :aria-invalid="error ? 'true' : undefined"
      :disabled="disabled"
      @keydown="onKeydown"
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
    />
    <button
      type="button"
      class="date-field__button"
      tabindex="-1"
      :aria-label="t('a11y.chooseDate')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="open ? closeCalendar(true) : openCalendarPopup(true)"
    >
      <CalendarDays class="date-field__icon" aria-hidden="true" />
    </button>
  </span>
  <Teleport to="body">
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- keeps focus and Tab in order around the calendar's own controls -->
    <div
      v-if="open"
      ref="popup"
      class="date-field__popup"
      @mousedown="onPopupMousedown"
      @keydown="onPopupKeydown"
    >
      <CalendarGrid
        :model-value="modelValue ?? today"
        :today="today"
        :focus-on-mount="focusInGrid"
        @pick="pick"
      />
    </div>
  </Teleport>
  <Callout
    v-if="error && wrapper"
    :anchor="wrapper"
    :title="t('app.invalidDate')"
    variant="opaque"
    :placements="scheduler ? ['bottom', 'bottomLeft'] : ['top', 'topLeft']"
    :take-focus="false"
    @close="error = null"
  >
    <RichText :text="error" />
  </Callout>
</template>

<style scoped>
.date-field {
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
}

.date-field__input {
  flex: 1;
  min-width: 0;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--text);
}

.date-field__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
}

.date-field__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.date-field__popup {
  position: fixed;
  z-index: 101; /* above TaskDialog (100) */
}
</style>
