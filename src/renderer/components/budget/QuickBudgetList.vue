<script setup lang="ts">
// The per-cell Quick Budget list (09 §5.4): a popup listbox of labelled amounts plus "Show calculator".
// ↑/↓ move the highlight, Enter or a click picks, Esc closes, and `+ * /` ask for the calculator with that
// operator. It takes focus while open.
import type { Operator } from '@shared/calculator';
import type { MoneySettings } from '@shared/money';
import { Calculator } from 'lucide-vue-next';
import { onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { QuickItem } from '../../budget/quick';
import MoneyAmount from '../common/MoneyAmount.vue';

const props = defineProps<{ items: readonly QuickItem[]; money: MoneySettings }>();
const emit = defineEmits<{ pick: [id: string]; close: []; operator: [op: Operator] }>();
const { t } = useI18n();
const id = useId();
const list = ref<HTMLElement | null>(null);
const active = ref(0);

function onKey(e: KeyboardEvent): void {
  const n = props.items.length;
  let handled = true;
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n;
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n;
  else if (e.key === 'Enter') {
    const item = props.items[active.value];
    if (item) emit('pick', item.id);
  } else if (e.key === 'Escape' || e.key === 'Tab') emit('close');
  else if (e.key === '+' || e.key === '*' || e.key === '/') emit('operator', e.key);
  else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

onMounted(() => {
  list.value?.focus();
});
</script>

<template>
  <ul
    ref="list"
    class="quick"
    role="listbox"
    tabindex="0"
    :aria-label="t('a11y.quickBudget')"
    :aria-activedescendant="`${id}-${String(active)}`"
    @keydown="onKey"
  >
    <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus, vuejs-accessibility/mouse-events-have-key-events -- the listbox has the focus and the keys; options follow aria-activedescendant -->
    <li
      v-for="(item, i) in items"
      :id="`${id}-${String(i)}`"
      :key="item.id"
      role="option"
      class="quick__item"
      :class="{ 'quick__item--active': i === active }"
      :aria-selected="i === active"
      @mouseenter="active = i"
      @mousedown.prevent
      @click="emit('pick', item.id)"
    >
      <Calculator v-if="item.amount === null" class="quick__icon" aria-hidden="true" />
      <span class="quick__label">{{ item.label }}</span>
      <span v-if="item.amount !== null" class="quick__amount"
        ><MoneyAmount :value="item.amount" :settings="money"
      /></span>
    </li>
  </ul>
</template>

<style scoped>
.quick {
  min-width: 16rem;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  box-shadow: 0 0.2rem 0.6rem color-mix(in srgb, var(--overlay-shadow) 50%, transparent);
  color: var(--text);
  list-style: none;
}

.quick:focus-visible {
  outline: 2px solid var(--focus-ring);
}

.quick__item {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  height: var(--row-h);
  padding: 0 var(--space-3);
  cursor: pointer;
  white-space: nowrap;
}

.quick__item--active {
  background: var(--budget-row-hover);
}

.quick__label {
  flex: 1;
}

.quick__amount {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.quick__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
