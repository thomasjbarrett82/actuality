<script setup lang="ts">
// Wipe the Slate Clean (18 §2): what is kept and deleted, where the backup goes (Change… picks another
// file), and, only once Alt has been pressed in the dialog ("advanced mode"), the cutoff combo: ALL DATES,
// then every month from the current one back to the first month with data. Closes with the choice, or
// null on Cancel.
import type { Month } from '@shared/domain/types';
import { monthHeader } from '@shared/format';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { backupFilters } from '../../budget-file/backup';
import type { SlateWipeChoice } from '../../budget-file/slate-wipe';
import { dateLocale } from '../../i18n';
import AppLogo from '../common/AppLogo.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ backupPath: string; months: readonly Month[] }>();
const emit = defineEmits<{ close: [result: SlateWipeChoice | null] }>();
const { t } = useI18n();
const id = useId();

const path = ref(props.backupPath);
const advanced = ref(false);
/** '' is ALL DATES. */
const cutoff = ref<Month | ''>('');

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Alt') advanced.value = true;
}

/** The folder and the file name of a path, on any OS. */
const split = computed(() => {
  const at = Math.max(path.value.lastIndexOf('/'), path.value.lastIndexOf('\\'));
  return { folder: at === -1 ? '' : path.value.slice(0, at), name: path.value.slice(at + 1) };
});

async function change(): Promise<void> {
  const chosen = await window.app.shell.files.saveFile({
    title: t('app.swChangeTitle'),
    defaultName: split.value.name,
    folder: split.value.folder,
    filters: backupFilters(),
  });
  if (chosen) path.value = chosen;
}

function submit(): void {
  emit('close', { backupPath: path.value, cutoffMonth: cutoff.value === '' ? null : cutoff.value });
}
</script>

<template>
  <StandardDialog
    :title="t('menu.wipeSlateClean')"
    width="lg"
    @cancel="emit('close', null)"
    @submit="submit"
  >
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- Alt anywhere in the dialog reveals the advanced option (18 §2) -->
    <div class="wipe" @keydown="onKeydown">
      <AppLogo class="wipe__logo" />
      <div class="wipe__body">
        <h2 :id="`${id}-heading`" class="wipe__heading">{{ t('app.swHeading') }}</h2>
        <p class="wipe__text">{{ t('app.swMessage') }}</p>
        <p class="wipe__text wipe__text--bold">{{ t('app.swBackupFirst') }}</p>
        <div class="wipe__row">
          <label :for="`${id}-path`">{{ t('app.swSaveBackupTo') }}</label>
          <input :id="`${id}-path`" class="input wipe__path" :value="path" readonly />
          <UiButton @click="change">{{ t('app.swChange') }}</UiButton>
        </div>
        <div v-if="advanced" class="wipe__row">
          <label :for="`${id}-cutoff`">{{ t('app.swDeleteBefore') }}</label>
          <select :id="`${id}-cutoff`" v-model="cutoff" class="input">
            <option value="">{{ t('app.swAllDates') }}</option>
            <option v-for="m in months" :key="m" :value="m">
              {{ monthHeader(m, dateLocale) }}
            </option>
          </select>
        </div>
      </div>
    </div>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary @click="submit">{{ t('app.swWipe') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.wipe {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
}

.wipe__logo {
  flex: none;
  width: 5rem;
  height: 5rem;
}

.wipe__body {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.wipe__heading {
  margin: 0;
  color: var(--accent-green);
  font-size: var(--font-xl);
  font-weight: 700;
}

.wipe__text {
  margin: 0;
}

.wipe__text--bold {
  font-weight: 700;
}

.wipe__row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.wipe__path {
  flex: 1;
  min-width: 0;
}
</style>
