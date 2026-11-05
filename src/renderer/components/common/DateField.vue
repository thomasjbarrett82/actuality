<script setup lang="ts">
// Date entry (11 §3): the budget's short date format, loose parsing, Quicken-style keys and a calendar
// drop-down. Invalid input reverts, keeps focus and shows the "Invalid date" callout (announced, 22 §4.5).
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
import CalendarGrid from './CalendarGrid.vue';
import Callout from './Callout.vue';
import RichText from './RichText.vue';

const MAX_RANGE_DAYS = 3650;
const INPUT_PREVIEW = 12;

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
  } else if (k === 'Escape' && open.value) {
    e.preventDefault();
    e.stopPropagation();
    closeCalendar(true);
  } else if (k === 'Escape' && text.value !== shown(props.modelValue)) {
    // The first Esc reverts the field; a second one is left to the form (11 §1 step 4).
    e.preventDefault();
    e.stopPropagation();
    text.value = shown(props.modelValue);
  } else if (k === 'Tab' && !commit()) {
    e.preventDefault();
  } else if (k.length === 1 && !/[\d/.\-']/.test(k) && k !== sep) {
    e.preventDefault();
  }
}

function onBlur(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && (wrapper.value?.contains(next) || popup.value?.contains(next))) return;
  if (!commit()) void nextTick(() => input.value?.focus());
}

let stop: (() => void) | null = null;

function openCalendarPopup(focusGrid = false): void {
  if (props.disabled) return;
  open.value = true;
  focusInGrid.value = focusGrid;
  void nextTick(() => {
    const anchor = wrapper.value;
    const el = popup.value;
    if (!anchor || !el) return;
    stop?.();
    stop = autoUpdate(anchor, el, () => {
      void computePosition(anchor, el, {
        placement: props.scheduler ? 'top-start' : 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(2), flip(), shift()],
      }).then(({ x, y }) => {
        el.style.left = `${String(x)}px`;
        el.style.top = `${String(y)}px`;
      });
    });
  });
}

const focusInGrid = ref(false);

function closeCalendar(refocus: boolean): void {
  stop?.();
  stop = null;
  open.value = false;
  if (refocus) void nextTick(() => input.value?.focus());
}

function pick(date: ISODate): void {
  error.value = null;
  set(date);
  closeCalendar(true);
}

function onPopupPointer(e: PointerEvent): void {
  const target = e.target as Node | null;
  if (open.value && target && !popup.value?.contains(target) && !wrapper.value?.contains(target))
    closeCalendar(false);
}
document.addEventListener('pointerdown', onPopupPointer, true);
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
    <div v-if="open" ref="popup" class="date-field__popup">
      <CalendarGrid
        :model-value="modelValue ?? today"
        :today="today"
        :focus-on-mount="focusInGrid"
        @pick="pick"
        @close="closeCalendar(true)"
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
