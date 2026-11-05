<script setup lang="ts">
// The Open Budget screen (07 §3.2): every budget on the server, sorted by name, with Encrypted and
// "Offline copy" columns and the Shared tag (03 §7.1). Double-click, Enter or Open opens the selected one;
// arrow keys move the selection. Refresh reloads the list.
import type { BudgetListEntry } from '@shared/rpc/host-api';
import { useQuery } from '@tanstack/vue-query';
import { Check, Lock } from 'lucide-vue-next';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../components/common/UiButton.vue';
import UiLink from '../../components/common/UiLink.vue';
import { host } from '../../rpc/host-client';
import { importBudgetFile, leaveStartScreen, openBudget, showUnexpected } from '../../session';
import { useConnection } from '../../stores/connection';

const { t } = useI18n();
const connection = useConnection();

const list = useQuery({
  queryKey: ['budgetList'],
  queryFn: () => host.call('session.listBudgets', {}),
  refetchOnMount: 'always',
  retry: false,
});
watch(
  () => list.error.value,
  (e) => {
    if (e) void showUnexpected(e);
  },
);

const openId = computed(() => connection.info.budget?.cloudFileId);
const budgets = computed(() =>
  (list.data.value ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
);
const selected = ref<string | null>(null);
watch(
  budgets,
  (now) => {
    if (!now.some((b) => b.cloudFileId === selected.value))
      selected.value = now[0]?.cloudFileId ?? null;
  },
  { immediate: true },
);

const rows = ref<HTMLTableRowElement[]>([]);
function select(i: number): void {
  const b = budgets.value[Math.max(0, Math.min(budgets.value.length - 1, i))];
  if (!b) return;
  selected.value = b.cloudFileId;
  void nextTick(() => rows.value[budgets.value.indexOf(b)]?.focus());
}

function open(b: BudgetListEntry | undefined): void {
  if (!b) return;
  if (b.cloudFileId === openId.value) {
    leaveStartScreen();
    return;
  }
  void openBudget({ cloudFileId: b.cloudFileId, name: b.name });
}

function onKey(e: KeyboardEvent, i: number): void {
  if (e.key === 'ArrowDown') select(i + 1);
  else if (e.key === 'ArrowUp') select(i - 1);
  else if (e.key === 'Home') select(0);
  else if (e.key === 'End') select(budgets.value.length - 1);
  else if (e.key === 'Enter') open(budgets.value[i]);
  else return;
  e.preventDefault();
}

const current = computed(() => budgets.value.find((b) => b.cloudFileId === selected.value));
/** The import uploads a new server budget, so it needs the server (07 §3.4). */
const canImport = computed(() => ['SignedIn', 'Online', 'Syncing'].includes(connection.info.state));
</script>

<template>
  <section class="open" aria-labelledby="open-title">
    <h1 id="open-title" class="open__title">{{ t('app.openBudgetTitle') }}</h1>
    <div class="open__panel">
      <table
        class="open__table"
        role="grid"
        aria-readonly="true"
        aria-labelledby="open-title"
        :aria-busy="list.isFetching.value"
      >
        <thead>
          <tr>
            <th scope="col">{{ t('app.openBudgetColumnName') }}</th>
            <th scope="col" class="open__flag">{{ t('app.openBudgetColumnEncrypted') }}</th>
            <th scope="col" class="open__flag">{{ t('app.openBudgetColumnOfflineCopy') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(b, i) in budgets"
            :key="b.cloudFileId"
            ref="rows"
            class="open__row"
            :class="{ 'open__row--selected': b.cloudFileId === selected }"
            :tabindex="b.cloudFileId === selected ? 0 : -1"
            :aria-selected="b.cloudFileId === selected"
            @click="selected = b.cloudFileId"
            @dblclick="open(b)"
            @keydown="onKey($event, i)"
          >
            <td>
              <span class="open__name">
                {{ b.name }}
                <span v-if="b.shared" v-tooltip="t('app.sharedTooltip')" class="tag">{{
                  t('app.sharedTag')
                }}</span>
              </span>
            </td>
            <td class="open__flag">
              <Lock
                v-if="b.encrypted"
                class="open__icon"
                :aria-label="t('app.openBudgetColumnEncrypted')"
              />
            </td>
            <td class="open__flag">
              <Check
                v-if="b.offlineCopy"
                class="open__icon"
                :aria-label="t('app.openBudgetColumnOfflineCopy')"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="list.isSuccess.value && budgets.length === 0" class="open__empty">
        {{ t('app.openBudgetEmpty') }}
      </p>
    </div>
    <div class="open__buttons">
      <UiButton @click="leaveStartScreen">{{ t('app.openBudgetBack') }}</UiButton>
      <UiButton :disabled="list.isFetching.value" @click="list.refetch()">
        {{ t('app.openBudgetRefresh') }}
      </UiButton>
      <UiButton primary :disabled="!current" @click="open(current)">
        {{ t('app.openBudgetOpen') }}
      </UiButton>
    </div>
    <p class="open__import">
      <UiLink class="open__link" :disabled="!canImport" @click="importBudgetFile">{{
        t('app.bfImportLink')
      }}</UiLink>
    </p>
  </section>
</template>

<style scoped>
.open__title {
  margin: 0 0 var(--space-6);
  font-size: var(--font-xl);
  font-weight: 400;
  text-align: center;
}

.open__panel {
  max-height: 55vh;
  overflow-y: auto;
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.open__table {
  width: 100%;
  border-collapse: collapse;
}

.open__table th {
  position: sticky;
  top: 0;
  height: var(--row-h);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--register-border);
  background: var(--register-gray-bg);
  font-weight: 600;
  text-align: left;
}

.open__row td {
  height: var(--row-h-lg);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--register-border);
}

.open__row {
  cursor: pointer;
}

.open__row:hover {
  background: var(--register-gray-bg);
}

.open__row--selected,
.open__row--selected:hover {
  background: var(--app-bg);
  color: var(--text-on-blue);
}

.open__row:focus-visible {
  outline: 2px solid var(--app-bg-dark);
  outline-offset: -2px;
}

.open__flag {
  width: 8rem;
  text-align: center;
}

.open__table th.open__flag {
  text-align: center;
}

.open__name {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--font-md);
}

.open__icon {
  width: var(--icon);
  height: var(--icon);
}

.open__empty {
  margin: 0;
  padding: var(--space-6);
  text-align: center;
}

.tag {
  padding: 0 var(--space-2);
  border: 1px solid currentcolor;
  border-radius: var(--radius-pill);
  font-size: var(--font-xs);
}

.open__buttons {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
  margin-top: var(--space-5);
}

.open__import {
  margin: var(--space-5) 0 0;
  text-align: center;
}

.open__link {
  color: var(--text-on-blue);
}
</style>
