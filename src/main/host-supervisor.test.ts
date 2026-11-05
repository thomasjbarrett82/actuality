import { setDebug } from '@shared/aspects/level';
import { INITIAL_CONNECTION, type ConnectionInfo, type OpenBudgetInfo } from '@shared/connection';
import { RENDERER_PORT_MESSAGE, type SessionRestore } from '@shared/rpc/control-api';
import { IPC } from '@shared/shell-api';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRASH_WINDOW_MS, MAX_CRASHES, type ControlContext } from './host-control';
import { HostSupervisor, type SupervisorOptions } from './host-supervisor';

/** A utility process the test plays the host for: it sees what main posts and can answer or exit. */
const fake = vi.hoisted(() => {
  class Emitter {
    private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const l of this.listeners.get(event) ?? []) l(...args);
    }
  }

  class FakeChild extends Emitter {
    readonly posted: unknown[] = [];
    /** The ports sent with each message. */
    readonly transfers: unknown[] = [];
    readonly stdout = new Emitter();
    readonly stderr = new Emitter();
    killed = false;

    constructor(readonly options: { env: Record<string, string> }) {
      super();
    }

    postMessage(m: unknown, transfer?: unknown[]): void {
      this.posted.push(m);
      if (transfer) this.transfers.push(...transfer);
    }

    kill(): void {
      this.killed = true;
      this.emit('exit', 0);
    }
  }
  const children: FakeChild[] = [];
  return { FakeChild, children };
});

vi.mock('electron', () => ({
  utilityProcess: {
    fork: (_path: string, _args: string[], options: { env: Record<string, string> }) => {
      const child = new fake.FakeChild(options);
      fake.children.push(child);
      return child;
    },
  },
  MessageChannelMain: vi.fn(function () {
    return { port1: 'port-to-host', port2: 'port-to-renderer' };
  }),
}));

const budget: OpenBudgetInfo = {
  cloudFileId: 'b1',
  groupId: 'g1',
  name: 'Budget',
  budgetType: 'envelope',
  localOnly: false,
};

let now = 0;

function supervisor(opts: Partial<SupervisorOptions> = {}): HostSupervisor {
  fake.children.length = 0;
  now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return new HostSupervisor({
    userData: '/tmp/actual-desktop-test',
    extraCaCertPath: null,
    control: {} as ControlContext,
    webContents: () => null,
    onStatus: () => undefined,
    ...opts,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function latest(): InstanceType<typeof fake.FakeChild> {
  const child = fake.children.at(-1);
  if (!child) throw new Error('no host started');
  return child;
}

const state = (patch: Partial<ConnectionInfo>): void => {
  latest().emit('message', {
    event: 'connection:state',
    payload: { ...INITIAL_CONNECTION, serverUrl: 'https://x', ...patch },
  });
};
const event = (name: string, payload: unknown = null): void => {
  latest().emit('message', { event: name, payload });
};
/** The host exits; each crash is outside the previous one's window, so main always restarts it. */
const crash = (): void => {
  now += CRASH_WINDOW_MS;
  latest().emit('exit', 1);
};

/** The `session:restore` requests main sent to the latest host. */
const restores = (): { id: number; params: SessionRestore }[] =>
  latest().posted.filter(
    (m): m is { id: number; method: string; params: SessionRestore } =>
      (m as { method?: string }).method === 'session:restore',
  );

describe('HostSupervisor crash recovery (03 §6.5)', () => {
  it("reopens the crashed host's budget, although the new host first reports no budget", () => {
    const sup = supervisor();
    sup.start();
    state({ state: 'Online', budget });
    event('budget:opened', budget);
    event('host:ready');
    expect(restores()).toEqual([]);

    crash();
    expect(fake.children).toHaveLength(2);
    // The new host's first state, from before it reopens anything.
    state({ state: 'Disconnected' });
    event('host:ready');
    expect(restores().map((r) => r.params)).toEqual([
      { serverUrl: 'https://x', cloudFileId: 'b1', localOnly: false },
    ]);
  });

  it('keeps the session through a crash during the reopen, and forgets it once reopened', async () => {
    const sup = supervisor();
    sup.start();
    state({ state: 'Online', budget });
    event('budget:opened', budget);
    event('host:ready');
    crash();
    state({ state: 'Disconnected' });
    event('host:ready');
    // It crashes while connecting, before the budget is open again.
    state({ state: 'Connecting' });
    crash();
    event('host:ready');
    const [again] = restores();
    expect(again?.params.cloudFileId).toBe('b1');

    // This host finishes the reopen; later the user closes the budget, then it crashes.
    latest().emit('message', { id: again?.id, ok: true, result: null });
    await Promise.resolve();
    state({ state: 'SignedIn' });
    crash();
    event('host:ready');
    expect(restores().map((r) => r.params)).toEqual([
      { serverUrl: 'https://x', cloudFileId: null, localOnly: false },
    ]);
  });
});

describe('HostSupervisor log level (02 §8.3)', () => {
  const levels = (): unknown[] =>
    latest()
      .posted.filter((m) => (m as { event?: string }).event === 'log:level')
      .map((m) => (m as { payload: unknown }).payload);

  afterEach(() => {
    setDebug(false);
  });

  it('sends the current level when the host is ready, and again after a restart', () => {
    const sup = supervisor();
    sup.start();
    expect(levels()).toEqual([]);
    event('host:ready');
    expect(levels()).toEqual([{ debug: false }]);

    setDebug(true);
    crash();
    expect(levels()).toEqual([]);
    event('host:ready');
    expect(levels()).toEqual([{ debug: true }]);
  });
});

describe('HostSupervisor process (02 §1, §4)', () => {
  it('starts the host with the CA certificates and reports its output without color codes', () => {
    const onLifecycle = vi.fn();
    const sup = supervisor({ extraCaCertPath: '/certs/ca.pem', onLifecycle });
    sup.start();
    expect(latest().options.env).toMatchObject({
      ACTUAL_DESKTOP_USER_DATA: '/tmp/actual-desktop-test',
      NODE_EXTRA_CA_CERTS: '/certs/ca.pem',
    });
    latest().stdout.emit('data', Buffer.from('\u001b[32mready\u001b[0m\n'));
    latest().stderr.emit('data', Buffer.from('warning '));
    expect(onLifecycle.mock.calls).toEqual([
      ['host.start', {}],
      ['host.stdout', { text: 'ready' }],
      ['host.stderr', { text: 'warning' }],
    ]);
  });

  it("serves the host's control requests and passes on its log entries", async () => {
    const onHostLog = vi.fn();
    const serveControl = vi.fn(() => Promise.resolve('value'));
    const sup = supervisor({ onHostLog, serveControl });
    sup.start();
    latest().emit('message', { id: 7, method: 'secrets.get', params: { key: 'k' } });
    event('log', { message: 'hello' });
    await vi.waitFor(() => {
      expect(latest().posted).toContainEqual({ id: 7, ok: true, result: 'value' });
    });
    expect(serveControl).toHaveBeenCalledWith('secrets.get', { key: 'k' });
    expect(onHostLog).toHaveBeenCalledWith({ message: 'hello' });
  });

  it('answers a control method it does not know with an error', async () => {
    const sup = supervisor();
    sup.start();
    latest().emit('message', { id: 1, method: 'nope', params: {} });
    await vi.waitFor(() => {
      expect(latest().posted).toContainEqual({
        id: 1,
        ok: false,
        error: { code: 'validation', message: 'Unknown control method nope.' },
      });
    });
  });

  it('gives the renderer a port once the host is ready, and again on reload', () => {
    const wc = { isDestroyed: () => false, postMessage: vi.fn(), send: vi.fn() };
    const sup = supervisor({ webContents: () => wc as unknown as WebContents });
    sup.start();
    sup.connectRenderer();
    expect(wc.postMessage).not.toHaveBeenCalled();
    event('host:ready');
    sup.connectRenderer();
    expect(wc.postMessage.mock.calls).toEqual([
      [IPC.hostPort, null, ['port-to-renderer']],
      [IPC.hostPort, null, ['port-to-renderer']],
    ]);
    expect(latest().transfers).toEqual(['port-to-host', 'port-to-host']);
    expect(latest().posted).toContainEqual({ event: RENDERER_PORT_MESSAGE, payload: null });
  });

  it('tells the window when the host restarts, and fails after too many crashes', () => {
    const wc = { isDestroyed: () => false, postMessage: vi.fn(), send: vi.fn() };
    const onStatus = vi.fn();
    const sup = supervisor({ webContents: () => wc as unknown as WebContents, onStatus });
    sup.start();
    for (let i = 0; i < MAX_CRASHES; i++) latest().emit('exit', 1);
    expect(fake.children).toHaveLength(MAX_CRASHES);
    expect(onStatus.mock.calls).toEqual([['restarting'], ['failed']]);
    expect(wc.send).toHaveBeenLastCalledWith(IPC.hostStatus, 'failed');
    expect(sup.hostStatus).toBe('failed');
  });

  it('notifies the host and tracks its unsynced changes', () => {
    const sup = supervisor();
    sup.start();
    sup.notify('log:level', { debug: true });
    expect(latest().posted).toContainEqual({ event: 'log:level', payload: { debug: true } });
    expect(sup.unsyncedChanges).toBe(false);
    state({ state: 'Online', unsyncedChanges: true });
    expect(sup.unsyncedChanges).toBe(true);
  });
});

describe('HostSupervisor quit (06 §5)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const quitRequest = (): { id: number } | undefined =>
    latest().posted.find(
      (m): m is { id: number } => (m as { method?: string }).method === 'app:quit',
    );

  it('stops the host once it has shut down, without restarting it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const onStatus = vi.fn();
    const sup = supervisor({ onStatus });
    sup.start();
    const stopped = sup.stop();
    const child = latest();
    expect(child.killed).toBe(false);
    child.emit('message', { id: quitRequest()?.id, ok: true, result: null });
    await stopped;
    expect(child.killed).toBe(true);
    expect(fake.children).toHaveLength(1);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("stops a host that doesn't answer after the timeout", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const sup = supervisor();
    sup.start();
    const stopped = sup.stop();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(latest().killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopped;
    expect(latest().killed).toBe(true);
  });

  it('has nothing to stop before it starts', async () => {
    await expect(supervisor().stop()).resolves.toBeUndefined();
  });
});
