// Derived app-level state: the window title (06 §1), the native menu state (06 §4) and the connection
// announcements (22 §4.5). Pure, so they're tested without a window.
import { APP_NAME } from '@shared/app';
import { canEdit, type ConnectionInfo } from '@shared/connection';
import type { HostStatus, MenuState } from '@shared/shell-api';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** "Actuality", "Actuality - {budget}", plus " (offline)" / " (signed out)" in OfflineReadOnly (06 §1). */
export function windowTitle(info: ConnectionInfo, t: Translate): string {
  const budget = info.budget?.name;
  if (!budget) return APP_NAME;
  if (info.state !== 'OfflineReadOnly') return t('app.titleBudget', { budget });
  return info.signedOut
    ? t('app.titleBudgetSignedOut', { budget })
    : t('app.titleBudgetOffline', { budget });
}

/** The parts of the menu state that come from the connection (06 §4). Screens add the rest. */
export function connectionMenuState(
  info: ConnectionInfo,
  hostStatus: HostStatus,
): Pick<MenuState, 'budgetOpen' | 'canEdit' | 'signedIn'> {
  return {
    budgetOpen: info.budget !== null,
    canEdit: hostStatus === 'running' && canEdit(info.state),
    signedIn: info.state === 'SignedIn',
  };
}

export interface Announcement {
  key: string;
  politeness: 'polite' | 'assertive';
}

/** Connection lost / back online (22 §4.5). Signed-out and sign-in texts are announced by their UI. */
export function connectionAnnouncement(
  before: ConnectionInfo,
  after: ConnectionInfo,
): Announcement | null {
  if (after.state === 'OfflineReadOnly' && before.state !== 'OfflineReadOnly' && !after.signedOut) {
    return { key: 'a11y.connectionLost', politeness: 'assertive' };
  }
  const wasOffline = before.state === 'OfflineReadOnly' || before.state === 'Reconnecting';
  if (wasOffline && canEdit(after.state)) return { key: 'a11y.backOnline', politeness: 'polite' };
  return null;
}
