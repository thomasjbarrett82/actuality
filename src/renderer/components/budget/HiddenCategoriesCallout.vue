<script setup lang="ts">
// Show Hidden Categories (09 §6.5): per group with hidden categories (or hidden itself), a bold "{Group}:"
// link that unhides the group and its hidden categories, then a link per hidden category. More than two
// items add Unhide All. A click closes with the ids to unhide as JSON. Offline the links are disabled.
import type { CategoryGroup, Id } from '@shared/domain/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCanEdit } from '../../stores/connection';
import UiLink from '../common/UiLink.vue';

const props = defineProps<{ groups: readonly CategoryGroup[] }>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const canEdit = useCanEdit();

const entries = computed(() =>
  props.groups
    .map((g) => ({ group: g, hidden: g.categories.filter((c) => g.hidden || c.hidden) }))
    .filter((e) => e.group.hidden || e.hidden.length > 0),
);
const itemCount = computed(() => entries.value.reduce((n, e) => n + 1 + e.hidden.length, 0));

function unhide(categoryIds: Id[], groupIds: Id[]): void {
  emit('close', JSON.stringify({ categoryIds, groupIds }));
}

const unhideGroup = (g: CategoryGroup): void => {
  unhide(
    g.categories.filter((c) => c.hidden).map((c) => c.id),
    g.hidden ? [g.id] : [],
  );
};

function unhideAll(): void {
  unhide(
    entries.value.flatMap((e) => e.group.categories.filter((c) => c.hidden).map((c) => c.id)),
    entries.value.filter((e) => e.group.hidden).map((e) => e.group.id),
  );
}
</script>

<template>
  <div class="hidden-list">
    <div class="hidden-list__scroll">
      <section v-for="e in entries" :key="e.group.id" class="hidden-list__group">
        <UiLink class="hidden-list__group-link" :disabled="!canEdit" @click="unhideGroup(e.group)"
          >{{ e.group.name }}:</UiLink
        >
        <UiLink
          v-for="c in e.hidden"
          :key="c.id"
          class="hidden-list__category"
          :disabled="!canEdit"
          @click="unhide(c.hidden ? [c.id] : [], e.group.hidden ? [e.group.id] : [])"
          >{{ c.name }}</UiLink
        >
      </section>
    </div>
    <UiLink v-if="itemCount > 2" :disabled="!canEdit" @click="unhideAll">{{
      t('app.budUnhideAll')
    }}</UiLink>
  </div>
</template>

<style scoped>
.hidden-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hidden-list__scroll {
  min-height: 7.5rem;
  max-height: 23rem;
  overflow: auto;
}

.hidden-list__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
  padding: var(--space-2) 0;
}

.hidden-list__group + .hidden-list__group {
  border-top: 1px solid var(--register-border);
}

.hidden-list__group-link {
  font-weight: 700;
}

.hidden-list__category {
  padding-left: var(--space-6);
}
</style>
