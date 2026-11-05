<script setup lang="ts">
// "Sign in to your Actual server" (03 §6.3), over the open budget or the Budget List while AuthRequired.
// The server's sign-in method is probed first (an admin may have switched it, 03 §7 step 6): a Password
// field and Sign in, or Sign in with {displayName} and the browser flow. Cancel follows 03 §4.
import type { LoginProbe } from '@shared/rpc/host-api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorInfo, unreachableMessage } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import {
  cancelSignIn,
  connectWithOpenId,
  connectWithPassword,
  showUnexpected,
} from '../../session';
import { useConnection } from '../../stores/connection';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ signedIn: [] }>();
const { t } = useI18n();
const connection = useConnection();
const url = computed(() => connection.info.serverUrl ?? '');

const method = ref<LoginProbe | null>(null);
const password = ref('');
const secureStorage = ref(true);
const staySignedIn = ref(true);
const busy = ref(false);
const waiting = ref(false);
const error = ref<string | null>(null);

function showError(e: unknown): void {
  const info = errorInfo(e);
  if (info.detail === 'invalid-password') error.value = t('app.passwordIncorrect');
  else if (info.code === 'offline') {
    const m = unreachableMessage(url.value, info);
    error.value = t(m.key, m.params);
  } else if (info.detail === 'openid-timeout') error.value = t('app.openIdTimeout');
  else if (info.detail !== 'openid-cancelled') void showUnexpected(e);
}

onMounted(async () => {
  secureStorage.value = await window.app.shell.secrets.available();
  staySignedIn.value = secureStorage.value;
  try {
    method.value = await host.call('session.probeLogin', { serverURL: url.value });
  } catch (e) {
    method.value = { method: 'password', displayName: '' };
    showError(e);
  }
});

const displayName = computed(() => method.value?.displayName ?? '');

async function submit(): Promise<void> {
  if (busy.value || !method.value || method.value.method === 'unsupported') return;
  if (method.value.method === 'password' && !password.value) return;
  error.value = null;
  busy.value = true;
  try {
    if (method.value.method === 'openid') {
      waiting.value = true;
      await connectWithOpenId(url.value, staySignedIn.value);
    } else {
      await connectWithPassword(url.value, password.value, staySignedIn.value);
    }
    emit('signedIn');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
    waiting.value = false;
    password.value = '';
  }
}

function cancel(): void {
  if (waiting.value) {
    void host.call('session.cancelOpenId', {});
    return;
  }
  void cancelSignIn();
}
</script>

<template>
  <StandardDialog :title="t('app.signInTitle')" width="sm" @cancel="cancel" @submit="submit">
    <form class="sign-in" novalidate @submit.prevent="submit">
      <p v-if="url" class="sign-in__server">{{ t('app.connectedTo', { url }) }}</p>
      <template v-if="method?.method === 'openid'">
        <p class="sign-in__text">{{ t('app.openIdServerText', { displayName }) }}</p>
      </template>
      <p v-else-if="method?.method === 'unsupported'" class="sign-in__text">
        {{ t('app.unsupportedSignIn') }}
      </p>
      <div v-else class="sign-in__field">
        <label for="sign-in-password">{{ t('app.connectPassword') }}</label>
        <input
          id="sign-in-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? 'sign-in-error' : undefined"
        />
      </div>
      <label class="check" :title="secureStorage ? undefined : t('app.secureStorageUnavailable')">
        <input v-model="staySignedIn" type="checkbox" :disabled="!secureStorage || busy" />
        {{ t('app.staySignedIn') }}
      </label>
      <p v-if="error" id="sign-in-error" class="sign-in__error" role="alert">{{ error }}</p>
      <div v-if="waiting" class="sign-in__waiting" role="status">
        <p>{{ t('app.openIdWaiting', { displayName }) }}</p>
        <p class="sign-in__hint">{{ t('app.openIdCertificateHint') }}</p>
      </div>
    </form>
    <template #footer>
      <UiButton @click="cancel">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton
        v-if="!waiting"
        primary
        :disabled="busy || !method || method.method === 'unsupported'"
        @click="submit"
      >
        {{
          method?.method === 'openid'
            ? t('app.openIdSignInWith', { displayName })
            : t('app.signInButton')
        }}
      </UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.sign-in {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.sign-in__server,
.sign-in__text {
  margin: 0;
}

.sign-in__server {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.sign-in__field {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-4);
  align-items: center;
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

.sign-in__error {
  margin: 0;
  color: var(--text-danger);
}

.sign-in__waiting p {
  margin: 0 0 var(--space-3);
}

.sign-in__hint {
  color: var(--text-muted);
  font-size: var(--font-sm);
}
</style>
