<script setup lang="ts">
// The Tags manager (04 §5.2; 07 §7): Actual's tag entities. Search, create, discover tags already used in
// notes, change a tag's color and description, rename (Actual rewrites every note that has it; a name in use,
// even by a deleted tag, is refused) or delete (the
// `#name` text stays in the notes), and view the transactions with a tag. `needs-review` drives approval, so it
// has no Rename or Delete. Writes need an online connection.
import type { TagEntity } from '@shared/domain/types';
import { REVIEW_TAG } from '@shared/metadata/tags';
import { tagTextColor } from '@shared/tag-color';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTags } from '../../queries/budget-data';
import { attempt, tell } from '../../register/dialogs';
import { useDefaultTagText } from '../../register/tag-default';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { escapeRichText } from '../common/rich-text';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ close: [result: { search: string } | null] }>();
const { t } = useI18n();
const tagsQ = useTags();
const connection = useConnection();
const defaultText = useDefaultTagText();

/** A tag name has no whitespace and no `#` (04 §5.2). */
const VALID_NAME = /^[^\s#]+$/;
const DEFAULT_COLOR = '#9161c6';

const query = ref('');
const newName = ref('');
const newColor = ref('');
const busy = ref(false);
/** The name being typed per tag id, when it differs from the stored one. */
const renames = ref(new Map<string, string>());

const tags = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return (tagsQ.data.value ?? []).filter((x) => x.tag.toLocaleLowerCase().includes(q));
});
const canEdit = computed(() => connection.canEdit && !busy.value);

const pillStyle = (color: string | null): Record<string, string> => {
  const text = color ? tagTextColor(color) : null;
  return color && text ? { background: color, color: text } : { color: defaultText.value };
};
const nameOf = (x: TagEntity): string => renames.value.get(x.id) ?? x.tag;
const typedName = (raw: string): string => raw.trim().replace(/^#/, '');

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  busy.value = true;
  try {
    return await attempt(fn);
  } finally {
    busy.value = false;
  }
}

async function create(): Promise<void> {
  const tag = typedName(newName.value);
  if (!VALID_NAME.test(tag)) {
    await tell(t('app.tagsInvalidNameTitle'), t('app.tagsInvalidNameMessage'));
    return;
  }
  const result = await run(() =>
    host.call('tags.create', { tag, ...(newColor.value ? { color: newColor.value } : {}) }),
  );
  if (result.ok) {
    newName.value = '';
    newColor.value = '';
  }
}

async function discover(): Promise<void> {
  const result = await run(() => host.call('tags.discover', {}));
  if (!result.ok) return;
  const n = result.value.length;
  await tell(
    t('app.tagsDiscoverTitle'),
    n === 0 ? t('app.tagsDiscoverNone') : t('app.tagsDiscoverFound', { n }, n),
    'info',
    'ok',
  );
}

async function setColor(x: TagEntity, color: string | null): Promise<void> {
  await run(() => host.call('tags.update', { id: x.id, color }));
}

async function setDescription(x: TagEntity, e: Event): Promise<void> {
  const description = (e.target as HTMLInputElement).value;
  if (description === (x.description ?? '')) return;
  await run(() => host.call('tags.update', { id: x.id, description }));
}

function onColor(x: TagEntity, e: Event): void {
  void setColor(x, (e.target as HTMLInputElement).value);
}

function onName(x: TagEntity, e: Event): void {
  renames.value.set(x.id, (e.target as HTMLInputElement).value);
}

async function rename(x: TagEntity): Promise<void> {
  const tag = typedName(nameOf(x));
  if (tag === x.tag) return;
  if (!VALID_NAME.test(tag)) {
    await tell(t('app.tagsInvalidNameTitle'), t('app.tagsInvalidNameMessage'));
    return;
  }
  const nameTaken = (): Promise<void> =>
    tell(
      t('app.tagsNameExistsTitle'),
      t('app.tagsNameExistsMessage', { tag: escapeRichText(tag) }),
    );
  if ((tagsQ.data.value ?? []).some((o) => o.tag === tag)) {
    await nameTaken();
    return;
  }
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('app.tagsRenameTitle'),
    content: t('app.tagsRenameMessage', {
      old: escapeRichText(x.tag),
      new: escapeRichText(tag),
    }),
    icon: 'warning',
    buttons: [{ id: 'rename', label: t('app.tagsRename'), isDefault: true }, 'cancel'],
  });
  if (button !== 'rename') return;
  // A deleted tag keeps its name taken in Actual, so the host can still refuse a name the list doesn't show.
  const result = await run(async () => {
    try {
      await host.call('tags.update', { id: x.id, tag });
      return true;
    } catch (e) {
      if (errorInfo(e).detail !== 'duplicate-tag') throw e;
      return false;
    }
  });
  if (!result.ok) return;
  if (result.value) renames.value.delete(x.id);
  else await nameTaken();
}

async function remove(x: TagEntity): Promise<void> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('app.tagsDeleteTitle'),
    content: t('app.tagsDeleteMessage', { tag: escapeRichText(x.tag) }),
    icon: 'warning',
    buttons: [{ id: 'delete', label: t('app.tagsDelete') }, 'cancel'],
  });
  if (button === 'delete') await run(() => host.call('tags.delete', { id: x.id }));
}

/** Closes with a register search for the tag; the caller shows All Accounts (10 §4). */
function view(x: TagEntity): void {
  emit('close', { search: `${t('search.kwTag')}: ${x.tag},` });
}
</script>

<template>
  <StandardDialog
    :title="t('app.tagsManagerTitle')"
    width="xl"
    @cancel="emit('close', null)"
    @submit="emit('close', null)"
  >
    <div class="tags">
      <div class="tags__bar">
        <input
          v-model="query"
          class="tags__input tags__grow"
          type="search"
          :aria-label="t('app.tagsSearch')"
          :placeholder="t('app.tagsSearch')"
        />
        <UiButton :disabled="!canEdit" @click="discover">{{ t('app.tagsDiscover') }}</UiButton>
      </div>

      <div class="tags__bar">
        <input
          v-model="newName"
          class="tags__input tags__grow"
          type="text"
          data-own-enter
          :aria-label="t('app.tagsNewName')"
          :placeholder="t('app.tagsNewName')"
          :disabled="!canEdit"
          @keydown.enter.prevent="create"
        />
        <input
          v-model="newColor"
          class="tags__color"
          type="color"
          :aria-label="t('app.tagsColor')"
          :disabled="!canEdit"
        />
        <UiButton :disabled="!canEdit || newName.trim() === ''" @click="create">{{
          t('app.tagsAdd')
        }}</UiButton>
      </div>

      <p v-if="tags.length === 0" class="tags__empty">{{ t('app.tagsEmpty') }}</p>
      <ul v-else class="tags__list" :aria-label="t('app.tagsManagerTitle')">
        <li v-for="x in tags" :key="x.id" class="tags__item">
          <span class="tags__pill" :style="pillStyle(x.color)">{{ `#${x.tag}` }}</span>
          <input
            :value="nameOf(x)"
            class="tags__input tags__name"
            type="text"
            data-own-enter
            :aria-label="t('app.tagsNameOf', { tag: x.tag })"
            :disabled="!canEdit || x.tag === REVIEW_TAG"
            @input="onName(x, $event)"
            @keydown.enter.prevent="rename(x)"
          />
          <input
            :value="x.color ?? DEFAULT_COLOR"
            class="tags__color"
            type="color"
            :aria-label="t('app.tagsColorOf', { tag: x.tag })"
            :disabled="!canEdit"
            @change="onColor(x, $event)"
          />
          <UiButton :disabled="!canEdit || x.color === null" @click="setColor(x, null)">{{
            t('app.tagsDefaultColor')
          }}</UiButton>
          <input
            :value="x.description ?? ''"
            class="tags__input tags__grow"
            type="text"
            data-own-enter
            :aria-label="t('app.tagsDescriptionOf', { tag: x.tag })"
            :placeholder="t('app.tagsDescription')"
            :disabled="!canEdit"
            @change="setDescription(x, $event)"
          />
          <UiButton
            v-if="x.tag !== REVIEW_TAG"
            :disabled="!canEdit || typedName(nameOf(x)) === x.tag"
            @click="rename(x)"
            >{{ t('app.tagsRename') }}</UiButton
          >
          <UiButton v-if="x.tag !== REVIEW_TAG" :disabled="!canEdit" @click="remove(x)">{{
            t('app.tagsDelete')
          }}</UiButton>
          <UiButton @click="view(x)">{{ t('app.tagsViewTransactions') }}</UiButton>
        </li>
      </ul>
      <p v-if="!connection.canEdit" class="tags__hint">{{ t('app.tagsOffline') }}</p>
    </div>
    <template #footer>
      <UiButton primary @click="emit('close', null)">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.tags {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.tags__bar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.tags__grow {
  flex: 1;
  min-width: 8rem;
}

.tags__input {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.tags__color {
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: 1px solid var(--register-border);
  background: transparent;
  cursor: pointer;
}

.tags__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.tags__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.tags__pill {
  min-width: 6rem;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--tag-default-bg);
  text-align: center;
}

.tags__name {
  width: 10rem;
}

.tags__empty,
.tags__hint {
  margin: 0;
  color: var(--text-muted);
}
</style>
