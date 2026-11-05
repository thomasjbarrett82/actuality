// The blue start canvas (07): which full-window screen shows before a budget is open, the Loading text and
// its Cancel link, where Go Back and Done lead, and the Budget Setup form while its job runs.
import type { BudgetFormats } from '@shared/rpc/host-api';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type StartScreen =
  'connect' | 'budgets' | 'open' | 'loading' | 'setup' | 'properties' | 'preferences';

/** A budget to open once the sign-in finishes (07 §1 step 4). */
export interface PendingOpen {
  cloudFileId: string;
  name: string;
}

export type TemplateId = 'personal' | 'business';

/** Budget Setup's fields, kept while the Loading screen shows, so an error returns to them (07 §4). */
export interface SetupDraft extends BudgetFormats {
  name: string;
  template: TemplateId;
}

export const LOADING_CANCEL_AFTER_MS = 10_000;

export const useStart = defineStore('start', () => {
  const screen = ref<StartScreen>('loading');
  const loadingText = ref('');
  /** The Loading screen's Cancel link appears after 10 s (07 §5). */
  const loadingCancelable = ref(false);
  /** Each Loading screen gets a number; Cancel marks it, and the open in progress is then undone. */
  const loadingId = ref(0);
  const cancelledLoading = ref(0);
  /** The Budget List was opened from the menu while a budget is open: Go Back returns to it (07 §3.3). */
  const canGoBack = ref(false);
  /** The address the Connect screen starts with (after Sign out, 07 §3.3). */
  const connectAddress = ref('');
  /** Where Back, Cancel and Done lead: a start screen, or the main canvas (07 §4, §7). */
  const returnTo = ref<StartScreen | 'main'>('budgets');
  const pendingOpen = ref<PendingOpen | null>(null);
  const setupDraft = ref<SetupDraft | null>(null);
  /** An error to show on Budget Setup when it comes back from Loading (07 §4). */
  const setupError = ref<string | null>(null);
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;

  function show(next: StartScreen): void {
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = null;
    loadingCancelable.value = false;
    screen.value = next;
  }

  /** Shows the Loading screen; returns its number, for `wasCancelled`. */
  function loading(text: string): number {
    show('loading');
    loadingText.value = text;
    loadingId.value++;
    loadingTimer = setTimeout(() => {
      loadingCancelable.value = true;
    }, LOADING_CANCEL_AFTER_MS);
    return loadingId.value;
  }

  /** The Loading screen's Cancel (07 §5): back to the Budget List at once. */
  function cancelLoading(): void {
    cancelledLoading.value = loadingId.value;
    show('budgets');
  }

  const wasCancelled = (id: number): boolean => cancelledLoading.value === id;

  return {
    screen,
    loadingText,
    loadingCancelable,
    loadingId,
    canGoBack,
    connectAddress,
    returnTo,
    pendingOpen,
    setupDraft,
    setupError,
    show,
    loading,
    cancelLoading,
    wasCancelled,
  };
});
