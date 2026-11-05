<script setup lang="ts">
// The register's account header (13 §3–4, 10 §1), shown for a single account: the account name (the
// panel's <h1>, 22 §4.1), the Notes and Rename buttons (shown on hover or keyboard focus), and the ⋯ menu
// with Close Account or Re-open Account. Rename edits the name in place: Enter or a click away saves, Esc
// cancels. Rename and Edit Account Note asked for from the sidebar or the Edit menu run here once the
// register is shown (22 §3). Offline, the buttons and the menu are disabled.
import type { Account } from '@shared/domain/types';
import { Ellipsis, Pencil, StickyNote } from 'lucide-vue-next';
import { nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { closeAccountFlow } from '../../accounts/dialogs';
import { renameAccount, reopenAccount } from '../../accounts/flows';
import { headerRequest, takeHeaderRequest } from '../../accounts/header-request';
import { editNote } from '../../budget/actions';
import { useAccounts } from '../../queries/budget-data';
import { host } from '../../rpc/host-client';
import { useCanEdit } from '../../stores/connection';

const props = defineProps<{ account: Account; ready: boolean }>();
const { t } = useI18n();
const id = useId();
const canEdit = useCanEdit();
const accounts = useAccounts();

const notesButton = ref<HTMLButtonElement | null>(null);
const renameButton = ref<HTMLButtonElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

const offlineTip = (label: string): string =>
  canEdit.value ? label : t('app.editingUnavailableOffline');

// ---------------------------------------------------------------------------- rename (13 §3)

const renaming = ref(false);
const draft = ref('');
let saving = false;

async function startRename(): Promise<void> {
  if (!canEdit.value) return;
  draft.value = props.account.name;
  renaming.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function endRename(refocus: boolean): void {
  renaming.value = false;
  if (refocus) void nextTick(() => renameButton.value?.focus());
}

/** Enter (`refocus`) or a click away: saves; on an error the input stays open (13 §3). */
async function saveRename(refocus: boolean): Promise<void> {
  if (saving || !renaming.value) return;
  saving = true;
  try {
    if (await renameAccount(props.account, draft.value, accounts.data.value ?? []))
      endRename(refocus);
    else {
      await nextTick();
      input.value?.focus();
    }
  } finally {
    saving = false;
  }
}

function onBlur(): void {
  // A validation dialog takes focus while saving: that isn't a click away.
  if (!saving) void saveRename(false);
}

// ---------------------------------------------------------------------------- notes, menu (13 §3–4)

async function openNote(): Promise<void> {
  const anchor = notesButton.value;
  if (!anchor) return;
  await editNote(
    anchor,
    props.account.name,
    props.account.note,
    (text) => host.call('accounts.update', { id: props.account.id, note: text }),
    canEdit.value,
  );
}

async function openMenu(): Promise<void> {
  if (!canEdit.value) return;
  const closed = props.account.closed;
  const choice = await window.app.shell.showContextMenu([
    {
      id: closed ? 'reopen' : 'close',
      label: t(closed ? 'accounts.reopenAccount' : 'accounts.closeAccount'),
    },
  ]);
  if (choice === 'reopen') await reopenAccount(props.account);
  else if (choice === 'close') {
    // A deleted account's panel goes away; a closed one stays, and the menu now offers Re-open (22 §3).
    if ((await closeAccountFlow(props.account)) === 'closed') menuButton.value?.focus();
  }
}

// Rename Account / Edit Account Note from the sidebar or the Edit menu, once this register is shown. The
// panel's own focus move runs first, so the action's focus wins (22 §3).
watch(
  [() => props.ready, headerRequest],
  ([ready]) => {
    if (!ready) return;
    const action = takeHeaderRequest(props.account.id);
    if (!action) return;
    setTimeout(() => {
      if (action === 'rename') void startRename();
      else void openNote();
    }, 0);
  },
  { immediate: true },
);
</script>

<template>
  <div class="header">
    <h1
      class="header__name"
      tabindex="-1"
      data-panel-heading
      :data-ready="ready ? 'true' : 'false'"
    >
      <input
        v-if="renaming"
        ref="input"
        v-model="draft"
        class="header__input"
        type="text"
        autocomplete="off"
        :aria-label="t('a11y.accountNameField')"
        @keydown.enter.prevent="saveRename(true)"
        @keydown.esc.prevent.stop="endRename(true)"
        @blur="onBlur"
      />
      <template v-else>{{ account.name }}</template>
    </h1>
    <button
      ref="notesButton"
      v-tooltip="offlineTip(t('a11y.accountNotes'))"
      type="button"
      class="header__icon header__icon--hover"
      :aria-label="t('a11y.accountNotes')"
      :aria-describedby="account.note ? `${id}-note` : undefined"
      :aria-disabled="canEdit ? undefined : 'true'"
      @click="canEdit && openNote()"
    >
      <StickyNote aria-hidden="true" />
    </button>
    <span v-if="account.note" :id="`${id}-note`" class="visually-hidden">{{ account.note }}</span>
    <button
      ref="renameButton"
      v-tooltip="offlineTip(t('a11y.renameAccount'))"
      type="button"
      class="header__icon header__icon--hover"
      :aria-label="t('a11y.renameAccount')"
      :aria-disabled="canEdit ? undefined : 'true'"
      @click="startRename"
    >
      <Pencil aria-hidden="true" />
    </button>
    <button
      ref="menuButton"
      v-tooltip="offlineTip(t('a11y.accountActions'))"
      type="button"
      class="header__icon header__menu"
      aria-haspopup="menu"
      :aria-label="t('a11y.accountActions')"
      :aria-disabled="canEdit ? undefined : 'true'"
      @click="openMenu"
      @keydown.down.prevent="openMenu"
    >
      <Ellipsis aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-3) var(--space-3) var(--space-2);
}

.header__name {
  min-width: 0;
  margin: 0 var(--space-2) 0 0;
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--font-xl);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header__input {
  min-width: 16rem;
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-strong);
  font: inherit;
}

.header__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
}

.header__icon[aria-disabled='true'] {
  color: var(--text-disabled);
  cursor: default;
}

.header__icon svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

/* Shown on hover or keyboard focus, and always in the tab order (22 §2.3). */
.header__icon--hover {
  opacity: 0;
}

.header:hover .header__icon--hover,
.header:focus-within .header__icon--hover {
  opacity: 1;
}

.header__menu {
  margin-left: auto;
}
</style>
