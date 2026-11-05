// Opening the payee dialogs (14 §3.1, §4): Payee Settings, pre-selecting a payee by id or typed name (or
// the last one shown), and Rename Payee. Payee Settings' transaction link opens All Accounts filtered by
// the payee.
import type { Id } from '@shared/domain/types';
import PayeeSettingsDialog from '../components/register/PayeeSettingsDialog.vue';
import RenamePayeeDialog from '../components/register/RenamePayeeDialog.vue';
import { payeesQuery } from '../queries/budget-data';
import { queryClient } from '../rpc/query-client';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useModals } from '../stores/modals';
import { useRegisterSession } from './view-state';

/** What Payee Settings closes with: a register search to show, or nothing. */
export interface PayeeSettingsResult {
  search: string;
}

/** Payee Settings (14 §4). `payee`: an id, or a typed name; null re-selects the last-shown payee. */
export async function openPayeeSettings(payee: { id: Id } | string | null): Promise<void> {
  const payees = await queryClient.query(payeesQuery);
  let id: Id | null = null;
  if (typeof payee === 'string') {
    const name = payee.trim().toLocaleLowerCase();
    id = payees.find((p) => p.name.toLocaleLowerCase() === name)?.id ?? null;
  } else if (payee) id = payee.id;
  if (id === null) id = useBudgetSettings().settings.payeeSettings.lastPayeeId;
  const result = await useModals().open<PayeeSettingsResult>(PayeeSettingsDialog, {
    initialId: id && payees.some((p) => p.id === id) ? id : null,
  });
  if (!result) return;
  // "Click to see these transactions in the register" (14 §4).
  const app = useAppStore();
  if (app.toAllAccounts()) useRegisterSession().view('all').search = result.search;
}

/** Rename like payees… (10 §6.1, 14 §3.1). */
export async function openRenamePayee(payeeId: Id): Promise<void> {
  await useModals().open<null>(RenamePayeeDialog, { payeeId });
}
