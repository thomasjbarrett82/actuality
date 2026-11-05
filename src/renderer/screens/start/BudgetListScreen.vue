<script setup lang="ts">
// The Budget List (07 §3): up to five recent budgets still on the server (the first one large), or the
// two large "open / create" buttons; the server footer; Go Back when opened from the menu with a budget
// open. With the server unreachable it shows only "Can't reach…" with Retry and Change server (03 §6.2).
import { recentDate } from '@shared/format';
import type { BudgetListEntry } from '@shared/rpc/host-api';
import { useQuery } from '@tanstack/vue-query';
import { ArrowLeft, Cloud, FolderOpen, Lock, Plus } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../components/common/UiButton.vue';
import UiLink from '../../components/common/UiLink.vue';
import { dateLocale } from '../../i18n';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import {
  changeServer,
  goBackToBudget,
  openBudget,
  showStartScreen,
  showUnexpected,
  signOut,
} from '../../session';
import { useConnection } from '../../stores/connection';
import { useSettings } from '../../stores/settings';
import { useStart } from '../../stores/start';

const MAX_RECENT = 5;
const { t } = useI18n();
const connection = useConnection();
const settings = useSettings();
const start = useStart();

const signedIn = computed(() => ['SignedIn', 'Online', 'Syncing'].includes(connection.info.state));
const list = useQuery({
  queryKey: ['budgetList'],
  queryFn: () => host.call('session.listBudgets', {}),
  refetchOnMount: 'always',
  enabled: signedIn,
  retry: false,
});
watch(signedIn, (now) => {
  if (now) void list.refetch();
});

const serverUrl = computed(() => connection.info.serverUrl ?? '');
const unreachable = computed(
  () =>
    connection.info.state === 'Disconnected' ||
    (list.isError.value && errorInfo(list.error.value).code === 'offline'),
);
const openId = computed(() => connection.info.budget?.cloudFileId);

interface RecentEntry {
  budget: BudgetListEntry;
  lastOpenedAt: number;
}

/** This device's recent budgets that the server still lists, newest first, the open one left out. */
const recent = computed((): RecentEntry[] => {
  const byId = new Map((list.data.value ?? []).map((b) => [b.cloudFileId, b]));
  return settings.app.recentBudgets
    .flatMap((r) => {
      const budget = byId.get(r.cloudFileId);
      return budget && r.cloudFileId !== openId.value
        ? [{ budget, lastOpenedAt: r.lastOpenedAt }]
        : [];
    })
    .slice(0, MAX_RECENT);
});

function when(at: number): string {
  const parts = recentDate(
    new Date(at),
    new Date(),
    settings.app.lastPickedDateFormat ?? 'MM/dd/yyyy',
    dateLocale.value,
  );
  if (parts.kind === 'date') return parts.date;
  return t(parts.kind === 'today' ? 'app.recentToday' : 'app.recentYesterday', {
    time: parts.time,
  });
}

function tooltip(entry: RecentEntry): string {
  const lines = t('app.budgetTooltip', {
    name: entry.budget.name,
    date: when(entry.lastOpenedAt),
    url: serverUrl.value,
  });
  return entry.budget.encrypted ? `${lines}\n${t('app.budgetTooltipEncrypted')}` : lines;
}

function open(budget: BudgetListEntry): void {
  void openBudget({ cloudFileId: budget.cloudFileId, name: budget.name });
}

const retrying = ref(false);
async function retry(): Promise<void> {
  retrying.value = true;
  try {
    await host.call('session.connect', { serverURL: serverUrl.value, remember: false });
    await list.refetch();
  } catch (e) {
    if (errorInfo(e).code !== 'offline' && errorInfo(e).code !== 'auth') await showUnexpected(e);
  } finally {
    retrying.value = false;
  }
}

function openAnother(): void {
  showStartScreen('open');
}

function createNew(): void {
  showStartScreen('setup');
}
</script>

<template>
  <section class="list">
    <button
      v-if="start.canGoBack && connection.info.budget"
      v-tooltip="t('app.goBack')"
      type="button"
      class="list__back"
      :aria-label="t('app.goBack')"
      @click="goBackToBudget"
    >
      <ArrowLeft class="list__back-icon" aria-hidden="true" />
    </button>

    <template v-if="unreachable">
      <p class="list__unreachable" role="status">
        {{ t('app.cantReachServerList', { url: serverUrl }) }}
      </p>
      <div class="list__row">
        <UiButton :disabled="retrying" @click="retry">{{ t('app.retry') }}</UiButton>
        <UiButton @click="changeServer">{{ t('app.changeServer') }}</UiButton>
      </div>
    </template>

    <template v-else>
      <ul v-if="recent.length > 0" class="list__recent">
        <li v-for="(entry, i) in recent" :key="entry.budget.cloudFileId">
          <button
            v-tooltip="tooltip(entry)"
            type="button"
            class="budget"
            :class="{ 'budget--large': i === 0 }"
            @click="open(entry.budget)"
          >
            <component
              :is="entry.budget.encrypted ? Lock : Cloud"
              class="budget__icon"
              aria-hidden="true"
            />
            <span class="budget__name">
              {{ entry.budget.name }}
              <span v-if="entry.budget.shared" v-tooltip="t('app.sharedTooltip')" class="tag">{{
                t('app.sharedTag')
              }}</span>
              <span v-if="entry.budget.offlineCopy" class="budget__offline" aria-hidden="true" />
            </span>
            <span class="budget__date">
              {{
                i === 0
                  ? t('app.recentLastOpened', { date: when(entry.lastOpenedAt) })
                  : when(entry.lastOpenedAt)
              }}
            </span>
          </button>
        </li>
      </ul>
      <div v-if="recent.length > 0" class="list__row">
        <UiButton @click="openAnother">{{ t('app.openAnotherBudget') }}</UiButton>
        <UiButton @click="createNew">{{ t('app.createNewBudget') }}</UiButton>
      </div>
      <div v-else class="list__stack">
        <button type="button" class="budget budget--large" @click="openAnother">
          <FolderOpen class="budget__icon" aria-hidden="true" />
          <span class="budget__name">{{ t('app.openExistingBudget') }}</span>
          <span class="budget__date">{{ t('app.openExistingBudgetHint') }}</span>
        </button>
        <button type="button" class="budget budget--large" @click="createNew">
          <Plus class="budget__icon" aria-hidden="true" />
          <span class="budget__name">{{ t('app.createBrandNewBudget') }}</span>
          <span class="budget__date">{{ t('app.createBrandNewBudgetHint') }}</span>
        </button>
      </div>
    </template>

    <footer class="list__footer">
      <span>{{
        serverUrl ? t('app.connectedTo', { url: serverUrl }) : t('app.notConnected')
      }}</span>
      <template v-if="serverUrl">
        <span aria-hidden="true">·</span>
        <UiLink class="list__link" @click="signOut">{{ t('app.signOut') }}</UiLink>
        <span aria-hidden="true">·</span>
        <UiLink class="list__link" @click="changeServer">{{ t('app.changeServer') }}</UiLink>
      </template>
    </footer>
  </section>
</template>

<style scoped>
.list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  align-items: center;
}

.list__back {
  position: fixed;
  top: 50%;
  left: var(--space-5);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--app-bg-dark) 30%, transparent);
  color: var(--text-on-blue);
  cursor: pointer;
}

.list__back-icon {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.list__recent,
.list__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(36rem, 100%);
  margin: 0;
  padding: 0;
  list-style: none;
}

.budget {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  width: 100%;
  min-height: var(--control-h);
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--app-bg-dark) 30%, transparent);
  color: var(--text-on-blue);
  font-size: var(--font-md);
  text-align: left;
  cursor: pointer;
}

.budget:hover {
  background: color-mix(in srgb, var(--app-bg-dark) 40%, transparent);
}

.budget:active {
  background: color-mix(in srgb, var(--app-bg-dark) 50%, transparent);
}

.budget__date {
  font-size: var(--font-sm);
}

.budget--large {
  grid-template-columns: auto 1fr;
  min-height: var(--control-h-lg);
  font-size: var(--font-xl);
}

.budget--large .budget__date {
  grid-column: 2;
  font-size: var(--font-body);
}

.budget__icon {
  width: var(--icon);
  height: var(--icon);
}

.budget--large .budget__icon {
  grid-row: span 2;
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.budget__name {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
  font-weight: 600;
}

.budget__offline {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--text-on-blue);
}

.tag {
  padding: 0 var(--space-2);
  border: 1px solid currentcolor;
  border-radius: var(--radius-pill);
  font-size: var(--font-xs);
  font-weight: 400;
}

.list__row {
  display: flex;
  gap: var(--space-3);
  justify-content: center;
}

.list__unreachable {
  margin: 0;
  font-size: var(--font-lg);
  text-align: center;
}

.list__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: center;
  margin-top: var(--space-6);
  font-size: var(--font-sm);
}

.list__link {
  color: var(--text-on-blue);
}
</style>
