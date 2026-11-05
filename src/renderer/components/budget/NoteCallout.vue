<script setup lang="ts">
// The note popover (09 §6.3): a multi-line note for a group, category, month or cell. Delete Note
// (left), Cancel, Done. It reports every change through `update`, because an outside click saves too: the
// caller keeps the text for 'done' and 'clickOutside', and clears the note for 'delete'. Offline it is
// read-only.
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCanEdit } from '../../stores/connection';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{ initial: string; label: string; update: (text: string) => void }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const canEdit = useCanEdit();
const area = ref<HTMLTextAreaElement | null>(null);
const text = ref(props.initial);
watch(text, (v) => {
  props.update(v);
});

onMounted(() => {
  area.value?.focus();
});
</script>

<template>
  <div class="note">
    <textarea
      ref="area"
      v-model="text"
      class="note__text"
      :aria-label="label"
      :readonly="!canEdit"
    />
    <div class="note__buttons">
      <UiLink v-if="canEdit" danger class="note__delete" @click="emit('close', 'delete')">{{
        t('app.budDeleteNote')
      }}</UiLink>
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <span v-tooltip="canEdit ? null : t('app.editingUnavailableOffline')">
        <UiButton primary :disabled="!canEdit" @click="emit('close', 'done')">{{
          t('taskDialog.DoneLabel')
        }}</UiButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.note {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.note__text {
  height: 7.5rem;
  padding: var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-subtle);
  font: inherit;
  resize: vertical;
}

.note__buttons {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: flex-end;
}

.note__delete {
  margin-right: auto;
}
</style>
