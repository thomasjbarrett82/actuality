<script setup lang="ts">
// The search info bar (10 §4): slides open while the register is filtered. "Showing {n} results" + the
// search + the date option, and Clear Search (search text) or Clear Date Filter (date only).
import { dateShort, monthShortYear } from '@shared/format';
import { CircleX } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { quotedSearch } from '../../register/search';
import { useRegister } from '../../register/use-register';
import { ALL_DATES } from '../../register/view-state';

const { t } = useI18n();
const reg = useRegister();

const PRESET_KEYS: Record<string, string> = {
  thisMonth: 'app.regDateThisMonth',
  latest3: 'app.regDateLatest3',
  thisYear: 'app.regDateThisYear',
  lastYear: 'app.regDateLastYear',
};
const dateText = computed(() => {
  const f = reg.dateFilter;
  if (f.preset === 'custom' && f.from && f.to)
    return t('app.regDateCustom', {
      from: monthShortYear(f.from, dateLocale.value),
      through: monthShortYear(f.to, dateLocale.value),
    });
  return t(PRESET_KEYS[f.preset] ?? 'app.regDateAll');
});

const text = computed(() => {
  const n = reg.shown.length;
  const reconcile = reg.reconcile;
  let s = reconcile ? t('app.recShowing', { n }, n) : t('app.regShowing', { n });
  const search = quotedSearch(reg.appliedSearch);
  if (search !== '') s += t('app.regShowingFor', { search });
  if (reconcile)
    s += t('app.recShowingBefore', {
      date: dateShort(reconcile.statementDate, reg.format.dateFormat),
    });
  else if (reg.dateFiltered) s += t('app.regShowingDuring', { date: dateText.value });
  return s;
});

/** Clear Search, Clear Date Filter, or nothing while reconciling with an empty search (10 §4). */
const clearShown = computed(() => !reg.reconciling || reg.searching);

function clear(): void {
  if (reg.searching) reg.searchText = '';
  else void reg.setDateFilter(ALL_DATES);
}
</script>

<template>
  <Transition name="info-bar">
    <div v-if="reg.filtered" class="info-bar" role="status">
      <span class="info-bar__text">{{ text }}</span>
      <button v-if="clearShown" type="button" class="info-bar__clear" @click="clear">
        <CircleX class="info-bar__icon" aria-hidden="true" />
        {{ reg.searching ? t('app.regClearSearch') : t('app.regClearDateFilter') }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--control-h);
  padding: 0 var(--space-3);
  background: var(--app-bg-dark);
  color: var(--text-on-blue);
  overflow: hidden;
}

.info-bar__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-bar__clear {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text-on-blue);
  cursor: pointer;
}

.info-bar__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.info-bar-enter-active,
.info-bar-leave-active {
  transition: max-height 250ms ease;
  max-height: var(--control-h);
}

.info-bar-enter-from,
.info-bar-leave-to {
  max-height: 0;
  min-height: 0;
}
</style>
