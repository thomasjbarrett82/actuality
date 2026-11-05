// The renderer's typed client for the API host (02 §4). Main brokers a MessagePort; preload forwards it to
// the page with window.postMessage. A new port arrives after every host restart (03 §6.5): calls made
// while there is no port wait for it. Once main gives up restarting the host, every call is rejected.
import { RpcEndpoint } from '@shared/rpc/endpoint';
import type {
  HostEvent,
  HostEvents,
  HostMethod,
  HostParams,
  HostResult,
} from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { HOST_PORT_MESSAGE } from '@shared/shell-api';

type Listener<E extends HostEvent> = (payload: HostEvents[E]) => void;

/** `details.code` of the calls rejected because the host failed for good (03 §6.5). */
export const HOST_FAILED = 'host-failed';

const hostFailed = (): RpcError =>
  new RpcError('internal', 'The API host stopped and will not restart.', { code: HOST_FAILED });

interface Waiting {
  resolve: (endpoint: RpcEndpoint) => void;
  reject: (e: unknown) => void;
}

export class HostClient {
  private endpoint: RpcEndpoint | null = null;
  private waiting: Waiting[] = [];
  /** Main stopped restarting the host (03 §6.5): calls fail at once instead of waiting for a port. */
  private failed = false;
  private readonly attachListeners = new Set<() => void>();
  private readonly listeners = new Map<HostEvent, Set<Listener<HostEvent>>>();
  /**
   * Request ids, numbered here rather than per port, so they stay unique across host restarts. The id is
   * the call id the host's log entries carry (02 §8.2).
   */
  private nextCallId = 1;

  /** Starts listening for ports posted by preload. */
  listen(target: Window): void {
    target.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== target || (e.data as { type?: string } | null)?.type !== HOST_PORT_MESSAGE)
        return;
      const port = e.ports[0];
      if (port) this.attach(port);
    });
  }

  /** Uses a port (tests pass one end of a MessageChannel). */
  attach(port: MessagePort): void {
    this.endpoint?.close('The API host restarted.');
    const endpoint = new RpcEndpoint({
      send: (m) => {
        port.postMessage(m);
      },
      listen: (h) => {
        const handler = (e: MessageEvent): void => {
          h(e.data);
        };
        port.addEventListener('message', handler);
        port.start();
        return () => {
          port.removeEventListener('message', handler);
          port.close();
        };
      },
    });
    endpoint.onEvent((event, payload) => {
      for (const l of this.listeners.get(event as HostEvent) ?? []) l(payload as never);
    });
    this.endpoint = endpoint;
    this.failed = false;
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) w.resolve(endpoint);
    for (const l of this.attachListeners) l();
  }

  /**
   * Main reported that the host failed for good (03 §6.5): rejects the calls in flight and those waiting
   * for a port, and every later call until a port arrives again.
   */
  fail(): void {
    this.failed = true;
    this.endpoint?.close(hostFailed());
    this.endpoint = null;
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) w.reject(hostFailed());
  }

  private ready(): Promise<RpcEndpoint> {
    if (this.failed) return Promise.reject(hostFailed());
    if (this.endpoint) return Promise.resolve(this.endpoint);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  call<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
    return this.request(this.nextCallId++, method, params) as Promise<HostResult<M>>;
  }

  /** One call with its request id: the join point renderer/main.ts weaves (02 §8.2). */
  async request(id: number, method: string, params: unknown): Promise<unknown> {
    const endpoint = await this.ready();
    // The host may have failed between the port arriving and this call going out.
    if (this.failed) throw hostFailed();
    return endpoint.call(method, params, id);
  }

  /** Runs after each new port: the host (re)started or the page reloaded. Runs now if already attached. */
  onAttach(listener: () => void): () => void {
    this.attachListeners.add(listener);
    if (this.endpoint) listener();
    return () => this.attachListeners.delete(listener);
  }

  on<E extends HostEvent>(event: E, listener: Listener<E>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<HostEvent>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<HostEvent>);
  }
}

export const host = new HostClient();
