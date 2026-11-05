// Budget Setup and Budget Properties on the fake API (07 §4; 03 §3, §7.1).
import type { BudgetTemplate } from '@shared/rpc/host-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { BudgetFileService } from './budget-file';

const TEMPLATE: BudgetTemplate = {
  groups: [
    { name: 'Giving', categories: ['Tithing', 'Charitable'] },
    { name: 'Debt', categories: ['Car Payment', 'Student Loan Payment'] },
  ],
  incomeCategory: 'Income',
};
const FORMATS = {
  currency: 'EUR',
  numberFormat: 'dot-comma',
  dateFormat: 'dd.MM.yyyy',
  hideFraction: false,
} as const;

describe('BudgetFileService (07 §4)', () => {
  let actual: FakeActual;
  let control: FakeControl;
  let conn: Connection;
  let service: BudgetFileService;

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({ cloudFileId: 'b1', name: 'Existing', owner: 'u-bob' });
    control = new FakeControl();
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control,
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
      validate: () =>
        Promise.resolve({
          userId: 'u-alice',
          userName: 'alice',
          displayName: 'Alice',
          loginMethod: 'password',
        }),
    });
    service = new BudgetFileService(actual, queue, conn);
    await conn.connect('https://x.test', 'pw', false);
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('creates the template in order, writes the formats, uploads and opens the budget', async () => {
    const opened = await service.create('  Family  ', TEMPLATE, FORMATS, false);
    expect(opened).toMatchObject({ name: 'Family', localOnly: false });
    expect(conn.state.state).toBe('Online');
    const budget = actual.budgets.get(opened.cloudFileId);
    expect(budget?.groups.map((g) => g.name)).toEqual(['Income', 'Giving', 'Debt']);
    expect(budget?.groups[1]?.categories.map((c) => c.name)).toEqual(['Tithing', 'Charitable']);
    expect(budget?.prefs).toMatchObject({
      defaultCurrencyCode: 'EUR',
      'flags.currency': 'true',
      numberFormat: 'dot-comma',
      dateFormat: 'dd.MM.yyyy',
      hideFraction: 'false',
    });
    expect(control.app.lastBudget?.cloudFileId).toBe(opened.cloudFileId);
  });

  it('refuses an empty name and a name the server already has, before closing anything', async () => {
    await expect(service.create('   ', TEMPLATE, FORMATS, false)).rejects.toMatchObject({
      code: 'validation',
    });
    await conn.openBudget('b1');
    await expect(service.create('Existing', TEMPLATE, FORMATS, false)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'duplicate-name' },
    });
    expect(conn.state.budget?.cloudFileId).toBe('b1');
  });

  it('reports a failed upload and returns to SignedIn (S-8)', async () => {
    actual.failUpload = true;
    await expect(service.create('Lost', TEMPLATE, FORMATS, false)).rejects.toMatchObject({
      details: { code: 'upload-failed' },
    });
    expect(conn.state).toMatchObject({ state: 'SignedIn', budget: null });
  });

  it('refuses to create while the open budget is offline with unsynced changes', async () => {
    await conn.openBudget('b1');
    actual.server = 'down';
    await conn.write('w', ['notes'], () => actual.updateNote('x', 'y')).catch(() => undefined);
    await conn.syncNow().catch(() => undefined);
    actual.server = 'up';
    expect(conn.state.unsyncedChanges).toBe(true);
    await expect(service.create('New', TEMPLATE, FORMATS, false)).rejects.toMatchObject({
      code: 'offline',
    });
  });

  it('reads properties, with Shared for a budget someone else owns (03 §7.1)', async () => {
    await conn.openBudget('b1');
    await expect(service.properties()).resolves.toEqual({
      name: 'Existing',
      currency: '',
      numberFormat: 'comma-dot',
      dateFormat: 'MM/dd/yyyy',
      hideFraction: false,
      renameAvailable: true,
      shared: true,
      firstDayOfWeek: null,
      encryption: 'disabled',
      encryptionKeyAvailable: true,
    });
  });

  it('saves formats and renames the budget everywhere', async () => {
    await conn.openBudget('b1');
    await service.updateProperties({ name: ' Renamed ', hideFraction: true });
    expect(actual.budgets.get('b1')?.name).toBe('Renamed');
    expect(actual.budgets.get('b1')?.prefs['hideFraction']).toBe('true');
    expect(conn.state.budget?.name).toBe('Renamed');
    expect(control.app.recentBudgets[0]?.name).toBe('Renamed');
    expect(control.app.lastBudget?.name).toBe('Renamed');
  });

  it('saves the first day of the week as its string index (04 §3)', async () => {
    await conn.openBudget('b1');
    await service.updateProperties({ firstDayOfWeek: 1 });
    expect(actual.budgets.get('b1')?.prefs['firstDayOfWeekIdx']).toBe('1');
    await expect(service.properties()).resolves.toMatchObject({ firstDayOfWeek: 1 });
  });

  it('maps a refused rename to the permission message, and a missing handler to its fallback', async () => {
    await conn.openBudget('b1');
    actual.refuseRename = true;
    await expect(service.updateProperties({ name: 'Mine now' })).rejects.toMatchObject({
      code: 'actual',
      details: { code: 'permission-denied' },
    });
    actual.refuseRename = false;
    actual.missingHandlers.add('save-prefs');
    await expect(service.updateProperties({ name: 'Mine now' })).rejects.toMatchObject({
      details: { code: 'internal-handler-unavailable' },
    });
    await expect(service.properties()).resolves.toMatchObject({ renameAvailable: false });
  });

  it('reads and writes synced prefs through the gate', async () => {
    await conn.openBudget('b1');
    await service.setSynced('numberFormat', 'space-comma');
    await expect(service.synced()).resolves.toMatchObject({ numberFormat: 'space-comma' });
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    await expect(service.setSynced('dateFormat', 'yyyy-MM-dd')).rejects.toMatchObject({
      code: 'offline',
    });
  });

  describe('end-to-end encryption (03 §7, 07 §4)', () => {
    it('enables encryption, keeps the budget open on its new group and syncs', async () => {
      await conn.openBudget('b1');
      const before = conn.state.budget?.groupId;
      await service.setEncryptionKey('secret', false);
      const budget = actual.budgets.get('b1');
      expect(budget?.password).toBe('secret');
      expect(conn.state.budget?.groupId).toBe(budget?.groupId);
      expect(conn.state.budget?.groupId).not.toBe(before);
      expect(conn.state.budget?.cloudFileId).toBe('b1');
      expect(control.app.lastBudget?.groupId).toBe(budget?.groupId);
      expect(control.app.recentBudgets[0]?.groupId).toBe(budget?.groupId);
      expect(actual.calls.slice(actual.calls.indexOf('makeEncryptionKey'))).toContain('sync');
      expect(conn.state.state).toBe('Online');
      await expect(service.properties()).resolves.toMatchObject({ encryption: 'enabled' });
    });

    it('opens the budget again with the in-memory password after a reconnect', async () => {
      await conn.openBudget('b1');
      await service.setEncryptionKey('secret', false);
      await conn.closeBudget(true);
      await expect(conn.openBudget('b1')).rejects.toMatchObject({
        details: { code: 'missing-key' },
      });
      await expect(conn.openBudget('b1', 'secret')).resolves.toMatchObject({ cloudFileId: 'b1' });
    });

    it('remembers the password only when asked, and only after the key is made', async () => {
      await conn.openBudget('b1');
      control.secrets.set('e2e:b1', 'stale');
      actual.failKeyMake = { reason: 'network' };
      await expect(service.setEncryptionKey('secret', true)).rejects.toMatchObject({
        code: 'offline',
      });
      expect(control.secrets.get('e2e:b1')).toBe('stale');
      await service.setEncryptionKey('secret', true);
      expect(control.secrets.get('e2e:b1')).toBe('secret');
      await service.setEncryptionKey('newer', false);
      expect(control.secrets.has('e2e:b1')).toBe(false);
      expect(actual.budgets.get('b1')?.password).toBe('newer');
    });

    it('reports a password it could not remember or forget without failing the key change', async () => {
      await conn.openBudget('b1');
      await expect(service.setEncryptionKey('secret', true)).resolves.toEqual({
        rememberFailed: false,
        forgetFailed: false,
      });
      const call = control.call.bind(control);
      const spy = vi.spyOn(control, 'call');
      spy.mockImplementation((method, params) =>
        method === 'secrets.set'
          ? Promise.reject(new Error('keyring locked'))
          : call(method, params),
      );
      await expect(service.setEncryptionKey('newer', true)).resolves.toEqual({
        rememberFailed: true,
        forgetFailed: false,
      });
      expect(actual.budgets.get('b1')?.password).toBe('newer');
      expect(conn.state.state).toBe('Online');
      // Not ticked: the old remembered password couldn't be deleted.
      spy.mockImplementation((method, params) =>
        method === 'secrets.delete'
          ? Promise.reject(new Error('keyring locked'))
          : call(method, params),
      );
      await expect(service.setEncryptionKey('newest', false)).resolves.toEqual({
        rememberFailed: false,
        forgetFailed: true,
      });
      expect(actual.budgets.get('b1')?.password).toBe('newest');
    });

    it('reports a failure without retrying, and refreshes what the server holds', async () => {
      await conn.openBudget('b1');
      actual.failKeyMake = { reason: 'upload-failure', afterReset: true };
      await expect(service.setEncryptionKey('secret', false)).rejects.toMatchObject({
        code: 'actual',
        details: { code: 'upload-failure' },
      });
      expect(actual.calls.filter((c) => c === 'makeEncryptionKey')).toHaveLength(1);
      expect(conn.state.budget?.groupId).toBe(actual.budgets.get('b1')?.groupId);
    });

    it('reports a missing key-make handler and marks it unavailable', async () => {
      await conn.openBudget('b1');
      actual.missingHandlers.add('key-make');
      await expect(service.setEncryptionKey('secret', false)).rejects.toMatchObject({
        details: { code: 'internal-handler-unavailable' },
      });
      await expect(service.properties()).resolves.toMatchObject({
        encryptionKeyAvailable: false,
      });
    });

    it('is refused offline, and the status is unknown in an offline session', async () => {
      await conn.openBudget('b1');
      actual.server = 'down';
      await conn.syncNow().catch(() => undefined);
      await expect(service.setEncryptionKey('secret', false)).rejects.toMatchObject({
        code: 'offline',
      });
      expect(actual.calls).not.toContain('makeEncryptionKey');
      await conn.closeBudget(true);
      await conn.openBudget('b1');
      expect(conn.state.budget?.localOnly).toBe(true);
      await expect(service.properties()).resolves.toMatchObject({ encryption: 'unknown' });
    });
  });
});
