<script setup lang="ts">
// A split's line under its expanded parent (11 §7.2): indented, background --budget-row-alt-even/white,
// 600 body --split-text. Lines that don't match a search are struck through for context (10 §4). A line
// has its own error icon (11 §7.1).
import { CircleAlert, TriangleAlert } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyLabel } from '../../money-display';
import type { ColumnLayout } from '../../register/layout';
import { errorText } from '../../register/messages';
import type { LineView, RowView } from '../../register/rows';
import { useRegister } from '../../register/use-register';
import MoneyAmount from '../common/MoneyAmount.vue';

const props = defineProps<{
  row: RowView;
  line: LineView;
  layout: readonly ColumnLayout[];
  lineIndex: number;
  rowIndex: number;
  matched: boolean;
}>();
const emit = defineEmits<{ error: [anchor: HTMLElement] }>();
const { t } = useI18n();
const reg = useRegister();
const l = computed(() => props.line.line);
const money = computed(() => reg.format.money);
const outflow = computed(() => (l.value.amount < 0 ? -l.value.amount : 0));
const inflow = computed(() => (l.value.amount > 0 ? l.value.amount : 0));
const errorName = computed(() =>
  l.value.errorLevel === 'error'
    ? t('a11y.errorIcon')
    : l.value.errorLevel === 'needsCategory'
      ? t('a11y.needsCategoryIcon')
      : '',
);
</script>

<template>
  <div
    class="split-line"
    role="row"
    aria-level="2"
    :aria-rowindex="rowIndex"
    :data-line-parent="row.t.id"
    :class="{ 'is-alt': lineIndex % 2 === 1, 'is-context': !matched }"
  >
    <template v-for="c in layout" :key="c.field">
      <div v-if="c.field === 'payee'" class="split-cell split-cell--indent" role="gridcell">
        <span class="split-text">{{ line.transferText }}</span>
      </div>
      <div v-else-if="c.field === 'error'" class="split-cell split-cell--icon" role="gridcell">
        <button
          v-if="l.errorLevel === 'error' || l.errorLevel === 'needsCategory'"
          v-tooltip="errorText(l.errorMessage) || errorName"
          type="button"
          tabindex="-1"
          class="split-error"
          :class="`split-error--${l.errorLevel}`"
          :aria-label="errorName"
          @click.stop="emit('error', $event.currentTarget as HTMLElement)"
        >
          <CircleAlert v-if="l.errorLevel === 'error'" class="split-icon" aria-hidden="true" />
          <TriangleAlert v-else class="split-icon" aria-hidden="true" />
        </button>
      </div>
      <div v-else-if="c.field === 'category'" class="split-cell" role="gridcell">
        <span class="split-text" :class="{ 'is-error': l.errorLevel === 'error' }">{{
          line.categoryText
        }}</span>
      </div>
      <div v-else-if="c.field === 'notes'" class="split-cell" role="gridcell">
        <span class="split-text">{{ l.notes }}</span>
      </div>
      <div
        v-else-if="c.field === 'outflow'"
        class="split-cell split-cell--money"
        role="gridcell"
        :aria-label="outflow ? moneyLabel(-outflow, money, { symbol: true }) : undefined"
      >
        <MoneyAmount :value="outflow" :settings="money" blank-zero />
      </div>
      <div
        v-else-if="c.field === 'inflow'"
        class="split-cell split-cell--money"
        role="gridcell"
        :aria-label="inflow ? moneyLabel(inflow, money, { symbol: true }) : undefined"
      >
        <MoneyAmount :value="inflow" :settings="money" blank-zero />
      </div>
      <div v-else class="split-cell" role="gridcell" />
    </template>
  </div>
</template>

<style scoped>
.split-line {
  display: grid;
  grid-template-columns: var(--reg-cols);
  height: var(--row-h);
  background: var(--budget-row-alt-even);
  color: var(--split-text);
  font-weight: 600;
}

.split-line.is-alt {
  background: var(--panel-bg);
}

.split-line.is-context {
  color: var(--text-strike);
  text-decoration: line-through;
}

.split-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--split-border);
  overflow: hidden;
  white-space: nowrap;
}

.split-cell--indent {
  padding-left: var(--space-6);
}

.split-cell--icon {
  justify-content: center;
  padding: 0;
}

.split-cell--money {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.split-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.split-text.is-error {
  text-decoration: line-through;
}

.split-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.split-error {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.split-error--error {
  color: var(--status-error);
}

.split-error--needsCategory {
  color: var(--needscat-badge);
}
</style>
