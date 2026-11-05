<script setup lang="ts">
// The error column's resolution popovers (10 §6.3), by level: choose a category for needs-category
// transactions, approve or delete unapproved ones, or remove the budget category from on-budget transfers.
// Closes with 'approve', 'delete', 'remove', `category:{id}` or 'cancel'.
import type { CategoryGroup, ErrorLevel } from '@shared/domain/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveCategory } from '../../register/editable';
import { categoryEntries, categoryFilter } from '../../register/entries';
import AutoComplete from '../common/AutoComplete.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{
  level: ErrorLevel;
  count: number;
  groups: readonly CategoryGroup[];
  canEdit: boolean;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const n = computed(() => props.count);

const entries = computed(() => categoryEntries(props.groups, {}));
const text = ref('');
const categoryId = computed(() => {
  const r = resolveCategory(text.value, '\u0000', props.groups);
  return r.kind === 'category' ? r.id : null;
});
</script>

<template>
  <div class="error-popover">
    <template v-if="level === 'needsCategory'">
      <p class="error-popover__title">{{ t('app.regChooseCategoryTitle', { n }, n) }}</p>
      <AutoComplete
        v-model="text"
        :entries="entries"
        :filter="categoryFilter"
        :label="t('app.regChooseCategoryTitle', { n }, n)"
        :disabled="!canEdit"
        highlight-first
        min-width="16rem"
      />
      <div class="error-popover__buttons">
        <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
        <UiButton
          primary
          :disabled="!canEdit || categoryId === null"
          @click="emit('close', `category:${categoryId}`)"
        >
          {{ t('app.editDone') }}
        </UiButton>
      </div>
    </template>
    <template v-else-if="level === 'forReview'">
      <p class="error-popover__title">{{ t('app.regUnapprovedTitle', { n }, n) }}</p>
      <UiLink :disabled="!canEdit" @click="emit('close', 'approve')">{{
        t('app.regApproveTransactions', n)
      }}</UiLink>
      <UiLink :disabled="!canEdit" @click="emit('close', 'delete')">{{
        t('app.regDeleteTransactions', n)
      }}</UiLink>
    </template>
    <template v-else-if="level === 'error'">
      <p class="error-popover__title">{{ t('app.regTransferErrorTitle', { n }, n) }}</p>
      <UiLink :disabled="!canEdit" @click="emit('close', 'remove')">{{
        t('app.regRemoveCategories', n)
      }}</UiLink>
    </template>
  </div>
</template>

<style scoped>
.error-popover {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

.error-popover__title {
  margin: 0;
  font-weight: 600;
}

.error-popover__buttons {
  display: flex;
  gap: var(--space-2);
  align-self: flex-end;
}
</style>
