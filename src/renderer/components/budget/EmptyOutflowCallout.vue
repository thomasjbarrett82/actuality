<script setup lang="ts">
// "How to Enter an Outflow" (09 §6.6): shown for a category or group with no outflows while
// `showEmptyOutflowTooltip` is on. Don't show this again closes with 'dontShow'; Close with 'close'.
import { useI18n } from 'vue-i18n';
import RichText from '../common/RichText.vue';
import UiButton from '../common/UiButton.vue';

defineProps<{ text: string }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="empty">
    <p class="empty__text"><RichText :text="text" /></p>
    <div class="empty__buttons">
      <label class="empty__check">
        <input type="checkbox" @change="emit('close', 'dontShow')" />
        {{ t('app.budDontShowAgain') }}
      </label>
      <UiButton @click="emit('close', 'close')">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  color: var(--text-subtle);
}

.empty__text {
  margin: 0;
}

.empty__buttons {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
}

.empty__check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
}
</style>
