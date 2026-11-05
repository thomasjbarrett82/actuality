// The logging aspects (02 §8.2), written once against a `Write` sink. Each process instantiates the ones it
// weaves in its `aspects/` folder, with its own sink. The debug advice checks the level flag first and
// returns before it builds anything (02 §8.3).
import { toErrorData } from '../rpc/protocol';
import { isDebug } from './level';
import { safeError, type LogLevel } from './log-entry';
import type { Advice, Aspect, JoinPoint, Returned, Threw } from './weave';

export type Write = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

/** Entries over this many milliseconds are slow (`queue.slow`, `http.slow`). */
export const SLOW_MS = 5_000;

const withId = (jp: JoinPoint, data: Record<string, unknown>): Record<string, unknown> =>
  jp.callId === undefined ? data : { ...data, callId: jp.callId };

function advice(returned?: (r: Returned) => void, threw?: (t: Threw) => void): Advice | undefined {
  if (!returned && !threw) return undefined;
  return { ...(returned ? { returned } : {}), ...(threw ? { threw } : {}) };
}

/** An event join point (`announce`): one entry at `level`, with the facts. */
export function eventLogging(write: Write, level: LogLevel): Aspect {
  return (jp) => {
    if (level === 'debug' && !isDebug()) return undefined;
    write(level, jp.name, withId(jp, { ...jp.facts() }));
    return undefined;
  };
}

/**
 * RPC calls, on both sides of the MessagePort. Debug: `rpc.call`, on entry (host only, `entry`) and on
 * exit. Always, `host` only: `rpc.error` for an error result (`error` for `internal`, else `warn`).
 */
export function rpcLogging(write: Write, opts: { host: boolean }): Aspect {
  return (jp) => {
    const debug = isDebug();
    const method = jp.name;
    if (debug && opts.host)
      write('debug', 'rpc.call', withId(jp, { method, phase: 'start', params: jp.argShape() }));
    return advice(
      debug
        ? (r) => {
            write(
              'debug',
              'rpc.call',
              withId(jp, { method, ok: true, ms: r.ms, result: r.resultShape() }),
            );
          }
        : undefined,
      (t) => {
        const { code } = toErrorData(t.error);
        if (debug)
          write(
            'debug',
            'rpc.call',
            withId(jp, { method, ok: false, code, ms: t.ms, ...safeError(t.error, true) }),
          );
        const errorData = safeError(t.error, debug);
        if (opts.host)
          write(
            code === 'internal' ? 'error' : 'warn',
            'rpc.error',
            withId(jp, { method, code, ...errorData }),
          );
      },
    );
  };
}

/**
 * Request handlers that aren't RPC methods: the control channel (`control.call`, `control.error`) and
 * main's `shell.*` IPC handlers (`shell.call`, `shell.error`). `nameKey` names the join point in `data`.
 */
export function handlerLogging(write: Write, event: string, nameKey: string): Aspect {
  return (jp) => {
    const debug = isDebug();
    const name = jp.name;
    return advice(
      debug
        ? (r) => {
            write('debug', `${event}.call`, { [nameKey]: name, ms: r.ms, outcome: 'ok' });
          }
        : undefined,
      (t) => {
        const { code } = toErrorData(t.error);
        if (debug) write('debug', `${event}.call`, { [nameKey]: name, ms: t.ms, outcome: code });
        write('warn', `${event}.error`, {
          [nameKey]: name,
          code,
          ...safeError(t.error, debug),
        });
      },
    );
  };
}

/**
 * Queue jobs (03 §3). The join point's facts carry `kind`, `depth` and `waitMs`. Always: `queue.slow` for a
 * job that waited or ran longer than 5 s, `queue.timeout` for a timeout. Debug: `queue.job`.
 */
export function queueLogging(write: Write): Aspect {
  return (jp) => {
    const debug = isDebug();
    const facts = jp.facts();
    const waitMs = typeof facts['waitMs'] === 'number' ? facts['waitMs'] : 0;
    const job = jp.name;
    const end = (ms: number, outcome: string): void => {
      if (outcome === 'timeout') write('warn', 'queue.timeout', withId(jp, { job, ms }));
      else if (waitMs > SLOW_MS || ms > SLOW_MS)
        write('warn', 'queue.slow', withId(jp, { job, waitMs, ms }));
      if (debug) write('debug', 'queue.job', withId(jp, { job, ...facts, ms, outcome }));
    };
    return {
      returned: (r) => {
        end(r.ms, 'ok');
      },
      threw: (t) => {
        end(t.ms, toErrorData(t.error).code);
      },
    };
  };
}

/** HTTP to the server, debug only: `http.request` with the facts (method, path, status) and duration. */
export function httpLogging(write: Write): Aspect {
  return (jp) => {
    if (!isDebug()) return undefined;
    return {
      returned: (r) => {
        write('debug', 'http.request', withId(jp, { ...jp.facts(), ...r.resultFacts(), ms: r.ms }));
      },
      threw: (t) => {
        const error = t.error instanceof Error ? t.error.name : 'error';
        write(
          'debug',
          'http.request',
          withId(jp, { ...jp.facts(), error, ...safeError(t.error, true), ms: t.ms }),
        );
      },
    };
  };
}

/**
 * Fallible steps (`step`): always `step.failed` (warn) with the error's code (02 §8.4). A step's caller
 * decides what a failure means, so this is the only record of one that is carried on from.
 */
export function stepLogging(write: Write): Aspect {
  return (jp) => ({
    threw: (t) => {
      write('warn', 'step.failed', withId(jp, { step: jp.name, ...safeError(t.error, isDebug()) }));
    },
  });
}

/** Failures that match `when`, as one `level` entry named `message`, with the join point's name. */
export function failureLogging(
  write: Write,
  message: string,
  when: (error: unknown) => boolean,
  level: LogLevel = 'warn',
): Aspect {
  return (jp) => ({
    threw: (t) => {
      if (when(t.error)) write(level, message, withId(jp, { call: jp.name }));
    },
  });
}
