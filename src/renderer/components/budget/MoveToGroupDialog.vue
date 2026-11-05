<script setup lang="ts">
// Move to Group… (22 §2.4): the keyboard alternative to dragging a category into another group. A list of
// the other groups of the same kind; Move closes with the chosen group's id, Cancel with null. The caller
// applies the same refusals as a drop (09 §4.3).
import type { CategoryGroup, Id } from '@shared/domain/types';
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ name: string; groups: readonly CategoryGroup[] }>();
const emit = defineEmits<{ close: [result: Id | null] }>();
const { t } = useI18n();
const id = useId();
const choice = ref<Id | null>(props.groups[0]?.id ?? null);
</script>

<template>
  <StandardDialog
    :title="t('app.budMoveToGroupTitle')"
    width="sm"
    @cancel="emit('close', null)"
    @submit="emit('close', choice)"
  >
    <p :id="`${id}-text`" class="move__text">{{ t('app.budMoveToGroupText', { name }) }}</p>
    <div role="radiogroup" :aria-labelledby="`${id}-text`" class="move__list">
      <label v-for="g in groups" :key="g.id" class="move__option">
        <input v-model="choice" type="radio" :name="id" :value="g.id" />
        {{ g.name }}
      </label>
    </div>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="choice === null" @click="emit('close', choice)">{{
        t('app.budMoveButton')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.move__text {
  margin: 0 0 var(--space-3);
}

.move__list {
  display: flex;
  flex-direction: column;
  max-height: 20rem;
  overflow: auto;
}

.move__option {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
}
</style>
