<script setup lang="ts">
// Save Filters / Rename Saved Filter (15 §3): one name field. The button is disabled for an empty name
// or one the page already uses, compared without regard to case; the reason shows under the field.
// Closes with the trimmed name, or null.
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { foldName } from '../../reports/state';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{
  title: string;
  button: string;
  initial: string;
  /** The page's other saved names. */
  taken: string[];
}>();
const emit = defineEmits<{ close: [result: string | null] }>();
const { t } = useI18n();
const id = useId();
const name = ref(props.initial);

const error = computed(() => {
  const n = name.value.trim();
  if (n === '') return t('reports.nameEmpty');
  if (props.taken.some((x) => foldName(x) === foldName(n)))
    return t('reports.nameDuplicate', { name: n });
  return null;
});

/** The reason shows once the user has typed or tried to save, not on an empty new name. */
const touched = ref(props.initial !== '');
const shown = computed(() => (touched.value ? error.value : null));

function submit(): void {
  touched.value = true;
  if (error.value === null) emit('close', name.value.trim());
}
</script>

<template>
  <StandardDialog :title="title" width="sm" @cancel="emit('close', null)" @submit="submit">
    <label class="field" :for="`${id}-name`">{{ t('reports.savedNameLabel') }}</label>
    <input
      :id="`${id}-name`"
      v-model="name"
      class="field__input"
      type="text"
      maxlength="100"
      :aria-invalid="shown !== null"
      :aria-describedby="`${id}-error`"
      @input="touched = true"
    />
    <p :id="`${id}-error`" class="field__error" aria-live="polite">{{ shown ?? '' }}</p>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="error !== null" @click="submit">{{ button }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.field {
  display: block;
  margin-bottom: var(--space-2);
  font-weight: 600;
}

.field__input {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font: inherit;
}

.field__error {
  min-height: 1.4em;
  margin: var(--space-2) 0 0;
  color: var(--text-danger);
  font-size: var(--font-sm);
}
</style>
