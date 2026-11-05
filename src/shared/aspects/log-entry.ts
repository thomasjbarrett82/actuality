// A log entry, as the three processes send it to main, the only writer (02 §8.1).
import { RpcError } from '../rpc/protocol';
import type { ProcessName } from './weave';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LogEntry {
  at: number;
  level: LogLevel;
  source: ProcessName;
  /** A stable event name in dotted lowercase (`rpc.call`); everything variable goes in `data`. */
  message: string;
  data?: unknown;
}

/** A loggable description of anything thrown: its message, and Actual's or the RPC error code. */
export function describeError(
  e: unknown,
  includeStack = false,
): { message: string; code?: string; stack?: string[] } {
  const code = errorCode(e);
  const message =
    e instanceof Error ? e.message : typeof e === 'string' ? e : (safeJson(e) ?? String(e));
  const stack = includeStack ? errorStack(e) : undefined;
  return {
    message,
    ...(code ? { code } : {}),
    ...(stack ? { stack } : {}),
  };
}

/**
 * What may be logged about a failure of a call or step (02 §8.4): the code, the error's class name, and
 * the message only when it is our own `RpcError`'s. Other messages (Actual's, the server's) can carry
 * budget content such as payee or category names.
 */
export function safeError(
  e: unknown,
  includeStack = false,
): { code?: string; name?: string; message?: string; stack?: string[] } {
  const code = errorCode(e);
  const out: { code?: string; name?: string; message?: string; stack?: string[] } = {};
  if (code) out.code = code;
  if (e instanceof RpcError) out.message = e.message;
  else if (e instanceof Error && e.name !== 'Error') out.name = e.name;
  const stack = includeStack ? errorStack(e) : undefined;
  if (stack) out.stack = stack;
  return out;
}

/** Stack frames only: the first line contains the exception message and can include budget content. */
function errorStack(e: unknown): string[] | undefined {
  if (!(e instanceof Error) || typeof e.stack !== 'string') return undefined;
  const lines = e.stack.split(/\r?\n/);
  const frames = /^\s*at\s/.test(lines[0] ?? '') ? lines : lines.slice(1);
  const nonEmptyFrames = frames.map((line) => line.trimEnd()).filter(Boolean);
  return nonEmptyFrames.length ? nonEmptyFrames : undefined;
}

/** The error's code: `code` on API and RPC errors, `reason` on some server responses (03 §1). */
export function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const { code, reason } = e as { code?: unknown; reason?: unknown };
  if (typeof code === 'string') return code;
  if (typeof reason === 'string') return reason;
  return undefined;
}

function safeJson(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}
