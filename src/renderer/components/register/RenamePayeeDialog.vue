<script setup lang="ts">
// Rename Payee (14 §3.1): "Rename like payees..." in the register menu. The new name is a payee
// auto-complete (match any part), pre-filled. Checks: unchanged, blank, an invalid transfer name. Then the
// rename's impact is confirmed unless nothing (or exactly one renameable transaction) is affected.
import { ENGLISH_TRANSFER_PREFIX } from '@shared/domain/payees';
import type { Id } from '@shared/domain/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAccounts, usePayees } from '../../queries/budget-data';
import { attempt, tell } from '../../register/dialogs';
import { resolvePayee } from '../../register/editable';
import { payeeEntries } from '../../register/entries';
import { host } from '../../rpc/host-client';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import AutoComplete from '../common/AutoComplete.vue';
import type { AutoCompleteApi } from '../common/exposed';
import { escapeRichText } from '../common/rich-text';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ payeeId: Id }>();
const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const payeesQ = usePayees();
const accountsQ = useAccounts();
const connection = useConnection();

const payee = computed(() => payeesQ.data.value?.find((p) => p.id === props.payeeId));
const name = ref(payee.value?.name ?? '');
const busy = ref(false);
const field = ref<AutoCompleteApi | null>(null);
const entries = computed(() =>
  payeeEntries(payeesQ.data.value ?? [], accountsQ.data.value ?? [], null, {
    heading: t('app.editTransferHeading'),
    transfer: (account: string) => t('app.transferPayee', { account }),
  }),
);

/** Names in the confirmation are cut at 30 characters (14 §3.1). */
const cut = (s: string): string => escapeRichText(s.length > 30 ? `${s.slice(0, 30)}…` : s);

async function confirmImpact(
  oldName: string,
  newName: string,
  transferId: Id | null,
  transferName: string,
): Promise<boolean> {
  const impact = await host.call('payees.renameImpact', {
    id: props.payeeId,
    ...(transferId ? { transferAccountId: transferId } : {}),
  });
  const n = impact.total;
  const k = impact.renameable;
  if (n === 0 || (n === 1 && k === 1)) return true;
  if (k === 0) {
    await tell(
      t('app.renameNoneTitle'),
      t('app.renameNoneMessage', { n, old: cut(oldName), new: cut(newName) }),
      'warning',
      'ok',
    );
    return false;
  }
  const body =
    k === n
      ? t('app.renameAllMessage', { n, old: cut(oldName), new: cut(newName) })
      : t('app.renameSomeMessage', { k, n, old: cut(oldName), new: cut(newName) });
  const note = transferId
    ? t('app.renameTransferNote', { account: escapeRichText(transferName) })
    : '';
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('register.payeeRenameHeading'),
    content: body + note,
    icon: 'info',
    buttons: [{ id: 'rename', label: t('app.renameButton'), isDefault: true }, 'cancel'],
  });
  return button === 'rename';
}

async function submit(): Promise<void> {
  const current = payee.value;
  if (!current || busy.value) return;
  // The field's text, also when Enter submits before the auto-complete has taken it.
  const typed = (field.value?.element()?.value ?? name.value).trim();
  if (typed === current.name) {
    await tell(t('app.renameEnterNewTitle'), t('app.renameEnterNewMessage'), 'warning', 'ok');
    return;
  }
  if (typed === '') {
    await tell(t('app.editInvalidPayeeTitle'), t('app.renameBlankMessage'));
    return;
  }
  const res = resolvePayee(
    typed,
    [t('app.transferPrefix'), ENGLISH_TRANSFER_PREFIX],
    payeesQ.data.value ?? [],
    accountsQ.data.value ?? [],
  );
  if (res.kind === 'invalidTransfer') {
    await tell(
      t('app.editInvalidPayeeTitle'),
      t('app.editInvalidTransferMessage', { name: escapeRichText(typed) }),
    );
    return;
  }
  const transfer = res.kind === 'transfer' ? res.account : null;
  busy.value = true;
  try {
    if (!(await confirmImpact(current.name, typed, transfer?.id ?? null, transfer?.name ?? '')))
      return;
    const result = await attempt(() =>
      host.call('payees.rename', {
        id: props.payeeId,
        name: typed,
        ...(transfer ? { transferAccountId: transfer.id } : {}),
      }),
    );
    if (result.ok) emit('close', null);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <StandardDialog
    :title="t('register.payeeRenameTitle')"
    @cancel="emit('close', null)"
    @submit="submit"
  >
    <div class="rename-payee">
      <p class="rename-payee__text">
        {{ t('register.payeeRenameDescription', { name: payee?.name ?? '' }) }}
      </p>
      <span class="rename-payee__label">{{ t('register.currentPayeeNameLabel') }}</span>
      <span class="rename-payee__value">{{ payee?.name ?? '' }}</span>
      <span class="rename-payee__label">{{ t('register.newPayeeNameLabel') }}</span>
      <AutoComplete
        ref="field"
        v-model="name"
        :entries="entries"
        :label="t('register.newPayeeNameLabel')"
        min-width="15.5rem"
        :disabled="!connection.canEdit"
      />
    </div>
    <template #footer>
      <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
      <UiButton primary :disabled="busy || !connection.canEdit" @click="submit">{{
        t('app.renameButton')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.rename-payee {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-3) var(--space-4);
  align-items: center;
}

.rename-payee__text {
  grid-column: 1 / -1;
  margin: 0;
}

.rename-payee__label {
  font-weight: 600;
}
</style>
