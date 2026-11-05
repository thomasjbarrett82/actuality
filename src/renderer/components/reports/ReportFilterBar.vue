<script setup lang="ts">
// A report page's filter bar (15 §2–3): Categories, Timeframe, Payees and Accounts (Spending Comparison:
// Compare Period for Timeframe; Net Worth: Timeframe and Accounts), each trigger summarizing its selection;
// Use linked filters while the page holds a saved filter; then Saved Filters and Export. The pickers commit
// on Done (report-flow.ts).
import { today as todayOf } from '@shared/dates';
import type { Id } from '@shared/domain/types';
import { NO_PAYEE, UNCATEGORIZED, type ReportPage } from '@shared/reporting/model';
import { Bookmark, FileDown, Link as LinkIcon } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { weekStartsOn } from '../../i18n';
import { useAccounts, useCategories, usePayees } from '../../queries/budget-data';
import {
  comparisonText,
  selectionText,
  timeframeText,
  type SelectionKind,
} from '../../reports/labels';
import {
  pickComparePeriod,
  pickSelection,
  pickTimeframe,
  savedFiltersMenu,
  useLinked,
} from '../../reports/report-flow';
import { pageFilterKeys, useReportsView, type FilterKey } from '../../reports/state';
import type { PickerEntry } from '../../reports/view-types';
import UiMenuButton from '../common/UiMenuButton.vue';

const props = defineProps<{ page: ReportPage; dateFormat: string; canExport: boolean }>();
const emit = defineEmits<{ export: [anchor: HTMLElement] }>();
const { t } = useI18n();
const view = useReportsView();
const accounts = useAccounts();
const categories = useCategories();
const payees = usePayees();

const filters = computed(() => view.filtersOf(props.page));
const shown = computed(() => pageFilterKeys(props.page));
const open = ref<string | null>(null);

const openAccounts = computed(() => (accounts.data.value ?? []).filter((a) => !a.closed));
const accountName = (id: Id): string | null =>
  accounts.data.value?.find((a) => a.id === id)?.name ?? null;

const categoryEntries = computed<PickerEntry[]>(() => [
  ...(categories.data.value ?? [])
    .filter((g) => g.categories.length > 0)
    .map((g) => ({
      id: g.id,
      label: g.name,
      children: g.categories.map((c) => ({ id: c.id, label: c.name })),
    })),
  { id: UNCATEGORIZED, label: t('reports.uncategorized') },
]);

const payeeLabel = (p: { name: string; transferAccountId: Id | null }): string =>
  p.transferAccountId
    ? t('app.transferPayee', { account: accountName(p.transferAccountId) ?? p.name })
    : p.name;
const payeeEntries = computed<PickerEntry[]>(() => [
  ...(payees.data.value ?? [])
    .map((p) => ({ id: p.id, label: payeeLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label)),
  { id: NO_PAYEE, label: t('reports.noPayee') },
]);

const accountEntries = computed<PickerEntry[]>(() => {
  const section = (id: string, label: string, list: typeof openAccounts.value): PickerEntry[] =>
    list.length > 0
      ? [{ id, label, children: list.map((a) => ({ id: a.id, label: a.name })) }]
      : [];
  return [
    ...section(
      'section:on',
      t('reports.budgetAccounts'),
      openAccounts.value.filter((a) => a.onBudget),
    ),
    ...section(
      'section:off',
      t('reports.offBudgetAccounts'),
      openAccounts.value.filter((a) => !a.onBudget),
    ),
  ];
});

function nameOf(kind: SelectionKind, id: Id): string | null {
  if (kind === 'accounts') return accountName(id);
  if (kind === 'payees') {
    if (id === NO_PAYEE) return t('reports.noPayee');
    const p = payees.data.value?.find((x) => x.id === id);
    return p ? payeeLabel(p) : null;
  }
  if (id === UNCATEGORIZED) return t('reports.uncategorized');
  for (const g of categories.data.value ?? []) {
    const c = g.categories.find((x) => x.id === id);
    if (c) return c.name;
  }
  return null;
}

const TITLES: Record<SelectionKind, string> = {
  categories: 'reports.filterCategories',
  payees: 'reports.filterPayees',
  accounts: 'reports.filterAccounts',
};

async function onSelection(kind: SelectionKind, anchor: HTMLElement): Promise<void> {
  open.value = kind;
  const entries =
    kind === 'categories' ? categoryEntries : kind === 'payees' ? payeeEntries : accountEntries;
  await pickSelection(
    props.page,
    kind,
    anchor,
    entries.value,
    t(TITLES[kind]),
    kind === 'accounts' ? openAccounts.value.filter((a) => a.onBudget).map((a) => a.id) : undefined,
  );
  open.value = null;
}

async function onTimeframe(anchor: HTMLElement): Promise<void> {
  open.value = 'timeframe';
  await pickTimeframe(props.page, anchor, todayOf(new Date()));
  open.value = null;
}

async function onComparePeriod(anchor: HTMLElement): Promise<void> {
  open.value = 'comparePeriod';
  await pickComparePeriod(anchor, todayOf(new Date()), props.dateFormat);
  open.value = null;
}

function onOpen(key: FilterKey, anchor: HTMLElement): void {
  if (key === 'timeframe') void onTimeframe(anchor);
  else if (key === 'comparePeriod') void onComparePeriod(anchor);
  else void onSelection(key, anchor);
}

async function onSaved(anchor: HTMLElement): Promise<void> {
  open.value = 'saved';
  await savedFiltersMenu(props.page, anchor);
  open.value = null;
}

const triggerText = (key: FilterKey): string => {
  const f = filters.value;
  if (key === 'timeframe') return timeframeText(f.timeframe, props.dateFormat);
  if (key === 'comparePeriod')
    return comparisonText(
      view.comparison,
      weekStartsOn.value,
      todayOf(new Date()),
      props.dateFormat,
    );
  return selectionText(key, f[key], (id) => nameOf(key, id));
};
const LABELS: Record<FilterKey, string> = {
  categories: 'reports.filterCategories',
  timeframe: 'reports.filterTimeframe',
  comparePeriod: 'reports.filterComparePeriod',
  payees: 'reports.filterPayees',
  accounts: 'reports.filterAccounts',
};
const match = computed(() => view.matching(props.page));
</script>

<template>
  <div class="filters" role="group" :aria-label="t('reports.filtersLabel')">
    <div class="filters__main">
      <UiMenuButton
        v-for="key in shown"
        :key="key"
        class="filters__trigger"
        popup="dialog"
        :expanded="open === key"
        v-bind="{ 'aria-label': `${t(LABELS[key])}: ${triggerText(key)}` }"
        @open="(el) => onOpen(key, el)"
      >
        {{ triggerText(key) }}
      </UiMenuButton>
      <button
        v-if="view.isOverride(page)"
        type="button"
        class="filters__linked"
        @click="useLinked(page)"
      >
        <LinkIcon class="filters__icon" aria-hidden="true" />
        {{ t('reports.useLinked') }}
      </button>
      <span v-if="view.isOverride(page) && match" class="filters__note">
        {{ t('reports.savedApplied', { name: match.name }) }}
      </span>
    </div>
    <div class="filters__side">
      <UiMenuButton popup="dialog" :expanded="open === 'saved'" @open="onSaved">
        <Bookmark class="filters__icon" aria-hidden="true" />
        {{ t('reports.savedFilters') }}
      </UiMenuButton>
      <UiMenuButton :disabled="!canExport" @open="(el) => emit('export', el)">
        <FileDown class="filters__icon" aria-hidden="true" />
        {{ t('reports.export') }}
      </UiMenuButton>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--grid-line-h);
}

.filters__main,
.filters__side {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.filters__trigger {
  max-width: 22rem;
}

.filters__linked {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--link);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.filters__note {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.filters__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
