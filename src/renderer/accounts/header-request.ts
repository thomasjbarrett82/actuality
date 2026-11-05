// Rename Account and Edit Account Note from the sidebar or the Edit menu (13 §3): they open the account's
// register, and its account header then acts once it's shown (22 §3).
import type { Id } from '@shared/domain/types';
import { shallowRef } from 'vue';
import { useAppStore } from '../stores/app';

export type HeaderAction = 'rename' | 'note';

/** The action waiting for the account's header; the header takes it. */
export const headerRequest = shallowRef<{ accountId: Id; action: HeaderAction } | null>(null);

/**
 * Opens the account's register, then leaves the action for its header. Nothing is left when the move is
 * refused or the open edit is kept, so a later visit doesn't act on its own.
 */
export async function requestHeaderAction(accountId: Id, action: HeaderAction): Promise<void> {
  if (await useAppStore().showAccount(accountId)) headerRequest.value = { accountId, action };
}

/** The pending action for this account, once; null when there is none. */
export function takeHeaderRequest(accountId: Id): HeaderAction | null {
  const request = headerRequest.value;
  if (request?.accountId !== accountId) return null;
  headerRequest.value = null;
  return request.action;
}
