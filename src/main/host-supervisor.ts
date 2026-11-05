// Spawns and supervises the API host (02 §1, 03 §6.5), serves its control channel (02 §4.1), and brokers
// a MessagePort pair between it and the renderer (02 §4). Its lifecycle events are hooks that index.ts
// connects to the logging aspects (02 §8.2).
import { isDebug } from '@shared/aspects/level';
import {
  RENDERER_PORT_MESSAGE,
  type HostToMainEvents,
  type MainToHostEvents,
  type SessionRestore,
} from '@shared/rpc/control-api';
import { RpcEndpoint } from '@shared/rpc/endpoint';
import type { RpcMessage } from '@shared/rpc/protocol';
import { IPC, type HostStatus } from '@shared/shell-api';
import {
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import { join } from 'node:path';
import { CrashPolicy, handleControl, SessionRecord, type ControlContext } from './host-control';

/** The host's output as plain text, without terminal color codes. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (d: Buffer): string => d.toString().replace(ANSI, '').trim();

/** How long main waits for the host's shutdown() on quit before stopping it (06 §5). */
const QUIT_TIMEOUT_MS = 20_000;

export interface SupervisorOptions {
  userData: string;
  /** NODE_EXTRA_CA_CERTS for self-signed servers (02 §6); takes effect when the host starts. */
  extraCaCertPath: string | null;
  control: ControlContext;
  /** The renderer to connect, or null before the window exists. */
  webContents: () => WebContents | null;
  onStatus: (status: HostStatus) => void;
  /** Serves one control request; default `handleControl` (index.ts weaves it, 02 §8.2). */
  serveControl?: (method: string, params: unknown) => Promise<unknown>;
  /** A log entry the host sent (02 §8.1). */
  onHostLog?: (entry: unknown) => void;
  /** Lifecycle: `host.start`, `host.exit` (unexpected, with the exit code), host stdout and stderr. */
  onLifecycle?: (event: HostLifecycle, facts: Record<string, string | number>) => void;
}

export type HostLifecycle = 'host.start' | 'host.exit' | 'host.stdout' | 'host.stderr';

export class HostSupervisor {
  private child: UtilityProcess | null = null;
  private endpoint: RpcEndpoint | null = null;
  private readonly crashes = new CrashPolicy();
  private readonly record = new SessionRecord();
  private stopping = false;
  private status: HostStatus = 'running';
  /** The current host said `host:ready`: only then does a renderer port reach a listening host. */
  private ready = false;
  /**
   * The session a crashed host had, taken when it crashed: a restarted host reports its own first states
   * before it reopens anything, which would overwrite the record. Kept until a host finishes reopening it.
   */
  private restoring: SessionRestore | null = null;

  constructor(private readonly opts: SupervisorOptions) {}

  start(): void {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ACTUAL_DESKTOP_USER_DATA: this.opts.userData,
    };
    if (this.opts.extraCaCertPath) env['NODE_EXTRA_CA_CERTS'] = this.opts.extraCaCertPath;
    const child = utilityProcess.fork(join(import.meta.dirname, '../host/index.js'), [], {
      serviceName: 'API host',
      env,
      stdio: 'pipe',
    });
    this.child = child;
    this.ready = false;
    this.opts.onLifecycle?.('host.start', {});
    child.stdout?.on('data', (d: Buffer) => {
      this.opts.onLifecycle?.('host.stdout', { text: plain(d) });
    });
    child.stderr?.on('data', (d: Buffer) => {
      this.opts.onLifecycle?.('host.stderr', { text: plain(d) });
    });

    const listeners = new Set<(m: unknown) => void>();
    child.on('message', (m: unknown) => {
      for (const l of listeners) l(m);
    });
    const endpoint = new RpcEndpoint({
      send: (m: RpcMessage) => {
        child.postMessage(m);
      },
      listen: (h) => {
        listeners.add(h);
        return () => listeners.delete(h);
      },
    });
    this.endpoint = endpoint;
    const serve =
      this.opts.serveControl ??
      ((method: string, params: unknown) => handleControl(this.opts.control, method, params));
    endpoint.handle((method, params) => serve(method, params));
    endpoint.onEvent((event, payload) => {
      if (event === 'log') this.opts.onHostLog?.(payload);
      else if (event === 'host:ready') this.onReady(endpoint);
      else this.record.onEvent(event as keyof HostToMainEvents, payload as never);
    });

    child.on('exit', (code) => {
      endpoint.close('The API host stopped.');
      if (this.child === child) {
        this.child = null;
        this.endpoint = null;
        this.ready = false;
      }
      if (!this.stopping) this.onCrash(code);
    });
  }

  private onReady(endpoint: RpcEndpoint): void {
    this.ready = true;
    // A restarted host starts at `info`: it gets the current level before anything else (02 §8.3).
    endpoint.emit('log:level', { debug: isDebug() } satisfies MainToHostEvents['log:level']);
    this.connectRenderer();
    this.setStatus('running');
    const session = this.restoring;
    if (!session) return;
    // A host that dies while reopening rejects the call; the session then waits for the next host.
    endpoint.call('session:restore', session).then(
      () => {
        if (this.restoring === session) this.restoring = null;
      },
      () => undefined,
    );
  }

  private onCrash(code: number): void {
    this.opts.onLifecycle?.('host.exit', { code });
    this.restoring ??= this.record.restore();
    if (!this.crashes.recordCrash(Date.now())) {
      this.setStatus('failed');
      return;
    }
    this.setStatus('restarting');
    this.start();
  }

  private setStatus(status: HostStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus(status);
    this.opts.webContents()?.send(IPC.hostStatus, status);
  }

  /**
   * Gives the renderer a fresh port to the host: once each host start is ready, and on each renderer
   * (re)load while it's ready. A port to a host still starting would go unanswered.
   */
  connectRenderer(): void {
    const wc = this.opts.webContents();
    if (!this.child || !this.ready || !wc || wc.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ event: RENDERER_PORT_MESSAGE, payload: null }, [port1]);
    wc.postMessage(IPC.hostPort, null, [port2]);
  }

  notify<E extends keyof MainToHostEvents>(event: E, payload: MainToHostEvents[E]): void {
    this.endpoint?.emit(event, payload);
  }

  get unsyncedChanges(): boolean {
    return this.record.unsyncedChanges;
  }

  get hostStatus(): HostStatus {
    return this.status;
  }

  /** The quit handshake (06 §5): the host runs shutdown() and replies; then it is stopped. */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    const endpoint = this.endpoint;
    const reply = endpoint?.call('app:quit', {}) ?? Promise.resolve(null);
    await Promise.race([
      reply.catch(() => null),
      new Promise((r) => setTimeout(r, QUIT_TIMEOUT_MS)),
    ]);
    child.kill();
  }
}
