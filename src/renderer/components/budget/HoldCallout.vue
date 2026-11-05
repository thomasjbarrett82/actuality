<script setup lang="ts">
// Hold for next month… (09 §5.5, X1): the text with what can be held, an amount (the current hold, or
// what is available when there is none), Cancel / Done. Done closes with the amount as JSON.
import type { Money } from '@shared/domain/types';
import type { MoneySettings } from '@shared/money';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyText } from '../../money-display';
import { useCanEdit } from '../../stores/connection';
import MoneyInput from '../common/MoneyInput.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{
  month: string;
  next: string;
  available: Money;
  initial: Money;
  settings: MoneySettings;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const canEdit = useCanEdit();
const amount = ref<Money | null>(props.initial);

function done(): void {
  if (!canEdit.value) return;
  emit('close', JSON.stringify(Math.max(0, amount.value ?? 0)));
}
</script>

<template>
  <form class="hold" novalidate @submit.prevent="done">
    <p class="hold__text">
      {{
        t('app.budHoldText', {
          month,
          next,
          amount: moneyText(available, settings, { symbol: true }),
        })
      }}
    </p>
    <MoneyInput v-model="amount" :label="t('app.budHoldTitle')" :settings="settings" />
    <div class="hold__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <span v-tooltip="canEdit ? null : t('app.editingUnavailableOffline')">
        <UiButton primary type="submit" :disabled="!canEdit">{{
          t('taskDialog.DoneLabel')
        }}</UiButton>
      </span>
    </div>
  </form>
</template>

<style scoped>
.hold {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hold__text {
  margin: 0;
}

.hold__buttons {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
