// A transport-agnostic RPC endpoint: requests with ids, responses, and events (02 §4, §4.1). Used on both
// sides of the renderer↔host MessagePort and the main↔host parentPort.
import {
  isEvent,
  isRequest,
  isResponse,
  RpcError,
  toErrorData,
  type RpcMessage,
  type RpcResponse,
} from './protocol';

export interface Transport {
  send(message: RpcMessage): void;
  /** Registers the message listener. Returns a function that removes it. */
  listen(handler: (message: unknown) => void): () => void;
}

/** Serves one request. `id` is the request id, which logging carries as the call id (02 §8.2). */
export type RequestHandler = (method: string, params: unknown, id: number) => Promise<unknown>;
export type EventHandler = (event: string, payload: unknown) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
}

export class RpcEndpoint {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private requestHandler: RequestHandler | null = null;
  private readonly eventHandlers = new Set<EventHandler>();
  private readonly unlisten: () => void;
  private closed = false;

  constructor(private readonly transport: Transport) {
    this.unlisten = transport.listen((m) => {
      this.receive(m);
    });
  }

  /**
   * Calls a method on the other side. Rejects with an RpcError carrying the remote error code. A caller
   * that numbers its own calls passes `id`; it must never reuse one on this endpoint.
   */
  call(method: string, params: unknown, id = this.nextId++): Promise<unknown> {
    if (this.closed) return Promise.reject(new RpcError('internal', 'The connection is closed.'));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send({ id, method, params });
    });
  }

  /** Serves incoming requests. Thrown errors are sent back as `{ ok: false, error }`. */
  handle(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    if (!this.closed) this.transport.send({ event, payload });
  }

  /** Stops listening and rejects every pending call, with `reason` (an `internal` error for a message). */
  close(reason: string | RpcError = 'The connection closed.'): void {
    if (this.closed) return;
    this.closed = true;
    this.unlisten();
    const error = typeof reason === 'string' ? new RpcError('internal', reason) : reason;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private receive(m: unknown): void {
    if (isResponse(m)) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(RpcError.from(m.error));
    } else if (isRequest(m)) {
      void this.serve(m.id, m.method, m.params);
    } else if (isEvent(m)) {
      for (const h of this.eventHandlers) h(m.event, m.payload);
    }
  }

  private async serve(id: number, method: string, params: unknown): Promise<void> {
    let response: RpcResponse;
    if (!this.requestHandler) {
      response = {
        id,
        ok: false,
        error: { code: 'internal', message: `No handler for ${method}.` },
      };
    } else {
      try {
        const result = await this.requestHandler(method, params, id);
        response = { id, ok: true, result: result ?? null };
      } catch (e) {
        response = { id, ok: false, error: toErrorData(e) };
      }
    }
    if (!this.closed) this.transport.send(response);
  }
}
