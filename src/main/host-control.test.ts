import { INITIAL_CONNECTION } from '@shared/connection';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRASH_WINDOW_MS,
  CrashPolicy,
  handleControl,
  isSafeExternalUrl,
  SessionRecord,
  type ControlContext,
} from './host-control';
import { SecretsStore } from './secrets';
import { SettingsStore } from './settings-store';

function ctx(): ControlContext & { opened: string[]; focused: number } {
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-ctl-'));
  const c = {
    settings: new SettingsStore(dir),
    secrets: new SecretsStore(dir, {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s).reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
    }),
    opened: [] as string[],
    focused: 0,
    openExternal: (url: string) => {
      c.opened.push(url);
      return Promise.resolve();
    },
    focusWindow: () => {
      c.focused++;
    },
    translate: (key: string, params?: Record<string, string>) =>
      `${key}:${JSON.stringify(params ?? {})}`,
  };
  return c;
}

describe('control channel, main side (02 §4.1)', () => {
  it('translates text the host must show (20 §3.4)', async () => {
    await expect(
      handleControl(ctx(), 'i18n.translate', { key: 'app.openIdSignedInPage' }),
    ).resolves.toBe('app.openIdSignedInPage:{}');
    await expect(
      handleControl(ctx(), 'i18n.translate', { key: 'not a key' }),
    ).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('round-trips secrets and settings', async () => {
    const c = ctx();
    await handleControl(c, 'secrets.set', { key: 'server:https://x', value: 'tok' });
    await expect(handleControl(c, 'secrets.get', { key: 'server:https://x' })).resolves.toBe('tok');
    await handleControl(c, 'secrets.set', { key: 'e2e:b1', value: 'pw' });
    await handleControl(c, 'secrets.clear', { prefix: 'e2e:' });
    await expect(handleControl(c, 'secrets.get', { key: 'e2e:b1' })).resolves.toBeNull();
    await handleControl(c, 'secrets.delete', { key: 'server:https://x' });
    await handleControl(c, 'secrets.clear', {});
    await expect(handleControl(c, 'secrets.get', { key: 'server:https://x' })).resolves.toBeNull();

    await expect(
      handleControl(c, 'settings.patchApp', { patch: { serverUrl: 'https://x' } }),
    ).resolves.toMatchObject({ serverUrl: 'https://x' });
    await expect(handleControl(c, 'settings.getApp', {})).resolves.toMatchObject({
      serverUrl: 'https://x',
    });
    await handleControl(c, 'settings.patchBudget', { cloudFileId: 'b1', patch: { localId: 'L' } });
    await expect(
      handleControl(c, 'settings.getBudget', { cloudFileId: 'b1' }),
    ).resolves.toMatchObject({ localId: 'L' });
    await handleControl(c, 'settings.patchAllBudgets', { patch: { localId: null } });
    await handleControl(c, 'settings.deleteBudget', { cloudFileId: 'b1' });
    await handleControl(c, 'settings.deleteAllBudgets', {});
    expect(c.settings.budgetIds()).toEqual([]);
  });

  it('validates params and method names', async () => {
    const c = ctx();
    await expect(handleControl(c, 'secrets.get', { key: 'password' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      handleControl(c, 'settings.patchApp', { patch: { zoomFactor: 9 } }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(handleControl(c, 'nope', {})).rejects.toMatchObject({ code: 'validation' });
  });

  it('opens only http(s) links, and focuses the window', async () => {
    const c = ctx();
    await handleControl(c, 'shell.openExternal', { url: 'https://login.example.com/x' });
    await expect(
      handleControl(c, 'shell.openExternal', { url: 'file:///etc/passwd' }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(c.opened).toEqual(['https://login.example.com/x']);
    await handleControl(c, 'window.focus', {});
    expect(c.focused).toBe(1);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('http://x')).toBe(true);
  });
});

describe('crash recovery (03 §6.5)', () => {
  it('stops restarting after 3 crashes within 5 minutes', () => {
    const p = new CrashPolicy();
    expect(p.recordCrash(0)).toBe(true);
    expect(p.recordCrash(1000)).toBe(true);
    expect(p.recordCrash(2000)).toBe(false);
    const q = new CrashPolicy();
    expect(q.recordCrash(0)).toBe(true);
    expect(q.recordCrash(1000)).toBe(true);
    expect(q.recordCrash(CRASH_WINDOW_MS + 1)).toBe(true);
  });

  it('records the session to reopen', () => {
    const r = new SessionRecord();
    expect(r.restore()).toBeNull();
    r.onEvent('connection:state', {
      ...INITIAL_CONNECTION,
      state: 'SignedIn',
      serverUrl: 'https://x',
    });
    expect(r.restore()).toEqual({ serverUrl: 'https://x', cloudFileId: null, localOnly: false });
    const budget = {
      cloudFileId: 'b1',
      groupId: 'g',
      name: 'B',
      budgetType: 'envelope' as const,
      localOnly: true,
    };
    r.onEvent('budget:opened', budget);
    r.onEvent('connection:state', {
      ...INITIAL_CONNECTION,
      state: 'OfflineReadOnly',
      serverUrl: 'https://x',
      budget,
    });
    expect(r.restore()).toEqual({ serverUrl: 'https://x', cloudFileId: 'b1', localOnly: true });
    r.onEvent('connection:state', {
      ...INITIAL_CONNECTION,
      state: 'Disconnected',
      serverUrl: 'https://x',
    });
    expect(r.restore()).toBeNull();
  });

  it('remembers an interrupted slate wipe once', () => {
    const r = new SessionRecord();
    r.onEvent('job:slateWipe', { phase: 'started', backupPath: '/b.zip' });
    expect(r.takeInterruptedSlateWipe()).toEqual({ backupPath: '/b.zip' });
    expect(r.takeInterruptedSlateWipe()).toBeNull();
    r.onEvent('job:slateWipe', { phase: 'started' });
    r.onEvent('job:slateWipe', { phase: 'ended' });
    expect(r.takeInterruptedSlateWipe()).toBeNull();
    r.onEvent('log', { at: 0, level: 'info', source: 'host', message: 'x' });
    expect(r.restore()).toBeNull();
  });

  it('hands an interrupted slate wipe to the restore, once', () => {
    const r = new SessionRecord();
    r.onEvent('connection:state', {
      ...INITIAL_CONNECTION,
      state: 'Online',
      serverUrl: 'https://x',
    });
    r.onEvent('budget:opened', {
      cloudFileId: 'b1',
      groupId: 'g1',
      name: 'B',
      budgetType: 'envelope',
      localOnly: false,
    });
    r.onEvent('job:slateWipe', { phase: 'started', backupPath: '/b.zip' });
    expect(r.restore()).toEqual({
      serverUrl: 'https://x',
      cloudFileId: 'b1',
      localOnly: false,
      interruptedSlateWipe: '/b.zip',
    });
    expect(r.restore()?.interruptedSlateWipe).toBeUndefined();
  });
});
