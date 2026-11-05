<script setup lang="ts">
// The Connect screen (07 §2): server address, then the server's sign-in method: a password, an
// OpenID browser sign-in, or "unsupported". Problems show inline, with the diagnosis action (03 §9.1).
import { ACTUAL_HTTPS_DOCS_URL, ACTUAL_INSTALL_URL } from '@shared/app';
import type { LoginProbe } from '@shared/rpc/host-api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { trustCertificate } from '../../certificates';
import UiButton from '../../components/common/UiButton.vue';
import UiLink from '../../components/common/UiLink.vue';
import { errorInfo, unreachableMessage, type DiagnosisAction } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import { connectWithOpenId, connectWithPassword, showUnexpected } from '../../session';
import { useStart } from '../../stores/start';

const { t } = useI18n();
const start = useStart();

const address = ref(start.connectAddress);
const password = ref('');
const staySignedIn = ref(true);
const secureStorage = ref(true);
const method = ref<LoginProbe | null>(null);
const probedFor = ref('');
const busy = ref(false);
const waitingForBrowser = ref(false);
const error = ref<{ text: string; action: DiagnosisAction } | null>(null);

onMounted(async () => {
  secureStorage.value = await window.app.shell.secrets.available();
  staySignedIn.value = secureStorage.value;
  if (address.value) void probe();
});

/** Trimmed, with no trailing slash (07 §2). Null and an inline error when it isn't a usable address. */
function normalized(): string | null {
  const url = address.value.trim().replace(/\/+$/, '');
  if (!url) {
    error.value = { text: t('app.connectAddressEmpty'), action: null };
    return null;
  }
  if (!/^https?:\/\/[^/\s]+/i.test(url)) {
    error.value = { text: t('app.connectAddressScheme'), action: null };
    return null;
  }
  return url;
}

function showConnectError(url: string, e: unknown): void {
  const info = errorInfo(e);
  if (info.detail === 'invalid-password') {
    error.value = { text: t('app.passwordIncorrect'), action: null };
  } else if (info.code === 'offline') {
    const m = unreachableMessage(url, info);
    error.value = { text: t(m.key, m.params), action: m.action };
  } else if (info.detail === 'openid-timeout') {
    error.value = { text: t('app.openIdTimeout'), action: null };
  } else if (info.detail !== 'openid-cancelled') {
    void showUnexpected(e);
  }
}

/** Leaving the address field, or Connect with an empty password, asks the server how to sign in. */
async function probe(): Promise<void> {
  error.value = null;
  const url = normalized();
  if (!url || url === probedFor.value) return;
  try {
    method.value = await host.call('session.probeLogin', { serverURL: url });
    probedFor.value = url;
  } catch (e) {
    method.value = null;
    probedFor.value = '';
    showConnectError(url, e);
  }
}

async function connect(): Promise<void> {
  error.value = null;
  const url = normalized();
  if (!url) return;
  if (
    !method.value ||
    probedFor.value !== url ||
    (method.value.method === 'password' && !password.value)
  ) {
    await probe();
    if (!method.value || (method.value.method === 'password' && !password.value)) return;
  }
  busy.value = true;
  try {
    if (method.value.method === 'openid') {
      waitingForBrowser.value = true;
      await connectWithOpenId(url, staySignedIn.value);
    } else {
      await connectWithPassword(url, password.value, staySignedIn.value);
    }
  } catch (e) {
    showConnectError(url, e);
  } finally {
    busy.value = false;
    waitingForBrowser.value = false;
    password.value = '';
  }
}

function cancelBrowser(): void {
  void host.call('session.cancelOpenId', {});
}

async function runAction(action: DiagnosisAction): Promise<void> {
  if (action === 'learnMore') await window.app.shell.openExternal(ACTUAL_HTTPS_DOCS_URL);
  else if (action === 'trustCertificate') await trustCertificate();
  else if (action === 'useHttps') {
    address.value = address.value.trim().replace(/^http:/i, 'https:');
    probedFor.value = '';
    await connect();
  }
}

const displayName = computed(() => method.value?.displayName ?? '');
const actionLabel = computed(() => {
  switch (error.value?.action) {
    case 'learnMore':
      return t('app.learnMore');
    case 'trustCertificate':
      return t('app.trustCertificateFile');
    case 'useHttps':
      return t('app.useHttps');
    default:
      return '';
  }
});
</script>

<template>
  <section class="connect" aria-labelledby="connect-title">
    <h1 id="connect-title" class="connect__title">{{ t('app.connectTitle') }}</h1>
    <form class="connect__form" novalidate @submit.prevent="connect">
      <label class="field" for="connect-address">{{ t('app.connectServerAddress') }}</label>
      <input
        id="connect-address"
        v-model="address"
        class="input"
        type="url"
        autocomplete="url"
        spellcheck="false"
        placeholder="https://budget.example.com"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? 'connect-error' : undefined"
        :disabled="waitingForBrowser"
        @blur="probe"
        @input="probedFor === address.trim().replace(/\/+$/, '') || (method = null)"
      />

      <template v-if="method?.method === 'openid'">
        <span />
        <p class="connect__text">{{ t('app.openIdServerText', { displayName }) }}</p>
      </template>
      <template v-else-if="method?.method === 'unsupported'">
        <span />
        <p class="connect__text">{{ t('app.unsupportedSignIn') }}</p>
      </template>
      <template v-else>
        <label class="field" for="connect-password">{{ t('app.connectPassword') }}</label>
        <input
          id="connect-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
      </template>

      <span />
      <label class="check" :title="secureStorage ? undefined : t('app.secureStorageUnavailable')">
        <input
          v-model="staySignedIn"
          type="checkbox"
          :disabled="!secureStorage || waitingForBrowser"
        />
        {{ t('app.staySignedIn') }}
      </label>

      <p v-if="error" id="connect-error" class="connect__error" role="alert">
        {{ error.text }}
        <UiButton v-if="error.action" class="connect__action" @click="runAction(error.action)">
          {{ actionLabel }}
        </UiButton>
      </p>

      <div v-if="waitingForBrowser" class="connect__waiting" role="status">
        <p>{{ t('app.openIdWaiting', { displayName }) }}</p>
        <p class="connect__hint">{{ t('app.openIdCertificateHint') }}</p>
        <UiButton @click="cancelBrowser">{{ t('taskDialog.CancelLabel') }}</UiButton>
      </div>
      <div v-else class="connect__buttons">
        <UiButton type="submit" primary :disabled="busy || method?.method === 'unsupported'">
          {{
            method?.method === 'openid'
              ? t('app.openIdSignInWith', { displayName })
              : t('app.connectButton')
          }}
        </UiButton>
      </div>
    </form>
    <UiLink class="connect__help" :href="ACTUAL_INSTALL_URL">{{ t('app.connectNoServer') }}</UiLink>
  </section>
</template>

<style scoped>
.connect__title {
  margin: 0 0 var(--space-6);
  font-size: var(--font-xl);
  font-weight: 400;
  text-align: center;
}

.connect__form {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-4) var(--space-4);
  align-items: center;
  max-width: 40rem;
  margin: 0 auto;
}

.field {
  font-size: var(--font-md);
}

.input {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-size: var(--font-md);
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.connect__text {
  margin: 0;
}

.connect__error {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.connect__action {
  margin-top: var(--space-3);
}

.connect__waiting {
  grid-column: 1 / -1;
  text-align: center;
}

.connect__hint {
  font-size: var(--font-sm);
}

.connect__buttons {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
}

.connect__help {
  display: flex;
  justify-content: center;
  margin-top: var(--space-7);
  color: var(--text-on-blue);
}
</style>
