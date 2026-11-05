// Screen and navigation state (06 §3). The app starts on the blue canvas ('start', 07); the other screens
// are the main canvas's. The main canvas screen is saved per budget and device as `lastScreen` (19 §2).
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { leaveEdit } from '../register/edit-guard';
import { useBudgetSettings } from './budget-settings';
import { useSettings } from './settings';

export type Screen = 'start' | 'welcome' | 'budget' | 'register' | 'reports';
export type MainScreen = Exclude<Screen, 'start'>;

/** `lastScreen` (06 §3): "budget", "reports", "all" or "account:{id}"; null is the Welcome panel. */
export function encodeScreen(screen: MainScreen, accountId: string | null): string | null {
  if (screen === 'budget' || screen === 'reports') return screen;
  if (screen === 'register')
    return accountId === null || accountId === 'all' ? 'all' : `account:${accountId}`;
  return null;
}

/** The screen a saved `lastScreen` restores; an account that's gone falls back to Budget (06 §3). */
export function decodeScreen(
  value: string | null,
  accountExists: (id: string) => boolean,
): { screen: MainScreen; accountId: string | null } {
  if (value === null) return { screen: 'welcome', accountId: null };
  if (value === 'budget' || value === 'reports') return { screen: value, accountId: null };
  if (value === 'all') return { screen: 'register', accountId: 'all' };
  const id = value.startsWith('account:') ? value.slice('account:'.length) : '';
  if (id !== '' && accountExists(id)) return { screen: 'register', accountId: id };
  return { screen: 'budget', accountId: null };
}

export const useAppStore = defineStore('app', () => {
  const screen = ref<Screen>('start');
  /** An account id, 'all' for All Accounts, or null. */
  const activeAccountId = ref<string | null>(null);
  /** The main canvas screen to return to from a start screen opened over a budget (07 §3.3, §7). */
  const lastMain = ref<MainScreen>('welcome');
  const lastMainAccountId = ref<string | null>(null);
  /** The last register shown, for View ▸ Go to Accounts (06 §4). */
  const lastRegisterAccountId = ref<string | null>(null);
  /** The current screen's first load is in progress: navigation is ignored (06 §3). */
  const busy = ref(false);
  /** Screens shown at least once since the budget opened: the loading illustration shows only once. */
  const seenScreens = ref(new Set<MainScreen>());
  /** Privacy mode (06 §7): the `privacyMode` preference, per device and for every budget. */
  const privacyMode = computed(() => useSettings().app.privacyMode);

  function togglePrivacyMode(): Promise<void> {
    return useSettings().set('privacyMode', !privacyMode.value);
  }

  /**
   * Changes screen. Between main-canvas screens it's ignored while the current one is busy. An open
   * register edit is committed first (11 §1); if that fails or is cancelled, nothing happens.
   */
  function navigate(next: Screen, accountId: string | null = null): boolean {
    return go(next, accountId) === true;
  }

  /** `navigate`, or a promise when it waits for the open edit: true once the screen changed. */
  function go(next: Screen, accountId: string | null): boolean | Promise<boolean> {
    if (busy.value && screen.value !== 'start' && next !== 'start') return false;
    const same =
      next === screen.value && (next !== 'register' || accountId === activeAccountId.value);
    if (!same) {
      const leave = leaveEdit();
      if (leave === false) return false;
      if (leave !== true) return leave.then((ok) => ok && go(next, accountId) === true);
    }
    if (next !== 'start') {
      lastMain.value = next;
      lastMainAccountId.value = next === 'register' ? accountId : null;
      activeAccountId.value = next === 'register' ? accountId : null;
      if (next === 'register') lastRegisterAccountId.value = accountId;
      void useBudgetSettings().patch({ lastScreen: encodeScreen(next, accountId) });
    }
    screen.value = next;
    return true;
  }

  /** A budget opened: forget the previous budget's screens. */
  function resetForBudget(): void {
    seenScreens.value = new Set();
    lastMain.value = 'welcome';
    lastMainAccountId.value = null;
    lastRegisterAccountId.value = null;
    activeAccountId.value = null;
    busy.value = false;
  }

  /** Back from a start screen opened over the budget, to the screen it was opened from. */
  const backToMain = (): boolean => navigate(lastMain.value, lastMainAccountId.value);

  const toWelcome = (): boolean => navigate('welcome');
  const toBudget = (): boolean => navigate('budget');
  const toReports = (): boolean => navigate('reports');
  const toAllAccounts = (): boolean => navigate('register', 'all');
  const toAccount = (id: string): boolean => navigate('register', id);
  /** `toAccount` that also waits for the open edit: true once the register shows the account. */
  const showAccount = async (id: string): Promise<boolean> => go('register', id);

  return {
    screen,
    activeAccountId,
    lastMain,
    lastRegisterAccountId,
    busy,
    seenScreens,
    privacyMode,
    togglePrivacyMode,
    navigate,
    resetForBudget,
    backToMain,
    toWelcome,
    toBudget,
    toReports,
    toAllAccounts,
    toAccount,
    showAccount,
  };
});
