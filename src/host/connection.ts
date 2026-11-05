// Connection state machine, write gate, sync and offline mode (03 §3–§7). Every API call runs inside a
// queue job. The state is mirrored to the renderer (`connection:state`) and to main (crash recovery).
import { describeError, errorCode } from '@shared/aspects/log-entry';
import { step } from '@shared/aspects/steps';
import {
  canEdit,
  INITIAL_CONNECTION,
  type ConnectionInfo,
  type Diagnosis,
  type OpenBudgetInfo,
} from '@shared/connection';
import { today } from '@shared/dates';
import type {
  ControlMethod,
  ControlParams,
  ControlResult,
  HostToMainEvents,
  SessionRestore,
} from '@shared/rpc/control-api';
import type {
  BudgetFileType,
  BudgetListEntry,
  EncryptionKeyResult,
  HostEvents,
} from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, BudgetFile, SyncEvent } from './actual';
import { isTrackingExport } from './budget-export';
import type { ProbeResult } from './diagnose';
import type { LoopbackListener } from './openid';
import {
  IMPORT_JOB_TIMEOUT_MS,
  OPEN_JOB_TIMEOUT_MS,
  type JobOptions,
  type JobQueue,
} from './queue';
import type { LoginProbe, TokenUser } from './server-api';

/** The host's side of the main↔host control channel (02 §4.1). */
export interface ControlPort {
  call<M extends ControlMethod>(method: M, params: ControlParams<M>): Promise<ControlResult<M>>;
  notify<E extends keyof HostToMainEvents>(event: E, payload: HostToMainEvents[E]): void;
}

export interface ConnectionDeps {
  actual: ActualApi;
  queue: JobQueue;
  control: ControlPort;
  emit: <E extends keyof HostEvents>(event: E, payload: HostEvents[E]) => void;
  /** `{userData}/actual-cache` (03 §2). */
  dataDir: string;
  probe: (serverUrl: string) => Promise<ProbeResult>;
  login: (serverUrl: string, password: string) => Promise<string>;
  /** The server's active sign-in method (03 §7). */
  probeLogin?: (serverUrl: string) => Promise<LoginProbe>;
  /** Starts an OpenID sign-in; returns the identity provider's URL (03 §7 step 2). */
  openIdLogin?: (serverUrl: string, returnUrl: string) => Promise<string>;
  /** The loopback listener for the OpenID redirect (03 §7 steps 1, 4). */
  startLoopback?: (page: string) => Promise<LoopbackListener>;
  /** Who a token belongs to (03 §7 step 7). Without it, the user check (03 §7.1) is skipped. */
  validate?: (serverUrl: string, token: string) => Promise<TokenUser>;
  serverVersion?: (serverUrl: string) => Promise<string | null>;
  /** Deletes the whole cache folder; called only after shutdown() (03 §2, §7.2). */
  removeCache?: () => Promise<void>;
  /** Each state transition, with the reason when there is one: a join point for logging (02 §8.2). */
  onTransition?: (t: { from: string; to: string; reason?: string }) => void;
  now?: () => number;
}

const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, '');

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/** The change of server user found at sign-in (03 §7.1). */
interface UserCheck {
  userId: string;
  changed: boolean;
}

/** A write job's last server contact must be at most this old, or the gate syncs first (03 §5.1). */
export const GATE_MAX_AGE_MS = 30_000;
/** Background sync while Online (03 §4.1). */
export const HEALTH_SYNC_MS = 60_000;
/** Post-write syncs within this window are coalesced (03 §5.2). */
export const POST_WRITE_SYNC_MS = 250;
/** Retry delays while offline: 5 s, 10 s, 30 s, then every 60 s (03 §4.1). */
export const RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];
/** lastSyncAt is written to device settings at most once a minute, and on close (03 §4.1). */
const LAST_SYNC_PERSIST_MS = 60_000;

const NETWORK_CODES = new Set(['network-failure', 'network']);
const AUTH_CODES = new Set(['invalid-password', 'token-expired', 'unauthorized']);
/** Every table, for a full invalidation after a re-init (03 §4.2). */
export const ALL_TABLES = ['*'];

/** Where to continue after a successful sign-in from AuthRequired (03 §4). */
type AuthReturn =
  | { kind: 'signedIn' }
  | { kind: 'open'; cloudFileId: string; e2ePassword?: string; remember?: boolean }
  | { kind: 'budget' };

type SessionKind = 'none' | 'server' | 'local';

const offlineError = (details?: unknown): RpcError =>
  new RpcError(
    'offline',
    "Changes can't be made while the app can't reach your Actual server. Your change was not saved.",
    details,
  );

/** Actual's Tracking mode is out of scope (01 §3): the open or import is refused (03 §6.1). */
const trackingBudgetError = (): RpcError =>
  new RpcError('validation', 'Tracking budgets are not supported.', { code: 'tracking-budget' });

/** The Actual code carried in an RpcError's details, if any. */
function detailCode(e: unknown): string | undefined {
  if (!(e instanceof RpcError)) return undefined;
  const d = e.details as { code?: unknown } | undefined;
  return typeof d?.code === 'string' ? d.code : e.code;
}

/** Converts an Actual error into an RpcError with the right code (03 §8–9). */
export function toRpcError(e: unknown, diagnosis?: Diagnosis): RpcError {
  if (e instanceof RpcError) return e;
  const code = errorCode(e);
  const { message } = describeError(e);
  if (code && NETWORK_CODES.has(code)) {
    return new RpcError('offline', "Couldn't reach the server.", {
      code,
      diagnosis: diagnosis ?? 'none',
    });
  }
  if (code && AUTH_CODES.has(code)) return new RpcError('auth', 'Sign in again.', { code });
  if (code === 'budget-not-found')
    return new RpcError('not-found', 'This budget no longer exists on the server.', { code });
  return new RpcError('actual', message, code ? { code, message } : { message });
}

export class Connection {
  private info: ConnectionInfo = { ...INITIAL_CONNECTION };
  private session: SessionKind = 'none';
  /** The server session token, in host memory only (03 §7). */
  private token: string | null = null;
  /** The open budget's encryption password, in host memory for the session (03 §7). */
  private e2ePassword: string | null = null;
  private localId: string | null = null;
  private encrypted = false;
  private lastContact = 0;
  /** A write job finished since the last successful sync: it's in the cache, maybe not on the server. */
  private writesSinceSync = false;
  private lastSyncPersisted = 0;
  private authReturn: AuthReturn | null = null;
  /** Tables collected from `applied` events while one of our write jobs runs (03 §4.1). */
  private writeTables: Set<string> | null = null;
  private postWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private retriesPaused = false;
  private retrying = false;
  private syncQueued = false;
  private readonly startTasks: { name: string; run: () => Promise<void>; tables: string[] }[] = [];
  private startTasksRanThisSession = false;
  private startTasksDay: string | null = null;
  /** The signed-in server user (03 §7.1), for the Shared tag. */
  private userId: string | null = null;
  /** The OpenID sign-in in progress (03 §7), so Cancel can stop it. */
  private openId: LoopbackListener | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ConnectionDeps) {
    this.now = deps.now ?? Date.now;
    deps.actual.onSync((e) => {
      this.onSyncEvent(e);
    });
  }

  // ---------------------------------------------------------------- state

  get state(): ConnectionInfo {
    return { ...this.info };
  }

  private set(patch: Partial<ConnectionInfo>, reason?: string): void {
    const before = this.info.state;
    this.info = { ...this.info, ...patch };
    if (this.info.state !== before) {
      const why = reason ?? patch.message;
      this.deps.onTransition?.({
        from: before,
        to: this.info.state,
        ...(why === undefined ? {} : { reason: why }),
      });
    }
    if (patch.state !== undefined && patch.message === undefined && patch.state !== 'Error')
      delete this.info.message;
    const snapshot = this.state;
    this.deps.emit('connection:state', snapshot);
    this.deps.control.notify('connection:state', snapshot);
    this.updateTimers();
  }

  private updateTimers(): void {
    const online = this.info.state === 'Online' || this.info.state === 'Syncing';
    if (online && !this.healthTimer) {
      this.healthTimer = setInterval(() => {
        if (this.info.state === 'Online') void this.backgroundSync();
      }, HEALTH_SYNC_MS);
    } else if (!online && this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.info.state !== 'OfflineReadOnly' && this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Stops every timer (host shutdown, tests). */
  dispose(): void {
    for (const t of [this.postWriteTimer, this.retryTimer]) if (t) clearTimeout(t);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.postWriteTimer = this.retryTimer = this.healthTimer = null;
  }

  // ------------------------------------------------------------ session start tasks (03 §6.4)

  /**
   * Registers a write task that runs at the session's first transition to Online, and daily after.
   * `tables`: what it may change, for `data:changed`.
   */
  registerStartTask(name: string, run: () => Promise<void>, tables: string[] = []): void {
    this.startTasks.push({ name, run, tables });
  }

  private runStartTasksIfDue(): void {
    const day = today(new Date(this.now()));
    if (this.startTasksRanThisSession && this.startTasksDay === day) return;
    this.startTasksRanThisSession = true;
    this.startTasksDay = day;
    for (const task of this.startTasks) {
      step(`start task: ${task.name}`, () =>
        this.write(`start task: ${task.name}`, task.tables, task.run),
      ).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------------------- jobs

  private job<T>(label: string, fn: () => Promise<T>, opts: JobOptions): Promise<T> {
    return this.deps.queue.run(label, fn, opts);
  }

  /** Called by the queue when a job times out (03 §3). Only init/download jobs are fatal. */
  onJobTimeout(fatal: boolean): void {
    if (fatal) this.toError('timeout');
  }

  // ------------------------------------------------------------------------------ settings

  private async budgetSettings(
    cloudFileId: string,
  ): Promise<{ localId: string | null; lastSyncAt: number | null }> {
    try {
      return await this.deps.control.call('settings.getBudget', { cloudFileId });
    } catch {
      return { localId: null, lastSyncAt: null };
    }
  }

  private persistLastSync(force = false): void {
    const budget = this.info.budget;
    const at = this.info.lastSyncAt;
    if (!budget || at === null) return;
    if (!force && this.now() - this.lastSyncPersisted < LAST_SYNC_PERSIST_MS) return;
    this.lastSyncPersisted = this.now();
    step('save lastSyncAt', () =>
      this.deps.control.call('settings.patchBudget', {
        cloudFileId: budget.cloudFileId,
        patch: { lastSyncAt: at },
      }),
    ).catch(() => undefined);
  }

  private async storedToken(serverUrl: string): Promise<string | null> {
    try {
      return await this.deps.control.call('secrets.get', { key: `server:${serverUrl}` });
    } catch {
      return null;
    }
  }

  private async forgetStoredToken(serverUrl = this.info.serverUrl): Promise<void> {
    const url = serverUrl;
    if (!url) return;
    await this.deps.control.call('secrets.delete', { key: `server:${url}` }).catch(() => null);
  }

  // --------------------------------------------------------------------------- sign-in

  /**
   * Signs in to a server (03 §6.1, §7): with a password (exchanged for a session token, never stored),
   * or without one, using the stored token. Then a token `init`. From AuthRequired, continues where the
   * session left off (03 §4).
   */
  /**
   * Runs a sign-in step; when it fails because the server can't be reached, runs the connection
   * diagnosis first (03 §9, §9.1) and rethrows `offline` with its result and Node's error code.
   */
  private async diagnosed<T>(serverUrl: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = toRpcError(e);
      const details = (err.details ?? {}) as { diagnosis?: unknown };
      if (err.code !== 'offline' || details.diagnosis !== undefined) throw err;
      const probe = await this.deps.probe(serverUrl);
      throw new RpcError('offline', err.message, {
        code: 'network-failure',
        diagnosis: probe.diagnosis,
        ...(probe.code ? { errorCode: probe.code } : {}),
      });
    }
  }

  async connect(
    serverURL: string,
    password: string | undefined,
    remember: boolean,
    force = false,
  ): Promise<ConnectionInfo> {
    const serverUrl = normalizeUrl(serverURL);
    return this.diagnosed(serverUrl, () => this.connectInner(serverUrl, password, remember, force));
  }

  private async connectInner(
    serverUrl: string,
    password: string | undefined,
    remember: boolean,
    force: boolean,
  ): Promise<ConnectionInfo> {
    const resume = this.info.state === 'AuthRequired' ? this.authReturn : null;
    await this.job(
      'session.connect',
      async () => {
        let token: string | null;
        if (password !== undefined) {
          token = await this.deps.login(serverUrl, password);
        } else {
          token = this.token ?? (await this.storedToken(serverUrl));
          if (!token) {
            const probe = await this.deps.probe(serverUrl);
            this.set({ serverUrl });
            if (probe.reachable) {
              this.toAuthRequired({ kind: 'signedIn' });
              throw new RpcError('auth', 'Sign in to your Actual server.', { code: 'no-token' });
            }
            throw new RpcError('offline', "Couldn't reach the server.", {
              code: 'network-failure',
              diagnosis: probe.diagnosis,
              ...(probe.code ? { errorCode: probe.code } : {}),
            });
          }
        }
        await this.signInWithToken(
          serverUrl,
          token,
          remember && password !== undefined,
          resume,
          force,
        );
      },
      { kind: 'sync', fatalOnTimeout: true },
    );
    await this.resumeOpen(resume);
    return this.state;
  }

  private async resumeOpen(resume: AuthReturn | null): Promise<void> {
    if (resume?.kind !== 'open') return;
    await step('resume open', () =>
      this.openBudget(resume.cloudFileId, resume.e2ePassword, resume.remember),
    ).catch(() => undefined);
  }

  /**
   * The rest of every sign-in, inside a job (03 §6.1, §7, §7.1): check which server user the token is,
   * store it if asked, init with it (or re-init the open budget), and clear another user's cached budgets.
   */
  private async signInWithToken(
    serverUrl: string,
    token: string,
    store: boolean,
    resume: AuthReturn | null,
    force: boolean,
  ): Promise<void> {
    const user = await this.checkUser(serverUrl, token);
    if (user?.changed && this.info.budget && this.info.unsyncedChanges && !force) {
      // The previous user's changes would be lost: the renderer asks first (03 §7.1, §5.4). The token
      // stays in memory, so the confirmed retry needs no new sign-in.
      this.token = token;
      throw new RpcError('conflict', 'Some changes have not reached the server.', {
        unsyncedChanges: true,
        code: 'user-switch',
      });
    }
    this.token = token;
    if (store)
      await this.deps.control.call('secrets.set', { key: `server:${serverUrl}`, value: token });
    if (this.info.budget && resume?.kind === 'budget' && !user?.changed) {
      // Signed in again with a budget open: re-init the server session and reload it (03 §4).
      await this.reinitOrFallBack();
      await this.recordUser(serverUrl, user);
      return;
    }
    if (this.info.budget || this.session !== 'none') await this.closeInJob();
    try {
      await this.deps.actual.init({
        dataDir: this.deps.dataDir,
        serverURL: serverUrl,
        sessionToken: token,
      });
    } catch (e) {
      const err = toRpcError(e);
      if (err.code === 'auth') {
        this.token = null;
        await this.forgetStoredToken(serverUrl);
        this.set({ serverUrl });
        this.toAuthRequired(resume ?? { kind: 'signedIn' });
      } else {
        this.set({ serverUrl, state: 'Disconnected' });
      }
      throw err;
    }
    this.session = 'server';
    this.lastContact = this.now();
    this.authReturn = null;
    this.retriesPaused = false;
    if (user?.changed) await this.removeOtherUsersBudgets();
    await this.recordUser(serverUrl, user);
    this.set({ serverUrl, state: 'SignedIn', signedOut: false, budget: null });
    await this.deps.control.call('settings.patchApp', { patch: { serverUrl } }).catch(() => null);
  }

  /** Which server user a token is, and whether it differs from the last one here (03 §7 step 7, §7.1). */
  private async checkUser(serverUrl: string, token: string): Promise<UserCheck | null> {
    if (!this.deps.validate) return null;
    const validate = this.deps.validate;
    let user: TokenUser;
    try {
      user = await step('check the server user', () => validate(serverUrl, token));
    } catch {
      // A rejected token fails the init just after; anything else only skips the check.
      return null;
    }
    if (!user.userId) return null;
    const app = await this.deps.control.call('settings.getApp', {});
    const previous = app.serverUsers[serverUrl];
    return { userId: user.userId, changed: previous !== undefined && previous !== user.userId };
  }

  private async recordUser(serverUrl: string, user: UserCheck | null): Promise<void> {
    if (!user) return;
    this.userId = user.userId;
    const app = await this.deps.control.call('settings.getApp', {});
    if (app.serverUsers[serverUrl] === user.userId) return;
    await this.deps.control.call('settings.patchApp', {
      patch: { serverUsers: { ...app.serverUsers, [serverUrl]: user.userId } },
    });
  }

  /**
   * A different user signed in (03 §7.1): delete every cached budget that isn't in the new user's server
   * list, with its device settings and remembered encryption password, and drop it from the recent list.
   * Runs inside the sign-in job, after the server init.
   */
  private async removeOtherUsersBudgets(): Promise<void> {
    const files = await this.serverBudgets(this.info.serverUrl);
    const visible = new Set(
      files.flatMap((f) => (f.state === 'remote' && f.cloudFileId ? [f.cloudFileId] : [])),
    );
    const stale = files.filter(
      (f) => f.id && f.state !== 'remote' && !(f.cloudFileId && visible.has(f.cloudFileId)),
    );
    const gone = new Set<string>();
    for (const f of stale) {
      await this.deps.actual.deleteLocalBudget(f.id ?? '');
      if (!f.cloudFileId) continue;
      gone.add(f.cloudFileId);
      await this.deps.control.call('settings.deleteBudget', { cloudFileId: f.cloudFileId });
      await this.deps.control.call('secrets.delete', { key: `e2e:${f.cloudFileId}` });
    }
    const app = await this.deps.control.call('settings.getApp', {});
    await this.deps.control.call('settings.patchApp', {
      patch: {
        recentBudgets: app.recentBudgets.filter((r) => !gone.has(r.cloudFileId)),
        lastBudget: app.lastBudget && gone.has(app.lastBudget.cloudFileId) ? null : app.lastBudget,
      },
    });
  }

  /** The server's active sign-in method (03 §7). Unreachable → `offline` with a diagnosis. */
  async probeLogin(serverURL: string): Promise<LoginProbe> {
    const serverUrl = normalizeUrl(serverURL);
    if (!this.deps.probeLogin) return { method: 'password', displayName: '' };
    const { probeLogin } = this.deps;
    return this.diagnosed(serverUrl, () => probeLogin(serverUrl));
  }

  /**
   * OpenID sign-in (03 §7): a loopback listener, the identity provider's page in the browser, then the
   * token. The wait for the browser runs outside the queue, so reads aren't blocked meanwhile.
   */
  async connectOpenId(
    serverURL: string,
    remember: boolean,
    force = false,
  ): Promise<ConnectionInfo> {
    const { startLoopback, openIdLogin } = this.deps;
    if (!startLoopback || !openIdLogin)
      throw new RpcError('internal', 'OpenID sign-in is not available.');
    const serverUrl = normalizeUrl(serverURL);
    const resume = this.info.state === 'AuthRequired' ? this.authReturn : null;
    this.openId?.cancel();
    const page = await this.deps.control
      .call('i18n.translate', { key: 'app.openIdSignedInPage' })
      .catch(() => '');
    const listener = await startLoopback(
      `<!doctype html><meta charset="utf-8"><p>${escapeHtml(page)}</p>`,
    );
    this.openId = listener;
    try {
      const providerUrl = await openIdLogin(serverUrl, listener.returnUrl);
      await this.deps.control.call('shell.openExternal', { url: providerUrl });
      const outcome = await listener.result;
      if (outcome.kind === 'cancelled') {
        throw new RpcError('conflict', 'Sign-in was cancelled.', { code: 'openid-cancelled' });
      }
      if (outcome.kind === 'timeout') {
        throw new RpcError('timeout', "Sign-in wasn't completed.", { code: 'openid-timeout' });
      }
      // Back from the browser (03 §7 step 4).
      await this.deps.control.call('window.focus', {}).catch(() => null);
      const { token } = outcome;
      await this.job(
        'session.connectOpenId',
        () => this.signInWithToken(serverUrl, token, remember, resume, force),
        { kind: 'sync', fatalOnTimeout: true },
      );
    } finally {
      listener.cancel();
      if (this.openId === listener) this.openId = null;
    }
    await this.resumeOpen(resume);
    return this.state;
  }

  /** Cancel while waiting for the browser (03 §7 step 3). */
  cancelOpenId(): ConnectionInfo {
    this.openId?.cancel();
    return this.state;
  }

  /** Cancel on the sign-in modal (03 §4): read-only with a budget open, else back to Connect. */
  cancelSignIn(): ConnectionInfo {
    if (this.info.state !== 'AuthRequired') return this.state;
    this.authReturn = null;
    if (this.info.budget) {
      this.retriesPaused = true;
      this.set({ state: 'OfflineReadOnly', signedOut: true });
    } else {
      this.session = 'none';
      this.set({ state: 'Disconnected', signedOut: false });
    }
    return this.state;
  }

  private toAuthRequired(returnTo: AuthReturn): void {
    this.authReturn = returnTo;
    this.retriesPaused = true;
    this.set({ state: 'AuthRequired' });
  }

  /** An auth error during a session: drop the token (the stored one too) and ask to sign in (03 §7 step 4). */
  private handleAuthFailure(): void {
    this.token = null;
    void this.forgetStoredToken();
    this.toAuthRequired(this.info.budget ? { kind: 'budget' } : { kind: 'signedIn' });
  }

  // --------------------------------------------------------------------------- budgets

  /** The server's budgets, de-duplicated by cloudFileId (03 §6.1). Empty while the server can't be reached. */
  async listBudgets(): Promise<BudgetListEntry[]> {
    return this.job(
      'session.listBudgets',
      async () => {
        if (this.session === 'local' || this.info.state === 'OfflineReadOnly') return [];
        await this.ensureServerInit();
        return dedupeBudgets(await this.serverBudgets(this.info.serverUrl), this.userId);
      },
      { kind: 'read' },
    );
  }

  /**
   * `getBudgets()` with the server's files. Actual drops the server's list silently when it can't fetch
   * it (`get-remote-files` gives null), so a list without one remote file is checked with the probe: a
   * server that doesn't answer is `offline`, never "no budgets" or "this budget no longer exists".
   */
  private async serverBudgets(serverUrl: string | null): Promise<BudgetFile[]> {
    const files = await this.deps.actual.getBudgets();
    if (!serverUrl || files.some((f) => f.state === 'remote')) return files;
    const probe = await this.deps.probe(serverUrl);
    if (probe.reachable) return files;
    throw new RpcError('offline', "Couldn't reach the server.", {
      code: 'network-failure',
      diagnosis: probe.diagnosis,
      ...(probe.code ? { errorCode: probe.code } : {}),
    });
  }

  /** Re-inits the server session after a close (shutdown ends it). */
  private async ensureServerInit(): Promise<void> {
    if (this.session === 'server') return;
    const url = this.info.serverUrl;
    if (!url || !this.token)
      throw new RpcError('auth', 'Sign in to your Actual server.', { code: 'no-token' });
    try {
      await this.deps.actual.init({
        dataDir: this.deps.dataDir,
        serverURL: url,
        sessionToken: this.token,
      });
    } catch (e) {
      const err = toRpcError(e);
      if (err.code === 'auth') this.handleAuthFailure();
      throw err;
    }
    this.session = 'server';
    this.lastContact = this.now();
  }

  /**
   * Opens a budget (03 §6.1): init + downloadBudget(current groupId) + sync → Online. If the server can't
   * be reached and the budget has a local copy, opens that local-only and read-only (03 §6.2).
   */
  async openBudget(
    cloudFileId: string,
    e2ePassword?: string,
    remember?: boolean,
  ): Promise<OpenBudgetInfo> {
    if (this.info.state === 'AuthRequired')
      throw new RpcError('auth', 'Sign in to your Actual server.');
    if (this.info.budget && this.info.unsyncedChanges) {
      throw new RpcError('conflict', 'Some changes have not reached the server.', {
        unsyncedChanges: true,
      });
    }
    // null: the server can't be reached, so open the local copy instead (03 §6.2).
    const online = await this.job(
      'session.openBudget',
      async (): Promise<OpenBudgetInfo | null> => {
        if (this.info.budget || this.session === 'local') await this.closeInJob();
        const serverUrl = this.info.serverUrl;
        if (!serverUrl) throw new RpcError('validation', 'No server is configured.');
        // Get a server session first: from memory, the stored token, or not at all (offline).
        if (this.session !== 'server') {
          this.token ??= await this.storedToken(serverUrl);
          if (!this.token) {
            const probe = await this.deps.probe(serverUrl);
            if (probe.reachable) {
              this.toAuthRequired(
                e2ePassword === undefined
                  ? { kind: 'open', cloudFileId }
                  : {
                      kind: 'open',
                      cloudFileId,
                      e2ePassword,
                      ...(remember === undefined ? {} : { remember }),
                    },
              );
              throw new RpcError('auth', 'Sign in to your Actual server.', { code: 'no-token' });
            }
            return null;
          }
          try {
            await this.ensureServerInit();
          } catch (e) {
            if (e instanceof RpcError && e.code === 'offline') {
              return null;
            }
            throw e;
          }
        }
        this.set({ state: 'Connecting' });
        let files: BudgetFile[];
        try {
          files = await this.serverBudgets(serverUrl);
        } catch (e) {
          if (!(e instanceof RpcError && e.code === 'offline')) throw e;
          // The server went away since sign-in: open the local copy instead (03 §4, §6.2).
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          return null;
        }
        const remote = files.find((b) => b.cloudFileId === cloudFileId && b.state === 'remote');
        if (!remote?.groupId) {
          this.set({ state: 'SignedIn' });
          throw new RpcError('not-found', 'This budget no longer exists on the server.', {
            code: 'budget-not-found',
          });
        }
        const stored =
          e2ePassword === undefined && remote.hasKey ? await this.storedE2e(cloudFileId) : null;
        const password = e2ePassword ?? this.passwordFor(cloudFileId) ?? stored ?? undefined;
        try {
          await this.deps.actual.downloadBudget(remote.groupId, password);
          await this.deps.actual.sync();
        } catch (e) {
          const code = errorCode(e);
          if (code && NETWORK_CODES.has(code)) {
            // downloadBudget leaves the local copy open; start over local-only, predictably.
            await this.deps.actual.shutdown().catch(() => undefined);
            this.session = 'none';
            return null;
          }
          if (code === 'decrypt-failure' && stored !== null) {
            await this.deps.control
              .call('secrets.delete', { key: `e2e:${cloudFileId}` })
              .catch(() => null);
          }
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          if (code === 'out-of-sync-migrations' || code === 'file-has-reset') this.toError(code);
          else if (code && AUTH_CODES.has(code)) this.handleAuthFailure();
          else this.set({ state: 'SignedIn' });
          throw toRpcError(e);
        }
        this.encrypted = remote.hasKey === true;
        this.e2ePassword = password ?? null;
        if (remember && e2ePassword !== undefined) {
          await this.deps.control.call('secrets.set', {
            key: `e2e:${cloudFileId}`,
            value: e2ePassword,
          });
        }
        const local = (await this.deps.actual.getBudgets()).find(
          (b) => b.cloudFileId === cloudFileId && b.id,
        );
        this.localId = local?.id ?? null;
        return await this.opened(remote, false);
      },
      { kind: 'sync', timeoutMs: OPEN_JOB_TIMEOUT_MS, fatalOnTimeout: true },
    );
    return online ?? (await this.openOffline(cloudFileId));
  }

  private passwordFor(cloudFileId: string): string | null {
    return this.info.budget?.cloudFileId === cloudFileId ? this.e2ePassword : null;
  }

  private async storedE2e(cloudFileId: string): Promise<string | null> {
    try {
      return await this.deps.control.call('secrets.get', { key: `e2e:${cloudFileId}` });
    } catch {
      return null;
    }
  }

  /** The local-only fallback (03 §6.2): init without a server, loadBudget(localId), read-only. */
  private async openOffline(cloudFileId: string): Promise<OpenBudgetInfo> {
    return this.job(
      'session.openBudget (offline)',
      async () => {
        const remembered = (await this.budgetSettings(cloudFileId)).localId;
        await this.deps.actual.init({ dataDir: this.deps.dataDir });
        this.session = 'local';
        const local = (await this.deps.actual.getBudgets()).find(
          (b) => b.cloudFileId === cloudFileId && b.id,
        );
        const localId = local?.id ?? remembered;
        if (!localId) {
          this.session = 'none';
          this.set({ state: 'Disconnected', budget: null });
          throw new RpcError(
            'offline',
            "Couldn't reach the server, and this budget isn't on this computer.",
            {
              code: 'network-failure',
            },
          );
        }
        await this.deps.actual.loadBudget(localId);
        this.deps.actual.setOfflineFallback(true);
        this.localId = localId;
        const settings = await this.budgetSettings(cloudFileId);
        return this.opened(
          {
            name: local?.name ?? '',
            cloudFileId,
            groupId: local?.groupId ?? '',
            ...(local?.hasKey === undefined ? {} : { hasKey: local.hasKey }),
          },
          true,
          settings.lastSyncAt,
        );
      },
      { kind: 'sync', timeoutMs: OPEN_JOB_TIMEOUT_MS, fatalOnTimeout: true },
    );
  }

  /** Closes a budget that loaded but mustn't open, back to the state before the open (03 §6.1). */
  private async abandonOpen(localOnly: boolean): Promise<void> {
    await this.deps.actual.shutdown().catch(() => undefined);
    this.deps.actual.setOfflineFallback(false);
    this.session = 'none';
    this.localId = null;
    this.e2ePassword = null;
    this.encrypted = false;
    this.set(localOnly ? { state: 'Disconnected', budget: null } : { state: 'SignedIn' });
  }

  /**
   * Common end of an open: record the budget, emit budget:opened, run start tasks once Online. A budget
   * in Actual's Tracking mode is closed again and refused, and so is one whose type can't be read
   * (01 §3, 03 §6.1).
   */
  private async opened(
    file: BudgetFile,
    localOnly: boolean,
    lastSyncAt: number | null = null,
  ): Promise<OpenBudgetInfo> {
    let prefs: Record<string, string | undefined>;
    try {
      prefs = await this.deps.actual.getPreferences();
    } catch (e) {
      await this.abandonOpen(localOnly);
      throw toRpcError(e);
    }
    if (prefs['budgetType'] === 'tracking') {
      await this.abandonOpen(localOnly);
      throw trackingBudgetError();
    }
    const budget: OpenBudgetInfo = {
      cloudFileId: file.cloudFileId ?? '',
      groupId: file.groupId ?? '',
      name: file.name,
      budgetType: 'envelope',
      localOnly,
    };
    this.startTasksRanThisSession = false;
    this.retryAttempt = 0;
    this.retriesPaused = false;
    if (localOnly) {
      this.set({
        state: 'OfflineReadOnly',
        budget,
        lastSyncAt,
        unsyncedChanges: false,
        signedOut: false,
      });
      this.scheduleRetry();
    } else {
      const at = this.now();
      this.lastContact = at;
      this.set({
        state: 'Online',
        budget,
        lastSyncAt: at,
        unsyncedChanges: false,
        signedOut: false,
      });
      this.persistLastSync(true);
      void this.deps.control
        .call('settings.patchBudget', {
          cloudFileId: budget.cloudFileId,
          patch: { localId: this.localId, lastSyncAt: at },
        })
        .catch(() => null);
      void this.recordRecent(budget);
    }
    this.deps.emit('budget:opened', budget);
    this.deps.control.notify('budget:opened', budget);
    if (!localOnly) this.runStartTasksIfDue();
    return budget;
  }

  private async recordRecent(budget: OpenBudgetInfo): Promise<void> {
    await step('record the recent budget', async () => {
      const app = await this.deps.control.call('settings.getApp', {});
      const ref = { cloudFileId: budget.cloudFileId, groupId: budget.groupId, name: budget.name };
      const recent = [
        { ...ref, lastOpenedAt: this.now() },
        ...app.recentBudgets.filter((r) => r.cloudFileId !== budget.cloudFileId),
      ].slice(0, 10);
      await this.deps.control.call('settings.patchApp', {
        patch: { lastBudget: ref, recentBudgets: recent },
      });
    }).catch(() => undefined);
  }

  /** Closes the budget (03 §4, §5.4). With unsynced changes, only when `force` (the dialog's "anyway"). */
  async closeBudget(force: boolean): Promise<ConnectionInfo> {
    await this.job(
      'session.closeBudget',
      async () => {
        if (this.info.unsyncedChanges && !force) {
          throw new RpcError('conflict', 'Some changes have not reached the server.', {
            unsyncedChanges: true,
          });
        }
        const wasLocal = this.session === 'local';
        await this.closeInJob();
        if (wasLocal || this.info.signedOut || !this.token)
          this.set({ state: 'Disconnected', signedOut: false });
        else this.set({ state: 'SignedIn' });
      },
      { kind: 'sync' },
    );
    return this.state;
  }

  private async closeInJob(): Promise<void> {
    this.persistLastSync(true);
    if (this.info.budget || this.session !== 'none') await this.deps.actual.shutdown();
    this.deps.actual.setOfflineFallback(false);
    this.session = 'none';
    this.e2ePassword = null;
    this.localId = null;
    this.encrypted = false;
    this.writesSinceSync = false;
    if (this.postWriteTimer) clearTimeout(this.postWriteTimer);
    this.postWriteTimer = null;
    this.set({ budget: null, unsyncedChanges: false, lastSyncAt: null });
  }

  /** Refuses with the §5.4 conflict while unsynced changes would be lost, unless forced. */
  private requireSynced(force: boolean): void {
    if (this.info.budget && this.info.unsyncedChanges && !force) {
      throw new RpcError('conflict', 'Some changes have not reached the server.', {
        unsyncedChanges: true,
      });
    }
  }

  /** Ends the API session and forgets everything in host memory for it. Inside a job. */
  private async endSession(): Promise<void> {
    await this.closeInJob();
    await this.deps.actual.shutdown().catch(() => undefined);
    this.session = 'none';
    this.token = null;
    this.userId = null;
    this.authReturn = null;
  }

  /**
   * Sign out (03 §7.3): close the budget, end the session, delete this server's stored token and every
   * remembered encryption password, and forget the last budget. The cache and device settings stay.
   */
  async signOut(force: boolean): Promise<ConnectionInfo> {
    await this.job(
      'session.signOut',
      async () => {
        this.requireSynced(force);
        const serverUrl = this.info.serverUrl;
        await this.endSession();
        if (serverUrl) await this.forgetStoredToken(serverUrl);
        await this.deps.control.call('secrets.clear', { prefix: 'e2e:' });
        await this.deps.control.call('settings.patchApp', { patch: { lastBudget: null } });
        this.set({ state: 'Disconnected', signedOut: false });
      },
      { kind: 'sync' },
    );
    return this.state;
  }

  /**
   * Change server (03 §7.2): close the budget, end the session, delete the whole cache, every device-
   * settings file and every secret, and reset the server, recent and last budgets, and this server's user.
   */
  async forgetServer(force: boolean): Promise<ConnectionInfo> {
    await this.job(
      'session.forgetServer',
      async () => {
        this.requireSynced(force);
        const serverUrl = this.info.serverUrl;
        await this.endSession();
        await this.deps.removeCache?.();
        await this.deps.control.call('settings.deleteAllBudgets', {});
        await this.deps.control.call('secrets.clear', {});
        const app = await this.deps.control.call('settings.getApp', {});
        const serverUsers = Object.fromEntries(
          Object.entries(app.serverUsers).filter(([url]) => url !== serverUrl),
        );
        await this.deps.control.call('settings.patchApp', {
          patch: { serverUrl: null, lastBudget: null, recentBudgets: [], serverUsers },
        });
        this.set({ state: 'Disconnected', serverUrl: null, signedOut: false });
      },
      { kind: 'sync' },
    );
    return this.state;
  }

  /**
   * Clear Offline Cache (03 §2): close the budget, delete the cache folder, and remove localId and
   * lastSyncAt from every budget's device settings. The sign-in stays, so the budget list comes back.
   */
  async clearCache(force: boolean): Promise<ConnectionInfo> {
    await this.job(
      'session.clearCache',
      async () => {
        this.requireSynced(force);
        await this.closeInJob();
        await this.deps.actual.shutdown().catch(() => undefined);
        this.session = 'none';
        await this.deps.removeCache?.();
        await this.deps.control.call('settings.patchAllBudgets', {
          patch: { localId: null, lastSyncAt: null },
        });
        this.set({ state: this.token ? 'SignedIn' : 'Disconnected' });
      },
      { kind: 'sync' },
    );
    return this.state;
  }

  /** The signed-in server user (03 §7.1), or null when unknown. */
  get serverUserId(): string | null {
    return this.userId;
  }

  /**
   * Budget Setup's create flow (07 §4), one job: close the open budget, refuse a name the server already
   * has, `runImport` with `fill`, confirm the upload through `getBudgets()`, then sync and open it
   * like any other budget. Allowed in SignedIn, and with a budget open while Online (06 §4).
   */
  async createBudget(
    name: string,
    fill: () => Promise<void>,
    force: boolean,
  ): Promise<OpenBudgetInfo> {
    return this.job(
      'budgetFile.create',
      async () => {
        if (!['SignedIn', 'Online', 'Syncing'].includes(this.info.state)) throw offlineError();
        this.requireSynced(force);
        await this.ensureServerInit();
        const files = await this.deps.actual.getBudgets();
        if (files.some((f) => f.state === 'remote' && f.name === name)) {
          throw new RpcError('conflict', 'A budget with this name already exists.', {
            code: 'duplicate-name',
          });
        }
        if (this.info.budget) {
          await this.closeInJob();
          this.set({ state: 'SignedIn' });
          await this.ensureServerInit();
        }
        const created = await this.deps.actual.createBudget(name, fill);
        const remote = created?.cloudFileId
          ? (await this.deps.actual.getBudgets()).find(
              (b) => b.state === 'remote' && b.cloudFileId === created.cloudFileId,
            )
          : undefined;
        if (!created || !remote) {
          // Created on this computer only. It isn't listed; Clear Offline Cache removes it (07 §4).
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          this.set({ state: 'SignedIn' });
          throw new RpcError('actual', 'The budget was not uploaded.', { code: 'upload-failed' });
        }
        this.localId = created.id ?? null;
        this.e2ePassword = null;
        this.encrypted = false;
        try {
          await this.deps.actual.sync();
        } catch (e) {
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          this.handleSyncFailure(e);
          if (this.info.state === 'OfflineReadOnly') this.set({ state: 'SignedIn' });
          throw toRpcError(e);
        }
        return this.opened(remote, false);
      },
      // Longer than the 120 s upload fetch timeout (03 §3).
      { kind: 'sync', timeoutMs: OPEN_JOB_TIMEOUT_MS },
    );
  }

  /**
   * Import a budget file (07 §3.4), one job: read the file, close the open budget, `importBudget` (which
   * uploads it as a new server budget and leaves it loaded), confirm the upload, rename it when another
   * server budget has its name, then open it like a new budget.
   */
  async importBudget(
    read: () => Promise<{ data: Uint8Array; filename: string }>,
    type: BudgetFileType,
    importedSuffix: string,
    force: boolean,
  ): Promise<OpenBudgetInfo> {
    return this.job(
      'budgetFile.importFile',
      async () => {
        if (!['SignedIn', 'Online', 'Syncing'].includes(this.info.state)) throw offlineError();
        this.requireSynced(force);
        // Read first: a file that can't be read, or a tracking budget, leaves the open budget open. A
        // tracking export is refused before importBudget uploads it (03 §6.1).
        const { data, filename } = await read();
        if (type === 'actual' && isTrackingExport(data)) throw trackingBudgetError();
        await this.ensureServerInit();
        if (this.info.budget) {
          await this.closeInJob();
          this.set({ state: 'SignedIn' });
          await this.ensureServerInit();
        }
        const names = new Set(
          (await this.deps.actual.getBudgets()).flatMap((b) =>
            b.state === 'remote' ? [b.name] : [],
          ),
        );
        const leave = async (): Promise<void> => {
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          this.set({ state: 'SignedIn' });
        };
        let imported: BudgetFile | null;
        try {
          imported = await step('import the budget', () =>
            this.deps.actual.importBudget(data, type, filename),
          );
        } catch {
          await leave();
          throw new RpcError('validation', 'The file could not be imported.', {
            code: 'bad-file',
          });
        }
        const cloudFileId = imported?.cloudFileId;
        const remote = cloudFileId
          ? (await this.deps.actual.getBudgets()).find(
              (b) => b.state === 'remote' && b.cloudFileId === cloudFileId,
            )
          : undefined;
        if (!imported || !remote) {
          // Imported on this computer only. It isn't listed; Clear Offline Cache removes it (07 §3.4).
          await leave();
          throw new RpcError('actual', 'The budget was not uploaded.', { code: 'upload-failed' });
        }
        let file = remote;
        if (names.has(remote.name)) {
          const name = `${remote.name} ${importedSuffix}`;
          try {
            await step('rename the imported budget', () => this.deps.actual.renameBudget(name));
            file = { ...remote, name };
          } catch {
            // Without the rename handler the import keeps its name (07 §4).
          }
        }
        this.localId = imported.id ?? null;
        this.e2ePassword = null;
        this.encrypted = false;
        try {
          await this.deps.actual.sync();
        } catch (e) {
          await this.deps.actual.shutdown().catch(() => undefined);
          this.session = 'none';
          this.handleSyncFailure(e);
          if (this.info.state === 'OfflineReadOnly') this.set({ state: 'SignedIn' });
          throw toRpcError(e);
        }
        return this.opened(file, false);
      },
      { kind: 'sync', timeoutMs: IMPORT_JOB_TIMEOUT_MS },
    );
  }

  /** A long job's progress for the renderer's overlay (03 §3, §8). */
  progress(label: string, done: number, total: number): void {
    this.deps.emit('job:progress', { label, done, total });
  }

  /** Main's record of a running slate wipe, reported if the host dies meanwhile (03 §6.5 step 5). */
  slateWipePhase(phase: 'started' | 'ended', backupPath?: string): void {
    this.deps.control.notify(
      'job:slateWipe',
      backupPath === undefined ? { phase } : { phase, backupPath },
    );
  }

  /**
   * After a rename through Budget Properties (07 §4): the open budget's name, in the state and in the
   * recent and last budget lists.
   */
  async budgetRenamed(name: string): Promise<void> {
    await this.budgetRefChanged({ name });
  }

  /** The open budget's name or groupId changed: in the state and in the recent and last budget lists. */
  private async budgetRefChanged(patch: { name?: string; groupId?: string }): Promise<void> {
    const budget = this.info.budget;
    if (!budget) return;
    this.set({ budget: { ...budget, ...patch } });
    await step('record the changed budget', async () => {
      const app = await this.deps.control.call('settings.getApp', {});
      const update = <T extends { cloudFileId: string; name: string; groupId: string }>(r: T): T =>
        r.cloudFileId === budget.cloudFileId ? { ...r, ...patch } : r;
      await this.deps.control.call('settings.patchApp', {
        patch: {
          recentBudgets: app.recentBudgets.map(update),
          lastBudget: app.lastBudget ? update(app.lastBudget) : null,
        },
      });
    }).catch(() => undefined);
  }

  /**
   * Enables end-to-end encryption on the open budget, or replaces its key (03 §7, 07 §4). `key-make` resets
   * sync and uploads this copy as the new source of truth, so it runs once, behind the write gate, and is
   * never retried. Afterwards the server's groupId and hasKey are read again (the cloudFileId stays), the
   * password is kept in memory and, only now, remembered or forgotten, and the budget syncs. A password
   * that couldn't be remembered or forgotten doesn't fail the key change: the result says so, for a
   * warning.
   */
  async setEncryptionKey(password: string, remember: boolean): Promise<EncryptionKeyResult> {
    const budget = this.info.budget;
    if (!budget) throw new RpcError('validation', 'No budget is open.');
    const { cloudFileId } = budget;
    let rememberFailed = false;
    let forgetFailed = false;
    await this.write(
      'budgetFile.setEncryptionKey',
      [],
      async () => {
        try {
          await this.deps.actual.makeEncryptionKey(password);
        } catch (e) {
          // The reset may have reached the server before the failure: show what it holds now.
          await this.refreshRemoteBudget(cloudFileId).catch(() => undefined);
          throw toRpcError(e);
        }
        this.e2ePassword = password;
        if (remember) {
          await step('remember the encryption password', () =>
            this.deps.control.call('secrets.set', { key: `e2e:${cloudFileId}`, value: password }),
          ).catch(() => {
            rememberFailed = true;
          });
        } else {
          await step('forget the old encryption password', () =>
            this.deps.control.call('secrets.delete', { key: `e2e:${cloudFileId}` }),
          ).catch(() => {
            forgetFailed = true;
          });
        }
        await this.refreshRemoteBudget(cloudFileId).catch(() => undefined);
        await this.syncInJob(false);
      },
      { timeoutMs: IMPORT_JOB_TIMEOUT_MS },
    );
    return { rememberFailed, forgetFailed };
  }

  /** The server's groupId and hasKey for the open budget, after a key change (03 §7). */
  private async refreshRemoteBudget(cloudFileId: string): Promise<void> {
    const remote = (await this.deps.actual.getBudgets()).find(
      (b) => b.state === 'remote' && b.cloudFileId === cloudFileId,
    );
    if (!remote) return;
    this.encrypted = remote.hasKey === true;
    if (remote.groupId && remote.groupId !== this.info.budget?.groupId)
      await this.budgetRefChanged({ groupId: remote.groupId });
  }

  /** "Stay signed in on this computer" (03 §7 step 3): store the session token, or delete it. */
  async setStaySignedIn(on: boolean): Promise<null> {
    const serverUrl = this.info.serverUrl;
    if (!serverUrl) throw new RpcError('validation', 'No server is configured.');
    if (!on) await this.forgetStoredToken(serverUrl);
    else if (this.token)
      await this.deps.control.call('secrets.set', {
        key: `server:${serverUrl}`,
        value: this.token,
      });
    else throw new RpcError('auth', 'Sign in to your Actual server.', { code: 'no-token' });
    return null;
  }

  /** The server's version (21 §7), or null when it can't be read. */
  async serverVersion(): Promise<string | null> {
    const serverUrl = this.info.serverUrl;
    if (!serverUrl || !this.deps.serverVersion) return null;
    return this.deps.serverVersion(serverUrl);
  }

  /** Main's quit handshake (06 §5): shutdown() in a job, so it never overlaps another API call. */
  async shutdownForQuit(): Promise<void> {
    this.dispose();
    await step('shutdown on quit', () =>
      this.job('app:quit', () => this.closeInJob(), { kind: 'sync' }),
    ).catch(() => undefined);
  }

  // ----------------------------------------------------------------------------- errors

  private toError(message: string): void {
    this.set({ state: 'Error', message });
  }

  // ------------------------------------------------------------------------------ writes

  /**
   * Runs a write as one queue job behind the gate (03 §5). The job emits `data:changed` for the tables it
   * wrote plus the `applied` tables seen meanwhile, then a coalesced post-write sync follows as its own job.
   */
  write<T>(
    label: string,
    tables: string[],
    fn: () => Promise<T>,
    opts: Omit<JobOptions, 'kind'> = {},
  ): Promise<T> {
    return this.job(
      label,
      async () => {
        await this.gate();
        this.writeTables = new Set(tables);
        try {
          return await fn();
        } finally {
          const changed = [...this.writeTables];
          this.writeTables = null;
          this.writesSinceSync = true;
          if (changed.length > 0) this.deps.emit('data:changed', { tables: changed });
          this.schedulePostWriteSync();
        }
      },
      { ...opts, kind: 'write' },
    );
  }

  /** The write gate, run at the start of every write job (03 §5.1). */
  private async gate(): Promise<void> {
    if (!canEdit(this.info.state)) throw offlineError();
    if (this.now() - this.lastContact <= GATE_MAX_AGE_MS) return;
    try {
      await this.deps.actual.sync();
      this.markSynced([]);
    } catch (e) {
      this.handleSyncFailure(e);
      throw offlineError();
    }
  }

  private schedulePostWriteSync(): void {
    if (this.postWriteTimer) clearTimeout(this.postWriteTimer);
    this.postWriteTimer = setTimeout(() => {
      this.postWriteTimer = null;
      void this.backgroundSync();
    }, POST_WRITE_SYNC_MS);
  }

  // ------------------------------------------------------------------------------- sync

  /** Sync Now (Ctrl+S, X9). */
  async syncNow(): Promise<ConnectionInfo> {
    if (!this.info.budget) return this.state;
    if (this.info.state === 'OfflineReadOnly') return (await this.retry('manual')).connection;
    await this.job('session.syncNow', () => this.syncInJob(true), { kind: 'sync' });
    return this.state;
  }

  /** A queued sync (health timer, focus, post-write). Failures only change the state. */
  private async backgroundSync(): Promise<void> {
    if (this.syncQueued || !this.info.budget || this.session !== 'server') return;
    if (!canEdit(this.info.state)) return;
    this.syncQueued = true;
    try {
      await this.job('sync', () => this.syncInJob(false), { kind: 'sync' });
    } catch {
      // The state already reflects the failure.
    } finally {
      this.syncQueued = false;
    }
  }

  private async syncInJob(rethrow: boolean): Promise<void> {
    if (this.session !== 'server') return;
    try {
      await this.deps.actual.sync();
      this.markSynced([]);
    } catch (e) {
      this.handleSyncFailure(e);
      if (rethrow) throw toRpcError(e);
    }
  }

  /** A successful sync: Online, lastSyncAt, unsynced changes pushed. */
  private markSynced(tables: string[]): void {
    const at = this.now();
    this.lastContact = at;
    this.writesSinceSync = false;
    const patch: Partial<ConnectionInfo> = { lastSyncAt: at, unsyncedChanges: false };
    if (this.info.state === 'Syncing' || this.info.state === 'Online') patch.state = 'Online';
    this.set(patch);
    this.persistLastSync();
    if (tables.length > 0) this.deps.emit('data:changed', { tables });
    if (this.info.state === 'Online' && this.info.budget) this.runStartTasksIfDue();
  }

  private handleSyncFailure(e: unknown): void {
    const code = errorCode(e);
    if (code && NETWORK_CODES.has(code)) this.toOffline();
    else if (code && AUTH_CODES.has(code)) this.handleAuthFailure();
    else if (
      code === 'file-has-reset' ||
      code === 'decrypt-failure' ||
      code === 'out-of-sync-migrations'
    )
      this.toError(code);
    else this.endSyncing(`sync failed: ${code ?? describeError(e).message}`);
  }

  /**
   * A sync that failed with an error that changes no state (`out-of-sync`, `clock-drift`, …) still ended:
   * back to Online, or the indicator spins and the health and focus syncs, which run only Online, stop.
   */
  private endSyncing(reason?: string): void {
    if (this.info.state === 'Syncing') this.set({ state: 'Online' }, reason);
  }

  /** Actual's sync events, including its own automatic syncs (03 §4.1). */
  private onSyncEvent(e: SyncEvent): void {
    if (!this.info.budget || this.session === 'none') return;
    switch (e.type) {
      case 'start':
        if (this.info.state === 'Online') this.set({ state: 'Syncing' });
        break;
      case 'applied':
        if (this.writeTables) {
          for (const t of e.tables) this.writeTables.add(t);
        } else if (e.tables.length > 0) {
          this.deps.emit('data:changed', { tables: e.tables });
        }
        if (
          this.info.state === 'OfflineReadOnly' &&
          this.session === 'server' &&
          !this.info.unsyncedChanges
        ) {
          this.set({ unsyncedChanges: true });
        }
        break;
      case 'success':
        if (this.info.state === 'Online' || this.info.state === 'Syncing')
          this.markSynced(e.tables);
        else if (e.tables.length > 0) this.deps.emit('data:changed', { tables: e.tables });
        break;
      case 'error':
        if (this.info.state !== 'Online' && this.info.state !== 'Syncing') break;
        if (e.subtype === 'network') this.toOffline();
        else if (e.subtype === 'file-has-reset' || e.subtype === 'decrypt-failure')
          this.toError(e.subtype);
        else this.endSyncing(`sync error: ${e.subtype}`);
        break;
      case 'unauthorized':
        if (this.info.state === 'Online' || this.info.state === 'Syncing') this.handleAuthFailure();
        break;
    }
  }

  // ------------------------------------------------------------------------- offline mode

  private toOffline(): void {
    if (this.info.state === 'OfflineReadOnly') return;
    // A write made since the last successful sync is in the cache but not on the server (03 §5.2).
    const unsynced = this.info.unsyncedChanges || this.writesSinceSync || this.writeTables !== null;
    this.retryAttempt = 0;
    this.set({ state: 'OfflineReadOnly', unsyncedChanges: unsynced });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retriesPaused || this.retryTimer) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retry('timer');
    }, delay);
  }

  /**
   * A retry (03 §4.2): first a reachability probe outside the queue, so a dead server never blocks
   * reads; only if it answers, one queued job: sync() for a server session, a same-process re-init for
   * a local-only session.
   */
  async retry(
    trigger: 'timer' | 'focus' | 'manual',
  ): Promise<{ connection: ConnectionInfo; diagnosis: Diagnosis; errorCode?: string }> {
    if (this.info.state !== 'OfflineReadOnly' || this.retrying)
      return { connection: this.state, diagnosis: 'none' };
    if (trigger === 'manual') this.retriesPaused = false;
    if (this.retriesPaused && trigger !== 'manual')
      return { connection: this.state, diagnosis: 'none' };
    const serverUrl = this.info.serverUrl;
    if (!serverUrl) return { connection: this.state, diagnosis: 'none' };
    this.retrying = true;
    try {
      if (this.info.signedOut) {
        // Signed out: Retry now shows the sign-in modal again (03 §4).
        this.toAuthRequired({ kind: 'budget' });
        return { connection: this.state, diagnosis: 'none' };
      }
      const probe = await this.deps.probe(serverUrl);
      if (!probe.reachable) {
        this.scheduleRetry();
        return {
          connection: this.state,
          diagnosis: probe.diagnosis,
          ...(probe.code ? { errorCode: probe.code } : {}),
        };
      }
      if (this.session === 'local') {
        this.token ??= await this.storedToken(serverUrl);
        if (!this.token) {
          this.toAuthRequired({ kind: 'budget' });
          return { connection: this.state, diagnosis: 'none' };
        }
        // A local copy doesn't record hasKey (03 §6.1): use a remembered password if there is one; the
        // re-init reports missing-key otherwise, and the encryption prompt appears (03 §4.2).
        this.e2ePassword ??= await this.storedE2e(this.info.budget?.cloudFileId ?? '');
      }
      this.set({ state: 'Reconnecting' });
      try {
        if (this.session === 'server') {
          await this.job(
            'retry: sync',
            async () => {
              await this.deps.actual.sync();
            },
            { kind: 'sync' },
          );
          this.set({ state: 'Online' });
          this.markSynced([]);
        } else {
          await this.job('retry: re-init', () => this.reinitOrFallBack(), {
            kind: 'sync',
            timeoutMs: OPEN_JOB_TIMEOUT_MS,
            fatalOnTimeout: true,
          });
        }
        this.retryAttempt = 0;
        return { connection: this.state, diagnosis: 'none' };
      } catch (e) {
        const code = errorCode(e) ?? detailCode(e);
        if (code && AUTH_CODES.has(code)) this.handleAuthFailure();
        else if (
          code === 'file-has-reset' ||
          code === 'out-of-sync-migrations' ||
          (code === 'decrypt-failure' && this.session === 'server')
        ) {
          // Unrecoverable for this session (03 §4 "any → Error"), as after any other sync.
          this.toError(code);
        } else if (code === 'missing-key' || code === 'decrypt-failure') {
          // The encryption prompt appears; retries pause until Retry now (03 §4.2).
          this.retriesPaused = true;
          this.set({ state: 'OfflineReadOnly', message: code });
        } else if (this.state.state === 'Reconnecting') {
          this.set({ state: 'OfflineReadOnly' });
          this.scheduleRetry();
        }
        return { connection: this.state, diagnosis: 'none' };
      }
    } finally {
      this.retrying = false;
    }
  }

  /**
   * Re-init, and if it fails part-way, reopen the local copy local-only so the budget stays readable.
   * Rethrows the failure for the caller to classify. Runs inside a job.
   */
  private async reinitOrFallBack(): Promise<void> {
    try {
      await step('re-init', () => this.reinitServer());
    } catch (e) {
      await step('reopen the local copy', () => this.restoreLocal()).catch(() => undefined);
      throw e;
    }
  }

  private async restoreLocal(): Promise<void> {
    if (!this.info.budget || !this.localId) return;
    await this.deps.actual.shutdown().catch(() => undefined);
    await this.deps.actual.init({ dataDir: this.deps.dataDir });
    this.session = 'local';
    await this.deps.actual.loadBudget(this.localId);
    this.deps.actual.setOfflineFallback(true);
    if (!this.info.budget.localOnly) this.set({ budget: { ...this.info.budget, localOnly: true } });
  }

  /**
   * Re-inits the API with the server in the same process: shutdown → init(token) → downloadBudget
   * (current groupId, 03 §6.1) → sync. Used to reconnect a local-only session and after re-auth with a
   * budget open. Runs inside a job.
   */
  private async reinitServer(): Promise<void> {
    const budget = this.info.budget;
    const serverUrl = this.info.serverUrl;
    if (!budget || !serverUrl || !this.token)
      throw new RpcError('auth', 'Sign in to your Actual server.');
    await this.deps.actual.shutdown().catch(() => undefined);
    this.deps.actual.setOfflineFallback(false);
    this.session = 'none';
    await this.deps.actual.init({
      dataDir: this.deps.dataDir,
      serverURL: serverUrl,
      sessionToken: this.token,
    });
    this.session = 'server';
    const remote = (await this.serverBudgets(serverUrl)).find(
      (b) => b.cloudFileId === budget.cloudFileId && b.state === 'remote',
    );
    if (!remote?.groupId)
      throw new RpcError('not-found', 'This budget no longer exists on the server.');
    this.encrypted = remote.hasKey === true;
    await this.deps.actual.downloadBudget(remote.groupId, this.e2ePassword ?? undefined);
    await this.deps.actual.sync();
    const at = this.now();
    this.lastContact = at;
    const reopened: OpenBudgetInfo = { ...budget, groupId: remote.groupId, localOnly: false };
    this.authReturn = null;
    // A re-init after sign-in comes from AuthRequired, which paused the retries (03 §4).
    this.retriesPaused = false;
    this.set({
      state: 'Online',
      budget: reopened,
      lastSyncAt: at,
      unsyncedChanges: false,
      signedOut: false,
    });
    this.persistLastSync(true);
    this.deps.emit('data:changed', { tables: ALL_TABLES });
    this.deps.emit('budget:opened', reopened);
    this.deps.control.notify('budget:opened', reopened);
    this.runStartTasksIfDue();
  }

  /** Main forwards `browser-window-focus` (03 §4.1): sync while Online, retry while offline. */
  onWindowFocus(): void {
    if (this.info.state === 'Online') void this.backgroundSync();
    else if (this.info.state === 'OfflineReadOnly') void this.retry('focus');
  }

  // --------------------------------------------------------------------------- crash recovery

  /**
   * Reopens the previous session after a host restart (03 §6.5). Errors leave the matching state; a budget
   * that didn't reopen is reported to the renderer, which handles it like any failed open.
   */
  async restore(r: SessionRestore): Promise<void> {
    this.set({ serverUrl: r.serverUrl });
    try {
      await step('session restore', async () => {
        if (r.cloudFileId) {
          if (!r.localOnly) {
            this.token = await this.storedToken(r.serverUrl);
          }
          await this.openBudget(r.cloudFileId);
        } else {
          await this.connect(r.serverUrl, undefined, false);
        }
      });
    } catch (e) {
      if (r.cloudFileId)
        this.deps.emit('session:restoreFailed', {
          cloudFileId: r.cloudFileId,
          error: toRpcError(e).toData(),
        });
    }
    // After the reopen, failed or not: the slate wipe error with the backup path (18 §2).
    if (r.interruptedSlateWipe !== undefined)
      this.deps.emit('slateWipe:interrupted', { backupPath: r.interruptedSlateWipe });
  }

  /** Server URL from settings at host start, so startup and offline opens know where to go. */
  setServerUrl(serverUrl: string | null): void {
    this.set({ serverUrl });
  }
}

/**
 * One entry per cloudFileId; the server's copy wins, and a local copy marks "Offline copy" (03 §6.1). A
 * budget owned by someone other than the signed-in user is Shared (03 §7.1).
 */
export function dedupeBudgets(
  files: BudgetFile[],
  userId: string | null = null,
): BudgetListEntry[] {
  const byId = new Map<string, { remote?: BudgetFile; local?: BudgetFile }>();
  for (const f of files) {
    if (!f.cloudFileId) continue;
    const slot = byId.get(f.cloudFileId) ?? {};
    if (f.state === 'remote') slot.remote = f;
    else if (f.id) slot.local = f;
    byId.set(f.cloudFileId, slot);
  }
  const out: BudgetListEntry[] = [];
  for (const [cloudFileId, { remote, local }] of byId) {
    if (!remote) continue;
    out.push({
      cloudFileId,
      groupId: remote.groupId ?? '',
      name: remote.name,
      encrypted: remote.hasKey === true,
      offlineCopy: local !== undefined,
      shared:
        userId !== null &&
        typeof remote.owner === 'string' &&
        remote.owner !== '' &&
        remote.owner !== userId,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
