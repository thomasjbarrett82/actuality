// Opening the account dialogs (13 §2, §4): Create Account, then the new account's register; Close
// Account, then the close or force close it chose. Kept apart from flows.ts, which the dialog components
// import, so there is no import cycle.
import type { Account } from '@shared/domain/types';
import CloseAccountDialog from '../components/accounts/CloseAccountDialog.vue';
import CreateAccountDialog from '../components/accounts/CreateAccountDialog.vue';
import { useAppStore } from '../stores/app';
import { useModals } from '../stores/modals';
import { closeAccount, type CloseChoice } from './flows';

/** The Close Account dialog (13 §4): what the user chose, or null on Cancel. */
export function askClose(account: Account): Promise<CloseChoice | null> {
  return useModals().open<CloseChoice>(CloseAccountDialog, { account });
}

/** Sidebar Add Account (13 §2): the dialog, then the new account's register. */
export async function createAccount(): Promise<void> {
  const id = await useModals().open<string>(CreateAccountDialog, {});
  if (id) useAppStore().toAccount(id);
}

/** Close Account from the header, the sidebar or the Edit menu (13 §4). */
export const closeAccountFlow = (account: Account): Promise<'closed' | 'deleted' | null> =>
  closeAccount(account, askClose);
