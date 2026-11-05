<script setup lang="ts">
// About Actuality (18 §1): the app icon, the motto, the version and commit, the Electron, Chromium and Node versions,
// the Actual API version, the connected server and its Actual version, the copyright and the
// non-affiliation lines, View licenses (the bundled third-party license file) and Close.
import { APP_NAME } from '@shared/app';
import type { AppInfo } from '@shared/shell-api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { host } from '../../rpc/host-client';
import { useConnection } from '../../stores/connection';
import AppLogo from '../common/AppLogo.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const connection = useConnection();
const info = ref<AppInfo | null>(null);
const serverVersion = ref<string | null>(null);

onMounted(async () => {
  info.value = await window.app.shell.appInfo();
  if (connection.info.serverUrl && connection.info.state !== 'Disconnected')
    serverVersion.value = await host.call('session.serverVersion', {}).catch(() => null);
});

async function licenses(): Promise<void> {
  await window.app.shell.openLicenses().catch(() => undefined);
}
</script>

<template>
  <StandardDialog
    :title="t('menu.about')"
    @cancel="emit('close', null)"
    @submit="emit('close', null)"
  >
    <div class="about">
      <AppLogo class="about__logo" />
      <div class="about__body">
        <div>
          <p class="about__name">{{ APP_NAME }}</p>
          <p class="about__motto">{{ t('app.aboutMotto') }}</p>
        </div>
        <template v-if="info">
          <p>
            {{
              info.gitSha
                ? t('app.aboutVersion', { version: info.version, sha: info.gitSha })
                : t('app.aboutVersionNoSha', { version: info.version })
            }}
          </p>
          <p>
            {{
              t('app.aboutRuntime', {
                electron: info.electron,
                chromium: info.chromium,
                node: info.node,
              })
            }}
          </p>
          <p>{{ t('app.aboutApi', { version: info.actualApi }) }}</p>
        </template>
        <p>
          <template v-if="connection.info.serverUrl">
            {{
              serverVersion
                ? t('app.aboutServer', { url: connection.info.serverUrl, version: serverVersion })
                : t('app.aboutServerNoVersion', { url: connection.info.serverUrl })
            }}
          </template>
          <template v-else>{{ t('app.notConnected') }}</template>
        </p>
        <p>{{ t('app.aboutCopyright') }}</p>
        <p>{{ t('app.aboutNotAffiliated') }}</p>
        <p v-if="info?.licenses">
          <UiLink @click="licenses">{{ t('app.aboutViewLicenses') }}</UiLink>
        </p>
      </div>
    </div>
    <template #footer>
      <UiButton primary @click="emit('close', null)">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.about {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
}

.about__logo {
  flex: none;
  width: 5rem;
  height: 5rem;
}

.about__body {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.about__body p {
  margin: 0;
}

.about__name {
  color: var(--accent-green);
  font-size: var(--font-xl);
  font-weight: 700;
}

.about__motto {
  color: var(--accent-green);
  font-style: italic;
}
</style>
