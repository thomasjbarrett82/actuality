<script setup lang="ts">
// The register footer (10 §7): the Scheduled Transactions toggle with its count, the summary box (Cleared
// Balance + Uncleared Transactions = Working Balance, with Selected Total and Search Total taking the first
// two panels' place) and Reconcile Account. The boxes are buttons (22 §2.3).
import { Clock, Scale } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { programmatic } from '../../register/search';
import { useRegister } from '../../register/use-register';
import MoneyAmount from '../common/MoneyAmount.vue';

const props = defineProps<{ schedulerShown: boolean; scheduledCount: number }>();
const emit = defineEmits<{ toggleScheduler: []; reconcile: [anchor: HTMLElement] }>();
const { t } = useI18n();
const reg = useRegister();
const schedulerTip = computed(() =>
  props.schedulerShown ? t('app.regHideScheduled') : t('app.regShowScheduled'),
);

/** 2+ selected rows take the first panel; a search takes the second (10 §7.2). */
const selecting = computed(() => reg.selection.size >= 2);
const searching = computed(() => reg.searching);
const defaults = computed(() => !selecting.value && !searching.value);

function showCleared(): void {
  reg.searchText = programmatic.is(reg.words, 'clearedOrReconciled');
}
function showUncleared(): void {
  reg.searchText = programmatic.is(reg.words, 'uncleared');
}
</script>

<template>
  <div class="footer" role="region" :aria-label="t('a11y.regionSummary')">
    <button
      v-tooltip="schedulerTip"
      type="button"
      class="footer__big"
      :aria-pressed="schedulerShown"
      @click="emit('toggleScheduler')"
    >
      <Clock class="footer__icon" aria-hidden="true" />
      <span class="footer__lines">{{ t('app.regScheduledButton') }}</span>
      <span v-if="scheduledCount > 0" class="footer__badge">{{ scheduledCount }}</span>
    </button>
    <div class="footer__summary" :class="{ 'is-dividers': !defaults }">
      <button
        v-if="selecting"
        v-tooltip="t('app.regSelectedTotalTooltip')"
        type="button"
        class="footer__panel"
      >
        <span class="footer__label">{{
          t('app.regSelectedTotal', { n: reg.selection.size })
        }}</span>
        <span class="footer__amount" :class="{ 'is-negative': reg.selectedTotal < 0 }"
          ><MoneyAmount :value="reg.selectedTotal" :settings="reg.format.money" symbol
        /></span>
      </button>
      <button
        v-else-if="searching"
        type="button"
        class="footer__panel"
        tabindex="-1"
        aria-hidden="true"
      />
      <button
        v-else
        v-tooltip="t('app.regClearedBalanceTooltip')"
        type="button"
        class="footer__panel"
        @click="showCleared"
      >
        <span class="footer__label">{{ t('app.regClearedBalance') }}</span>
        <span class="footer__amount" :class="{ 'is-negative': reg.balancesTotal.cleared < 0 }"
          ><MoneyAmount :value="reg.balancesTotal.cleared" :settings="reg.format.money" symbol
        /></span>
      </button>
      <span class="footer__op" aria-hidden="true"><template v-if="defaults">+</template></span>
      <button
        v-if="searching"
        v-tooltip="t('app.regSearchTotalTooltip')"
        type="button"
        class="footer__panel footer__panel--wide"
      >
        <span class="footer__label">{{
          t('app.regSearchTotal', { n: reg.searchTotal.count })
        }}</span>
        <span class="footer__amount" :class="{ 'is-negative': reg.searchTotal.total < 0 }"
          ><MoneyAmount :value="reg.searchTotal.total" :settings="reg.format.money" symbol
        /></span>
      </button>
      <button
        v-else-if="selecting"
        type="button"
        class="footer__panel footer__panel--wide"
        tabindex="-1"
        aria-hidden="true"
      />
      <button
        v-else
        v-tooltip="t('app.regUnclearedTooltip')"
        type="button"
        class="footer__panel footer__panel--wide"
        @click="showUncleared"
      >
        <span class="footer__label">{{ t('app.regUnclearedTransactions') }}</span>
        <span class="footer__amount" :class="{ 'is-negative': reg.balancesTotal.uncleared < 0 }"
          ><MoneyAmount :value="reg.balancesTotal.uncleared" :settings="reg.format.money" symbol
        /></span>
      </button>
      <span class="footer__op" aria-hidden="true"><template v-if="defaults">=</template></span>
      <button v-tooltip="t('app.regWorkingBalanceTooltip')" type="button" class="footer__panel">
        <span class="footer__label">{{ t('app.regWorkingBalance') }}</span>
        <span class="footer__amount" :class="{ 'is-negative': reg.balancesTotal.working < 0 }"
          ><MoneyAmount :value="reg.balancesTotal.working" :settings="reg.format.money" symbol
        /></span>
      </button>
    </div>
    <button
      v-tooltip="reg.isAll ? t('app.regReconcileAllTooltip') : undefined"
      type="button"
      class="footer__big"
      :disabled="reg.isAll || !reg.canEdit"
      @click="emit('reconcile', $event.currentTarget as HTMLElement)"
    >
      <Scale class="footer__icon" aria-hidden="true" />
      <span class="footer__lines">{{ t('app.regReconcileButton') }}</span>
    </button>
  </div>
</template>

<style scoped>
.footer {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
}

.footer__big {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--control-h-lg);
  padding: 0 var(--space-4);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
}

.footer__big:disabled {
  color: var(--text-disabled);
  cursor: default;
}

.footer__lines {
  white-space: pre-line;
  text-align: left;
}

.footer__badge {
  min-width: 1.4em;
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--accent-blue);
  color: var(--panel-bg);
  font-size: var(--font-sm);
  text-align: center;
}

.footer__icon {
  width: var(--icon);
  height: var(--icon);
}

.footer__summary {
  display: flex;
  gap: var(--space-3);
  align-items: stretch;
}

.footer__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 8rem;
  min-height: var(--control-h-lg);
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  cursor: pointer;
}

.footer__panel--wide {
  min-width: 9.6rem;
}

.footer__label {
  font-size: var(--font-sm);
}

.footer__amount {
  color: var(--text-strong);
  font-size: var(--font-md);
  font-weight: 600;
}

.footer__amount.is-negative {
  color: var(--money-negative-strong);
}

.footer__op {
  align-self: center;
  font-size: var(--font-md);
}

.is-dividers .footer__op {
  align-self: stretch;
  border-left: 1px solid var(--summary-divider);
}
</style>
