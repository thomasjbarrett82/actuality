import { setDebug } from '@shared/aspects/level';
import type { LogEntry } from '@shared/aspects/log-entry';
import { advise, weave } from '@shared/aspects/weave';
import { hostMethods, type HostMethod } from '@shared/rpc/host-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentCallId, runWithCallId } from '../call-context';
import { dispatch } from '../dispatch';
import { requestFacts } from '../fetch-timeout';
import { setLogSink } from '../log';
import { JobQueue } from '../queue';
import { httpAspect, queueAspect, rpcAspect } from './logging';

let entries: LogEntry[] = [];

beforeEach(() => {
  entries = [];
  setLogSink((e) => entries.push(e));
});

afterEach(() => {
  setDebug(false);
});

const methods = Object.keys(hostMethods) as HostMethod[];

/** Every RPC method, answering null, woven the way host/index.ts weaves the real handlers. */
function wovenHandlers(): Record<HostMethod, (p: unknown) => Promise<unknown>> {
  const handlers = Object.fromEntries(methods.map((m) => [m, () => Promise.resolve(null)]));
  return weave(
    handlers as unknown as Record<HostMethod, (p: unknown) => Promise<unknown>>,
    { process: 'host', callId: currentCallId, args: ([params]) => params },
    [rpcAspect],
  );
}

describe('the RPC dispatcher join point (02 §8.2, §8.6)', () => {
  it('logs rpc.call on entry and on exit exactly once per method, in debug', async () => {
    setDebug(true);
    const handlers = wovenHandlers();
    for (const m of methods) await handlers[m]({});
    for (const m of methods) {
      const calls = entries.filter(
        (e) => e.message === 'rpc.call' && (e.data as { method: string }).method === m,
      );
      expect(
        calls.map((c) => (c.data as { phase?: string }).phase ?? 'exit'),
        m,
      ).toEqual(['start', 'exit']);
    }
  });

  it('logs nothing for a successful call while debug logging is off', async () => {
    const handlers = wovenHandlers();
    for (const m of methods) await handlers[m]({});
    expect(entries).toEqual([]);
  });

  it('carries the request id through dispatch, the queue job and the HTTP request', async () => {
    setDebug(true);
    const queue = new JobQueue({}, [queueAspect], currentCallId);
    const fetch = advise(
      (...args: [string, RequestInit?]) =>
        Promise.resolve(new Response(null, { status: args.length > 0 ? 200 : 500 })),
      {
        name: 'http.request',
        process: 'host',
        callId: currentCallId,
        facts: ([input, init]) => requestFacts(input, init),
        resultFacts: (r) => ({ status: r.status }),
      },
      [httpAspect],
    );
    const handlers = weave(
      {
        'session.state': () =>
          queue.run('sync', () => fetch('https://srv/sync/sync?x=1', { method: 'POST' }), {
            kind: 'sync',
          }),
      },
      { process: 'host', callId: currentCallId },
      [rpcAspect],
    );
    await runWithCallId(42, () => dispatch(handlers as never, 'session.state', {}));
    const traced = entries.filter((e) => (e.data as { callId?: number }).callId === 42);
    expect(traced.map((e) => e.message)).toEqual([
      'rpc.call',
      'http.request',
      'queue.job',
      'rpc.call',
    ]);
    expect(traced.find((e) => e.message === 'http.request')?.data).toMatchObject({
      method: 'POST',
      path: '/sync/sync',
      status: 200,
    });
    expect(JSON.stringify(entries)).not.toContain('x=1');
  });
});
