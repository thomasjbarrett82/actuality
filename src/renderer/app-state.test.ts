import { APP_NAME } from '@shared/app';
import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import { describe, expect, it } from 'vitest';
import { connectionAnnouncement, connectionMenuState, windowTitle } from './app-state';

const t = (key: string, params?: Record<string, unknown>): string => {
  const budget = params?.['budget'];
  return `${key}(${typeof budget === 'string' ? budget : ''})`;
};
const budget = {
  cloudFileId: 'c1',
  groupId: 'g1',
  name: 'Home',
  budgetType: 'envelope' as const,
  localOnly: false,
};
const info = (patch: Partial<ConnectionInfo>): ConnectionInfo => ({
  ...INITIAL_CONNECTION,
  ...patch,
});

describe('window title (06 §1)', () => {
  it('is the app name without a budget', () => {
    expect(windowTitle(info({ state: 'SignedIn' }), t)).toBe(APP_NAME);
  });

  it('adds the budget, and offline or signed out in OfflineReadOnly', () => {
    expect(windowTitle(info({ state: 'Online', budget }), t)).toBe('app.titleBudget(Home)');
    expect(windowTitle(info({ state: 'OfflineReadOnly', budget }), t)).toBe(
      'app.titleBudgetOffline(Home)',
    );
    expect(windowTitle(info({ state: 'OfflineReadOnly', budget, signedOut: true }), t)).toBe(
      'app.titleBudgetSignedOut(Home)',
    );
  });
});

describe('menu state (06 §4)', () => {
  it('enables editing only when Online with the host running', () => {
    expect(connectionMenuState(info({ state: 'Online', budget }), 'running')).toEqual({
      budgetOpen: true,
      canEdit: true,
      signedIn: false,
    });
    expect(connectionMenuState(info({ state: 'Online', budget }), 'restarting').canEdit).toBe(
      false,
    );
    expect(connectionMenuState(info({ state: 'OfflineReadOnly', budget }), 'running').canEdit).toBe(
      false,
    );
    expect(connectionMenuState(info({ state: 'SignedIn' }), 'running')).toEqual({
      budgetOpen: false,
      canEdit: false,
      signedIn: true,
    });
  });
});

describe('connection announcements (22 §4.5)', () => {
  it('announces losing and regaining the connection', () => {
    const online = info({ state: 'Online', budget });
    const offline = info({ state: 'OfflineReadOnly', budget });
    expect(connectionAnnouncement(online, offline)).toEqual({
      key: 'a11y.connectionLost',
      politeness: 'assertive',
    });
    expect(connectionAnnouncement(offline, online)).toEqual({
      key: 'a11y.backOnline',
      politeness: 'polite',
    });
    expect(connectionAnnouncement(info({ state: 'Reconnecting', budget }), online)?.key).toBe(
      'a11y.backOnline',
    );
  });

  it('stays quiet otherwise', () => {
    expect(
      connectionAnnouncement(info({ state: 'Online' }), info({ state: 'Syncing' })),
    ).toBeNull();
    expect(
      connectionAnnouncement(
        info({ state: 'Online' }),
        info({ state: 'OfflineReadOnly', signedOut: true }),
      ),
    ).toBeNull();
  });
});
