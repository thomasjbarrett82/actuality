<script setup lang="ts">
// A payee, account, category or category group picker for the rule editor (23 §3.1): one id, or several
// as removable chips for the "one of" operators. Typed text that names no item reverts.
import type { Id } from '@shared/domain/types';
import { X } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  AutoCompleteEntry,
  AutoCompleteFilter,
  AutoCompleteItem,
} from '../common/autocomplete-list';
import AutoComplete from '../common/AutoComplete.vue';
import type { AutoCompleteApi } from '../common/exposed';

const props = withDefaults(
  defineProps<{
    /** Items have `id` = the entity id. */
    entries: readonly AutoCompleteEntry[];
    label: string;
    filter?: AutoCompleteFilter | undefined;
    disabled?: boolean;
    /** Several ids (chips) instead of one. */
    multiple?: boolean;
  }>(),
  { disabled: false, multiple: false },
);
const id = defineModel<Id | null>('id', { default: null });
const ids = defineModel<Id[]>('ids', { default: () => [] });
const { t } = useI18n();
const ac = ref<AutoCompleteApi | null>(null);

const items = computed(() => props.entries.filter((e): e is AutoCompleteItem => e.kind === 'item'));
const labelOf = (x: Id): string =>
  items.value.find((i) => i.id === x)?.label ?? t('app.rulesDeleted');
const text = computed(() => (props.multiple || id.value === null ? '' : labelOf(id.value)));
const shown = computed(() =>
  props.multiple
    ? props.entries.filter((e) => e.kind !== 'item' || !ids.value.includes(e.id))
    : props.entries,
);

function find(value: string, item: AutoCompleteItem | null): Id | null | undefined {
  if (item) return item.id;
  const typed = value.trim().toLocaleLowerCase();
  if (typed === '') return null;
  return items.value.find((i) => i.label.toLocaleLowerCase() === typed)?.id;
}

function onCommit(value: string, item: AutoCompleteItem | null): void {
  const found = find(value, item);
  if (props.multiple) {
    if (found && !ids.value.includes(found)) ids.value = [...ids.value, found];
    ac.value?.reset();
    return;
  }
  if (found === undefined) ac.value?.reset();
  else id.value = found;
}
</script>

<template>
  <div class="id-picker" data-own-enter>
    <ul v-if="multiple && ids.length > 0" class="id-picker__chips">
      <li v-for="x in ids" :key="x" class="id-picker__chip">
        <span>{{ labelOf(x) }}</span>
        <button
          type="button"
          class="id-picker__remove"
          :disabled="disabled"
          :aria-label="`${t('app.rulesRemoveRow')} ${labelOf(x)}`"
          @click="ids = ids.filter((y) => y !== x)"
        >
          <X aria-hidden="true" />
        </button>
      </li>
    </ul>
    <AutoComplete
      ref="ac"
      :model-value="text"
      :entries="shown"
      :label="label"
      :disabled="disabled"
      v-bind="filter ? { filter } : {}"
      highlight-first
      @commit="onCommit"
    />
  </div>
</template>

<style scoped>
.id-picker {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 12rem;
}

.id-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.id-picker__chip {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--register-gray-bg);
}

.id-picker__remove {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.id-picker__remove svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
