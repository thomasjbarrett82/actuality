import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_FILE, RotatingLog } from './log';
import { SecretsStore, type Cipher } from './secrets';
import { migrate, renameRetrying, SettingsStore } from './settings-store';

/** A reversible fake cipher: the file must not contain the plain value. */
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'actual-desktop-test-'));
});

describe('SettingsStore (19)', () => {
  it('starts from defaults and survives a restart', () => {
    const a = new SettingsStore(dir);
    expect(a.getApp()).toEqual(DEFAULT_APP_SETTINGS);
    a.patchApp({ zoomFactor: 1.5, serverUrl: 'https://x' });
    const b = new SettingsStore(dir);
    expect(b.getApp()).toMatchObject({ zoomFactor: 1.5, serverUrl: 'https://x', schemaVersion: 1 });
  });

  it('reads a damaged file tolerantly', () => {
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(new SettingsStore(dir).getApp()).toEqual(DEFAULT_APP_SETTINGS);
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ zoomFactor: 'big', sidebarExpanded: false }),
    );
    expect(new SettingsStore(dir).getApp()).toMatchObject({
      zoomFactor: 1,
      sidebarExpanded: false,
    });
  });

  it('writes atomically, leaving no temp files', () => {
    const s = new SettingsStore(dir);
    s.patchApp({ language: 'de' });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps per-budget files and notifies changes', () => {
    const s = new SettingsStore(dir);
    const changes: string[] = [];
    const off = s.onChange((c) => changes.push(c.scope));
    s.patchBudget('abc-1', { localId: 'L1', lastSyncAt: 5 });
    s.patchBudget('def-2', { localId: 'L2' });
    expect(s.getBudget('abc-1')).toMatchObject({ localId: 'L1', lastSyncAt: 5 });
    expect(s.budgetIds().sort()).toEqual(['abc-1', 'def-2']);
    s.patchAllBudgets({ localId: null, lastSyncAt: null });
    expect(s.getBudget('def-2').localId).toBeNull();
    s.deleteBudget('abc-1');
    expect(s.budgetIds()).toEqual(['def-2']);
    s.deleteAllBudgets();
    expect(s.budgetIds()).toEqual([]);
    off();
    s.patchApp({ language: 'en' });
    expect(changes).toEqual(Array<string>(6).fill('budget'));
  });

  it('refuses unsafe budget ids', () => {
    expect(() => new SettingsStore(dir).getBudget('../evil')).toThrow();
  });

  it('migrates files without a version and keeps newer ones as they are', () => {
    expect(migrate({ a: 1 })).toEqual({ a: 1, schemaVersion: 1 });
    expect(migrate({ schemaVersion: 9 })).toEqual({ schemaVersion: 9 });
    expect(migrate('x')).toBe('x');
  });

  it('retries a rename while Windows holds the file, then gives up', () => {
    const locked = (code: string) => Object.assign(new Error(code), { code });
    let calls = 0;
    const waits: number[] = [];
    renameRetrying(
      'a',
      'b',
      () => {
        if (++calls < 3) throw locked(calls === 1 ? 'EPERM' : 'EBUSY');
      },
      (ms) => waits.push(ms),
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([10, 20]);
    const always = () => {
      throw locked('EBUSY');
    };
    expect(() => {
      renameRetrying('a', 'b', always, () => undefined);
    }).toThrow('EBUSY');
    let other = 0;
    const missing = () => {
      other++;
      throw locked('ENOENT');
    };
    expect(() => {
      renameRetrying('a', 'b', missing, () => undefined);
    }).toThrow('ENOENT');
    expect(other).toBe(1);
  });
});

describe('SecretsStore (19 §4)', () => {
  it('stores values encrypted, readable after a restart', () => {
    const s = new SecretsStore(dir, cipher);
    s.set('server:https://x', 'token-123');
    const file = readFileSync(join(dir, 'secrets.json'), 'utf8');
    expect(file).not.toContain('token-123');
    const again = new SecretsStore(dir, cipher);
    expect(again.get('server:https://x')).toBe('token-123');
    expect(again.has('server:https://x')).toBe(true);
    expect(again.get('missing')).toBeNull();
  });

  it('deletes one, a prefix, or all', () => {
    const s = new SecretsStore(dir, cipher);
    s.set('server:a', '1');
    s.set('e2e:b', '2');
    s.set('e2e:c', '3');
    s.delete('server:a');
    s.delete('server:a');
    expect(s.has('server:a')).toBe(false);
    s.clear('e2e:');
    expect(s.has('e2e:b')).toBe(false);
    s.set('server:z', '9');
    s.clear();
    expect(s.has('server:z')).toBe(false);
  });

  it('refuses to store without secure storage, and reads nothing', () => {
    const off: Cipher = { ...cipher, isEncryptionAvailable: () => false };
    const s = new SecretsStore(dir, off);
    expect(s.available()).toBe(false);
    expect(() => {
      s.set('server:a', '1');
    }).toThrow();
    expect(s.get('server:a')).toBeNull();
  });

  it('ignores a damaged file and undecryptable values', () => {
    writeFileSync(join(dir, 'secrets.json'), '[1,2');
    expect(new SecretsStore(dir, cipher).has('x')).toBe(false);
    writeFileSync(join(dir, 'secrets.json'), JSON.stringify({ 'server:a': 'zz', bad: 3 }));
    const broken: Cipher = {
      ...cipher,
      decryptString: () => {
        throw new Error('nope');
      },
    };
    const s = new SecretsStore(dir, broken);
    expect(s.get('server:a')).toBeNull();
    expect(s.has('bad')).toBe(false);
  });
});

describe('RotatingLog (17 §8)', () => {
  it('rotates at the size limit and keeps 5 files', () => {
    const log = new RotatingLog(dir, 200, 5);
    for (let i = 0; i < 40; i++)
      log.write({
        at: 0,
        level: 'info',
        source: 'main',
        message: `entry ${String(i)} ${'x'.repeat(40)}`,
        data: { i },
      });
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(LOG_FILE))
      .sort();
    expect(files).toEqual(['app.log', 'app.log.1', 'app.log.2', 'app.log.3', 'app.log.4']);
    expect(readFileSync(join(dir, LOG_FILE), 'utf8')).toContain('entry 39');
    expect(existsSync(join(dir, 'app.log.5'))).toBe(false);
  });
});
