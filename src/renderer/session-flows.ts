// Close-budget and quit flows (06 §5, 03 §5.4): with unsynced changes, ask first. "Try again" syncs and
// carries on only if that worked; "Quit/Close anyway" carries on; Cancel (or Esc) stops.
import { i18n } from './i18n';
import { leaveEdit } from './register/edit-guard';
import { host } from './rpc/host-client';
import { useConnection } from './stores/connection';
import { useDialogs } from './stores/dialogs';
import { useSettings } from './stores/settings';

export type Leaving = 'quit' | 'close';

/**
 * Resolves true when it's fine to leave the budget (quit or close): an open register edit is committed
 * first (06 §5 step 1), then the unsynced-changes check.
 */
export async function confirmLeave(kind: Leaving): Promise<boolean> {
  if (!(await leaveEdit())) return false;
  const connection = useConnection();
  const dialogs = useDialogs();
  const settings = useSettings();
  const { t } = i18n.global;
  for (;;) {
    if (!connection.info.budget || !connection.info.unsyncedChanges) return true;
    const keepCache = kind === 'quit' && settings.app.clearCacheOnExit;
    const { button } = await dialogs.showTaskDialog({
      instruction: t('app.unsyncedTitle'),
      content: keepCache
        ? `<p>${t('app.unsyncedMessage')}</p><p>${t('app.unsyncedKeepCache')}</p>`
        : t('app.unsyncedMessage'),
      icon: 'warning',
      buttons: [
        { id: 'retry', label: t('app.tryAgain'), isDefault: true },
        { id: 'anyway', label: kind === 'quit' ? t('app.quitAnyway') : t('app.closeAnyway') },
        'cancel',
      ],
    });
    if (button === 'anyway') return true;
    if (button !== 'retry') return false;
    await host.call('session.syncNow', {}).catch(() => undefined);
    // The loop asks again if the changes still haven't gone.
  }
}

/** Window close / quit (06 §5): main asks, the renderer checks, then main quits. */
export async function quit(): Promise<void> {
  if (await confirmLeave('quit')) await window.app.shell.quit();
}
