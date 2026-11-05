<script setup lang="ts">
// "Just Checking..." (11 §6 step 8): an income category with an outflow. Closes with 'inflow' (flip the
// sign and commit again) or 'outflow' (leave it).
import { useI18n } from 'vue-i18n';
import RichText from '../common/RichText.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="income-outflow">
    <p class="income-outflow__text"><RichText :text="t('app.incomeOutflowMessage')" /></p>
    <div class="income-outflow__buttons">
      <UiButton primary @click="emit('close', 'inflow')">{{ t('app.incomeOutflowYes') }}</UiButton>
      <UiButton @click="emit('close', 'outflow')">{{ t('app.incomeOutflowNo') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.income-outflow {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.income-outflow__text {
  margin: 0;
}

.income-outflow__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
