<script setup lang="ts">
// Money entry (11 §2, 09 §5.4): a text field labelled by its column (22 §4.4). Allowed characters are
// digits, `. , + - * /` and the locale decimal separator. Commit (Enter / blur) parses with
// shared/money.ts; invalid text reverts. `+ * /` open the calculator with the current value and that
// operator; `-` does too when the value isn't 0, otherwise it types a minus sign. The calculator closes once
// the user moves on, discarding its calculation; the field then commits what it holds, as on blur.
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Operator } from '@shared/calculator';
import type { Money } from '@shared/domain/types';
import {
  DEFAULT_MONEY_SETTINGS,
  format,
  parse,
  separators,
  type MoneySettings,
} from '@shared/money';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useMaskedField } from '../../money-display';
import CalculatorPanel from './CalculatorPanel.vue';
import { usePopupDismissal } from './popup-dismissal';

const props = withDefaults(
  defineProps<{
    modelValue: Money | null;
    label: string;
    settings?: MoneySettings;
    disabled?: boolean;
    blankZero?: boolean;
    placeholder?: string;
    /** Shown but not editable (a transfer created by a split elsewhere, 11 §2). */
    readonly?: boolean;
  }>(),
  {
    settings: () => DEFAULT_MONEY_SETTINGS,
    disabled: false,
    blankZero: false,
    readonly: false,
  },
);
const emit = defineEmits<{
  'update:modelValue': [value: Money | null];
  commit: [value: Money | null];
}>();

const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const decimal = computed(() => separators(props.settings.numberFormat).decimal);
const display = (m: Money | null): string =>
  m === null || (props.blankZero && m === 0) ? '' : format(m, props.settings, { thousands: false });
const text = ref(display(props.modelValue));
// Privacy mode (06 §7): the amount stays masked until the user clicks or types in the field.
const mask = useMaskedField(text);
const { shown, attrs } = mask;
const calc = ref<{ initial: Money; operator: Operator } | null>(null);

watch(
  () => props.modelValue,
  (m) => {
    text.value = display(m);
  },
);

function commit(): void {
  const trimmed = text.value.trim();
  const value = trimmed === '' ? null : parse(trimmed, props.settings);
  if (trimmed !== '' && value === null) {
    text.value = display(props.modelValue);
    return;
  }
  // A blank-zero field shows 0 as blank, so leaving it blank isn't a change. Without this, tabbing
  // through an empty Inflow commits 0 and wipes the Outflow just entered.
  const unchanged =
    value === props.modelValue ||
    (props.blankZero && (value ?? 0) === 0 && (props.modelValue ?? 0) === 0);
  if (!unchanged) {
    emit('update:modelValue', value);
    emit('commit', value);
  }
  text.value = display(value);
}

function current(): Money {
  return (
    (text.value.trim() === '' ? 0 : parse(text.value, props.settings)) ?? props.modelValue ?? 0
  );
}

function onKeydown(e: KeyboardEvent): void {
  mask.onKeydown(e);
  if (e.ctrlKey || e.metaKey || e.altKey || props.readonly) return;
  const k = e.key;
  if (k === 'Enter') {
    commit();
    return;
  }
  if (k === 'Escape') {
    if (text.value !== display(props.modelValue)) {
      text.value = display(props.modelValue);
      e.stopPropagation();
    }
    return;
  }
  if (k === '+' || k === '*' || k === '/' || (k === '-' && current() !== 0)) {
    e.preventDefault();
    calc.value = { initial: current(), operator: k };
    void placePopup();
    return;
  }
  if (k.length === 1 && !/[\d.,-]/.test(k) && k !== decimal.value) e.preventDefault();
}

let stop: (() => void) | null = null;
async function placePopup(): Promise<void> {
  await nextTick();
  const anchor = input.value;
  const el = popup.value;
  if (!anchor || !el) return;
  stop?.();
  const stopUpdate = autoUpdate(anchor, el, () => {
    void computePosition(anchor, el, {
      placement: 'bottom-end',
      strategy: 'fixed',
      middleware: [offset(2), flip(), shift()],
    }).then(({ x, y }) => {
      el.style.left = `${String(x)}px`;
      el.style.top = `${String(y)}px`;
    });
  });
  const stopListening = dismissal.listen();
  stop = () => {
    stopUpdate();
    stopListening();
  };
}

function removeCalc(): void {
  stop?.();
  stop = null;
  calc.value = null;
}

function closeCalc(value: Money | null): void {
  removeCalc();
  if (value !== null) {
    text.value = display(value);
    commit();
  }
  void nextTick(() => input.value?.focus());
}

const dismissal = usePopupDismissal({
  popup,
  anchor: input,
  isOpen: () => calc.value !== null,
  onReturn: () => {
    closeCalc(null);
  },
  // The blur that would have committed was ignored while the calculator was open.
  onLeave: () => {
    removeCalc();
    commit();
  },
});

onBeforeUnmount(() => {
  stop?.();
});

defineExpose({
  focus: () => input.value?.focus(),
  select: () => input.value?.select(),
  calculatorOpen: () => calc.value !== null,
});
</script>

<template>
  <input
    ref="input"
    :value="shown"
    class="money-input"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    :aria-label="label"
    v-bind="attrs"
    :disabled="disabled"
    :readonly="readonly"
    :placeholder="placeholder"
    @input="mask.onInput"
    @pointerdown="mask.onPointerdown"
    @keydown="onKeydown"
    @blur="(mask.onBlur(), calc === null && !readonly && commit())"
  />
  <Teleport to="body">
    <div v-if="calc" ref="popup" class="money-input__popup" @focusout="dismissal.onFocusout">
      <CalculatorPanel
        :initial="calc.initial"
        :operator="calc.operator"
        :decimal-separator="decimal"
        @ok="closeCalc"
        @cancel="closeCalc(null)"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.money-input {
  width: 100%;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
  text-align: right;
}

.money-input__popup {
  position: fixed;
  z-index: 96;
}
</style>
