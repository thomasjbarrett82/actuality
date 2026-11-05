<script setup lang="ts">
// Add New Category (11 §4.2): heading "New Category"; 1. an editable combo of existing master categories
// (a new name creates one), 2. the category's name; Cancel / Create Category. The name rules are 09
// §6.1–6.2's, shown in "Please choose a different category name". Closes with the new category, or null.
import { categoryLabel, categoryNameError, groupNameError } from '@shared/domain/categories';
import type { CategoryGroup } from '@shared/domain/types';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { attempt, tell } from '../../register/dialogs';
import type { NewCategory } from '../../register/editable';
import { host } from '../../rpc/host-client';
import type { AutoCompleteEntry } from '../common/autocomplete-list';
import AutoComplete from '../common/AutoComplete.vue';
import type { AutoCompleteApi } from '../common/exposed';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = withDefaults(
  defineProps<{ groups: readonly CategoryGroup[]; groupName?: string; name?: string }>(),
  { groupName: '', name: '' },
);
const emit = defineEmits<{ close: [result: NewCategory | null] }>();
const { t } = useI18n();
const id = useId();

/** Reserved group names are blanked when pre-filling (11 §4.2). */
const reserved = computed(() => [
  t('app.categoryHiddenCategories'),
  t('app.categoryUncategorized'),
  t('register.addNewCategory'),
]);
const fold = (s: string): string => s.trim().toLocaleLowerCase();
const groupText = ref(
  groupNameError(props.groupName, [], reserved.value) === 'reserved' ? '' : props.groupName,
);
const nameText = ref(props.name);
const busy = ref(false);
const groupField = ref<AutoCompleteApi | null>(null);

const expense = computed(() => props.groups.filter((g) => !g.isIncome));
const entries = computed<AutoCompleteEntry[]>(() =>
  expense.value.map((g) => ({ kind: 'item', id: g.id, label: g.name })),
);

async function refuse(message: string): Promise<void> {
  await tell(t('app.categoryNameDifferent'), message, 'warning');
}

const NAME_MESSAGES: Record<string, string> = {
  empty: 'app.categoryMustHaveName',
  characters: 'app.categoryBadCharacters',
  duplicate: 'app.categoryAlreadyExists',
};
const GROUP_MESSAGES: Record<string, string> = {
  empty: 'app.categoryMustHaveName',
  characters: 'app.categoryBadCharacters',
  duplicate: 'app.categoryNameUsed',
  income: 'app.categoryIncomeGroup',
  reserved: 'app.categoryReservedName',
};

async function submit(): Promise<void> {
  if (busy.value) return;
  // The field's text, also when Enter submits before the auto-complete has taken it.
  const groupName = (groupField.value?.element()?.value ?? groupText.value).trim();
  const name = nameText.value.trim();
  if (groupName === '' || name === '') return refuse(t('app.categoryNeedNames'));
  const group = props.groups.find((g) => fold(g.name) === fold(groupName));
  if (group?.isIncome || (!group && fold(groupName) === 'income'))
    return refuse(t('app.categoryIncomeGroup'));
  const nameError = categoryNameError(name, group?.categories.map((c) => c.name) ?? []);
  if (nameError) return refuse(t(NAME_MESSAGES[nameError] ?? 'app.categoryMustHaveName'));
  if (!group) {
    const groupError = groupNameError(
      groupName,
      props.groups.map((g) => g.name),
      reserved.value,
    );
    if (groupError) return refuse(t(GROUP_MESSAGES[groupError] ?? 'app.categoryMustHaveName'));
  }
  busy.value = true;
  const result = await attempt(() =>
    host.call('categories.create', group ? { groupId: group.id, name } : { groupName, name }),
  );
  busy.value = false;
  if (!result.ok) return;
  emit('close', {
    id: result.value.id,
    text: categoryLabel({ name: group?.name ?? groupName }, { name }),
  });
}
</script>

<template>
  <StandardDialog
    :title="t('register.newCategoryTitle')"
    @cancel="emit('close', null)"
    @submit="submit"
  >
    <div class="add-category">
      <span class="add-category__step">{{ t('register.categoryGroupStep') }}</span>
      <div class="add-category__field">
        <AutoComplete
          ref="groupField"
          v-model="groupText"
          :entries="entries"
          :label="t('register.categoryGroupStep')"
          :placeholder="t('register.categoryGroupName')"
        />
      </div>
      <p class="add-category__hint">{{ t('register.categoryGroupPickerHelp') }}</p>
      <label :for="`${id}-name`" class="add-category__step">{{
        t('register.categoryNameStep')
      }}</label>
      <input
        :id="`${id}-name`"
        v-model="nameText"
        class="add-category__input"
        type="text"
        :placeholder="t('register.categoryNameLabel')"
      />
    </div>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="busy" @click="submit">{{ t('app.categoryCreate') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.add-category {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.add-category__step {
  font-weight: 600;
}

.add-category__hint {
  margin: 0 0 var(--space-4);
  color: var(--text-subtle);
  font-size: var(--font-sm);
}

.add-category__input {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}
</style>
