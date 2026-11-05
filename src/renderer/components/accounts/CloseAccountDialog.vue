<script setup lang="ts">
// Close Account (13 §4), as Actual's: an account without transactions is deleted by the close; one with
// transactions and a zero balance is closed; one with a balance first needs the open account it moves to
// and, moving on-budget money off-budget, the category Actual needs for that transfer. With transactions,
// "Force close" offers the deletion instead. Closes with the choice, or null on Cancel.
import { bySortOrder } from '@shared/domain/accounts';
import type { Account } from '@shared/domain/types';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CloseChoice } from '../../accounts/flows';
import { moneyText } from '../../money-display';
import { useAccounts, useBudgetFormat, useCategories } from '../../queries/budget-data';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{ account: Account }>();
const emit = defineEmits<{ close: [result: CloseChoice | null] }>();
const { t } = useI18n();
const id = useId();
const accounts = useAccounts();
const categories = useCategories();
const budgetFormat = useBudgetFormat();

const hasBalance = computed(() => props.account.balances.working !== 0);

/** Open accounts, on-budget ones first, in sidebar order. */
const targets = computed(() =>
  (accounts.data.value ?? [])
    .filter((a) => !a.closed && a.id !== props.account.id)
    .sort((a, b) => Number(b.onBudget) - Number(a.onBudget) || bySortOrder(a, b)),
);
const groups = computed(() =>
  (categories.data.value ?? [])
    .filter((g) => !g.isIncome && !g.hidden)
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.hidden) }))
    .filter((g) => g.categories.length > 0),
);

const targetId = ref(targets.value[0]?.id ?? '');
const categoryId = ref('');
const target = computed(() => targets.value.find((a) => a.id === targetId.value));
const needsCategory = computed(() => props.account.onBudget && target.value?.onBudget === false);
const ready = computed(
  () =>
    !hasBalance.value ||
    (target.value !== undefined && (!needsCategory.value || categoryId.value !== '')),
);

const message = computed(() => {
  const name = props.account.name;
  if (!props.account.hasTransactions) return t('app.closeNoTransactions', { name });
  if (!hasBalance.value) return t('app.closeKeepsTransactions', { name });
  return t('app.closeBalanceMessage', {
    name,
    balance: moneyText(props.account.balances.working, budgetFormat.value.money, {
      symbol: true,
    }),
  });
});

function submit(): void {
  if (!ready.value) return;
  if (!hasBalance.value) {
    emit('close', { action: 'close' });
    return;
  }
  emit('close', {
    action: 'close',
    transfer: {
      transferAccountId: targetId.value,
      ...(needsCategory.value ? { transferCategoryId: categoryId.value } : {}),
    },
  });
}
</script>

<template>
  <StandardDialog
    :title="t('accounts.closeAccount')"
    @cancel="emit('close', null)"
    @submit="submit"
  >
    <form class="close" novalidate @submit.prevent="submit">
      <p class="close__text">{{ message }}</p>
      <template v-if="hasBalance">
        <label :for="`${id}-account`">{{ t('app.closeTransferAccount') }}</label>
        <select :id="`${id}-account`" v-model="targetId" class="input">
          <option v-for="a in targets" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <template v-if="needsCategory">
          <label :for="`${id}-category`">{{ t('app.closeTransferCategory') }}</label>
          <select :id="`${id}-category`" v-model="categoryId" class="input">
            <option value="" disabled />
            <optgroup v-for="g in groups" :key="g.id" :label="g.name">
              <option v-for="c in g.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </optgroup>
          </select>
        </template>
      </template>
      <p v-if="account.hasTransactions" class="close__force">
        {{ t('app.forceCloseText') }}
        <UiLink danger @click="emit('close', { action: 'forceClose' })">{{
          t('app.forceClose')
        }}</UiLink>
      </p>
    </form>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="!ready" @click="submit">{{
        t('accounts.closeAccount')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.close {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-4);
  align-items: center;
}

.close__text,
.close__force {
  grid-column: 1 / -1;
  margin: 0;
}

.close__force {
  color: var(--text-subtle);
  font-size: var(--font-sm);
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
