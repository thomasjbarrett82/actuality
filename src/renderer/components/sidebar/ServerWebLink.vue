<script setup lang="ts">
// The server web link (08 §2.4): a globe icon button between the privacy toggle and the connection
// indicator that opens the current Actual server in the OS browser. Always enabled, offline too: the
// browser shows whether the server can be reached.
import { Globe } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConnection } from '../../stores/connection';

const { t } = useI18n();
const connection = useConnection();
const url = computed(() => connection.info.serverUrl);
const tooltip = computed(() => t('app.sidebarServerWeb', { url: url.value ?? '' }));
const label = computed(() => t('a11y.serverWeb', { url: url.value ?? '' }));

function open(): void {
  if (url.value) void window.app.shell.openExternal(url.value);
}
</script>

<template>
  <button
    v-if="url"
    v-tooltip="tooltip"
    type="button"
    class="server-web"
    :aria-label="label"
    @click="open"
  >
    <Globe class="server-web__icon" aria-hidden="true" />
  </button>
</template>

<style scoped>
.server-web {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-on-blue);
  cursor: pointer;
}

.server-web:hover {
  background: color-mix(in srgb, var(--text-on-blue) 15%, transparent);
}

.server-web__icon {
  width: var(--icon);
  height: var(--icon);
}
</style>
