<script setup lang="ts">
// A report filter's picker (15 §2.1): Categories (each group with its categories, Uncategorized on its
// own), Payees (flat) or Accounts (Budget and Off-Budget). Ticks are a draft: Done commits it, Cancel, Esc
// and an outside click discard it. Search is case-insensitive and starts empty each time; while searching,
// Select All, Select None and the group boxes touch only the visible matches. Closes with the selection
// as JSON, or 'cancel'.
import type { Id } from '@shared/domain/types';
import type { AccountSelection, Selection } from '@shared/reporting/model';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PickerEntry } from '../../reports/view-types';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{
  entries: readonly PickerEntry[];
  selected: Selection | AccountSelection;
  /** Accounts: the open on-budget ids, which the default selection means. */
  onBudget?: readonly Id[];
  searchLabel: string;
}>();
const emit = defineEmits<{ close: [result: string] }>();
const { t } = useI18n();
const id = useId();

const leavesOf = (e: PickerEntry): { id: Id; label: string }[] =>
  e.children ? e.children : [{ id: e.id, label: e.label }];
const allLeaves = computed(() => props.entries.flatMap(leavesOf).map((l) => l.id));

function initial(): Set<Id> {
  const s = props.selected;
  if (s.kind === 'all') return new Set(allLeaves.value);
  if (s.kind === 'onBudget') return new Set(props.onBudget ?? []);
  return new Set(s.ids.filter((x) => allLeaves.value.includes(x)));
}
const ticked = ref<Set<Id>>(initial());
const query = ref('');

const fold = (s: string): string => s.toLocaleLowerCase();
/** The entries and members the search shows: a matching group shows all its members. */
const visible = computed(() => {
  const q = fold(query.value.trim());
  if (!q) return props.entries.map((e) => ({ entry: e, members: e.children ?? [] }));
  return props.entries.flatMap((e) => {
    if (!e.children) return fold(e.label).includes(q) ? [{ entry: e, members: [] }] : [];
    const members = fold(e.label).includes(q)
      ? e.children
      : e.children.filter((c) => fold(c.label).includes(q));
    return members.length > 0 ? [{ entry: e, members }] : [];
  });
});
const visibleLeaves = computed(() =>
  visible.value.flatMap((v) => (v.entry.children ? v.members.map((m) => m.id) : [v.entry.id])),
);

function setMany(ids: readonly Id[], on: boolean): void {
  const next = new Set(ticked.value);
  for (const x of ids) {
    if (on) next.add(x);
    else next.delete(x);
  }
  ticked.value = next;
}
const toggle = (x: Id): void => {
  setMany([x], !ticked.value.has(x));
};
const groupState = (members: readonly { id: Id }[]): 'all' | 'some' | 'none' => {
  const n = members.filter((m) => ticked.value.has(m.id)).length;
  return n === 0 ? 'none' : n === members.length ? 'all' : 'some';
};

function done(): void {
  const ids = [...ticked.value];
  let result: Selection | AccountSelection;
  if (allLeaves.value.every((x) => ticked.value.has(x)) && allLeaves.value.length > 0)
    result = { kind: 'all' };
  else if (
    props.onBudget &&
    ids.length === props.onBudget.length &&
    props.onBudget.every((x) => ticked.value.has(x))
  )
    result = { kind: 'onBudget' };
  else result = { kind: 'ids', ids };
  emit('close', JSON.stringify(result));
}

/** Enter is Done, except on a button, which runs its own action. */
function onEnter(e: KeyboardEvent): void {
  if (e.target instanceof HTMLButtonElement) return;
  e.preventDefault();
  done();
}

const root = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
onMounted(() => {
  root.value?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onEnter(e);
  });
  search.value?.focus();
});
</script>

<template>
  <div ref="root" class="picker">
    <input
      ref="search"
      v-model="query"
      type="search"
      class="picker__search"
      :aria-label="searchLabel"
      :placeholder="t('reports.search')"
      :aria-controls="`${id}-list`"
    />
    <div class="picker__bulk">
      <UiButton @click="setMany(visibleLeaves, true)">{{ t('reports.selectAll') }}</UiButton>
      <UiButton @click="setMany(visibleLeaves, false)">{{ t('reports.selectNone') }}</UiButton>
    </div>
    <div :id="`${id}-list`" class="picker__list">
      <p v-if="visible.length === 0" class="picker__empty" role="status">
        {{ t('reports.noMatches') }}
      </p>
      <template v-for="v in visible" :key="v.entry.id">
        <div v-if="v.entry.children" role="group" :aria-labelledby="`${id}-${v.entry.id}`">
          <label class="picker__item picker__item--group">
            <input
              type="checkbox"
              :checked="groupState(v.members) === 'all'"
              :indeterminate="groupState(v.members) === 'some'"
              @change="
                setMany(
                  v.members.map((m) => m.id),
                  groupState(v.members) !== 'all',
                )
              "
            />
            <span :id="`${id}-${v.entry.id}`">{{ v.entry.label }}</span>
          </label>
          <label v-for="m in v.members" :key="m.id" class="picker__item picker__item--child">
            <input type="checkbox" :checked="ticked.has(m.id)" @change="toggle(m.id)" />
            <span>{{ m.label }}</span>
          </label>
        </div>
        <label v-else class="picker__item">
          <input type="checkbox" :checked="ticked.has(v.entry.id)" @change="toggle(v.entry.id)" />
          <span>{{ v.entry.label }}</span>
        </label>
      </template>
    </div>
    <div class="picker__buttons">
      <UiButton @click="emit('close', 'cancel')">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary @click="done">{{ t('app.editDone') }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
/* The list shrinks and scrolls when the callout is capped to the room left (17 §3); the buttons stay. */
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 18rem;
  min-height: 0;
}

.picker__search {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font: inherit;
}

.picker__bulk,
.picker__buttons {
  display: flex;
  flex: none;
  gap: var(--space-2);
}

.picker__buttons {
  justify-content: flex-end;
}

.picker__list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 22rem;
  overflow-y: auto;
}

.picker__item {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  cursor: pointer;
}

.picker__item--group {
  font-weight: 600;
}

.picker__item--child {
  padding-left: var(--space-6);
}

.picker__empty {
  margin: var(--space-3) var(--space-2);
  color: var(--text-muted);
}
</style>
