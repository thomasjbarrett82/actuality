<script setup lang="ts">
// The reconciliation footer (13 §6.2): the last reconciled balance, the transactions cleared above, the
// cleared balance as of the statement date, the statement balance and the difference, a message, and
// Finish Reconciliation / Adjust Statement / Stop Reconciling.
import { dateShort } from '@shared/format';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRegister } from '../../register/use-register';
import MoneyAmount from '../common/MoneyAmount.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ finish: []; adjust: []; stop: [] }>();
const { t } = useI18n();
const reg = useRegister();
const date = (d: string): string => dateShort(d as never, reg.format.dateFormat);

const totals = computed(() => reg.reconcileTotals);
const statement = computed(() => reg.reconcile?.statementDate ?? reg.today);
const last = computed(() => reg.account?.lastReconciledDate ?? null);
const balanced = computed(() => totals.value.difference === 0);
</script>

<template>
  <div class="rec-footer" role="region" :aria-label="t('a11y.regionReconcile')">
    <dl class="rec-footer__table">
      <dt>
        {{ last ? t('app.recLastCleared', { date: date(last) }) : t('app.recNeverReconciled') }}
      </dt>
      <dd><MoneyAmount :value="totals.reconciled" :settings="reg.format.money" symbol /></dd>
      <dt>{{ t('app.recClearedAbove') }}</dt>
      <dd class="rec-footer__boxed">
        <MoneyAmount :value="totals.clearedAbove" :settings="reg.format.money" symbol />
      </dd>
      <dt class="rec-footer__rule">{{ t('app.recClearedAsOf', { date: date(statement) }) }}</dt>
      <dd class="rec-footer__rule">
        <MoneyAmount :value="totals.clearedAsOf" :settings="reg.format.money" symbol />
      </dd>
      <dt>{{ t('app.recStatementAsOf', { date: date(statement) }) }}</dt>
      <dd class="rec-footer__boxed">
        <MoneyAmount :value="reg.reconcile?.target ?? 0" :settings="reg.format.money" symbol />
      </dd>
      <dt>{{ t('app.recDifference') }}</dt>
      <dd :class="{ 'is-off': !balanced }">
        <MoneyAmount :value="totals.difference" :settings="reg.format.money" symbol />
      </dd>
    </dl>
    <p class="rec-footer__message" role="status" :class="{ 'is-done': balanced }">
      {{ balanced ? t('app.recGreatJob') : t('app.recClearMessage') }}
    </p>
    <div class="rec-footer__buttons">
      <UiButton primary :disabled="!reg.canEdit" @click="emit('finish')">{{
        t('app.recFinish')
      }}</UiButton>
      <UiButton @click="emit('adjust')">{{ t('app.recAdjust') }}</UiButton>
      <UiButton @click="emit('stop')">{{ t('app.recStop') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.rec-footer {
  display: flex;
  gap: var(--space-6);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
}

.rec-footer__table {
  display: grid;
  grid-template-columns: max-content max-content;
  gap: var(--space-1) var(--space-4);
  margin: 0;
}

.rec-footer__table dt {
  color: var(--text-subtle);
}

.rec-footer__table dd {
  margin: 0;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: right;
}

.rec-footer__boxed {
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
}

.rec-footer__rule {
  padding-top: var(--space-1);
  border-top: 1px solid var(--register-border);
}

.rec-footer__table dd.is-off {
  color: var(--money-negative-strong);
}

.rec-footer__message {
  margin: 0;
  color: var(--text);
  font-size: var(--font-md);
  text-align: center;
  white-space: pre-line;
}

.rec-footer__message.is-done {
  color: var(--change-good);
  font-weight: 600;
}

.rec-footer__buttons {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
