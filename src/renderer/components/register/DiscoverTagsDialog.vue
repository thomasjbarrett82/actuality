<script setup lang="ts">
// The Discover dialog (04 §5.2), opened from the Tags manager: the tags used in transaction notes that have
// no entity, each with a checkbox (all checked at first). Add creates the checked ones in one write; Cancel
// changes nothing. Add with none checked closes with a toast. While no managed tag starts with `flag-`,
// "Add YNAB flags" creates the six YNAB flag tags at once and the dialog stays open.
import { FLAG_TAG_DESCRIPTION, FLAG_TAG_PREFIX, FLAG_TAGS } from '@shared/metadata/tags';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTags } from '../../queries/budget-data';
import { attempt } from '../../register/dialogs';
import { host } from '../../rpc/host-client';
import { useConnection } from '../../stores/connection';
import { useToasts } from '../../stores/toasts';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

/** The toast "Add" shows with nothing checked; showing it again replaces it. */
const NONE_SELECTED_TOAST = 'tags-discover-none-selected';

const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const tagsQ = useTags();
const connection = useConnection();

/** The unmanaged tag names, by name; null while they load. */
const found = ref<string[] | null>(null);
const checked = ref(new Set<string>());
const busy = ref(false);

const canEdit = computed(() => connection.canEdit && !busy.value);
const allChecked = computed(
  () => (found.value?.length ?? 0) > 0 && checked.value.size === found.value?.length,
);
const someChecked = computed(() => checked.value.size > 0 && !allChecked.value);
const showFlags = computed(
  () =>
    tagsQ.data.value !== undefined &&
    !tagsQ.data.value.some((x) => x.tag.startsWith(FLAG_TAG_PREFIX)),
);

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  busy.value = true;
  try {
    return await attempt(fn);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const result = await run(() => host.call('tags.unmanaged', {}));
  if (!result.ok) {
    emit('close', null);
    return;
  }
  found.value = result.value;
  checked.value = new Set(result.value);
});

function toggle(tag: string): void {
  const next = new Set(checked.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  checked.value = next;
}

function toggleAll(): void {
  checked.value = allChecked.value ? new Set() : new Set(found.value);
}

/** Drops tags that now have an entity from the list. */
function forget(tags: readonly string[]): void {
  const gone = new Set(tags);
  found.value = (found.value ?? []).filter((x) => !gone.has(x));
  checked.value = new Set([...checked.value].filter((x) => !gone.has(x)));
}

async function addFlags(): Promise<void> {
  const result = await run(() =>
    host.call('tags.createMany', {
      tags: FLAG_TAGS.map((f) => ({ ...f, description: FLAG_TAG_DESCRIPTION })),
    }),
  );
  if (result.ok) forget(result.value.map((x) => x.tag));
}

async function add(): Promise<void> {
  const tags = (found.value ?? []).filter((x) => checked.value.has(x));
  if (tags.length === 0) {
    useToasts().show({
      id: NONE_SELECTED_TOAST,
      title: t('app.tagsDiscoverTitle'),
      message: t('app.tagsDiscoverNoneSelected'),
    });
    emit('close', null);
    return;
  }
  const result = await run(() =>
    host.call('tags.createMany', { tags: tags.map((tag) => ({ tag })) }),
  );
  if (result.ok) emit('close', null);
}

function onSubmit(): void {
  if (canEdit.value && found.value !== null) void add();
}
</script>

<template>
  <StandardDialog
    :title="t('app.tagsDiscoverTitle')"
    width="sm"
    @cancel="emit('close', null)"
    @submit="onSubmit"
  >
    <div class="discover">
      <p v-if="found === null" class="discover__message" role="status">
        {{ t('app.tagsDiscoverLoading') }}
      </p>
      <p v-else-if="found.length === 0" class="discover__message">
        {{ t('app.tagsDiscoverNone') }}
      </p>
      <template v-else>
        <label class="discover__check discover__all">
          <input
            type="checkbox"
            :checked="allChecked"
            :indeterminate="someChecked"
            @change="toggleAll"
          />
          {{ t('app.tagsDiscoverSelectAll') }}
        </label>
        <ul class="discover__list" :aria-label="t('app.tagsDiscoverList')">
          <li v-for="tag in found" :key="tag">
            <label class="discover__check">
              <input type="checkbox" :checked="checked.has(tag)" @change="toggle(tag)" />
              {{ `#${tag}` }}
            </label>
          </li>
        </ul>
      </template>
    </div>
    <template #footer>
      <UiButton v-if="showFlags" class="discover__flags" :disabled="!canEdit" @click="addFlags">{{
        t('app.tagsDiscoverFlags')
      }}</UiButton>
      <UiButton tone="cancel" @click="emit('close', null)">{{
        t('taskDialog.CancelLabel')
      }}</UiButton>
      <UiButton primary tone="save" :disabled="!canEdit || found === null" @click="add">{{
        t('app.tagsDiscoverAdd')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.discover {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.discover__message {
  margin: 0;
  color: var(--text-muted);
}

.discover__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.discover__check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
  overflow-wrap: anywhere;
}

.discover__all {
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--register-border);
}

.discover__flags {
  margin-right: auto;
}
</style>
