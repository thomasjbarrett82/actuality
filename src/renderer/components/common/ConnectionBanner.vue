<script setup lang="ts">
// The connection banner (03 §4, 17 §7): only in OfflineReadOnly / Reconnecting / with unsynced changes,
// and while the API host restarts. Never modal, never takes focus; changes are announced (22 §4.5).
import { format } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { useConnection } from '../../stores/connection';

const props = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ retry: []; signIn: [] }>();
const { t } = useI18n();
const connection = useConnection();

const time = computed(() => {
  const at = connection.info.lastSyncAt;
  return at === null
    ? t('app.neverSynced')
    : format(new Date(at), 'Pp', { locale: dateLocale.value });
});

const message = computed((): string | null => {
  const { state, signedOut, unsyncedChanges } = connection.info;
  if (connection.hostStatus === 'restarting' || state === 'Reconnecting')
    return t('app.bannerReconnecting');
  if (state !== 'OfflineReadOnly') return null;
  if (signedOut) return t('app.bannerSignedOut', { time: time.value });
  if (unsyncedChanges) return t('app.bannerUnsynced');
  return t('app.bannerOffline', { time: time.value });
});

const action = computed(() => {
  if (connection.info.state !== 'OfflineReadOnly' || connection.hostStatus !== 'running')
    return null;
  return connection.info.signedOut ? 'signIn' : 'retry';
});
</script>

<template>
  <div v-if="message" class="banner" role="region" :aria-label="t('a11y.regionConnection')">
    <span class="banner__text">{{ message }}</span>
    <button
      v-if="action"
      type="button"
      class="banner__action"
      :disabled="props.busy"
      @click="action === 'signIn' ? emit('signIn') : emit('retry')"
    >
      {{ action === 'signIn' ? t('app.signIn') : t('app.retryNow') }}
    </button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  min-height: var(--bar-h);
  padding: var(--space-2) var(--space-5);
  background: var(--banner-bg);
  border-bottom: 1px solid var(--banner-border);
  color: var(--text);
}

.banner__text {
  flex: 1;
}

.banner__action {
  min-height: max(var(--control-h-sm), var(--hit-min));
  padding: 0 var(--space-4);
  border: 1px solid var(--banner-border);
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  font-weight: 600;
  cursor: pointer;
}
</style>
