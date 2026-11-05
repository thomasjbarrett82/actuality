<script setup lang="ts">
// The session's modal questions and reactions to host state (03 §4, §6.3, §7, §9): the sign-in modal while
// AuthRequired, the encryption prompt (also when a reconnect needs the password, 03 §4.2), and the Error
// state's dialog, and a budget a restarted host couldn't reopen (03 §6.5).
import { onBeforeUnmount, watch } from 'vue';
import { host } from '../../rpc/host-client';
import { continuePendingOpen, handleErrorState, openBudget, restoreFailed } from '../../session';
import { useAppStore } from '../../stores/app';
import { useConnection } from '../../stores/connection';
import { usePrompts } from '../../stores/prompts';
import { useStart } from '../../stores/start';
import EncryptionDialog from './EncryptionDialog.vue';
import SignInModal from './SignInModal.vue';

const connection = useConnection();
const prompts = usePrompts();
const app = useAppStore();
const start = useStart();

/** After a sign-in: the budget the host resumed, or the one startup was waiting for (07 §1). */
async function afterSignIn(): Promise<void> {
  if (connection.info.budget) {
    if (app.screen === 'start' && start.screen !== 'preferences') app.backToMain();
    return;
  }
  await continuePendingOpen();
}

watch(
  () => connection.info.state,
  (state, before) => {
    if (state === 'Error' && before !== 'Error') void handleErrorState(connection.info.message);
  },
);

const offRestoreFailed = host.on('session:restoreFailed', ({ cloudFileId, error }) => {
  void restoreFailed(cloudFileId, error);
});
onBeforeUnmount(offRestoreFailed);

// A reconnect of an encrypted budget needs its password (03 §4.2): ask, then open it online.
watch(
  () => connection.info.message,
  async (message) => {
    const budget = connection.info.budget;
    if (!budget || connection.info.state !== 'OfflineReadOnly') return;
    if (message !== 'missing-key' && message !== 'decrypt-failure') return;
    const answer = await prompts.askEncryptionPassword(budget.name, message === 'decrypt-failure');
    if (answer) await openBudget({ cloudFileId: budget.cloudFileId, name: budget.name }, answer);
  },
);
</script>

<template>
  <SignInModal
    v-if="connection.info.state === 'AuthRequired' && connection.hostReady"
    @signed-in="afterSignIn"
  />
  <EncryptionDialog
    v-if="prompts.encryption"
    :key="`${prompts.encryption.name}:${String(prompts.encryption.retry)}`"
    :name="prompts.encryption.name"
    :retry="prompts.encryption.retry"
  />
</template>
