<script setup lang="ts">
// The Reconciliation Statement dialog (13 §6.1, --dialog-w-sm): the statement date (default today, or the
// one in progress) and balance, a hint with the cleared balance through that date ("Use this amount."
// fills it in and begins at once). The amount is taken as typed, with its sign: a balance owed is
// negative. Closes with `{ statementDate, target }` or null.
import { APP_HELP_URL } from '@shared/app';
import type { Account, ISODate, Money } from '@shared/domain/types';
import { currencyPlain } from '@shared/format';
import { parse } from '@shared/money';
import { ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { invalidBalance } from '../../accounts/flows';
import { moneyText, useMaskedField } from '../../money-display';
import { useBudgetFormat } from '../../queries/budget-data';
import { host } from '../../rpc/host-client';
import { showUnexpected } from '../../session';
import DateField from '../common/DateField.vue';
import type { DateFieldApi } from '../common/exposed';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{
  account: Account;
  today: ISODate;
  /** The reconciliation in progress: Continue mode. */
  current: { statementDate: ISODate; target: Money } | null;
}>();
const emit = defineEmits<{ close: [result: { statementDate: ISODate; target: Money } | null] }>();
const { t } = useI18n();
const id = useId();
const format = useBudgetFormat();

const date = ref<ISODate>(props.current?.statementDate ?? props.today);
const field = ref<DateFieldApi | null>(null);
const text = ref(props.current ? currencyPlain(props.current.target, format.value.money) : '');
// Privacy mode (06 §7): the statement balance stays masked until the user clicks or types in it.
const { shown, attrs, onInput, onPointerdown, onKeydown, onBlur } = useMaskedField(text);
const cleared = ref<Money | null>(null);

// Only the answer for the current date counts: an earlier date's may arrive after a later one's.
let request = 0;
watch(
  date,
  async (d) => {
    const mine = ++request;
    cleared.value = null;
    try {
      const value = await host.call('reconcile.clearedThrough', {
        accountId: props.account.id,
        date: d,
      });
      if (mine === request) cleared.value = value;
    } catch (e) {
      // The hint stays hidden; say why, once, for the current date.
      if (mine === request) await showUnexpected(e);
    }
  },
  { immediate: true },
);

function finish(target: Money): void {
  emit('close', { statementDate: date.value, target });
}

async function begin(): Promise<void> {
  // The dialog takes Enter before the date field sees it, so the typed date is committed here.
  if (!field.value?.commit()) return;
  const raw = text.value.trim();
  const value = parse(raw, format.value.money);
  if (value === null) {
    await invalidBalance(raw);
    return;
  }
  finish(value);
}

/** Pressing these controls leaves focus in the date field, so their click commits the date, not a blur. */
const keepsFocus = {
  onMousedown: (e: MouseEvent): void => {
    e.preventDefault();
  },
};

/** "Use this amount.": fills in the cleared balance and begins (13 §6.1). */
function useAmount(): void {
  if (cleared.value === null) return;
  // The amount belongs to the committed date: a newly typed date recalculates it first.
  const amountDate = date.value;
  if (!field.value?.commit() || date.value !== amountDate) return;
  text.value = currencyPlain(cleared.value, format.value.money);
  finish(cleared.value);
}
</script>

<template>
  <StandardDialog
    :title="t('app.recTitle')"
    width="sm"
    @cancel="emit('close', null)"
    @submit="begin"
  >
    <form class="rec" novalidate @submit.prevent="begin">
      <p class="rec__text">
        {{ t('app.recIntro') }}
        <UiLink :href="APP_HELP_URL">{{ t('app.recLearnMore') }}</UiLink>
      </p>
      <div class="rec__field">
        <span>{{ t('app.recDateLabel') }}</span>
        <DateField
          ref="field"
          :model-value="date"
          :label="t('app.recDateLabel')"
          :date-format="format.dateFormat"
          :today="today"
          @update:model-value="(d) => d && (date = d)"
        />
      </div>
      <div class="rec__field">
        <label :for="`${id}-balance`">{{ t('app.recBalanceLabel') }}</label>
        <input
          :id="`${id}-balance`"
          :value="shown"
          class="input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          v-bind="attrs"
          @input="onInput"
          @pointerdown="onPointerdown"
          @keydown="onKeydown"
          @blur="onBlur"
        />
      </div>
      <p class="rec__hint">
        <template v-if="cleared !== null">
          {{
            t('app.recClearedHint', { amount: moneyText(cleared, format.money, { symbol: true }) })
          }}
          <UiLink v-bind="keepsFocus" @click="useAmount">{{ t('app.recUseAmount') }}</UiLink>
        </template>
      </p>
    </form>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton v-bind="keepsFocus" primary @click="begin">{{
        current ? t('app.recContinue') : t('app.recBegin')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.rec {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rec__text,
.rec__hint {
  margin: 0;
}

/* Keeps its line while the amount reloads, so a click on the buttons below doesn't miss (13 §6.1). */
.rec__hint {
  min-height: 1lh;
  color: var(--text-subtle);
  font-size: var(--font-sm);
}

.rec__field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 9rem;
  gap: var(--space-4);
  align-items: center;
}

.input {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-size: var(--font-md);
}
</style>
