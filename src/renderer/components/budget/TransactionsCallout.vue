<script setup lang="ts">
// The transactions popover (`<TransactionsCallout>`, 09 §6.6): a summary line, then a read-only grid of
// Date, Account, Payee, Notes and Amount, newest first, 4–8 rows tall. Clicking a row (or Enter on it)
// closes with `jump:{index}`; Show in Account View closes with 'show'; Close with 'close'.
import type { Money } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import type { MoneySettings } from '@shared/money';
import type { CalloutTransaction } from '@shared/rpc/host-api';
import { Eye } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import MoneyAmount from '../common/MoneyAmount.vue';
import RichText from '../common/RichText.vue';
import UiButton from '../common/UiButton.vue';

defineProps<{
  summary: string;
  /** Plain lines under the summary (the income breakdown, 09 §5.1). */
  lines?: readonly string[];
  rows: readonly CalloutTransaction[];
  /** The "Held from {PrevMonth}" summary row of the income popover. */
  held?: { label: string; amount: Money } | null;
  settings: MoneySettings;
  dateFormat: string;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();

function payee(r: CalloutTransaction): string {
  const transfer = r.transferAccountName
    ? t('app.budTransferPayee', { account: r.transferAccountName })
    : null;
  if (!r.isSplitLine) return transfer ?? r.payeeName;
  const split = t('app.budSplitPayee', { payee: r.payeeName });
  return transfer ? `${split} / ${transfer}` : split;
}

const notes = (r: CalloutTransaction): string =>
  r.isSplitLine && r.parentNotes
    ? r.notes
      ? `${r.notes} - ${r.parentNotes}`
      : r.parentNotes
    : r.notes;
</script>

<template>
  <div class="tx">
    <p class="tx__summary"><RichText :text="summary" /></p>
    <ul v-if="lines && lines.length > 0" class="tx__lines">
      <li v-for="line in lines" :key="line">{{ line }}</li>
    </ul>
    <div
      v-if="rows.length > 0 || held"
      class="tx__grid"
      role="grid"
      :aria-rowcount="rows.length + 1"
    >
      <div class="tx__row tx__row--head" role="row">
        <span role="columnheader">{{ t('register.columnDate') }}</span>
        <span role="columnheader">{{ t('app.budColumnAccount') }}</span>
        <span role="columnheader">{{ t('register.columnPayee') }}</span>
        <span role="columnheader">{{ t('register.columnNotes') }}</span>
        <span role="columnheader" class="tx__amount">{{ t('app.budColumnAmount') }}</span>
      </div>
      <div class="tx__body">
        <div
          v-for="(r, i) in rows"
          :key="r.id"
          class="tx__row tx__row--item"
          role="row"
          tabindex="0"
          data-callout-row
          @click="emit('close', `jump:${String(i)}`)"
          @keydown.enter.prevent="emit('close', `jump:${String(i)}`)"
        >
          <span role="gridcell">{{ dateShort(r.date, dateFormat, true) }}</span>
          <span v-tooltip.truncated role="gridcell" class="tx__text">{{ r.accountName }}</span>
          <span v-tooltip.truncated role="gridcell" class="tx__text">{{ payee(r) }}</span>
          <span v-tooltip.truncated role="gridcell" class="tx__text">{{ notes(r) }}</span>
          <span role="gridcell" class="tx__amount"
            ><MoneyAmount :value="r.amount" :settings="settings"
          /></span>
        </div>
        <div v-if="held" class="tx__row tx__row--held" role="row">
          <span role="gridcell" />
          <span role="gridcell" />
          <span role="gridcell" class="tx__text">{{ held.label }}</span>
          <span role="gridcell" />
          <span role="gridcell" class="tx__amount"
            ><MoneyAmount :value="held.amount" :settings="settings"
          /></span>
        </div>
      </div>
    </div>
    <div class="tx__buttons">
      <UiButton :disabled="rows.length === 0" @click="emit('close', 'show')">
        <Eye class="tx__icon" aria-hidden="true" />
        {{ t('app.budShowInAccountView') }}
      </UiButton>
      <UiButton @click="emit('close', 'close')">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.tx {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--text);
}

.tx__summary {
  margin: 0;
}

.tx__lines {
  margin: 0;
  padding-left: var(--space-5);
}

.tx__grid {
  border: 1px solid var(--register-border);
}

.tx__body {
  max-height: calc(8 * var(--row-h));
  min-height: calc(4 * var(--row-h));
  overflow-y: auto;
}

.tx__row {
  display: grid;
  grid-template-columns: 4rem 5.75rem 5.75rem 5.75rem minmax(5.75rem, 1fr);
  gap: var(--space-2);
  align-items: center;
  height: var(--row-h);
  padding: 0 var(--space-2);
}

.tx__row--head {
  background: linear-gradient(var(--header-bg-current), var(--header-bg-current-end));
  color: var(--atb-future);
  font-weight: 700;
}

.tx__row--item {
  cursor: pointer;
}

.tx__row--item:nth-child(even) {
  background: var(--row-alt-even);
}

.tx__row--item:hover {
  background: var(--budget-row-hover);
}

.tx__row--held {
  font-style: italic;
}

.tx__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx__amount {
  text-align: right;
}

.tx__buttons {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.tx__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
