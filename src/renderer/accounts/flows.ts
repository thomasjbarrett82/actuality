// Account flows in the renderer (13 §2–5, 08 §4): the questions they ask, the validation messages, and
// the host calls. Dialogs, the sidebar and the register's account header call these; the host does the
// writes (03 §8 `accounts.*`).
import { accountNameError, groupOf } from '@shared/domain/accounts';
import type { Account, Id } from '@shared/domain/types';
import type { ReconcileTexts } from '@shared/rpc/host-api';
import { escapeRichText } from '../components/common/rich-text';
import { i18n } from '../i18n';
import { host } from '../rpc/host-client';
import { showUnexpected } from '../session';
import { useDialogs } from '../stores/dialogs';

const t = (key: string, params: Record<string, unknown> | unknown[] = {}): string =>
  i18n.global.t(key, params as Record<string, unknown>);

/** Text the host writes into the budget, in the UI language (20 §3.8): the adjustment's notes. */
export function reconcileTexts(): ReconcileTexts {
  return { adjustmentNotes: t('accounts.reconciliationAdjustmentNotes') };
}

async function tell(instruction: string, content: string): Promise<void> {
  await useDialogs().showTaskDialog({ instruction, content, icon: 'logo', buttons: ['close'] });
}

const NAME_MESSAGES: Record<string, string> = {
  'name-empty': 'app.accountNameEmpty',
  'name-duplicate': 'app.accountNameExists',
  'name-backtick': 'app.accountNameBacktick',
};

/** Create Account's name check (13 §2): false after showing the message. */
export async function checkNewName(name: string, accounts: readonly Account[]): Promise<boolean> {
  const error = accountNameError(name, accounts);
  if (!error) return true;
  await tell(t('app.accountNameErrorTitle'), t(NAME_MESSAGES[`name-${error}`] ?? ''));
  return false;
}

/**
 * Rename's name check (13 §3): only a change other than in letter case is validated. False after
 * showing the message.
 */
export async function checkRename(
  account: Pick<Account, 'id' | 'name'>,
  name: string,
  accounts: readonly Account[],
): Promise<boolean> {
  if (name.trim().toLocaleLowerCase() === account.name.toLocaleLowerCase()) return true;
  const error = accountNameError(name, accounts, account.id);
  if (error === 'empty') await tell(t('app.accountNameProvide'), t('app.accountNameEmpty'));
  else if (error === 'duplicate')
    await tell(
      t('app.accountNameChoose'),
      t('app.accountNameAlready', { name: escapeRichText(name.trim()) }),
    );
  else if (error === 'backtick')
    await tell(t('app.accountNameChoose'), t('app.accountNameBacktick'));
  return error === null;
}

/** "Invalid Balance" (13 §2, §6.1). */
export async function invalidBalance(text: string): Promise<void> {
  await tell(
    t('app.invalidBalanceTitle'),
    t('app.invalidBalanceMessage', { value: escapeRichText(text) }),
  );
}

/** Runs a host write; an error is shown, and false returned. */
export async function attempt(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (e) {
    await showUnexpected(e);
    return false;
  }
}

/** Rename (13 §3): validates, then saves. False when the name was refused or the save failed. */
export async function renameAccount(
  account: Account,
  name: string,
  accounts: readonly Account[],
): Promise<boolean> {
  if (name.trim() === account.name) return true;
  if (!(await checkRename(account, name, accounts))) return false;
  return attempt(() => host.call('accounts.update', { id: account.id, name }));
}

/**
 * Force close (13 §5): Actual's delete of the account and all of its transactions, after the
 * confirmation. True once deleted.
 */
export async function deleteAccount(account: Account): Promise<boolean> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('accounts.confirmDeleteAccount', { account: account.name }),
    content: t('app.deleteAccountWarning'),
    icon: 'warning',
    buttons: [{ id: 'delete', label: t('accounts.deleteAccount') }, 'cancel'],
  });
  if (button !== 'delete') return false;
  return attempt(() => host.call('accounts.delete', { id: account.id }));
}

/** The transfer a close needs when the account still has a balance (13 §4). */
export interface CloseTransfer {
  transferAccountId: Id;
  transferCategoryId?: Id;
}

/** What the Close Account dialog chose (13 §4): close (with a transfer when there's a balance), or force close. */
export type CloseChoice = { action: 'close'; transfer?: CloseTransfer } | { action: 'forceClose' };

/** Accounts closed here by Close Account: they stay selected, so their menu offers Re-open (13 §4, 22 §3). */
const closedHere = new Set<Id>();

/** True once for an account this window just closed. */
export const takeClosedHere = (id: Id): boolean => closedHere.delete(id);

/**
 * Close Account (13 §4): `ask` shows the Close Account dialog; null cancels. Closing an account without
 * transactions deletes it, as Actual does; force close deletes it after its own confirmation. Returns
 * what happened.
 */
export async function closeAccount(
  account: Account,
  ask: (account: Account) => Promise<CloseChoice | null>,
): Promise<'closed' | 'deleted' | null> {
  const choice = await ask(account);
  if (!choice) return null;
  if (choice.action === 'forceClose') return (await deleteAccount(account)) ? 'deleted' : null;
  if (account.hasTransactions) closedHere.add(account.id);
  const ok = await attempt(() =>
    host.call('accounts.close', { id: account.id, ...choice.transfer }),
  );
  if (!ok) closedHere.delete(account.id);
  return ok ? (account.hasTransactions ? 'closed' : 'deleted') : null;
}

/** Re-open Account (13 §4). */
export const reopenAccount = (account: Account): Promise<boolean> =>
  attempt(() => host.call('accounts.reopen', { id: account.id }));

/** A sidebar drop or Move Up / Move Down (08 §4, 22 §2.4): a move within the account's own group. */
export const moveAccount = (account: Account, beforeId: Id | null): Promise<boolean> =>
  attempt(() =>
    host.call('accounts.reorder', { id: account.id, beforeId, group: groupOf(account) }),
  );
