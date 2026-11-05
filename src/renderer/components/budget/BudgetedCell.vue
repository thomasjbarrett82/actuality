<script setup lang="ts">
// The Budgeted cell (09 §5.4): a bordered box with the amount (blank when 0) and a cell-note icon. Editing
// (canEdit only) turns it into a right-aligned field with the text selected and a dropdown arrow:
// Enter / Tab / ↓ commit and move to the next visible category in the month (↑ / Shift+Tab: previous,
// wrapping); Esc discards; F2 opens the Quick Budget list; `+ * /` (and `-` on a non-zero value) open the
// calculator, whose OK writes the result into the field and commits it at once. A click outside commits.
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Operator } from '@shared/calculator';
import type { Money } from '@shared/domain/types';
import { currencyPlain } from '@shared/format';
import { parse, separators } from '@shared/money';
import type { CategoryQuickStats } from '@shared/quickbudget/quickbudget';
import { ChevronDown, StickyNote } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { editableCategoryIds, nextCategory } from '../../budget/budget-model';
import { cellQuickItems, type QuickItem, type QuickItemId } from '../../budget/quick';
import { useBudget, type CellRef } from '../../budget/use-budget';
import { moneyLabel } from '../../money-display';
import { attempt, tr } from '../../register/dialogs';
import { host } from '../../rpc/host-client';
import CalculatorPanel from '../common/CalculatorPanel.vue';
import MoneyAmount from '../common/MoneyAmount.vue';
import QuickBudgetList from './QuickBudgetList.vue';

const props = defineProps<{
  cell: CellRef;
  budgeted: Money;
  past: boolean;
  /** The first category row of its group: the box has a top border. */
  first: boolean;
  note: string | null;
  /** The accessible name: "{Month} Budgeted". */
  label: string;
  /** The grid's roving tab stop is here. */
  tabStop: boolean;
  /** The cell's grid position, for the grid's keyboard model. */
  row: number;
  col: number;
}>();
const emit = defineEmits<{ note: [anchor: HTMLElement] }>();
const b = useBudget();

const box = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const editing = computed(
  () => b.editing?.month === props.cell.month && b.editing.categoryId === props.cell.categoryId,
);
const decimal = computed(() => separators(b.format.money.numberFormat).decimal);
const plain = (m: Money): string => (m === 0 ? '' : currencyPlain(m, b.format.money));
const text = ref('');
/** The open popup: the Quick Budget list or the calculator. */
const pop = ref<
  | { kind: 'list'; items: QuickItem[] }
  | { kind: 'calc'; initial: Money; operator: Operator | null }
  | null
>(null);

watch(
  editing,
  async (on) => {
    if (!on) return;
    text.value = plain(props.budgeted);
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true },
);

const current = (): Money => {
  const t = text.value.trim();
  return t === '' ? 0 : (parse(t, b.format.money) ?? props.budgeted);
};

/** Parses and writes the text: invalid reverts, unchanged writes nothing (09 §5.4). */
async function commit(): Promise<void> {
  const t = text.value.trim();
  const value = t === '' ? 0 : parse(t, b.format.money);
  if (value === null) {
    text.value = plain(props.budgeted);
    return;
  }
  await b.commitAmount(props.cell, value);
}

function close(focusCell: boolean): void {
  if (!editing.value) return;
  b.editing = null;
  if (focusCell) void nextTick(() => box.value?.focus());
}

async function moveTo(step: 1 | -1): Promise<void> {
  const ids = editableCategoryIds(b.rows);
  const next = nextCategory(ids, props.cell.categoryId, step);
  const commitDone = commit();
  if (next) {
    b.focus = { month: props.cell.month, categoryId: next };
    b.editing = { month: props.cell.month, categoryId: next };
  } else close(true);
  await commitDone;
}

async function openList(): Promise<void> {
  const result = await attempt(() =>
    host.call('budget.quickBudgetStats', { month: props.cell.month }),
  );
  if (!result.ok || !editing.value) return;
  const stats = result.value;
  pop.value = {
    kind: 'list',
    items: cellQuickItems(stats, props.cell.categoryId, b.format.money, tr),
  };
  quickStats = stats.categories[props.cell.categoryId] ?? null;
  await place();
}
let quickStats: CategoryQuickStats | null = null;

async function openCalc(operator: Operator | null): Promise<void> {
  pop.value = { kind: 'calc', initial: current(), operator };
  await place();
}

async function pick(id: string): Promise<void> {
  if (id === 'calculator') return openCalc(null);
  const value = quickStats?.[id as Exclude<QuickItemId, 'calculator'>];
  closePopup(false);
  if (value === undefined) return;
  text.value = plain(value);
  await commit();
  close(true);
}

function closePopup(refocus = true): void {
  stopPlace?.();
  stopPlace = null;
  pop.value = null;
  if (refocus) void nextTick(() => input.value?.focus());
}

/** OK commits the result at once, so Balance and the totals update; the editor stays open (09 §5.4). */
async function calcDone(value: Money | null): Promise<void> {
  closePopup();
  if (value === null) return;
  const shown = plain(value);
  text.value = shown;
  void nextTick(() => input.value?.select());
  const ok = await b.commitAmount(props.cell, value);
  if (!ok && editing.value && text.value === shown) text.value = plain(props.budgeted);
}

let stopPlace: (() => void) | null = null;
async function place(): Promise<void> {
  await nextTick();
  const anchor = box.value;
  const el = popup.value;
  if (!anchor || !el) return;
  stopPlace?.();
  stopPlace = autoUpdate(anchor, el, () => {
    void computePosition(anchor, el, {
      placement: 'bottom-end',
      strategy: 'fixed',
      middleware: [offset(2), flip({ fallbackPlacements: ['top-end'] }), shift()],
    }).then(({ x, y }) => {
      el.style.left = `${String(x)}px`;
      el.style.top = `${String(y)}px`;
    });
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const handled = (): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (((k === 'Enter' || k === 'Tab') && !e.shiftKey) || k === 'ArrowDown') {
    handled();
    void moveTo(1);
  } else if (((k === 'Enter' || k === 'Tab') && e.shiftKey) || k === 'ArrowUp') {
    handled();
    void moveTo(-1);
  } else if (k === 'Escape') {
    handled();
    const changed = text.value.trim() !== plain(props.budgeted);
    text.value = plain(props.budgeted);
    close(changed);
    if (!changed) box.value?.closest<HTMLElement>('[data-budget-scroll]')?.focus();
  } else if (k === 'F2') {
    handled();
    void openList();
  } else if (k === '+' || k === '*' || k === '/' || (k === '-' && current() !== 0)) {
    handled();
    void openCalc(k);
  } else if (e.code === 'NumpadDecimal') {
    handled();
    const el = input.value;
    if (!el) return;
    const at = el.selectionStart ?? text.value.length;
    text.value = `${text.value.slice(0, at)}${decimal.value}${text.value.slice(el.selectionEnd ?? at)}`;
  } else if (k.length === 1 && !/[\d.,-]/.test(k) && k !== decimal.value) e.preventDefault();
}

function onBlur(e: FocusEvent): void {
  if (pop.value) return;
  const to = e.relatedTarget as Node | null;
  if (to && box.value?.contains(to)) return;
  void commit().then(() => {
    close(false);
  });
}

function start(): void {
  if (!b.canEdit || editing.value) return;
  b.focus = { ...props.cell };
  b.editing = { ...props.cell };
}

onBeforeUnmount(() => {
  stopPlace?.();
});

defineExpose({ start });
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -- roving tabindex (22 §2.3): the bound tabindex is 0 or -1, and the grid turns Enter into a click -->
  <div
    ref="box"
    v-tooltip="b.canEdit ? null : tr('app.editingUnavailableOffline')"
    class="budgeted"
    :class="{
      'budgeted--past': past,
      'budgeted--first': first,
      'budgeted--editing': editing,
      'budgeted--readonly': !b.canEdit,
    }"
    role="gridcell"
    :tabindex="editing ? -1 : tabStop ? 0 : -1"
    :aria-label="`${label}: ${moneyLabel(budgeted, b.format.money)}`"
    :aria-readonly="!b.canEdit"
    data-budget-cell="budgeted"
    :data-r="row"
    :data-c="col"
    @click="start"
    @focus="b.focus = { ...cell }"
  >
    <button
      v-if="note"
      v-tooltip="note"
      type="button"
      class="budgeted__note"
      tabindex="-1"
      :aria-label="tr('a11y.budgetNote')"
      @click.stop="emit('note', $event.currentTarget as HTMLElement)"
    >
      <StickyNote aria-hidden="true" />
    </button>
    <template v-if="editing">
      <input
        ref="input"
        v-model="text"
        class="budgeted__input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        size="1"
        :aria-label="label"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <button
        v-tooltip="tr('app.budCellMenuTooltip')"
        type="button"
        class="budgeted__arrow"
        tabindex="-1"
        :aria-label="tr('a11y.quickBudget')"
        @mousedown.prevent
        @click.stop="openList"
      >
        <ChevronDown aria-hidden="true" />
      </button>
    </template>
    <span v-else class="budgeted__amount"
      ><MoneyAmount :value="budgeted" :settings="b.format.money" blank-zero
    /></span>
    <Teleport to="body">
      <div v-if="pop" ref="popup" class="budgeted__popup" @focusout.stop>
        <QuickBudgetList
          v-if="pop.kind === 'list'"
          :items="pop.items"
          :money="b.format.money"
          @pick="pick"
          @close="closePopup()"
          @operator="(op) => openCalc(op)"
        />
        <CalculatorPanel
          v-else
          :initial="pop.initial"
          :operator="pop.operator"
          :decimal-separator="decimal"
          @ok="calcDone"
          @cancel="calcDone(null)"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.budgeted {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  height: 100%;
  margin-right: var(--space-1);
  padding: 0 var(--space-2);
  border-right: 1px solid var(--budget-cell-border);
  border-bottom: 1px solid var(--budget-cell-border);
  border-left: 1px solid var(--budget-cell-border);
  color: var(--text);
  cursor: text;
  font-variant-numeric: tabular-nums;
}

.budgeted--first {
  border-top: 1px solid var(--budget-cell-border);
}

.budgeted--past {
  border-color: var(--budget-cell-border-past);
}

.budgeted--readonly {
  cursor: default;
}

.budgeted--editing,
.budgeted:focus-visible {
  outline: 2px solid var(--budget-cell-border);
  outline-offset: -1px;
}

.budgeted__amount {
  overflow: hidden;
  white-space: nowrap;
}

.budgeted__input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: right;
}

.budgeted__input:focus {
  outline: none;
}

.budgeted__note,
.budgeted__arrow {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.budgeted__note {
  position: absolute;
  left: 0;
}

.budgeted__note svg,
.budgeted__arrow svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.budgeted__popup {
  position: fixed;
  z-index: 96;
}
</style>
