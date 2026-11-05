<script setup lang="ts">
// The Saved Filters menu (15 §3): the page's saved definitions, the one that exactly matches the current
// selections marked, and per definition Load, Replace with current filters, Rename and Delete; then Save
// Current Filters. Closes with `{action}:{index}`, 'save', or 'cancel'.
import { Check } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import UiButton from '../common/UiButton.vue';
import UiSmallButton from '../common/UiSmallButton.vue';

defineProps<{ names: string[]; match: number }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="saved">
    <p v-if="names.length === 0" class="saved__empty">{{ t('reports.savedNone') }}</p>
    <ul v-else class="saved__list">
      <li v-for="(name, i) in names" :key="name" class="saved__item">
        <span class="saved__name">
          <Check v-if="i === match" class="saved__icon" aria-hidden="true" />
          <span>{{ name }}</span>
          <span v-if="i === match" class="saved__match">{{ t('reports.savedMatch') }}</span>
        </span>
        <span class="saved__actions" role="group" :aria-label="name">
          <UiSmallButton @click="emit('close', `load:${i}`)">{{
            t('reports.savedLoad')
          }}</UiSmallButton>
          <UiSmallButton :disabled="i === match" @click="emit('close', `replace:${i}`)">
            {{ t('reports.savedReplace') }}
          </UiSmallButton>
          <UiSmallButton @click="emit('close', `rename:${i}`)">
            {{ t('reports.savedRename') }}
          </UiSmallButton>
          <UiSmallButton @click="emit('close', `delete:${i}`)">
            {{ t('reports.savedDelete') }}
          </UiSmallButton>
        </span>
      </li>
    </ul>
    <div class="saved__footer">
      <UiButton @click="emit('close', 'save')">{{ t('reports.saveCurrent') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.saved {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 22rem;
  min-height: 0;
}

.saved__empty {
  margin: 0;
  color: var(--text-muted);
}

.saved__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  max-height: 22rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.saved__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--grid-line-h);
}

.saved__name {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  font-weight: 600;
}

.saved__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.saved__match {
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-weight: 400;
}

.saved__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.saved__footer {
  display: flex;
  justify-content: flex-end;
}
</style>
