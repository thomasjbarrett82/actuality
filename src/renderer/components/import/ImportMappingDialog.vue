<script setup lang="ts">
// The account mapping and preview dialog (16 §1.4), one per account in the file: the target account (or
// "<Skip this account>"), the start-date warning, the preview, the date order for QIF/CSV when it's
// ambiguous, and the notes options. Defaults come from the remembered mapping, else the previous
// dialog's choices, else the account the import started from. Closes with the choices, or null (Cancel).
import type { DateOrder } from '@shared/dates';
import type { Account, Id } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import {
  dateOf,
  defaultOrder,
  validOrders,
  type ParsedTransaction,
} from '@shared/import/import-rules';
import type { ImportParse, ImportRunAccount } from '@shared/rpc/host-api';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { bankAccountLabel } from '../../import/labels';
import { useBudgetFormat } from '../../queries/budget-data';
import MoneyAmount from '../common/MoneyAmount.vue';
import RichText from '../common/RichText.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import { escapeRichText } from '../common/rich-text';

const props = defineProps<{
  parsed: ImportParse;
  index: number;
  accounts: readonly Account[];
  defaultAccountId: Id | null;
  budgetOrder: DateOrder;
  previous: ImportRunAccount | null;
  last: boolean;
}>();
const emit = defineEmits<{ close: [result: ImportRunAccount | null] }>();
const { t } = useI18n();
const id = useId();
const format = useBudgetFormat();

const SKIP = '';
const account = computed(() => props.parsed.accounts[props.index]);
const txns = computed<ParsedTransaction[]>(() => account.value?.transactions ?? []);
const mapping = computed(() =>
  account.value?.key ? props.parsed.mappings[account.value.key] : undefined,
);
const isOpen = (accountId: Id | null | undefined): accountId is Id =>
  accountId !== null && accountId !== undefined && props.accounts.some((a) => a.id === accountId);

function initialTarget(): Id {
  const m = mapping.value;
  if (m) return m.accountId === null ? SKIP : isOpen(m.accountId) ? m.accountId : firstTarget();
  if (props.previous && props.previous.accountId !== null && isOpen(props.previous.accountId))
    return props.previous.accountId;
  return firstTarget();
}
function firstTarget(): Id {
  if (isOpen(props.defaultAccountId)) return props.defaultAccountId;
  return props.accounts[0]?.id ?? SKIP;
}

const target = ref<Id>(initialTarget());
// Swap goes on by itself when no row has a payee but some have notes (unless remembered).
const autoSwap = txns.value.every((t) => t.payee === '') && txns.value.some((t) => t.notes !== '');
const importNotes = ref(mapping.value?.importNotes ?? props.previous?.importNotes ?? true);
const swap = ref(mapping.value?.swapPayeeNotes ?? props.previous?.swapPayeeNotes ?? autoSwap);
const includeEarly = ref(props.previous?.includeBeforeStart ?? false);

const fileDates = props.parsed.format !== 'ofx';
const orders = computed(() => (fileDates ? validOrders(txns.value.map((t) => t.rawDate)) : []));
const order = ref<DateOrder | null>(
  fileDates ? defaultOrder(orders.value, props.budgetOrder, mapping.value?.dateOrder) : null,
);
const unreadable = computed(() => fileDates && order.value === null);

const ORDER_KEYS: Record<DateOrder, string> = {
  MDY: 'app.impOrderMDY',
  DMY: 'app.impOrderDMY',
  YMD: 'app.impOrderYMD',
};

const start = computed(() =>
  target.value === SKIP ? null : (props.parsed.startDates[target.value] ?? null),
);
const dated = computed(() =>
  txns.value.flatMap((t) => {
    const date = dateOf(t, order.value);
    return date ? [{ t, date }] : [];
  }),
);
const early = computed(() => {
  const s = start.value;
  return s === null ? [] : dated.value.filter((d) => d.date < s);
});
const included = computed(() =>
  includeEarly.value || start.value === null
    ? dated.value
    : dated.value.filter((d) => d.date >= (start.value ?? '')),
);

const prompt = computed(() =>
  t('app.impPrompt', {
    n: included.value.length,
    account: escapeRichText(account.value ? bankAccountLabel(account.value) : ''),
  }),
);

const rows = computed(() =>
  included.value.map(({ t, date }, i) => ({
    key: i,
    date: dateShort(date, format.value.dateFormat),
    check: t.checkNumber ?? '',
    payee: swap.value ? t.notes : t.payee,
    notes: swap.value ? t.payee : importNotes.value ? t.notes : '',
    amount: t.amount,
  })),
);

function done(): void {
  if (unreadable.value && target.value !== SKIP) return;
  emit('close', {
    index: props.index,
    accountId: target.value === SKIP ? null : target.value,
    importNotes: importNotes.value,
    swapPayeeNotes: swap.value,
    dateOrder: order.value,
    includeBeforeStart: includeEarly.value,
  });
}
</script>

<template>
  <StandardDialog
    :title="t('app.impTitle')"
    width="lg"
    @cancel="emit('close', null)"
    @submit="done"
  >
    <div class="map">
      <p class="map__prompt"><RichText :text="prompt" /></p>
      <select v-model="target" class="input map__target" :aria-label="t('app.impTitle')">
        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        <option :value="SKIP">{{ t('app.impSkipAccount') }}</option>
      </select>
      <Transition name="map-warn">
        <div v-if="early.length > 0" class="map__warning" role="status">
          <p class="map__warning-text">{{ t('app.impStartWarning') }}</p>
          <label class="map__check">
            <input v-model="includeEarly" type="checkbox" />
            {{ t('app.impIncludeEarly', { n: early.length }) }}
          </label>
        </div>
      </Transition>
      <h3 class="map__heading">{{ t('app.impPreview') }}</h3>
      <p v-if="unreadable" class="map__error" role="alert">{{ t('app.impDatesUnreadable') }}</p>
      <div v-else class="map__preview" role="table" :aria-label="t('app.impPreview')">
        <div class="map__row map__row--head" role="row">
          <span role="columnheader">{{ t('register.columnDate') }}</span>
          <span role="columnheader">{{ t('register.columnCheckNumber') }}</span>
          <span role="columnheader">{{ t('register.columnPayee') }}</span>
          <span role="columnheader">{{ t('register.columnNotes') }}</span>
          <span role="columnheader" class="map__money">{{ t('app.impAmount') }}</span>
        </div>
        <div v-for="r in rows" :key="r.key" class="map__row" role="row">
          <span role="cell">{{ r.date }}</span>
          <span role="cell">{{ r.check }}</span>
          <span role="cell" class="map__text">{{ r.payee }}</span>
          <span role="cell" class="map__text">{{ r.notes }}</span>
          <span role="cell" class="map__money"
            ><MoneyAmount :value="r.amount" :settings="format.money"
          /></span>
        </div>
      </div>
      <div class="map__options">
        <label v-if="orders.length > 1" class="map__check" :for="`${id}-order`">
          {{ t('app.impDateFormat') }}
          <select :id="`${id}-order`" v-model="order" class="input">
            <option v-for="o in orders" :key="o" :value="o">{{ t(ORDER_KEYS[o]) }}</option>
          </select>
        </label>
        <span class="map__notes">
          {{ t('app.impNotes') }}
          <label v-tooltip="t('app.impNotesImportTooltip')" class="map__check">
            <input v-model="importNotes" type="checkbox" :disabled="swap" />
            {{ t('app.impNotesImport') }}
          </label>
          <label v-tooltip="t('app.impNotesSwapTooltip')" class="map__check">
            <input v-model="swap" type="checkbox" />
            {{ t('app.impNotesSwap') }}
          </label>
        </span>
      </div>
    </div>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="unreadable && target !== SKIP" @click="done">{{
        last ? t('app.impImport') : t('app.impNext')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.map {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.map__prompt,
.map__warning-text,
.map__error {
  margin: 0;
}

.map__target {
  align-self: flex-start;
  min-width: 18rem;
  min-height: var(--control-h);
}

.map__warning {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--needscat-row-border);
  border-radius: var(--radius-sm);
  background: var(--needscat-row-bg);
  white-space: pre-line;
}

.map-warn-enter-active,
.map-warn-leave-active {
  transition:
    opacity 250ms ease-out,
    max-height 250ms ease-out;
  overflow: hidden;
  max-height: 10rem;
}

.map-warn-enter-from,
.map-warn-leave-to {
  max-height: 0;
  opacity: 0;
}

.map__heading {
  margin: 0;
  font-size: var(--font-md);
  font-weight: 600;
}

.map__error {
  color: var(--money-negative-strong);
}

.map__preview {
  max-height: 16rem;
  border: 1px solid var(--register-border);
  overflow-y: auto;
}

.map__row {
  display: grid;
  grid-template-columns: 6rem 5rem minmax(0, 2fr) minmax(0, 2fr) 6rem;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--grid-line-h);
}

.map__row--head {
  position: sticky;
  top: 0;
  background: var(--grid-header-bg);
  color: var(--text-on-blue);
  font-weight: 600;
}

.map__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map__money {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.map__options {
  display: flex;
  gap: var(--space-6);
  align-items: center;
  justify-content: space-between;
}

.map__notes,
.map__check {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

@media (prefers-reduced-motion: reduce) {
  .map-warn-enter-active,
  .map-warn-leave-active {
    transition: none;
  }
}
</style>
