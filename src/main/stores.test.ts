import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_FILE, RotatingLog } from './log';
import { SecretsStore, type Cipher } from './secrets';
import { migrate, renameRetrying, SettingsStore } from './settings-store';

/** A reversible fake cipher: the file must not contain the plain value. */
const xor = (b: Buffer): Buffer => Buffer.from([...b].map((x) => x ^ 0x5a));
const cipher: Cipher = {
  isAsyncEncryptionAvailable: () => Promise.resolve(true),
  encryptStringAsync: (s) => Promise.resolve(xor(Buffer.from(s, 'utf8'))),
  decryptStringAsync: (b) =>
    Promise.resolve({ result: xor(b).toString('utf8'), shouldReEncrypt: false }),
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
  it('stores values encrypted, readable after a restart', async () => {
    const s = new SecretsStore(dir, cipher);
    await s.set('server:https://x', 'token-123');
    const file = readFileSync(join(dir, 'secrets.json'), 'utf8');
    expect(file).not.toContain('token-123');
    const again = new SecretsStore(dir, cipher);
    await expect(again.get('server:https://x')).resolves.toBe('token-123');
    await expect(again.has('server:https://x')).resolves.toBe(true);
    await expect(again.get('missing')).resolves.toBeNull();
  });

  it('deletes one, a prefix, or all', async () => {
    const s = new SecretsStore(dir, cipher);
    await s.set('server:a', '1');
    await s.set('e2e:b', '2');
    await s.set('e2e:c', '3');
    await s.delete('server:a');
    await s.delete('server:a');
    await expect(s.has('server:a')).resolves.toBe(false);
    await s.clear('e2e:');
    await expect(s.has('e2e:b')).resolves.toBe(false);
    await s.set('server:z', '9');
    await s.clear();
    await expect(s.has('server:z')).resolves.toBe(false);
  });

  it('applies calls in order, so a later delete wins over a set still encrypting', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Cipher = {
      ...cipher,
      encryptStringAsync: async (v) => {
        await gate;
        return xor(Buffer.from(v, 'utf8'));
      },
    };
    const s = new SecretsStore(dir, slow);
    const set = s.set('e2e:b', 'pw');
    const del = s.delete('e2e:b');
    const has = s.has('e2e:b');
    release();
    await Promise.all([set, del]);
    await expect(has).resolves.toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8'))).toEqual({});
  });

  it('re-encrypts a value when the OS asks for it', async () => {
    await new SecretsStore(dir, cipher).set('server:a', 'tok');
    const rotated: Cipher = {
      ...cipher,
      encryptStringAsync: (v) => Promise.resolve(Buffer.from(`v2:${v}`, 'utf8')),
      decryptStringAsync: (b) =>
        Promise.resolve({ result: xor(b).toString('utf8'), shouldReEncrypt: true }),
    };
    await expect(new SecretsStore(dir, rotated).get('server:a')).resolves.toBe('tok');
    const after = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as {
      'server:a': string;
    };
    expect(after['server:a']).toBe(Buffer.from('v2:tok', 'utf8').toString('base64'));
  });

  it('keeps the old value when re-encryption fails', async () => {
    await new SecretsStore(dir, cipher).set('server:a', 'tok');
    const before = readFileSync(join(dir, 'secrets.json'), 'utf8');
    const failing: Cipher = {
      ...cipher,
      encryptStringAsync: () => Promise.reject(new Error('locked')),
      decryptStringAsync: (b) =>
        Promise.resolve({ result: xor(b).toString('utf8'), shouldReEncrypt: true }),
    };
    await expect(new SecretsStore(dir, failing).get('server:a')).resolves.toBe('tok');
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).toBe(before);
  });

  it('refuses to store without secure storage, and reads nothing', async () => {
    await new SecretsStore(dir, cipher).set('server:a', '1');
    const off: Cipher = { ...cipher, isAsyncEncryptionAvailable: () => Promise.resolve(false) };
    const s = new SecretsStore(dir, off);
    await expect(s.available()).resolves.toBe(false);
    await expect(s.set('server:b', '1')).rejects.toThrow();
    await expect(s.get('server:a')).resolves.toBeNull();
    await expect(s.has('server:b')).resolves.toBe(false);
  });

  it('ignores a damaged file and undecryptable values', async () => {
    writeFileSync(join(dir, 'secrets.json'), '[1,2');
    await expect(new SecretsStore(dir, cipher).has('x')).resolves.toBe(false);
    writeFileSync(join(dir, 'secrets.json'), JSON.stringify({ 'server:a': 'zz', bad: 3 }));
    const broken: Cipher = {
      ...cipher,
      decryptStringAsync: () => Promise.reject(new Error('nope')),
    };
    const s = new SecretsStore(dir, broken);
    await expect(s.get('server:a')).resolves.toBeNull();
    await expect(s.has('bad')).resolves.toBe(false);
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
