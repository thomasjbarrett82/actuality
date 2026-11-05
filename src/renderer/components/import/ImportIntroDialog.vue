<script setup lang="ts">
// The Import Transactions window (16 §1.2): the formats the import reads, "Don't show this again", and
// Choose file to import... (the default). Closes with `{ skipNextTime }`, or null for Cancel.
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import RichText from '../common/RichText.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ close: [result: { skipNextTime: boolean } | null] }>();
const { t } = useI18n();
const skip = ref(false);

function choose(): void {
  emit('close', { skipNextTime: skip.value });
}
</script>

<template>
  <StandardDialog :title="t('app.impTitle')" @cancel="emit('close', null)" @submit="choose">
    <div class="intro">
      <h2 class="intro__heading">{{ t('register.importDialogHeading') }}</h2>
      <p class="intro__text">{{ t('register.importStatementDescription') }}</p>
      <ul class="intro__formats">
        <li><RichText :text="t('register.importRecommendedFormats')" /></li>
        <li><RichText :text="t('register.importOtherSupportedFormats')" /></li>
        <li><RichText :text="t('register.importCsvAdvancedLabel')" /></li>
      </ul>
    </div>
    <template #footer>
      <label v-tooltip="t('app.impDontShowTooltip')" class="intro__skip">
        <input v-model="skip" type="checkbox" />
        {{ t('app.impDontShow') }}
      </label>
      <UiButton @click="emit('close', null)">{{ t('register.cancelImport') }}</UiButton>
      <UiButton primary @click="choose">{{ t('register.chooseImportFile') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: var(--dialog-text-w);
}

.intro__heading {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--font-lg);
  font-weight: 600;
}

.intro__text {
  margin: 0;
}

.intro__formats {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding-left: var(--space-6);
}

.intro__skip {
  display: inline-flex;
  flex: 1;
  gap: var(--space-2);
  align-items: center;
}
</style>
