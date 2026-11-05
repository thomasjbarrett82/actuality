<script setup lang="ts">
// The connection indicator (08 §2.4, X6): an icon button with a short label in the expanded sidebar,
// driven by the connection store (03 §4). Each state has its own icon shape, so it never relies on color
// alone. Click: Sync Now, Retry, sign in, or the details, as the state calls for.
import { format } from 'date-fns';
import {
  Cloud,
  CloudAlert,
  CloudOff,
  CloudUpload,
  KeyRound,
  LogIn,
  RefreshCw,
} from 'lucide-vue-next';
import { computed, ref, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { commands } from '../../commands';
import { dateLocale } from '../../i18n';
import { handleErrorState, retryConnection } from '../../session';
import { useConnection } from '../../stores/connection';

defineProps<{ showLabel: boolean }>();
const { t } = useI18n();
const connection = useConnection();
const busy = ref(false);

type Kind = 'online' | 'syncing' | 'offline' | 'signedOut' | 'unsynced' | 'auth' | 'error';

const kind = computed((): Kind => {
  const { state, signedOut, unsyncedChanges } = connection.info;
  if (state === 'Error') return 'error';
  if (state === 'AuthRequired') return 'auth';
  if (unsyncedChanges) return 'unsynced';
  if (connection.hostStatus !== 'running' || state === 'Reconnecting') return 'offline';
  if (state === 'OfflineReadOnly') return signedOut ? 'signedOut' : 'offline';
  if (state === 'Syncing') return 'syncing';
  return 'online';
});

const ICONS: Record<Kind, Component> = {
  online: Cloud,
  syncing: RefreshCw,
  offline: CloudOff,
  signedOut: KeyRound,
  unsynced: CloudUpload,
  auth: LogIn,
  error: CloudAlert,
};

const LABELS: Record<Kind, string> = {
  online: 'app.indicatorConnected',
  syncing: 'app.indicatorSyncing',
  offline: 'app.indicatorOffline',
  signedOut: 'app.indicatorSignedOut',
  unsynced: 'app.indicatorNotSynced',
  auth: 'app.indicatorSignInNeeded',
  error: 'app.indicatorError',
};

const label = computed(() => t(LABELS[kind.value]));

const time = computed(() => {
  const at = connection.info.lastSyncAt;
  return at === null
    ? t('app.neverSynced')
    : format(new Date(at), 'Pp', { locale: dateLocale.value });
});

const tooltip = computed(() => {
  const url = connection.info.serverUrl ?? '';
  switch (kind.value) {
    case 'online':
    case 'syncing':
      return t('app.indicatorOnlineTooltip', { url, time: time.value });
    case 'offline':
      return t('app.indicatorOfflineTooltip', { url, time: time.value });
    case 'signedOut':
      return t('app.indicatorSignedOutTooltip', { url, time: time.value });
    case 'unsynced':
      return t('app.indicatorUnsyncedTooltip');
    case 'auth':
      return t('app.indicatorDetailsTooltip', { message: t('app.signInTitle') });
    case 'error':
      return t('app.indicatorDetailsTooltip', { message: t('app.somethingWentWrong') });
  }
});

async function click(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    if (kind.value === 'error') await handleErrorState(connection.info.message);
    else if (connection.canEdit) await commands.run('file.syncNow');
    else await retryConnection();
  } catch {
    // The state change shows the outcome (banner, indicator).
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    v-tooltip="tooltip"
    type="button"
    class="indicator"
    :class="`indicator--${kind}`"
    :aria-label="showLabel ? undefined : label"
    @click="click"
  >
    <component :is="ICONS[kind]" class="indicator__icon" aria-hidden="true" />
    <span v-if="showLabel" class="indicator__label">{{ label }}</span>
  </button>
</template>

<style scoped>
.indicator {
  --indicator-color: var(--status-online);

  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-on-blue);
  cursor: pointer;
}

.indicator:hover {
  background: color-mix(in srgb, var(--text-on-blue) 15%, transparent);
}

.indicator__icon {
  flex: none;
  width: var(--icon);
  height: var(--icon);
  color: var(--indicator-color);

  /* A hairline --text-on-blue outline keeps every status color visible on blue (08 §2.4). */
  filter: drop-shadow(0 0 0.08rem var(--text-on-blue));
}

.indicator--syncing .indicator__icon {
  animation: indicator-spin 1s linear infinite;
}

.indicator--offline,
.indicator--signedOut {
  --indicator-color: var(--status-offline);
}

.indicator--unsynced {
  --indicator-color: var(--status-unsynced);
}

.indicator--auth,
.indicator--error {
  --indicator-color: var(--status-error);
}

.indicator__label {
  font-size: var(--font-md);
  white-space: nowrap;
}

@keyframes indicator-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
