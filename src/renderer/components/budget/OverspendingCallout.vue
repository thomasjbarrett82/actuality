<script setup lang="ts">
// Overspending Settings (09 §6.4, X2): the current carryover setting is pre-selected and only Done
// applies it. Closes with 'on', 'off' or 'cancel'.
// Offline, Done is disabled.
import { ArrowRight } from 'lucide-vue-next';
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCanEdit } from '../../stores/connection';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ carryover: boolean }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const id = useId();
const canEdit = useCanEdit();
const on = ref(props.carryover);
</script>

<template>
  <div class="overspend">
    <p :id="`${id}-q`" class="overspend__question">{{ t('budget.overspendingQuestion') }}</p>
    <div role="radiogroup" :aria-labelledby="`${id}-q`" class="overspend__options">
      <label class="overspend__option">
        <input v-model="on" type="radio" :name="id" :value="false" :disabled="!canEdit" />
        {{ t('budget.rolloverToAvailableToBudget') }}
      </label>
      <label class="overspend__option">
        <input v-model="on" type="radio" :name="id" :value="true" :disabled="!canEdit" />
        {{ t('budget.rolloverToCategoryBalance') }}
        <ArrowRight class="overspend__arrow" aria-hidden="true" />
      </label>
    </div>
    <div class="overspend__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <span v-tooltip="canEdit ? null : t('app.editingUnavailableOffline')">
        <UiButton primary :disabled="!canEdit" @click="emit('close', on ? 'on' : 'off')">{{
          t('taskDialog.DoneLabel')
        }}</UiButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.overspend {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--text);
}

.overspend__question {
  margin: 0;
}

.overspend__options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.overspend__option {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
}

.overspend__arrow {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--overspend-arrow);
}

.overspend__buttons {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
