<script setup lang="ts">
// Create a New Account (13 §2), as Actual's: name, Off budget, and the balance, which Actual turns into
// the starting balance. The default name is computed once, on open. Create runs the 13 §2 checks, then
// `accounts.create` as one host job, and closes with the new account's id.
import { uniqueName } from '@shared/domain/accounts';
import { currencyPlain } from '@shared/format';
import { parse } from '@shared/money';
import { ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { checkNewName, invalidBalance } from '../../accounts/flows';
import { useMaskedField } from '../../money-display';
import { useAccounts, useBudgetFormat } from '../../queries/budget-data';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import { showUnexpected } from '../../session';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ close: [id: string | null] }>();
const { t } = useI18n();
const id = useId();
const accounts = useAccounts();
const budgetFormat = useBudgetFormat();

const name = ref('');
// Computed once, as soon as the account names are known (13 §2).
watch(
  () => accounts.data.value,
  (list) => {
    if (list && name.value === '')
      name.value = uniqueName(
        t('app.accountDefaultName'),
        list.map((a) => a.name),
      );
  },
  { immediate: true },
);
const offBudget = ref(false);
const balanceText = ref('');
// Privacy mode (06 §7): a typed balance is masked again once the field loses focus.
const balanceField = useMaskedField(balanceText);
const busy = ref(false);

async function create(): Promise<void> {
  if (busy.value) return;
  const list = accounts.data.value ?? (await accounts.refetch()).data ?? [];
  if (!(await checkNewName(name.value, list))) return;
  const raw = balanceText.value.trim();
  // Any sign is accepted as typed: a balance owed is negative (13 §2).
  const balance = raw === '' ? 0 : parse(raw, budgetFormat.value.money);
  if (balance === null) {
    await invalidBalance(raw);
    return;
  }
  busy.value = true;
  try {
    const created = await host.call('accounts.create', {
      name: name.value.trim(),
      onBudget: !offBudget.value,
      balance,
    });
    emit('close', created.id);
  } catch (e) {
    // Another device may have taken the name meanwhile: the same message as the local check.
    if (errorInfo(e).detail?.startsWith('name-')) await checkNewName(name.value, list);
    else await showUnexpected(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <StandardDialog
    :title="t('accounts.createAccountTitle')"
    @cancel="emit('close', null)"
    @submit="create"
  >
    <form class="create" novalidate @submit.prevent="create">
      <label :for="`${id}-name`">{{ t('accounts.accountNameLabel') }}</label>
      <input :id="`${id}-name`" v-model="name" class="input" type="text" autocomplete="off" />

      <label v-tooltip="t('app.accountOffBudgetTooltip')" class="create__check">
        <input v-model="offBudget" type="checkbox" />
        {{ t('accounts.offBudgetCheckbox') }}
      </label>

      <label :for="`${id}-balance`">{{ t('accounts.balanceLabel') }}</label>
      <input
        :id="`${id}-balance`"
        :value="balanceField.shown.value"
        class="input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :placeholder="currencyPlain(0, budgetFormat.money)"
        @input="balanceField.onInput"
        @pointerdown="balanceField.onPointerdown"
        @keydown="balanceField.onKeydown"
        @blur="balanceField.onBlur"
      />
    </form>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="busy" @click="create">{{
        t('accounts.createAccount')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.create {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-4) var(--space-5);
  align-items: center;
}

.create__check {
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
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
