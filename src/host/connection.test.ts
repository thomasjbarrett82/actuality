import type { ConnectionInfo } from '@shared/connection';
import type { HostEvents } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Connection,
  dedupeBudgets,
  GATE_MAX_AGE_MS,
  POST_WRITE_SYNC_MS,
  RETRY_DELAYS_MS,
  toRpcError,
} from './connection';
import type { ProbeResult } from './diagnose';
import { JobQueue } from './queue';
import { FakeActual } from './testing/fake-actual';
import { FakeControl } from './testing/fake-control';

const URL_ = 'https://budget.test';

interface Harness {
  actual: FakeActual;
  control: FakeControl;
  queue: JobQueue;
  conn: Connection;
  events: { event: keyof HostEvents; payload: unknown }[];
  states: () => string[];
  probeResult: ProbeResult;
  clock: { now: number };
}

function setup(): Harness {
  const actual = new FakeActual();
  actual.addBudget({ cloudFileId: 'b1', name: 'My Budget' });
  const control = new FakeControl();
  const events: Harness['events'] = [];
  const clock = { now: Date.UTC(2026, 9, 18, 12) };
  const h = {
    actual,
    control,
    events,
    clock,
    probeResult: { reachable: true, diagnosis: 'none' },
  } as Harness;
  let conn: Connection | null = null;
  const queue = new JobQueue({ onTimeout: (_j, fatal) => conn?.onJobTimeout(fatal) });
  conn = new Connection({
    actual,
    queue,
    control,
    emit: (event, payload) => events.push({ event, payload }),
    dataDir: '/tmp/actual-cache',
    probe: () =>
      Promise.resolve(
        actual.server === 'up'
          ? h.probeResult
          : { reachable: false, diagnosis: 'none', code: 'ECONNREFUSED' },
      ),
    login: (_url, password) =>
      password === 'pw'
        ? Promise.resolve('good-token')
        : Promise.reject(
            new RpcError('auth', 'That password is incorrect.', { code: 'invalid-password' }),
          ),
    now: () => clock.now,
  });
  h.queue = queue;
  h.conn = conn;
  h.states = () =>
    events
      .filter((e) => e.event === 'connection:state')
      .map((e) => (e.payload as ConnectionInfo).state);
  return h;
}

async function online(h: Harness): Promise<void> {
  await h.conn.connect(URL_, 'pw', true);
  await h.conn.openBudget('b1');
}

const changed = (h: Harness): string[][] =>
  h.events
    .filter((e) => e.event === 'data:changed')
    .map((e) => (e.payload as { tables: string[] }).tables);

describe('Connection (03 §4–7)', () => {
  let h: Harness;
  beforeEach(() => {
    vi.useFakeTimers();
    h = setup();
  });
  afterEach(() => {
    h.conn.dispose();
    vi.useRealTimers();
  });

  describe('sign-in', () => {
    it('signs in with a password, stores the token (never the password) when asked', async () => {
      const info = await h.conn.connect(URL_, 'pw', true);
      expect(info.state).toBe('SignedIn');
      expect(h.control.secrets.get(`server:${URL_}`)).toBe('good-token');
      expect([...h.control.secrets.values()]).not.toContain('pw');
      expect(h.control.app.serverUrl).toBe(URL_);
    });

    it('keeps the token in memory only without "Stay signed in"', async () => {
      await h.conn.connect(URL_, 'pw', false);
      expect(h.control.secrets.size).toBe(0);
      await expect(h.conn.listBudgets()).resolves.toHaveLength(1);
    });

    it('rejects a wrong password', async () => {
      await expect(h.conn.connect(URL_, 'bad', true)).rejects.toMatchObject({ code: 'auth' });
    });

    it('uses the stored token when no password is given', async () => {
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      await expect(h.conn.connect(URL_, undefined, false)).resolves.toMatchObject({
        state: 'SignedIn',
      });
    });

    it('asks to sign in when there is no stored token and the server answers', async () => {
      await expect(h.conn.connect(URL_, undefined, false)).rejects.toMatchObject({ code: 'auth' });
      expect(h.conn.state.state).toBe('AuthRequired');
    });

    it('reports offline with no token and no server', async () => {
      h.actual.server = 'down';
      await expect(h.conn.connect(URL_, undefined, false)).rejects.toMatchObject({
        code: 'offline',
      });
    });

    it('deletes a rejected stored token and asks to sign in', async () => {
      h.control.secrets.set(`server:${URL_}`, 'stale');
      await expect(h.conn.connect(URL_, undefined, false)).rejects.toMatchObject({ code: 'auth' });
      expect(h.control.secrets.has(`server:${URL_}`)).toBe(false);
      expect(h.conn.state.state).toBe('AuthRequired');
    });
  });

  describe('opening budgets', () => {
    it('opens online: download by the current groupId, then sync (03 §6.1)', async () => {
      await online(h);
      expect(h.conn.state.state).toBe('Online');
      expect(h.actual.calls).toContain('downloadBudget:g-b1');
      const opened = h.events.find((e) => e.event === 'budget:opened')?.payload;
      expect(opened).toMatchObject({
        cloudFileId: 'b1',
        groupId: 'g-b1',
        name: 'My Budget',
        budgetType: 'envelope',
        localOnly: false,
      });
      expect(h.control.notified.some((n) => n.event === 'budget:opened')).toBe(true);
      expect(h.control.budgets.get('b1')?.localId).toBe('local-b1');
      expect(h.control.app.lastBudget?.cloudFileId).toBe('b1');
      expect(h.control.app.recentBudgets[0]?.cloudFileId).toBe('b1');
    });

    it('refuses a tracking budget: closes it again and stays signed in (01 §3, 03 §6.1)', async () => {
      const b = h.actual.budgets.get('b1');
      if (b) b.prefs['budgetType'] = 'tracking';
      await h.conn.connect(URL_, 'pw', false);
      await expect(h.conn.openBudget('b1')).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'tracking-budget' },
      });
      expect(h.conn.state).toMatchObject({ state: 'SignedIn', budget: null });
      expect(h.actual.calls.at(-1)).toBe('shutdown');
      expect(h.events.some((e) => e.event === 'budget:opened')).toBe(false);
      expect(h.control.app.recentBudgets).toEqual([]);
      // The session still works: another budget opens.
      h.actual.addBudget({ cloudFileId: 'b2', name: 'Envelope' });
      await expect(h.conn.openBudget('b2')).resolves.toMatchObject({ budgetType: 'envelope' });
    });

    it('fails closed when the budget type cannot be read', async () => {
      await h.conn.connect(URL_, 'pw', false);
      vi.spyOn(h.actual, 'getPreferences').mockRejectedValueOnce(new Error('prefs unavailable'));
      await expect(h.conn.openBudget('b1')).rejects.toBeInstanceOf(RpcError);
      expect(h.conn.state).toMatchObject({ state: 'SignedIn', budget: null });
      expect(h.actual.calls.at(-1)).toBe('shutdown');
      expect(h.events.some((e) => e.event === 'budget:opened')).toBe(false);
    });

    it('refuses a tracking budget opened from the local copy too', async () => {
      const b = h.actual.budgets.get('b1');
      if (b) b.prefs['budgetType'] = 'tracking';
      h.conn.setServerUrl(URL_);
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await expect(h.conn.openBudget('b1')).rejects.toMatchObject({
        details: { code: 'tracking-budget' },
      });
      expect(h.conn.state).toMatchObject({ state: 'Disconnected', budget: null });
      expect(h.actual.calls).toContain('init:local');
      expect(h.actual.calls.at(-1)).toBe('shutdown');
    });

    it('lists budgets once each, marking offline copies', async () => {
      h.actual.addBudget({ cloudFileId: 'b2', name: 'Another', password: 'secret' });
      h.actual.localCopies.set('b1', 'local-b1');
      await h.conn.connect(URL_, 'pw', false);
      await expect(h.conn.listBudgets()).resolves.toEqual([
        {
          cloudFileId: 'b2',
          groupId: 'g-b2',
          name: 'Another',
          encrypted: true,
          offlineCopy: false,
          shared: false,
        },
        {
          cloudFileId: 'b1',
          groupId: 'g-b1',
          name: 'My Budget',
          encrypted: false,
          offlineCopy: true,
          shared: false,
        },
      ]);
    });

    it('reports a budget that no longer exists', async () => {
      await h.conn.connect(URL_, 'pw', false);
      await expect(h.conn.openBudget('gone')).rejects.toMatchObject({ code: 'not-found' });
      expect(h.conn.state.state).toBe('SignedIn');
    });

    it('asks for the encryption password, then keeps it in memory and remembers it if asked', async () => {
      h.actual.addBudget({ cloudFileId: 'enc', name: 'Encrypted', password: 'secret' });
      await h.conn.connect(URL_, 'pw', false);
      const e = await h.conn.openBudget('enc').catch((err: unknown) => err);
      expect(e).toMatchObject({ code: 'actual', details: { code: 'missing-key' } });
      expect(h.conn.state.state).toBe('SignedIn');
      await expect(h.conn.openBudget('enc', 'wrong')).rejects.toMatchObject({
        details: { code: 'decrypt-failure' },
      });
      await h.conn.openBudget('enc', 'secret', true);
      expect(h.conn.state.state).toBe('Online');
      expect(h.control.secrets.get('e2e:enc')).toBe('secret');
    });

    it('deletes a remembered encryption password that no longer works (03 §7)', async () => {
      h.actual.addBudget({ cloudFileId: 'enc', name: 'Encrypted', password: 'new' });
      h.control.secrets.set('e2e:enc', 'old');
      await h.conn.connect(URL_, 'pw', false);
      await expect(h.conn.openBudget('enc')).rejects.toMatchObject({
        details: { code: 'decrypt-failure' },
      });
      expect(h.control.secrets.has('e2e:enc')).toBe(false);
    });

    it('closes the budget back to SignedIn', async () => {
      await online(h);
      await expect(h.conn.closeBudget(false)).resolves.toMatchObject({
        state: 'SignedIn',
        budget: null,
      });
    });
  });

  describe('the write gate (03 §5)', () => {
    it('writes while Online and reports written and applied tables', async () => {
      await online(h);
      await h.conn.write('notes.set', ['notes'], () => h.actual.updateNote('n1', 'hello'));
      expect(changed(h).at(-1)).toEqual(['notes']);
      const syncs = h.actual.calls.filter((c) => c === 'sync').length;
      await vi.advanceTimersByTimeAsync(POST_WRITE_SYNC_MS);
      expect(h.actual.calls.filter((c) => c === 'sync').length).toBe(syncs + 1);
    });

    it('coalesces post-write syncs within 250 ms', async () => {
      await online(h);
      const before = h.actual.calls.filter((c) => c === 'sync').length;
      await h.conn.write('a', ['notes'], () => h.actual.updateNote('a', '1'));
      await vi.advanceTimersByTimeAsync(100);
      await h.conn.write('b', ['notes'], () => h.actual.updateNote('b', '2'));
      await vi.advanceTimersByTimeAsync(POST_WRITE_SYNC_MS);
      expect(h.actual.calls.filter((c) => c === 'sync').length).toBe(before + 1);
    });

    it('rejects writes while offline, writing nothing', async () => {
      await online(h);
      h.actual.server = 'down';
      await h.conn.syncNow().catch(() => undefined);
      expect(h.conn.state.state).toBe('OfflineReadOnly');
      const write = vi.fn(() => h.actual.updateNote('n1', 'x'));
      await expect(h.conn.write('notes.set', ['notes'], write)).rejects.toMatchObject({
        code: 'offline',
      });
      expect(write).not.toHaveBeenCalled();
    });

    it('syncs first when the last contact is older than 30 s, and rejects if that fails', async () => {
      await online(h);
      h.clock.now += GATE_MAX_AGE_MS + 1;
      h.actual.server = 'down';
      const write = vi.fn(() => h.actual.updateNote('n1', 'x'));
      await expect(h.conn.write('notes.set', ['notes'], write)).rejects.toMatchObject({
        code: 'offline',
      });
      expect(write).not.toHaveBeenCalled();
      expect(h.conn.state.state).toBe('OfflineReadOnly');
    });

    it('marks unsynced changes when the post-write sync fails, and asks before closing (03 §5.2, §5.4)', async () => {
      await online(h);
      await h.conn.write('notes.set', ['notes'], () => h.actual.updateNote('n1', 'x'));
      h.actual.server = 'down';
      await vi.advanceTimersByTimeAsync(POST_WRITE_SYNC_MS);
      expect(h.conn.state).toMatchObject({ state: 'OfflineReadOnly', unsyncedChanges: true });
      await expect(h.conn.closeBudget(false)).rejects.toMatchObject({ code: 'conflict' });
      h.actual.server = 'up';
      await h.conn.retry('manual');
      expect(h.conn.state).toMatchObject({ state: 'Online', unsyncedChanges: false });
    });

    it("emits applied tables from Actual's own writes outside our jobs", async () => {
      await online(h);
      h.actual.emitSync({ type: 'applied', tables: ['transactions'] });
      expect(changed(h).at(-1)).toEqual(['transactions']);
    });

    it('adds applied tables seen during a write job to its data:changed', async () => {
      await online(h);
      await h.conn.write('w', ['notes'], async () => {
        await h.actual.updateNote('n', 'x');
        h.actual.emitSync({ type: 'applied', tables: ['transactions'] });
      });
      expect(changed(h).at(-1)).toEqual(['notes', 'transactions']);
    });
  });

  describe('sync events (03 §4.1)', () => {
    it('shows Syncing for automatic syncs and emits only received tables', async () => {
      await online(h);
      h.actual.emitSync({ type: 'start' });
      expect(h.conn.state.state).toBe('Syncing');
      h.actual.emitSync({ type: 'success', tables: [] });
      expect(h.conn.state.state).toBe('Online');
      const before = changed(h).length;
      h.actual.emitSync({ type: 'start' });
      h.actual.emitSync({ type: 'success', tables: ['notes'] });
      expect(changed(h).length).toBe(before + 1);
    });

    it('goes offline on a network error, to AuthRequired on unauthorized, to Error on file-has-reset', async () => {
      await online(h);
      h.actual.emitSync({ type: 'error', subtype: 'network' });
      expect(h.conn.state.state).toBe('OfflineReadOnly');

      const h2 = setup();
      await online(h2);
      h2.actual.emitSync({ type: 'unauthorized' });
      expect(h2.conn.state.state).toBe('AuthRequired');
      h2.conn.dispose();

      const h3 = setup();
      await online(h3);
      h3.actual.emitSync({ type: 'error', subtype: 'file-has-reset' });
      expect(h3.conn.state).toMatchObject({ state: 'Error', message: 'file-has-reset' });
      h3.conn.dispose();
    });

    it('syncs every 60 s while Online, and on window focus', async () => {
      await online(h);
      const count = (): number => h.actual.calls.filter((c) => c === 'sync').length;
      const before = count();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(count()).toBe(before + 1);
      h.conn.onWindowFocus();
      await vi.advanceTimersByTimeAsync(0);
      expect(count()).toBe(before + 2);
    });

    it('ends Syncing after an error that changes no state, so the health syncs go on', async () => {
      await online(h);
      const count = (): number => h.actual.calls.filter((c) => c === 'sync').length;
      for (const subtype of ['out-of-sync', 'clock-drift', undefined]) {
        h.actual.emitSync({ type: 'start' });
        h.actual.emitSync(subtype === undefined ? { type: 'error' } : { type: 'error', subtype });
        expect(h.conn.state.state).toBe('Online');
      }
      const before = count();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(count()).toBe(before + 1);
    });
  });

  describe('offline mode and retry (03 §4.2, §6.2)', () => {
    it('opens the local copy read-only when the server is down at startup', async () => {
      h.control.app = { ...h.control.app, serverUrl: URL_ };
      h.conn.setServerUrl(URL_);
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      h.actual.localCopies.set('b1', 'local-b1');
      h.control.budgets.set('b1', {
        ...(await h.control.call('settings.getBudget', { cloudFileId: 'b1' })),
        lastSyncAt: 123,
      });
      h.actual.server = 'down';
      const opened = await h.conn.openBudget('b1');
      expect(opened.localOnly).toBe(true);
      expect(h.conn.state).toMatchObject({ state: 'OfflineReadOnly', lastSyncAt: 123 });
      expect(h.actual.calls).toContain('init:local');
      await expect(
        h.conn.write('w', ['notes'], () => h.actual.updateNote('n', 'x')),
      ).rejects.toMatchObject({ code: 'offline' });
      await expect(h.actual.updateNote('n', 'x')).rejects.toMatchObject({ code: 'offline' });
      await expect(h.conn.listBudgets()).resolves.toEqual([]);
    });

    it('opens offline without a stored token too (a local-only open needs none)', async () => {
      h.conn.setServerUrl(URL_);
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await expect(h.conn.openBudget('b1')).resolves.toMatchObject({ localOnly: true });
    });

    it('opens the local copy when the server went away after sign-in (03 §4 Connecting → OfflineReadOnly)', async () => {
      await h.conn.connect(URL_, 'pw', false);
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await expect(h.conn.openBudget('b1')).resolves.toMatchObject({ localOnly: true });
      expect(h.conn.state.state).toBe('OfflineReadOnly');
    });

    it('lists budgets as offline, not as an empty server, when the server went away', async () => {
      await h.conn.connect(URL_, 'pw', false);
      h.actual.server = 'down';
      await expect(h.conn.listBudgets()).rejects.toMatchObject({
        code: 'offline',
        details: { code: 'network-failure' },
      });
    });

    it('fails clearly with no server and no local copy', async () => {
      h.conn.setServerUrl(URL_);
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      h.actual.server = 'down';
      await expect(h.conn.openBudget('b1')).rejects.toMatchObject({ code: 'offline' });
      expect(h.conn.state.state).toBe('Disconnected');
    });

    it('does not queue a job while the server is unreachable (probe outside the queue)', async () => {
      await online(h);
      h.actual.server = 'down';
      h.actual.emitSync({ type: 'error', subtype: 'network' });
      const calls = h.actual.calls.length;
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] ?? 0);
      expect(h.queue.size).toBe(0);
      expect(h.actual.calls.length).toBe(calls);
      expect(h.conn.state.state).toBe('OfflineReadOnly');
    });

    it('reconnects a server session with sync() once the probe answers', async () => {
      await online(h);
      h.actual.server = 'down';
      h.actual.emitSync({ type: 'error', subtype: 'network' });
      h.actual.server = 'up';
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] ?? 0);
      expect(h.conn.state.state).toBe('Online');
      expect(h.states()).toContain('Reconnecting');
    });

    it('reconnects a local-only session by re-init in the same process (S-9)', async () => {
      h.conn.setServerUrl(URL_);
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await h.conn.openBudget('b1');
      h.actual.server = 'up';
      const result = await h.conn.retry('manual');
      expect(result.connection).toMatchObject({ state: 'Online', budget: { localOnly: false } });
      expect(changed(h).at(-1)).toEqual(['*']);
      await expect(
        h.conn.write('w', ['notes'], () => h.actual.updateNote('n', 'x')),
      ).resolves.toBeUndefined();
    });

    it('asks to sign in when a local-only session has no token (03 §4)', async () => {
      h.conn.setServerUrl(URL_);
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await h.conn.openBudget('b1');
      h.actual.server = 'up';
      await h.conn.retry('manual');
      expect(h.conn.state.state).toBe('AuthRequired');
      await h.conn.connect(URL_, 'pw', false);
      expect(h.conn.state).toMatchObject({ state: 'Online', budget: { localOnly: false } });
    });

    it('keeps the local copy readable and asks for the password when an encrypted re-init needs it', async () => {
      h.actual.addBudget({ cloudFileId: 'enc', name: 'Encrypted', password: 'secret' });
      h.conn.setServerUrl(URL_);
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      h.actual.localCopies.set('enc', 'local-enc');
      h.actual.server = 'down';
      await h.conn.openBudget('enc');
      h.actual.server = 'up';
      await h.conn.retry('manual');
      expect(h.conn.state).toMatchObject({ state: 'OfflineReadOnly', message: 'missing-key' });
      expect(h.actual.openBudget).toBe('enc');
    });

    it('goes to Error when the retry sync finds the file reset or migrations out of sync (03 §4)', async () => {
      for (const code of ['file-has-reset', 'out-of-sync-migrations']) {
        const hx = setup();
        await online(hx);
        hx.actual.emitSync({ type: 'error', subtype: 'network' });
        vi.spyOn(hx.actual, 'sync').mockRejectedValueOnce(Object.assign(new Error(code), { code }));
        await hx.conn.retry('manual');
        expect(hx.conn.state).toMatchObject({ state: 'Error', message: code });
        hx.conn.dispose();
      }
    });

    it('reports the diagnosis to Retry now', async () => {
      await online(h);
      h.actual.server = 'down';
      h.actual.emitSync({ type: 'error', subtype: 'network' });
      await expect(h.conn.retry('manual')).resolves.toMatchObject({
        connection: { state: 'OfflineReadOnly' },
        diagnosis: 'none',
        errorCode: 'ECONNREFUSED',
      });
    });
  });

  describe('re-authentication (03 §6.3)', () => {
    it('resumes the open after signing in', async () => {
      h.conn.setServerUrl(URL_);
      await expect(h.conn.openBudget('b1')).rejects.toMatchObject({ code: 'auth' });
      expect(h.conn.state.state).toBe('AuthRequired');
      await h.conn.connect(URL_, 'pw', false);
      expect(h.conn.state).toMatchObject({ state: 'Online', budget: { cloudFileId: 'b1' } });
    });

    it('re-inits an open budget after signing in again', async () => {
      await online(h);
      h.actual.emitSync({ type: 'unauthorized' });
      expect(h.conn.state.state).toBe('AuthRequired');
      await h.conn.connect(URL_, 'pw', false);
      expect(h.conn.state.state).toBe('Online');
    });

    it('retries automatically again after signing in with a budget open', async () => {
      await online(h);
      h.actual.emitSync({ type: 'unauthorized' });
      await h.conn.connect(URL_, 'pw', false);
      expect(h.conn.state.state).toBe('Online');
      h.actual.emitSync({ type: 'error', subtype: 'network' });
      expect(h.conn.state.state).toBe('OfflineReadOnly');
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] ?? 0);
      expect(h.conn.state.state).toBe('Online');
    });

    it('cancelling with a budget open keeps it open read-only, signed out', async () => {
      await online(h);
      h.actual.emitSync({ type: 'unauthorized' });
      expect(h.conn.cancelSignIn()).toMatchObject({ state: 'OfflineReadOnly', signedOut: true });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.conn.state.state).toBe('OfflineReadOnly');
      await h.conn.retry('manual');
      expect(h.conn.state.state).toBe('AuthRequired');
      await expect(
        h.conn.closeBudget(true).then(() => h.conn.cancelSignIn()),
      ).resolves.toBeDefined();
    });

    it('cancelling without a budget goes back to Disconnected', async () => {
      await h.conn.connect(URL_, undefined, false).catch(() => undefined);
      expect(h.conn.cancelSignIn().state).toBe('Disconnected');
      expect(h.conn.cancelSignIn().state).toBe('Disconnected');
    });
  });

  describe('session start tasks (03 §6.4)', () => {
    it('run once at the first Online, and again on a new local day', async () => {
      const task = vi.fn(() => Promise.resolve());
      h.conn.registerStartTask('flag tags', task);
      await online(h);
      await vi.advanceTimersByTimeAsync(0);
      expect(task).toHaveBeenCalledTimes(1);
      await h.conn.syncNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(task).toHaveBeenCalledTimes(1);
      h.clock.now += 86_400_000;
      await h.conn.syncNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(task).toHaveBeenCalledTimes(2);
    });

    it('wait for the reconnect after an offline open', async () => {
      const task = vi.fn(() => Promise.resolve());
      h.conn.registerStartTask('carryover', task);
      h.conn.setServerUrl(URL_);
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      h.actual.localCopies.set('b1', 'local-b1');
      h.actual.server = 'down';
      await h.conn.openBudget('b1');
      await vi.advanceTimersByTimeAsync(0);
      expect(task).not.toHaveBeenCalled();
      h.actual.server = 'up';
      await h.conn.retry('manual');
      await vi.advanceTimersByTimeAsync(0);
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('log a failing task without breaking the session', async () => {
      h.conn.registerStartTask('broken', () => Promise.reject(new Error('nope')));
      await online(h);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.conn.state.state).toBe('Online');
    });
  });

  describe('errors and recovery', () => {
    it('a fatal job timeout means Error (03 §3)', async () => {
      await h.conn.connect(URL_, 'pw', false);
      h.actual.server = 'hang';
      const open = h.conn.openBudget('b1').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(await open).toMatchObject({ code: 'timeout' });
      expect(h.conn.state.state).toBe('Error');
    });

    it('restores a session after a host restart (03 §6.5)', async () => {
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      await h.conn.restore({ serverUrl: URL_, cloudFileId: 'b1', localOnly: false });
      expect(h.conn.state).toMatchObject({ state: 'Online', budget: { cloudFileId: 'b1' } });
      const h2 = setup();
      h2.control.secrets.set(`server:${URL_}`, 'good-token');
      await h2.conn.restore({ serverUrl: URL_, cloudFileId: null, localOnly: false });
      expect(h2.conn.state.state).toBe('SignedIn');
      h2.conn.dispose();
    });

    it('a restore that fails leaves the matching state', async () => {
      await h.conn.restore({ serverUrl: URL_, cloudFileId: null, localOnly: false });
      expect(h.conn.state.state).toBe('AuthRequired');
      // Only a budget that didn't reopen is reported.
      expect(h.events.some((e) => e.event === 'session:restoreFailed')).toBe(false);
    });

    it('reports a budget that did not reopen, for the renderer to handle like a failed open', async () => {
      h.control.secrets.set(`server:${URL_}`, 'good-token');
      await h.conn.restore({ serverUrl: URL_, cloudFileId: 'gone', localOnly: false });
      expect(h.events.find((e) => e.event === 'session:restoreFailed')?.payload).toEqual({
        cloudFileId: 'gone',
        error: {
          code: 'not-found',
          message: 'This budget no longer exists on the server.',
          details: { code: 'budget-not-found' },
        },
      });
    });

    it('shuts down on quit', async () => {
      await online(h);
      await h.conn.shutdownForQuit();
      expect(h.actual.calls.at(-1)).toBe('shutdown');
    });

    it('maps Actual errors to RPC codes', () => {
      const code = (c: string): Error => Object.assign(new Error(c), { code: c });
      expect(toRpcError(code('network-failure')).code).toBe('offline');
      expect(toRpcError(code('token-expired')).code).toBe('auth');
      expect(toRpcError(code('budget-not-found')).code).toBe('not-found');
      expect(toRpcError(code('missing-key'))).toMatchObject({
        code: 'actual',
        details: { code: 'missing-key' },
      });
      expect(toRpcError(new Error('plain'))).toMatchObject({
        code: 'actual',
        details: { message: 'plain' },
      });
      const rpc = new RpcError('validation', 'v');
      expect(toRpcError(rpc)).toBe(rpc);
    });
  });

  it('de-duplicates budgets by cloudFileId', () => {
    expect(
      dedupeBudgets([
        { name: 'A', cloudFileId: 'a', groupId: 'old', id: 'local-a' },
        { name: 'A', cloudFileId: 'a', groupId: 'new', state: 'remote', hasKey: false },
        { name: 'Local only', cloudFileId: 'x', id: 'local-x' },
        { name: 'No id' },
      ]),
    ).toEqual([
      {
        cloudFileId: 'a',
        groupId: 'new',
        name: 'A',
        encrypted: false,
        offlineCopy: true,
        shared: false,
      },
    ]);
  });
});
