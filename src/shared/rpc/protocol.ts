// Wire protocol shared by renderer↔host (MessagePort) and main↔host (parentPort) (02 §4, §4.1).
// Everything on the wire is JSON-serializable.

export const RPC_ERROR_CODES = [
  'offline',
  'auth',
  'not-found',
  'validation',
  'conflict',
  'timeout',
  'actual',
  'internal',
] as const;

/** Error codes (03 §8). `actual` carries Actual's own `code`/`message` in `details`. */
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export interface RpcErrorData {
  code: RpcErrorCode;
  message: string;
  details?: unknown;
}

export interface RpcRequest {
  id: number;
  method: string;
  params: unknown;
}

export type RpcResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: RpcErrorData };

export interface RpcEvent {
  event: string;
  payload: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

export function isRequest(m: unknown): m is RpcRequest {
  return typeof m === 'object' && m !== null && 'method' in m && 'id' in m;
}

export function isResponse(m: unknown): m is RpcResponse {
  return typeof m === 'object' && m !== null && 'ok' in m && 'id' in m;
}

export function isEvent(m: unknown): m is RpcEvent {
  return typeof m === 'object' && m !== null && 'event' in m;
}

/** An error that crosses the RPC boundary with its code. */
export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly details: unknown;

  constructor(code: RpcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
  }

  toData(): RpcErrorData {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }

  static from(data: RpcErrorData): RpcError {
    return new RpcError(data.code, data.message, data.details);
  }
}

/** Converts anything thrown into wire error data. Unknown errors become `internal`. */
export function toErrorData(e: unknown): RpcErrorData {
  if (e instanceof RpcError) return e.toData();
  const message = e instanceof Error ? e.message : String(e);
  return { code: 'internal', message };
}
