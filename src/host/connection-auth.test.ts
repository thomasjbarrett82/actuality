// Sign-in methods, users and leaving a server (03 §7–7.3), on the fake API.
import { RpcError } from '@shared/rpc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, type ConnectionDeps } from './connection';
import type { LoopbackListener, LoopbackOutcome } from './openid';
import { JobQueue } from './queue';
import type { LoginProbe, TokenUser } from './server-api';
import { FakeActual } from './testing/fake-actual';
import { FakeControl } from './testing/fake-control';

const URL_ = 'https://budget.test';

interface Harness {
  actual: FakeActual;
  control: FakeControl;
  conn: Connection;
  /** The user each token belongs to. */
  users: Map<string, string>;
  loginMethod: LoginProbe;
  /** Settles the pending OpenID listener. */
  browser: (outcome: LoopbackOutcome) => void;
  removedCache: number;
}

function setup(): Harness {
  const actual = new FakeActual();
  actual.addBudget({ cloudFileId: 'b1', name: 'Mine', owner: 'u-alice' });
  actual.addBudget({ cloudFileId: 'b2', name: 'Team', owner: 'u-bob' });
  actual.validTokens.add('bob-token');
  const control = new FakeControl();
  const h = {
    actual,
    control,
    users: new Map([
      ['good-token', 'u-alice'],
      ['bob-token', 'u-bob'],
    ]),
    loginMethod: { method: 'password', displayName: '' },
    browser: () => undefined,
    removedCache: 0,
  } as unknown as Harness;
  const deps: ConnectionDeps = {
    actual,
    queue: new JobQueue(),
    control,
    emit: () => undefined,
    dataDir: '/tmp/actual-cache',
    probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
    login: (_url, password) =>
      password === 'pw'
        ? Promise.resolve('good-token')
        : password === 'bob'
          ? Promise.resolve('bob-token')
          : Promise.reject(
              new RpcError('auth', 'That password is incorrect.', { code: 'invalid-password' }),
            ),
    probeLogin: () =>
      actual.server === 'up'
        ? Promise.resolve(h.loginMethod)
        : Promise.reject(new RpcError('offline', "Couldn't reach the server.")),
    openIdLogin: (_url, returnUrl) =>
      Promise.resolve(`https://idp.test/auth?return=${encodeURIComponent(returnUrl)}`),
    startLoopback: () => {
      let settle: (o: LoopbackOutcome) => void = () => undefined;
      const result = new Promise<LoopbackOutcome>((resolve) => {
        settle = resolve;
      });
      h.browser = settle;
      const listener: LoopbackListener = {
        returnUrl: 'http://localhost:4567',
        result,
        cancel: () => {
          settle({ kind: 'cancelled' });
        },
      };
      return Promise.resolve(listener);
    },
    validate: (_url, token): Promise<TokenUser> => {
      const userId = h.users.get(token);
      return userId
        ? Promise.resolve({
            userId,
            userName: userId,
            displayName: userId,
            loginMethod: 'password',
          })
        : Promise.reject(new RpcError('auth', 'Sign in again.', { code: 'token-expired' }));
    },
    serverVersion: () => Promise.resolve('26.2.0'),
    removeCache: () => {
      h.removedCache++;
      return Promise.resolve();
    },
  };
  h.conn = new Connection(deps);
  return h;
}

describe('sign-in methods and users (03 §7–7.3)', () => {
  let h: Harness;
  beforeEach(() => {
    vi.useFakeTimers();
    h = setup();
  });
  afterEach(() => {
    h.conn.dispose();
    vi.useRealTimers();
  });

  it('probes the sign-in method, with a diagnosis when the server is down', async () => {
    h.loginMethod = { method: 'openid', displayName: 'Authentik' };
    await expect(h.conn.probeLogin(`${URL_}/`)).resolves.toEqual({
      method: 'openid',
      displayName: 'Authentik',
    });
    h.actual.server = 'down';
    await expect(h.conn.probeLogin(URL_)).rejects.toMatchObject({
      code: 'offline',
      details: { diagnosis: 'none' },
    });
  });

  it('signs in through the browser and focuses the window (03 §7)', async () => {
    const signingIn = h.conn.connectOpenId(URL_, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.control.opened).toEqual([
      `https://idp.test/auth?return=${encodeURIComponent('http://localhost:4567')}`,
    ]);
    h.browser({ kind: 'token', token: 'good-token' });
    await expect(signingIn).resolves.toMatchObject({ state: 'SignedIn', serverUrl: URL_ });
    expect(h.control.focused).toBe(1);
    expect(h.control.secrets.get(`server:${URL_}`)).toBe('good-token');
    expect(h.control.app.serverUsers).toEqual({ [URL_]: 'u-alice' });
  });

  it('reports a cancelled or timed-out browser sign-in', async () => {
    const cancelled = h.conn.connectOpenId(URL_, false);
    await vi.advanceTimersByTimeAsync(0);
    h.conn.cancelOpenId();
    await expect(cancelled).rejects.toMatchObject({ details: { code: 'openid-cancelled' } });
    const slow = h.conn.connectOpenId(URL_, false);
    await vi.advanceTimersByTimeAsync(0);
    h.browser({ kind: 'timeout' });
    await expect(slow).rejects.toMatchObject({
      code: 'timeout',
      details: { code: 'openid-timeout' },
    });
    expect(h.conn.state.state).toBe('Disconnected');
  });

  it('tags budgets owned by someone else as Shared (03 §7.1)', async () => {
    await h.conn.connect(URL_, 'pw', false);
    const list = await h.conn.listBudgets();
    expect(list.map((b) => [b.name, b.shared])).toEqual([
      ['Mine', false],
      ['Team', true],
    ]);
  });

  it('removes the previous user’s cached budgets when someone else signs in', async () => {
    await h.conn.connect(URL_, 'pw', false);
    await h.conn.openBudget('b1');
    await h.conn.closeBudget(false);
    h.control.secrets.set('e2e:b1', 'secret');
    h.control.budgets.set('b1', { ...h.control.budgets.get('b1'), localId: 'local-b1' } as never);
    expect(h.control.app.recentBudgets.map((r) => r.cloudFileId)).toEqual(['b1']);
    // Bob can see only the Team budget.
    const visibleToBob = new Map([...h.actual.budgets].filter(([id]) => id === 'b2'));
    const all = new Map(h.actual.budgets);
    h.actual.budgets.clear();
    for (const [k, v] of visibleToBob) h.actual.budgets.set(k, v);
    h.actual.localCopies.set('b1', 'local-b1');
    // The local copy stays listed (as the API lists it) although the server no longer lists b1.
    const original = h.actual.getBudgets.bind(h.actual);
    h.actual.getBudgets = async () => [
      ...(await original()),
      { name: 'Mine', cloudFileId: 'b1', groupId: 'g-b1', id: 'local-b1' },
    ];
    await h.conn.connect(URL_, 'bob', false);
    expect(h.actual.calls).toContain('deleteLocalBudget:local-b1');
    expect(h.control.secrets.has('e2e:b1')).toBe(false);
    expect(h.control.budgets.has('b1')).toBe(false);
    expect(h.control.app.recentBudgets).toEqual([]);
    expect(h.control.app.lastBudget).toBeNull();
    expect(h.control.app.serverUsers[URL_]).toBe('u-bob');
    for (const [k, v] of all) h.actual.budgets.set(k, v);
  });

  it('asks before switching users with unsynced changes in the open budget', async () => {
    await h.conn.connect(URL_, 'pw', false);
    await h.conn.openBudget('b1');
    // Lose the server, write while offline in the cache (Actual's own sync recorded it), then re-auth.
    (h.conn as unknown as { info: { unsyncedChanges: boolean } }).info.unsyncedChanges = true;
    await expect(h.conn.connect(URL_, 'bob', false)).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'user-switch' },
    });
    expect(h.conn.state.budget?.cloudFileId).toBe('b1');
    await expect(h.conn.connect(URL_, undefined, false, true)).resolves.toMatchObject({
      state: 'SignedIn',
    });
    expect(h.control.app.serverUsers[URL_]).toBe('u-bob');
  });

  it('signs out: keeps the cache and device settings, forgets the token, passwords and last budget', async () => {
    await h.conn.connect(URL_, 'pw', true);
    await h.conn.openBudget('b1');
    h.control.secrets.set('e2e:b1', 'secret');
    await expect(h.conn.signOut(false)).resolves.toMatchObject({
      state: 'Disconnected',
      serverUrl: URL_,
      budget: null,
    });
    expect(h.control.secrets.size).toBe(0);
    expect(h.control.app.lastBudget).toBeNull();
    expect(h.control.app.recentBudgets).toHaveLength(1);
    expect(h.removedCache).toBe(0);
    await expect(h.conn.listBudgets()).rejects.toMatchObject({ code: 'auth' });
  });

  it('changes server: wipes the cache, device settings, secrets and server settings', async () => {
    await h.conn.connect(URL_, 'pw', true);
    await h.conn.openBudget('b1');
    await expect(h.conn.forgetServer(false)).resolves.toMatchObject({
      state: 'Disconnected',
      serverUrl: null,
    });
    expect(h.removedCache).toBe(1);
    expect(h.control.secrets.size).toBe(0);
    expect(h.control.budgets.size).toBe(0);
    expect(h.control.app).toMatchObject({
      serverUrl: null,
      lastBudget: null,
      recentBudgets: [],
      serverUsers: {},
    });
  });

  it('refuses to leave with unsynced changes unless forced', async () => {
    await h.conn.connect(URL_, 'pw', false);
    await h.conn.openBudget('b1');
    (h.conn as unknown as { info: { unsyncedChanges: boolean } }).info.unsyncedChanges = true;
    for (const leave of [
      () => h.conn.signOut(false),
      () => h.conn.forgetServer(false),
      () => h.conn.clearCache(false),
    ]) {
      await expect(leave()).rejects.toMatchObject({
        code: 'conflict',
        details: { unsyncedChanges: true },
      });
    }
    await expect(h.conn.clearCache(true)).resolves.toMatchObject({
      state: 'SignedIn',
      budget: null,
    });
  });

  it('clears the offline cache and the local ids that pointed into it (03 §2)', async () => {
    await h.conn.connect(URL_, 'pw', false);
    await h.conn.openBudget('b1');
    await h.conn.clearCache(false);
    expect(h.removedCache).toBe(1);
    expect(h.control.budgets.get('b1')).toMatchObject({ localId: null, lastSyncAt: null });
    await expect(h.conn.listBudgets()).resolves.toHaveLength(2);
  });

  it('stores or deletes the token for "Stay signed in" and reads the server version', async () => {
    await h.conn.connect(URL_, 'pw', false);
    expect(h.control.secrets.has(`server:${URL_}`)).toBe(false);
    await h.conn.setStaySignedIn(true);
    expect(h.control.secrets.get(`server:${URL_}`)).toBe('good-token');
    await h.conn.setStaySignedIn(false);
    expect(h.control.secrets.has(`server:${URL_}`)).toBe(false);
    await expect(h.conn.serverVersion()).resolves.toBe('26.2.0');
  });
});
