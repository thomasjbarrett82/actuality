<script setup lang="ts">
// Edit / Add category and master category (09 §6.1–6.2), inside a Callout with the title. The name is
// pre-filled, selected and focused. Done (or Enter) validates a changed name and saves it; the links
// close it with 'hide' or 'delete' for the caller. Offline, Done is disabled (09 §9 criterion 4).
import { categoryNameError, groupNameError } from '@shared/domain/categories';
import { EyeOff, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { tell } from '../../register/dialogs';
import { useCanEdit } from '../../stores/connection';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{
  kind: 'category' | 'group';
  /** The callout's title, also the field's name. */
  title: string;
  name: string;
  /** Names the new name may not take: siblings, or other groups. */
  others: readonly string[];
  /** The UI language's reserved group names (09 §6.2). */
  reserved?: readonly string[];
  isNew: boolean;
  save: (name: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const id = useId();
const canEdit = useCanEdit();
const input = ref<HTMLInputElement | null>(null);
const text = ref(props.name);
const busy = ref(false);

const MESSAGES: Record<string, string> = {
  empty: 'app.categoryMustHaveName',
  characters: 'app.categoryBadCharacters',
  duplicate: 'app.categoryNameUsed',
  income: 'app.categoryIncomeName',
  reserved: 'app.categoryReservedName',
};

const error = computed(() => {
  const name = text.value.trim();
  if (name === props.name) return null;
  return props.kind === 'group'
    ? groupNameError(name, props.others, props.reserved ?? [])
    : categoryNameError(name, props.others);
});

async function done(): Promise<void> {
  if (busy.value || !canEdit.value) return;
  if (error.value) {
    await tell(
      t('app.categoryNameDifferent'),
      t(MESSAGES[error.value] ?? MESSAGES['empty'] ?? ''),
      'warning',
    );
    input.value?.focus();
    return;
  }
  busy.value = true;
  try {
    const name = text.value.trim();
    if (name !== props.name && !(await props.save(name))) return;
    emit('close', 'done');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  input.value?.focus();
  input.value?.select();
});
</script>

<template>
  <form class="edit" novalidate @submit.prevent="done">
    <input
      :id="`${id}-name`"
      ref="input"
      v-model="text"
      :aria-label="title"
      class="edit__input"
      type="text"
      autocomplete="off"
      :disabled="!canEdit"
      @keydown.enter.prevent="done"
    />
    <div v-if="!isNew && canEdit" class="edit__links">
      <UiLink :icon="EyeOff" @click="emit('close', 'hide')">{{
        t(kind === 'group' ? 'app.budHideGroup' : 'app.budHideCategory')
      }}</UiLink>
      <UiLink :icon="Trash2" danger @click="emit('close', 'delete')">{{
        t(kind === 'group' ? 'app.budDeleteGroup' : 'app.budDeleteCategory')
      }}</UiLink>
    </div>
    <div class="edit__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <span v-tooltip="canEdit ? null : t('app.editingUnavailableOffline')">
        <UiButton primary :disabled="busy || !canEdit" type="submit">{{
          t('taskDialog.DoneLabel')
        }}</UiButton>
      </span>
    </div>
  </form>
</template>

<style scoped>
.edit {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.edit__input {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-size: var(--font-md);
  font-weight: 600;
}

.edit__links {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
  font-size: var(--font-sm);
}

.edit__buttons {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
