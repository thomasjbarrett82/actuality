<script setup lang="ts">
// "This budget is encrypted" (03 §7): the end-to-end encryption password for one budget, with "Remember on
// this computer". After a wrong password it says so and asks again.
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePrompts } from '../../stores/prompts';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ name: string; retry: boolean }>();
const { t } = useI18n();
const prompts = usePrompts();

const password = ref('');
const remember = ref(false);
const secureStorage = ref(true);

onMounted(async () => {
  secureStorage.value = await window.app.shell.secrets.available();
});

function submit(): void {
  if (!password.value) return;
  prompts.answerEncryption({ password: password.value, remember: remember.value });
}
</script>

<template>
  <StandardDialog
    :title="t('app.encryptedTitle')"
    width="sm"
    @cancel="prompts.answerEncryption(null)"
    @submit="submit"
  >
    <form class="e2e" novalidate @submit.prevent="submit">
      <p class="e2e__text">{{ t('app.encryptedPrompt', { name: props.name }) }}</p>
      <p v-if="props.retry" id="e2e-error" class="e2e__error" role="alert">
        {{ t('app.encryptedWrongPassword') }}
      </p>
      <div class="e2e__field">
        <label for="e2e-password">{{ t('app.encryptedPassword') }}</label>
        <input
          id="e2e-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="off"
          :aria-invalid="props.retry ? 'true' : undefined"
          :aria-describedby="props.retry ? 'e2e-error' : undefined"
        />
      </div>
      <label class="check" :title="secureStorage ? undefined : t('app.secureStorageUnavailable')">
        <input v-model="remember" type="checkbox" :disabled="!secureStorage" />
        {{ t('app.rememberOnComputer') }}
      </label>
    </form>
    <template #footer>
      <UiButton @click="prompts.answerEncryption(null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="!password" @click="submit">{{
        t('app.encryptedOpen')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.e2e {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.e2e__text,
.e2e__error {
  margin: 0;
}

.e2e__error {
  color: var(--text-danger);
}

.e2e__field {
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
</style>
