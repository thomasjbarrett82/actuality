// Jump to transaction (10 §9.1): from popovers and the transfer icon. It goes to the
// transaction's account (or stays in All Accounts if that's showing); the register then clears the
// search or date filter only if they'd hide it, shows reconciled rows if it's reconciled, selects it and
// scrolls it into view. A split line jumps to its parent, expanded.
import type { Id } from '@shared/domain/types';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAppStore } from '../stores/app';

export interface JumpTarget {
  accountId: Id;
  /** The transaction, or a split's parent. */
  transactionId: Id;
  /** Set when the target was a split line: its parent opens. */
  expand?: boolean;
}

export const useJump = defineStore('registerJump', () => {
  const pending = ref<JumpTarget | null>(null);

  function jump(target: JumpTarget): void {
    const app = useAppStore();
    pending.value = target;
    const stayInAll = app.screen === 'register' && app.activeAccountId === 'all';
    if (!stayInAll) app.toAccount(target.accountId);
  }

  /** The register showing `accountId` takes the pending jump, if it's for it. */
  function take(accountId: string): JumpTarget | null {
    const p = pending.value;
    if (!p || (accountId !== 'all' && accountId !== p.accountId)) return null;
    pending.value = null;
    return p;
  }

  return { pending, jump, take };
});
