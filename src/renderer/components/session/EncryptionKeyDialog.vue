<script setup lang="ts">
// Enable end-to-end encryption, or generate a new key (03 §7, 07 §4): what the sync reset and the
// encryption do and don't cover, then the password with show/hide and "Remember on this computer". The
// host call runs once; a failure is shown here and never retried on its own.
import type { EncryptionKeyResult } from '@shared/rpc/host-api';
import { Eye, EyeOff } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ name: string; replace: boolean }>();
/** `done` carries what secure storage couldn't do (03 §7). */
const emit = defineEmits<{ cancel: []; done: [result: EncryptionKeyResult] }>();
const { t } = useI18n();

const password = ref('');
const visible = ref(false);
const remember = ref(false);
const secureStorage = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  secureStorage.value = await window.app.shell.secrets.available();
});

function cancel(): void {
  if (!busy.value) emit('cancel');
}

async function submit(): Promise<void> {
  if (!password.value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await host.call('budgetFile.setEncryptionKey', {
      password: password.value,
      remember: remember.value,
    });
    emit('done', result);
  } catch (e) {
    const info = errorInfo(e);
    if (info.code === 'offline') error.value = t('app.offlineMessage');
    else if (info.detail === 'internal-handler-unavailable')
      error.value = t('app.encryptionKeyUnavailable');
    else error.value = t('app.encryptionKeyFailed', { message: info.message });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <StandardDialog
    :title="props.replace ? t('app.encryptionKeyNewTitle') : t('app.encryptionKeyEnableTitle')"
    width="md"
    @cancel="cancel"
    @submit="submit"
  >
    <form class="key" novalidate @submit.prevent="submit">
      <p class="key__text">{{ t('app.encryptionKeyIntro', { name: props.name }) }}</p>
      <ul class="key__list">
        <li>{{ t('app.encryptionKeyReset') }}</li>
        <li>{{ t('app.encryptionKeyForgotten') }}</li>
        <li>{{ t('app.encryptionKeyLimits') }}</li>
        <li v-if="props.replace">{{ t('app.encryptionKeyRandomized') }}</li>
      </ul>
      <div class="key__field">
        <label for="key-password">{{ t('app.encryptedPassword') }}</label>
        <div class="key__password">
          <input
            id="key-password"
            v-model="password"
            class="input"
            :type="visible ? 'text' : 'password'"
            autocomplete="new-password"
            spellcheck="false"
            :disabled="busy"
            aria-describedby="key-hint"
          />
          <button
            type="button"
            class="key__toggle"
            :aria-label="visible ? t('app.encryptionKeyHide') : t('app.encryptionKeyShow')"
            :aria-pressed="visible"
            :title="visible ? t('app.encryptionKeyHide') : t('app.encryptionKeyShow')"
            @click="visible = !visible"
          >
            <EyeOff v-if="visible" class="key__icon" aria-hidden="true" />
            <Eye v-else class="key__icon" aria-hidden="true" />
          </button>
        </div>
        <span />
        <p id="key-hint" class="key__hint">{{ t('app.encryptionKeyPasswordHint') }}</p>
      </div>
      <label class="check" :title="secureStorage ? undefined : t('app.secureStorageUnavailable')">
        <input v-model="remember" type="checkbox" :disabled="!secureStorage || busy" />
        {{ t('app.rememberOnComputer') }}
      </label>
      <p v-if="busy" class="key__text" role="status">{{ t('app.encryptionKeyWorking') }}</p>
      <p v-if="error" class="key__error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton :disabled="busy" @click="cancel">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="!password || busy" @click="submit">{{
        props.replace ? t('app.propertiesEncryptionReplace') : t('app.propertiesEncryptionEnable')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.key {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.key__text,
.key__error,
.key__hint {
  margin: 0;
}

.key__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding-left: var(--space-5);
}

.key__error {
  color: var(--text-danger);
}

.key__hint {
  font-size: var(--font-sm);
}

.key__field {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

.key__password {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.key__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.key__icon {
  width: 1rem;
  height: 1rem;
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

.key__password .input {
  flex: 1;
  min-width: 0;
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
</style>
