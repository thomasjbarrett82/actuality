// Session flows in the renderer (07 §1–5, 03 §6–9): startup, the start screens and the way back to the
// main canvas, opening and creating budgets (with the encryption prompt), sign-in errors, Sign out and
// Change server. The host does the work; this module chooses the screen, asks the questions and shows the
// errors.
import { ACTUAL_HTTPS_DOCS_URL, MIN_SERVER_VERSION } from '@shared/app';
import { today } from '@shared/dates';
import type { Account } from '@shared/domain/types';
import {
  BUDGET_FILE_TYPES,
  type BudgetFileType,
  type BudgetFormats,
  type BudgetTemplate,
} from '@shared/rpc/host-api';
import { RpcError, type RpcErrorData } from '@shared/rpc/protocol';
import type { FileFilter } from '@shared/shell-api';
import { trustCertificate } from './certificates';
import { i18n } from './i18n';
import { accountsQuery } from './queries/budget-data';
import { useReportsView } from './reports/state';
import { errorInfo, unreachableMessage, versionOlderThan } from './rpc/errors';
import { HOST_FAILED, host } from './rpc/host-client';
import { queryClient } from './rpc/query-client';
import { confirmLeave } from './session-flows';
import { decodeScreen, useAppStore } from './stores/app';
import { useBudgetSettings } from './stores/budget-settings';
import { useConnection } from './stores/connection';
import { useDialogs } from './stores/dialogs';
import { usePrompts } from './stores/prompts';
import { useSettings } from './stores/settings';
import { useStart, type PendingOpen, type StartScreen } from './stores/start';

const t = (key: string, params: Record<string, unknown> | unknown[] = {}): string =>
  i18n.global.t(key, params as Record<string, unknown>);

async function showError(instruction: string, content?: string): Promise<void> {
  await useDialogs().showTaskDialog({
    instruction,
    ...(content ? { content } : {}),
    icon: 'error',
    buttons: ['close'],
  });
}

/** Any error the screens don't handle themselves: TaskDialog "Something went wrong" (03 §9). */
export async function showUnexpected(e: unknown): Promise<void> {
  const info = errorInfo(e);
  // The host failed for good: App shows the one dialog for that (03 §6.5), not one per call.
  if (info.detail === HOST_FAILED) return;
  if (info.code === 'offline') {
    const url = useConnection().info.serverUrl ?? '';
    const m = unreachableMessage(url, info);
    await showError(t(m.key, m.params));
    return;
  }
  if (info.detail === 'permission-denied') {
    await showError(t('app.noPermission'));
    return;
  }
  await showError(t('app.somethingWentWrong'), info.message);
}

// ------------------------------------------------------------------------------------- navigation

/** Shows a start screen. Opened over a budget, its Back, Cancel or Done returns to the budget. */
export function showStartScreen(screen: StartScreen): void {
  const app = useAppStore();
  const start = useStart();
  if (app.screen !== 'start') start.returnTo = 'main';
  else if (start.screen !== 'loading' && start.screen !== screen) start.returnTo = start.screen;
  start.show(screen);
  app.navigate('start');
}

/** Back from Open Budget, Budget Setup / Properties or Preferences, to where they were opened from. */
export function leaveStartScreen(): void {
  const app = useAppStore();
  const start = useStart();
  if (start.returnTo === 'main' && useConnection().info.budget) {
    app.backToMain();
    return;
  }
  start.show(start.returnTo === 'main' ? 'budgets' : start.returnTo);
}

/**
 * The main canvas, after a budget opened (07 §1), on the budget's last screen (06 §3): Budget instead
 * of an account that's gone, the Welcome panel when nothing was saved.
 */
async function toMainCanvas(): Promise<void> {
  const start = useStart();
  start.canGoBack = false;
  start.returnTo = 'budgets';
  const app = useAppStore();
  app.resetForBudget();
  // Reports start on Summary with the default filters for each budget opened (15 §1, 19 §2).
  useReportsView().reset();
  // Another budget's data must never show: start the cache afresh.
  queryClient.clear();
  let target = decodeScreen(null, () => false);
  const budget = useConnection().info.budget;
  if (budget) {
    try {
      const saved = (await useBudgetSettings().load(budget.cloudFileId)).lastScreen;
      const accounts: Account[] = saved?.startsWith('account:')
        ? await queryClient.query(accountsQuery)
        : [];
      target = decodeScreen(saved, (id) => accounts.some((a) => a.id === id));
    } catch {
      // Unreadable settings or accounts: the Welcome panel.
    }
  }
  app.navigate(target.screen, target.accountId);
}

/** File ▸ Open (06 §4): the Budget List, or straight to Open Budget with no recent budgets (07 §3.2). */
export function openFromMenu(): void {
  const connection = useConnection();
  const app = useAppStore();
  const start = useStart();
  const openId = connection.info.budget?.cloudFileId;
  start.canGoBack = openId !== undefined && (app.screen !== 'start' || start.canGoBack);
  const hasRecent = useSettings().app.recentBudgets.some((r) => r.cloudFileId !== openId);
  showStartScreen(connection.info.serverUrl && !hasRecent ? 'open' : 'budgets');
}

/** Go Back on the Budget List (07 §3.3): return to the open budget. */
export function goBackToBudget(): void {
  const start = useStart();
  start.canGoBack = false;
  start.returnTo = 'budgets';
  useAppStore().backToMain();
}

// ---------------------------------------------------------------------------------------- startup

/** Warns once per sign-in when the server is older than the minimum (21 §7). */
async function checkServerVersion(): Promise<void> {
  const version = await host.call('session.serverVersion', {}).catch(() => null);
  if (version && versionOlderThan(version, MIN_SERVER_VERSION)) {
    await useDialogs().showTaskDialog({
      instruction: t('app.serverTooOld', { version, min: MIN_SERVER_VERSION }),
      icon: 'warning',
      buttons: ['ok'],
    });
  }
}

/** The startup sequence (07 §1), after the settings have loaded. */
export async function startup(): Promise<void> {
  const settings = useSettings().app;
  const start = useStart();
  useAppStore().navigate('start');
  const serverUrl = settings.serverUrl;
  if (!serverUrl) {
    start.show('connect');
    return;
  }
  start.connectAddress = serverUrl;
  const last = settings.openLastBudgetOnStartup ? settings.lastBudget : null;
  start.loading(
    last
      ? t('app.loadingBudget', { name: last.name })
      : t('app.loadingConnecting', { url: serverUrl }),
  );
  try {
    await host.call('session.connect', { serverURL: serverUrl, remember: false });
  } catch (e) {
    const info = errorInfo(e);
    if (info.code === 'auth') {
      // No stored token: the Budget List shows, empty, under the sign-in modal; the open continues after.
      start.pendingOpen = last;
      start.show('budgets');
      return;
    }
    if (info.code === 'offline' && last) {
      // A local-only open needs no token (03 §6.2).
      await openBudget(last);
      return;
    }
    start.show('budgets');
    if (info.code !== 'offline') await showUnexpected(e);
    return;
  }
  void checkServerVersion();
  if (last) await openBudget(last);
  else start.show('budgets');
}

/** Connect screen, password servers (07 §2). Errors are the caller's to show inline. */
export async function connectWithPassword(
  url: string,
  password: string,
  remember: boolean,
): Promise<void> {
  await host.call('session.connect', { serverURL: url, password, remember });
  useStart().show('budgets');
  void checkServerVersion();
}

/** Connect screen and sign-in modal, OpenID servers (03 §7). */
export async function connectWithOpenId(url: string, remember: boolean): Promise<void> {
  await host.call('session.connectOpenId', { serverURL: url, remember });
  if (!useConnection().info.budget) useStart().show('budgets');
  void checkServerVersion();
}

// ------------------------------------------------------------------------------------ open, create

/**
 * Opens a budget (07 §3.1, 03 §6.1): the Loading screen, then the main canvas. Asks for the encryption
 * password when needed (03 §7). Cancel on the Loading screen closes it again once the open finishes.
 */
export async function openBudget(
  budget: PendingOpen,
  e2e?: { password: string; remember: boolean },
): Promise<void> {
  const start = useStart();
  start.pendingOpen = null;
  useAppStore().navigate('start');
  const loading = start.loading(t('app.loadingBudget', { name: budget.name }));
  try {
    await host.call('session.openBudget', {
      cloudFileId: budget.cloudFileId,
      ...(e2e ? { e2ePassword: e2e.password, remember: e2e.remember } : {}),
    });
    if (start.wasCancelled(loading)) {
      await host.call('session.closeBudget', { force: false }).catch(() => undefined);
      return;
    }
    await toMainCanvas();
  } catch (e) {
    if (start.wasCancelled(loading)) return;
    await openFailed(budget, e);
  }
}

/** The host refuses budgets in Actual's Tracking mode (01 §3, 07 §3.2). */
const TRACKING_BUDGET = 'tracking-budget';

const showTrackingUnsupported = (): Promise<void> =>
  showError(t('app.budgetTrackingUnsupported'), t('app.budgetTrackingUnsupportedMessage'));

/** A budget that didn't open: the Budget List, then the prompt or the error that fits (03 §7, §9). */
async function openFailed(budget: PendingOpen, e: unknown): Promise<void> {
  const info = errorInfo(e);
  useStart().show('budgets');
  // The sign-in modal is up (AuthRequired); the host resumes this open after the sign-in.
  if (info.code === 'auth') return;
  if (info.detail === 'missing-key' || info.detail === 'decrypt-failure') {
    const answer = await usePrompts().askEncryptionPassword(
      budget.name,
      info.detail === 'decrypt-failure',
    );
    if (answer) await openBudget(budget, answer);
    return;
  }
  if (info.detail === 'old-key-style') await showError(t('app.encryptedOldFormat'));
  else if (info.detail === TRACKING_BUDGET) await showTrackingUnsupported();
  else if (info.code === 'not-found') await showError(t('app.budgetNotFound'));
  else if (info.detail === 'out-of-sync-migrations') await showError(t('app.budgetDamaged'));
  else if (info.code === 'offline') await showError(t('app.openOfflineUnavailable'));
  else await showUnexpected(e);
}

/**
 * A restarted host couldn't reopen the budget (03 §6.5): leave the main canvas, which has no budget
 * behind it any more, and handle it like any failed open.
 */
export async function restoreFailed(cloudFileId: string, error: RpcErrorData): Promise<void> {
  const app = useSettings().app;
  const known = [...app.recentBudgets, ...(app.lastBudget ? [app.lastBudget] : [])].find(
    (r) => r.cloudFileId === cloudFileId,
  );
  const start = useStart();
  start.canGoBack = false;
  start.returnTo = 'budgets';
  useAppStore().navigate('start');
  await openFailed({ cloudFileId, name: known?.name ?? '' }, RpcError.from(error));
}

/** Opens the budget the sign-in was waiting for (07 §1 step 4). */
export async function continuePendingOpen(): Promise<void> {
  const pending = useStart().pendingOpen;
  if (pending) await openBudget(pending);
}

/**
 * Budget Setup's Create Budget (07 §4): the unsynced-changes check, the Loading screen, then the main
 * canvas. The picked formats become the next defaults (19 §1). Errors return to Budget Setup, except a
 * failed upload, which returns to the Budget List.
 */
export async function createBudget(
  name: string,
  template: BudgetTemplate,
  formats: BudgetFormats,
): Promise<void> {
  if (!(await confirmLeave('close'))) return;
  const start = useStart();
  const settings = useSettings();
  start.setupError = null;
  start.loading(t('app.loadingCreating'));
  try {
    await host.call('budgetFile.create', { name, template, formats, force: true });
    start.setupDraft = null;
    await toMainCanvas();
    await Promise.all([
      settings.set('lastPickedCurrency', formats.currency),
      settings.set('lastPickedNumberFormat', formats.numberFormat),
      settings.set('lastPickedDateFormat', formats.dateFormat),
    ]);
  } catch (e) {
    const info = errorInfo(e);
    if (info.detail === 'upload-failed') {
      start.setupDraft = null;
      start.show('budgets');
      await showError(t('app.createUploadFailed'));
      return;
    }
    start.show('setup');
    if (info.detail === 'duplicate-name') start.setupError = t('app.setupDuplicateName', { name });
    else await showUnexpected(e);
  }
}

/** The open dialog's filters for each type of budget file (07 §3.4). */
function budgetFileFilters(type: BudgetFileType): FileFilter[] {
  switch (type) {
    case 'actual':
      return [{ name: t('app.bfActualFilter'), extensions: ['zip'] }];
    case 'ynab4':
      // The budget's zip, or the Budget.ymeta file inside its .ynab4 folder.
      return [{ name: t('app.bfYnab4Filter'), extensions: ['zip', 'ymeta'] }];
    case 'ynab5':
      return [{ name: t('app.bfYnab5Filter'), extensions: ['json'] }];
  }
}

/**
 * Import a budget file… (07 §3.4): "What type of file?", the file, the unsynced check, then the import
 * on the Loading screen. The host closes the open budget, uploads the import as a new server budget
 * (renamed when the name is taken) and opens it.
 */
export async function importBudgetFile(): Promise<void> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('app.bfWhatType'),
    icon: 'help',
    buttons: ['cancel'],
    commandLinks: [
      { id: 'actual', title: t('app.bfActual'), isDefault: true },
      { id: 'ynab4', title: t('app.bfYnab4'), subLabel: t('app.bfYnab4Hint') },
      { id: 'ynab5', title: t('app.bfYnab5') },
    ],
  });
  const type = BUDGET_FILE_TYPES.find((k) => k === button);
  if (!type) return;
  const path = await window.app.shell.files.openFile({
    title: t('app.bfImportTitle'),
    filters: budgetFileFilters(type),
  });
  if (!path || !(await confirmLeave('close'))) return;
  const start = useStart();
  const back = start.screen === 'loading' ? 'open' : start.screen;
  start.loading(t('app.bfImporting'));
  try {
    await host.call('budgetFile.importFile', {
      path,
      type,
      importedSuffix: t('app.bfImportedSuffix', { date: today(new Date()) }),
      force: true,
    });
    await toMainCanvas();
  } catch (e) {
    const info = errorInfo(e);
    // The open budget is closed by now unless the file couldn't be read.
    start.show(useConnection().info.budget ? back : 'open');
    if (info.detail === 'upload-failed') await showError(t('app.bfUploadFailed'));
    else if (info.detail === TRACKING_BUDGET) await showTrackingUnsupported();
    else if (info.detail === 'bad-file') await showError(t('app.bfBadFile'));
    else await showUnexpected(e);
  }
}

// ------------------------------------------------------------------------------------ leaving

/**
 * The unsynced-changes question before signing out or changing server (03 §5.4 variants). Resolves true
 * to go on (forced), false to stop. "Try again" syncs and asks again if changes are still waiting.
 */
async function confirmLeavingServer(kind: 'signOut' | 'changeServer'): Promise<boolean> {
  const connection = useConnection();
  const dialogs = useDialogs();
  for (;;) {
    if (!connection.info.budget || !connection.info.unsyncedChanges) return true;
    const { button } = await dialogs.showTaskDialog({
      instruction: t('app.unsyncedTitle'),
      content: t(
        kind === 'signOut' ? 'app.unsyncedSignOutMessage' : 'app.unsyncedChangeServerMessage',
      ),
      icon: 'warning',
      buttons: [
        { id: 'retry', label: t('app.tryAgain'), isDefault: true },
        {
          id: 'anyway',
          label: t(kind === 'signOut' ? 'app.signOutAnyway' : 'app.changeServerAnyway'),
        },
        'cancel',
      ],
    });
    if (button === 'anyway') return true;
    if (button !== 'retry') return false;
    await host.call('session.syncNow', {}).catch(() => undefined);
  }
}

/** The Connect screen, after leaving a server or a cancelled sign-in. */
function toConnect(address: string): void {
  const start = useStart();
  start.connectAddress = address;
  start.canGoBack = false;
  start.returnTo = 'budgets';
  start.show('connect');
  useAppStore().navigate('start');
}

/** Sign out (03 §7.3, 07 §3.3): back to Connect with the address filled in. */
export async function signOut(): Promise<void> {
  if (!(await confirmLeavingServer('signOut'))) return;
  const info = await host.call('session.signOut', { force: true });
  toConnect(info.serverUrl ?? '');
}

/** Change server… (03 §7.2): confirm, wipe, and back to an empty Connect screen. */
export async function changeServer(): Promise<void> {
  const url = useConnection().info.serverUrl ?? '';
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('app.changeServerTitle'),
    content: t('app.changeServerMessage', { url }),
    icon: 'warning',
    buttons: [{ id: 'change', label: t('app.changeServerConfirm') }, 'cancel'],
  });
  if (button !== 'change') return;
  if (!(await confirmLeavingServer('changeServer'))) return;
  await host.call('session.forgetServer', { force: true });
  toConnect('');
}

/** Cancel on the sign-in modal (03 §4): read-only with a budget open, else the Connect screen. */
export async function cancelSignIn(): Promise<void> {
  const info = await host.call('session.cancelSignIn', {});
  if (!info.budget) {
    useStart().pendingOpen = null;
    toConnect(info.serverUrl ?? '');
  }
}

/**
 * Retry now (03 §4.2, §9.1), from the banner or the sidebar indicator: one retry. A certificate or address
 * problem the probe found is shown once in a TaskDialog, with its action; the banner stays. "Use https://"
 * isn't offered here: the address changes only through Change server.
 */
export async function retryConnection(): Promise<void> {
  const result = await host.call('session.retryConnection', {});
  if (result.diagnosis === 'none') return;
  const m = unreachableMessage(result.connection.serverUrl ?? '', {
    diagnosis: result.diagnosis,
    errorCode: result.errorCode ?? null,
  });
  const action = m.action === 'learnMore' || m.action === 'trustCertificate' ? m.action : null;
  const { button } = await useDialogs().showTaskDialog({
    instruction: t(m.key, m.params),
    icon: 'error',
    buttons: [
      ...(action === null
        ? []
        : [
            {
              id: action,
              label: t(action === 'learnMore' ? 'app.learnMore' : 'app.trustCertificateFile'),
            },
          ]),
      'close',
    ],
  });
  if (button === 'learnMore') await window.app.shell.openExternal(ACTUAL_HTTPS_DOCS_URL);
  else if (button === 'trustCertificate') await trustCertificate();
}

/**
 * File ▸ Close Budget (06 §4, 03 §4): the unsynced check, then the Budget List, or Connect with the
 * address filled in when the session was signed out.
 */
export async function closeBudgetToList(): Promise<void> {
  const connection = useConnection();
  const { signedOut, serverUrl } = connection.info;
  if (!(await confirmLeave('close'))) return;
  await host.call('session.closeBudget', { force: true });
  if (signedOut) {
    toConnect(serverUrl ?? '');
    return;
  }
  const start = useStart();
  start.canGoBack = false;
  start.returnTo = 'budgets';
  start.show('budgets');
  useAppStore().navigate('start');
}

/**
 * The connection's Error state (03 §4, §9): explain it, then download again or go back to the Budget
 * List. `file-has-reset` keeps the budget visible behind the dialog.
 */
export async function handleErrorState(code: string | undefined): Promise<void> {
  const connection = useConnection();
  const budget = connection.info.budget;
  if (code === 'file-has-reset' && budget) {
    const unsynced = connection.info.unsyncedChanges;
    const { button } = await useDialogs().showTaskDialog({
      instruction: t('app.fileResetTitle'),
      content: unsynced
        ? `<p>${t('app.fileResetMessage')}</p><p>${t('app.fileResetUnsynced')}</p>`
        : t('app.fileResetMessage'),
      icon: 'warning',
      buttons: [
        { id: 'download', label: t('app.downloadAgain'), isDefault: true },
        { id: 'close', label: t('app.closeBudgetButton') },
      ],
    });
    await host.call('session.closeBudget', { force: true });
    if (button === 'download') {
      await openBudget({ cloudFileId: budget.cloudFileId, name: budget.name });
      return;
    }
  } else {
    if (code === 'out-of-sync-migrations') await showError(t('app.budgetDamaged'));
    else if (code === 'decrypt-failure') await showError(t('app.encryptedWrongPassword'));
    else await showError(t('app.somethingWentWrong'), code);
    await host.call('session.closeBudget', { force: true }).catch(() => undefined);
  }
  const start = useStart();
  start.canGoBack = false;
  start.show('budgets');
  useAppStore().navigate('start');
}
