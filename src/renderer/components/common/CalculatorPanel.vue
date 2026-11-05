<script setup lang="ts">
// The calculator (09 §5.4), shared by budget cells and the register. A dialog named "Calculator" whose
// display is a status region (22 §4.4). Arithmetic is exact (shared/calculator.ts), never floating point.
import { Calculator, type Operator } from '@shared/calculator';
import type { Money } from '@shared/domain/types';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from './UiButton.vue';

const props = withDefaults(
  defineProps<{ initial?: Money; operator?: Operator | null; decimalSeparator?: string }>(),
  { initial: 0, operator: null, decimalSeparator: '.' },
);
const emit = defineEmits<{ ok: [value: Money]; cancel: [] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);

const calc = ref(
  props.operator
    ? Calculator.withOperator(props.initial, props.operator)
    : new Calculator(props.initial),
);
const shown = ref(calc.value.display);
const sync = (): void => {
  shown.value = calc.value.error
    ? t('app.calcError')
    : calc.value.display.replace('.', props.decimalSeparator);
};

function press(key: string): void {
  const c = calc.value;
  if (/^\d$/.test(key) || key === '.') c.digit(key);
  else if (key === '+' || key === '-' || key === '*' || key === '/') c.operator(key);
  else if (key === '=') c.equals();
  else if (key === 'back') c.backspace();
  else if (key === 'C') c.clear();
  else if (key === 'F') c.negate();
  sync();
}

function ok(): void {
  const value = calc.value.equals();
  sync();
  if (value !== null) emit('ok', value);
}

function onKey(e: KeyboardEvent): void {
  const k = e.key;
  let handled = true;
  if (/^\d$/.test(k)) press(k);
  else if (k === '.' || k === ',' || k === props.decimalSeparator) press('.');
  else if (k === '+' || k === '-' || k === '*' || k === '/') press(k);
  else if (k === 'x' || k === 'X') press('*');
  else if (k === '=') press('=');
  else if (k === 'Backspace') press('back');
  else if (k === 'c' || k === 'C' || k === 'Delete') press('C');
  else if (k === 'f' || k === 'F') press('F');
  else if (k === 'Enter') ok();
  else if (k === 'Escape') emit('cancel');
  else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

onMounted(() => {
  root.value?.focus();
});

const keys = computed((): { key: string; label: string; aria?: string }[][] => [
  [
    { key: 'C', label: t('app.calcKeyClear'), aria: t('a11y.calcClear') },
    { key: 'F', label: t('app.calcKeyNegate'), aria: t('a11y.calcNegate') },
    { key: 'back', label: t('app.calcKeyBack'), aria: t('a11y.calcBackspace') },
    { key: '/', label: '/', aria: t('a11y.calcDivide') },
  ],
  [
    { key: '7', label: '7' },
    { key: '8', label: '8' },
    { key: '9', label: '9' },
    { key: '*', label: t('app.calcKeyTimes'), aria: t('a11y.calcMultiply') },
  ],
  [
    { key: '4', label: '4' },
    { key: '5', label: '5' },
    { key: '6', label: '6' },
    { key: '-', label: '-', aria: t('a11y.calcSubtract') },
  ],
  [
    { key: '1', label: '1' },
    { key: '2', label: '2' },
    { key: '3', label: '3' },
    { key: '+', label: '+', aria: t('a11y.calcAdd') },
  ],
  [
    { key: '0', label: '0' },
    { key: '.', label: props.decimalSeparator, aria: t('a11y.calcDecimal') },
    { key: '=', label: '=', aria: t('a11y.calcEquals') },
  ],
]);
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- the dialog takes the calculator keys for its buttons (09 §5.4) -->
  <div
    ref="root"
    class="calc"
    role="dialog"
    :aria-label="t('a11y.calculator')"
    tabindex="-1"
    @keydown="onKey"
  >
    <div class="calc__display" role="status">{{ shown }}</div>
    <div v-for="(row, r) in keys" :key="r" class="calc__row">
      <button
        v-for="k in row"
        :key="k.key"
        type="button"
        class="calc__key"
        :class="{ 'calc__key--wide': k.key === '0' }"
        :aria-label="k.aria"
        @click="press(k.key)"
      >
        {{ k.label }}
      </button>
    </div>
    <div class="calc__actions">
      <UiButton primary @click="ok">{{ t('app.calcOk') }}</UiButton>
      <UiButton @click="emit('cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.calc {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 15rem;
  padding: var(--space-3);
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
}

.calc__display {
  display: block;
  min-height: var(--control-h);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  background: var(--register-gray-bg);
  font-size: var(--font-lg);
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
}

.calc__row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.calc__key {
  min-height: max(var(--control-h), var(--hit-min));
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  color: var(--text);
  font-size: var(--font-md);
  cursor: pointer;
}

.calc__key--wide {
  grid-column: span 2;
}

.calc__actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
