<script setup lang="ts">
// One transaction row of the register grid (10 §1–2, §6): the cells of the visible columns, the row style
// by error level (10 §2.1), the category cell's text and pills (10 §2.2), the notes cell's tag pills (10 §6.2),
// and the click targets: error icon, cleared toggle, the transfer icon and the split disclosure. The grid handles selection.
import type { RunningBalance } from '@shared/domain/register';
import { dateShort } from '@shared/format';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Lock,
  TriangleAlert,
} from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyLabel, moneyText } from '../../money-display';
import type { ColumnLayout } from '../../register/layout';
import { errorText } from '../../register/messages';
import type { RowView } from '../../register/rows';
import { useRegister } from '../../register/use-register';
import MoneyAmount from '../common/MoneyAmount.vue';
import NoteText from './NoteText.vue';

const props = defineProps<{
  row: RowView;
  layout: readonly ColumnLayout[];
  index: number;
  rowIndex: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  balance: RunningBalance | null;
  glow: boolean;
}>();
// Clicks on cells reach the grid by delegation (it holds focus); only the buttons emit.
const emit = defineEmits<{
  tag: [tag: string];
  error: [anchor: HTMLElement];
  cleared: [];
  transfer: [];
  toggle: [];
}>();
const { t } = useI18n();
const reg = useRegister();

const tx = computed(() => props.row.t);
const money = computed(() => reg.format.money);
const fullAmount = (m: number): string => moneyLabel(m, money.value, { symbol: true });
const outflow = computed(() => (tx.value.amount < 0 ? -tx.value.amount : 0));
const inflow = computed(() => (tx.value.amount > 0 ? tx.value.amount : 0));

const payeeTooltip = computed(() => {
  const imported = tx.value.importedPayee;
  return imported && imported !== props.row.payeeText
    ? t('app.regPayeeTooltipImported', { payee: props.row.payeeText, imported })
    : props.row.payeeText;
});

const tipAmount = (m: number): string => moneyText(m, money.value, { symbol: true });
const balanceTooltip = computed(() => {
  const b = props.balance;
  if (!b) return '';
  const date = dateShort(tx.value.date, reg.format.dateFormat);
  return [
    t('app.regBalanceThrough', { date }),
    `${t('app.regBalanceCleared', { date })}  ${tipAmount(b.cleared)}`,
    `${t('app.regBalanceUncleared')}  ${tipAmount(b.uncleared)}`,
    `${t('app.regBalanceWorking', { date })}  ${tipAmount(b.working)}`,
  ].join('\n');
});

const clearedTooltip = computed(() =>
  t(
    tx.value.cleared === 'R'
      ? 'app.regClearedTooltipR'
      : tx.value.cleared === 'C'
        ? 'app.regClearedTooltipC'
        : 'app.regClearedTooltipU',
  ),
);
const clearedName = computed(() =>
  t(
    tx.value.cleared === 'R'
      ? 'a11y.reconciledState'
      : tx.value.cleared === 'C'
        ? 'a11y.clearedState'
        : 'a11y.unclearedState',
  ),
);

const errorName = computed(() => {
  switch (tx.value.errorLevel) {
    case 'error':
      return t('a11y.errorIcon');
    case 'needsCategory':
      return t('a11y.needsCategoryIcon');
    case 'forReview':
      return t('a11y.needsApprovalIcon');
    default:
      return '';
  }
});

/** "This needs a category": on-budget, non-split, non-zero, uncategorized (10 §2.1). */
const needsCategoryPill = computed(
  () =>
    tx.value.errorLevel === 'needsCategory' &&
    props.row.categoryKind === 'none' &&
    tx.value.amount !== 0,
);
const errorPill = computed(
  () => tx.value.errorLevel === 'error' && props.row.categoryKind === 'category',
);
</script>

<template>
  <div
    :id="`reg-row-${tx.id}`"
    class="reg-row"
    role="row"
    aria-level="1"
    :aria-rowindex="rowIndex"
    :aria-selected="selected"
    :aria-expanded="row.lines.length > 0 ? expanded : undefined"
    :data-row-id="tx.id"
    :class="{
      'is-alt': index % 2 === 1,
      'is-selected': selected,
      'is-focused': focused,
      'is-review': tx.errorLevel === 'forReview',
      'is-glow': glow,
    }"
  >
    <template v-for="c in layout" :key="c.field">
      <div
        v-if="c.field === 'select'"
        class="reg-cell reg-cell--select"
        role="gridcell"
        data-col="select"
      >
        <input
          type="checkbox"
          tabindex="-1"
          :checked="selected"
          :aria-label="t('a11y.selectTransaction')"
        />
      </div>
      <div v-else-if="c.field === 'account'" class="reg-cell" role="gridcell" data-col="account">
        <span v-tooltip.truncated="row.accountName" class="reg-text">{{ row.accountName }}</span>
      </div>
      <div v-else-if="c.field === 'date'" class="reg-cell" role="gridcell" data-col="date">
        {{ dateShort(tx.date, reg.format.dateFormat, true) }}
      </div>
      <div v-else-if="c.field === 'check'" class="reg-cell" role="gridcell" data-col="check">
        <span v-if="tx.checkNumber" class="reg-text">{{ tx.checkNumber }}</span>
      </div>
      <div
        v-else-if="c.field === 'payee'"
        class="reg-cell reg-cell--payee"
        role="gridcell"
        data-col="payee"
      >
        <button
          v-if="row.lines.length > 0"
          type="button"
          tabindex="-1"
          class="reg-disclosure"
          :aria-label="t('a11y.splitLines')"
          :aria-expanded="expanded"
          @click.stop="emit('toggle')"
        >
          <ChevronDown v-if="expanded" class="reg-icon" aria-hidden="true" />
          <ChevronRight v-else class="reg-icon" aria-hidden="true" />
        </button>
        <span v-tooltip="payeeTooltip" class="reg-text">{{ row.payeeText }}</span>
        <button
          v-if="row.transferAccount"
          type="button"
          tabindex="-1"
          class="reg-transfer"
          :aria-label="t('a11y.goToTransfer')"
          @click.stop="emit('transfer')"
        >
          <ArrowLeftRight class="reg-icon" aria-hidden="true" />
        </button>
      </div>
      <div
        v-else-if="c.field === 'error'"
        class="reg-cell reg-cell--icon"
        role="gridcell"
        data-col="error"
      >
        <button
          v-if="tx.errorLevel !== 'none'"
          v-tooltip="errorText(tx.errorMessage) || errorName"
          type="button"
          tabindex="-1"
          class="reg-error"
          :class="`reg-error--${tx.errorLevel}`"
          :aria-label="errorName"
          @click.stop="emit('error', $event.currentTarget as HTMLElement)"
        >
          <CircleAlert v-if="tx.errorLevel === 'error'" class="reg-icon" aria-hidden="true" />
          <TriangleAlert
            v-else-if="tx.errorLevel === 'needsCategory'"
            class="reg-icon"
            aria-hidden="true"
          />
          <Clock v-else class="reg-icon" aria-hidden="true" />
        </button>
      </div>
      <div v-else-if="c.field === 'category'" class="reg-cell" role="gridcell" data-col="category">
        <span v-if="needsCategoryPill" class="reg-pill reg-pill--needscat">{{
          t('app.regNeedsCategory')
        }}</span>
        <span
          v-else
          v-tooltip.truncated="row.categoryText"
          class="reg-text"
          :class="{
            'reg-pill reg-pill--error': errorPill,
            'is-muted': row.categoryKind === 'notNeeded',
          }"
          >{{ row.categoryText }}</span
        >
      </div>
      <div v-else-if="c.field === 'notes'" class="reg-cell" role="gridcell" data-col="notes">
        <NoteText
          v-tooltip.truncated="tx.notes"
          class="reg-text"
          :notes="tx.notes"
          :needs-review="tx.needsReview"
          @tag="emit('tag', $event)"
        />
      </div>
      <div
        v-else-if="c.field === 'outflow'"
        class="reg-cell reg-cell--money"
        role="gridcell"
        data-col="outflow"
        :aria-label="outflow ? fullAmount(-outflow) : undefined"
      >
        <MoneyAmount :value="outflow" :settings="money" blank-zero />
      </div>
      <div
        v-else-if="c.field === 'inflow'"
        class="reg-cell reg-cell--money"
        role="gridcell"
        data-col="inflow"
        :aria-label="inflow ? fullAmount(inflow) : undefined"
      >
        <MoneyAmount :value="inflow" :settings="money" blank-zero />
      </div>
      <div
        v-else-if="c.field === 'balance'"
        v-tooltip="balanceTooltip"
        class="reg-cell reg-cell--money reg-cell--balance"
        role="gridcell"
        data-col="balance"
        :class="{ 'is-negative': (balance?.working ?? 0) < 0 }"
      >
        <MoneyAmount v-if="balance" :value="balance.working" :settings="money" />
      </div>
      <div
        v-else-if="c.field === 'cleared'"
        class="reg-cell reg-cell--icon"
        role="gridcell"
        data-col="cleared"
      >
        <button
          v-tooltip="clearedTooltip"
          type="button"
          tabindex="-1"
          class="reg-cleared"
          :class="`reg-cleared--${tx.cleared}`"
          :aria-label="clearedName"
          :disabled="tx.cleared === 'R'"
          @click.stop="emit('cleared')"
        >
          <Lock v-if="tx.cleared === 'R'" class="reg-icon" aria-hidden="true" />
          <span v-else class="reg-cleared__c" aria-hidden="true">{{
            t('register.columnCleared')
          }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.reg-row {
  display: grid;
  grid-template-columns: var(--reg-cols);
  height: var(--row-h);
  background: var(--row-alt-even);
  color: var(--text-grid);
  font-size: var(--font-body);
  cursor: default;
}

.reg-row.is-alt {
  background: var(--row-alt-odd);
}

.reg-row.is-selected {
  background: var(--row-selected);
}

.reg-row.is-focused {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.reg-row.is-review {
  font-weight: 700;
}

.reg-row.is-glow {
  animation: reg-glow 1s ease-out;
}

@keyframes reg-glow {
  from {
    box-shadow: inset 0 0 0 0.2rem var(--accent-blue);
  }

  to {
    box-shadow: inset 0 0 0 0 transparent;
  }
}

.reg-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-2);
  border-right: 1px solid var(--grid-line-v);
  border-bottom: 1px solid var(--grid-line-h);
  overflow: hidden;
  white-space: nowrap;
}

.reg-cell--select,
.reg-cell--icon {
  justify-content: center;
  padding: 0;
}

/* The box only mirrors the selection: clicks land on the cell, which toggles it. A click on the
   box itself would otherwise have its native toggle cancelled after Vue renders the new state. */
.reg-cell--select input {
  pointer-events: none;
}

.reg-cell--money {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.reg-cell--balance {
  color: var(--running-balance-text);
}

.reg-cell--balance.is-negative {
  color: var(--money-negative);
}

.reg-cell--payee {
  gap: var(--space-1);
}

.reg-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reg-text.is-muted {
  color: var(--text-muted);
}

.reg-pill {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--font-sm);
}

.reg-pill--needscat {
  background: var(--needscat-pill-bg);
  color: var(--needscat-pill-text);
  font-style: italic;
}

.reg-pill--error {
  background: var(--error-pill-bg);
  color: var(--error-pill-text);
  text-decoration: line-through;
}

.reg-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.reg-error,
.reg-cleared,
.reg-transfer,
.reg-disclosure {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--icon);
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.reg-error--error {
  color: var(--status-error);
}

.reg-error--needsCategory {
  color: var(--needscat-badge);
}

.reg-error--forReview {
  color: var(--review-badge);
}

.reg-cleared {
  color: var(--cleared-off);
}

.reg-cleared__c {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-sm);
  height: var(--icon-sm);
  border: 1px solid currentcolor;
  border-radius: 50%;
  font-size: var(--font-xs);
  font-weight: 700;
  line-height: 1;
}

.reg-cleared--C {
  color: var(--cleared-on);
}

.reg-cleared--C .reg-cleared__c {
  border-color: var(--cleared-on);
  background: var(--cleared-on);
  color: var(--panel-bg);
}

.reg-cleared--R {
  color: var(--cleared-on);
  cursor: default;
}

.reg-transfer {
  flex: none;
  color: var(--link);
}
</style>
