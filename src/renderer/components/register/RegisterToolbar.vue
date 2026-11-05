<script setup lang="ts">
// The register toolbar (10 §3): on the left Edit Transactions ▾ (the actions menu), Add and Transfer (a new
// transaction, 11 §1) and Import (16 §1); on the right the reconciled filter, the date filter with its
// Timeframe callout, and the search box. Reconciling hides Import and both filters (13 §6.2).
import { monthShortYear } from '@shared/format';
import { ArrowLeftRight, Download, Eye, EyeOff, Plus } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { useRegister } from '../../register/use-register';
import type { DateFilter } from '../../register/view-state';
import { useCallouts } from '../../stores/callouts';
import UiButton from '../common/UiButton.vue';
import UiMenuButton from '../common/UiMenuButton.vue';
import { BELOW_RIGHT } from '../common/callout-placement';
import SearchBox from './SearchBox.vue';
import TimeframeCallout from './TimeframeCallout.vue';

const emit = defineEmits<{ menu: []; import: [] }>();
const { t } = useI18n();
const reg = useRegister();
const callouts = useCallouts();
const search = ref<{ focus(): void } | null>(null);
const dateButton = ref<{ $el: Element } | null>(null);
const dateOpen = ref(false);

const editLabel = computed(() => {
  const n = reg.selection.size;
  if (n === 0) return t('register.editTransactionsDisabled');
  return n === 1
    ? t('register.editTransactionSingular')
    : t('register.editTransactionsPlural', { count: n });
});

const PRESET_KEYS: Record<string, string> = {
  all: 'app.regDateAll',
  thisMonth: 'app.regDateThisMonth',
  latest3: 'app.regDateLatest3',
  thisYear: 'app.regDateThisYear',
  lastYear: 'app.regDateLastYear',
};
const dateLabel = computed(() => {
  const f = reg.dateFilter;
  if (f.preset === 'custom' && f.from && f.to)
    return t('app.regDateCustom', {
      from: monthShortYear(f.from, dateLocale.value),
      through: monthShortYear(f.to, dateLocale.value),
    });
  return t(PRESET_KEYS[f.preset] ?? 'app.regDateAll');
});

async function openDates(): Promise<void> {
  const anchor = dateButton.value?.$el;
  if (!(anchor instanceof HTMLElement)) return;
  dateOpen.value = true;
  const result = await callouts.show(
    TimeframeCallout,
    { current: reg.dateFilter, from: reg.monthRange.from, to: reg.monthRange.to, today: reg.today },
    { anchor, title: t('app.regTimeframe'), placements: BELOW_RIGHT },
  );
  dateOpen.value = false;
  if (result.startsWith('{')) await reg.setDateFilter(JSON.parse(result) as DateFilter);
}

/** Disabled while the register is filtered (10 §3). */
const reconciledDisabled = computed(() => reg.filtered);

/** Offline, Add and Transfer stay focusable with aria-disabled so the tooltip can be read (22 §4.6). */
const offlineTooltip = computed(() => (reg.canEdit ? null : t('app.editingUnavailableOffline')));

defineExpose({ focusSearch: () => search.value?.focus() });
</script>

<template>
  <div class="toolbar">
    <UiMenuButton :disabled="reg.selection.size === 0" @open="emit('menu')">{{
      editLabel
    }}</UiMenuButton>
    <UiButton
      v-tooltip="offlineTooltip"
      class="toolbar__add"
      :unavailable="!reg.canEdit"
      @click="reg.beginNew()"
    >
      <Plus class="toolbar__icon" aria-hidden="true" />
      {{ t('app.regAdd') }}
    </UiButton>
    <UiButton
      v-if="reg.canTransfer"
      v-tooltip="offlineTooltip"
      class="toolbar__transfer"
      :unavailable="!reg.canEdit"
      @click="reg.beginNew({ transfer: true })"
    >
      <ArrowLeftRight class="toolbar__icon" aria-hidden="true" />
      {{ t('app.regTransfer') }}
    </UiButton>
    <UiButton v-if="!reg.reconciling" :disabled="reg.isAll || !reg.canEdit" @click="emit('import')">
      <Download class="toolbar__icon" aria-hidden="true" />
      {{ t('app.regImport') }}
    </UiButton>
    <span class="toolbar__spacer" />
    <div
      v-if="!reg.reconciling"
      role="radiogroup"
      class="toolbar__reconciled"
      :aria-label="t('app.regShowReconciled')"
      :aria-disabled="reconciledDisabled || undefined"
    >
      <button
        v-tooltip="
          reconciledDisabled ? t('app.regReconciledFilterDisabled') : t('app.regShowReconciled')
        "
        type="button"
        role="radio"
        class="toolbar__segment"
        :aria-checked="reg.showReconciled"
        :aria-label="t('app.regShowReconciled')"
        :disabled="reconciledDisabled"
        @click="reg.setShowReconciled(true)"
      >
        <Eye class="toolbar__icon" aria-hidden="true" />
      </button>
      <button
        v-tooltip="
          reconciledDisabled ? t('app.regReconciledFilterDisabled') : t('app.regHideReconciled')
        "
        type="button"
        role="radio"
        class="toolbar__segment"
        :aria-checked="!reg.showReconciled"
        :aria-label="t('app.regHideReconciled')"
        :disabled="reconciledDisabled"
        @click="reg.setShowReconciled(false)"
      >
        <EyeOff class="toolbar__icon" aria-hidden="true" />
      </button>
    </div>
    <UiMenuButton
      v-if="!reg.reconciling"
      ref="dateButton"
      popup="dialog"
      :expanded="dateOpen"
      @open="openDates"
    >
      {{ dateLabel }}
    </UiMenuButton>
    <SearchBox ref="search" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
}

.toolbar > :not(.search) {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Pushes the filter group to the right edge (10 §1). */
.toolbar__spacer {
  flex: 1 0 0;
}

.toolbar__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.toolbar__reconciled {
  display: inline-flex;
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.toolbar__segment {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: max(var(--control-h), var(--hit-min));
  border: 0;
  background: var(--button-bg);
  color: var(--text-muted);
  cursor: pointer;
}

.toolbar__segment[aria-checked='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
}

.toolbar__segment:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
