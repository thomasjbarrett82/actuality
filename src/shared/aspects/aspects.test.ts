import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcError } from '../rpc/protocol';
import { setDebug } from './level';
import { describeError } from './log-entry';
import {
  eventLogging,
  handlerLogging,
  queueLogging,
  rpcLogging,
  stepLogging,
  type Write,
} from './logging';
import { MAX_STRING, REDACTED, redact } from './redact';
import * as shapeModule from './shape';
import { step, weaveSteps } from './steps';
import { advise, announce, weave, type Aspect } from './weave';

vi.mock('./shape', { spy: true });

afterEach(() => {
  setDebug(false);
  weaveSteps('main', []);
  vi.clearAllMocks();
});

/** An aspect that records what it sees, in order. */
function recorder(log: string[], tag = 'a'): Aspect {
  return (jp) => {
    log.push(`${tag}:before:${jp.name}`);
    return {
      returned: (r) => log.push(`${tag}:returned:${JSON.stringify(r.resultShape())}`),
      threw: (t) => log.push(`${tag}:threw:${(t.error as Error).message}`),
    };
  };
}

const entries = (): {
  write: Write;
  lines: { level: string; message: string; data?: unknown }[];
} => {
  const lines: { level: string; message: string; data?: unknown }[] = [];
  return {
    lines,
    write: (level, message, data) => {
      lines.push(data === undefined ? { level, message } : { level, message, data });
    },
  };
};

describe('advise (02 §8.2)', () => {
  it('runs before, then the call, then after returning, for a sync call', () => {
    const log: string[] = [];
    const fn = advise(
      (a: number) => {
        log.push('call');
        return [a];
      },
      { name: 'f', process: 'main' },
      [recorder(log, 'a'), recorder(log, 'b')],
    );
    expect(fn(1)).toEqual([1]);
    expect(log).toEqual([
      'a:before:f',
      'b:before:f',
      'call',
      'a:returned:{"array":1}',
      'b:returned:{"array":1}',
    ]);
  });

  it('runs after returning once the promise resolves, for an async call', async () => {
    const log: string[] = [];
    let release!: (v: { x: number }) => void;
    const fn = advise(
      () =>
        new Promise<{ x: number }>((r) => {
          release = r;
        }),
      { name: 'g', process: 'host' },
      [recorder(log)],
    );
    const p = fn();
    await Promise.resolve();
    expect(log).toEqual(['a:before:g']);
    release({ x: 1 });
    await expect(p).resolves.toEqual({ x: 1 });
    expect(log).toEqual(['a:before:g', 'a:returned:{"fields":["x"]}']);
  });

  it('rethrows the error unchanged, sync and async', async () => {
    const log: string[] = [];
    const boom = new Error('boom');
    const sync = advise(
      () => {
        throw boom;
      },
      { name: 's', process: 'main' },
      [recorder(log)],
    );
    expect(() => sync()).toThrow(boom);
    const rejected = advise(() => Promise.reject(boom), { name: 'r', process: 'main' }, [
      recorder(log),
    ]);
    await expect(rejected()).rejects.toBe(boom);
    expect(log).toEqual(['a:before:s', 'a:threw:boom', 'a:before:r', 'a:threw:boom']);
  });

  it('an aspect that throws does not affect the call', async () => {
    const broken: Aspect = () => ({
      returned: () => {
        throw new Error('aspect');
      },
      threw: () => {
        throw new Error('aspect');
      },
    });
    const throwsBefore: Aspect = () => {
      throw new Error('aspect');
    };
    const fn = advise((n: number) => Promise.resolve(n * 2), { name: 'h', process: 'main' }, [
      throwsBefore,
      broken,
    ]);
    await expect(fn(2)).resolves.toBe(4);
    const failing = advise(() => Promise.reject(new Error('own')), { name: 'h', process: 'main' }, [
      broken,
    ]);
    await expect(failing()).rejects.toThrow('own');
  });

  it('gives the aspects the call id and facts, never the arguments', () => {
    const seen: unknown[] = [];
    const fn = advise(
      (...args: [number, string]) => `ok ${String(args.length)}`,
      {
        name: ([id]) => `call-${String(id)}`,
        process: 'renderer',
        callId: ([id]) => id,
        facts: () => ({ kind: 'read' }),
      },
      [
        (jp) => {
          seen.push(jp.name, jp.callId, jp.facts(), jp.argShape());
          return undefined;
        },
      ],
    );
    fn(7, 'hunter2');
    expect(seen).toEqual(['call-7', 7, { kind: 'read' }, { array: 2 }]);
    expect(JSON.stringify(seen)).not.toContain('hunter2');
  });
});

describe('weave', () => {
  it('wraps every method, keeps `this` and private fields, and passes other properties through', () => {
    class Service {
      #count = 0;
      readonly label = 'svc';
      bump(by: number): number {
        this.#count += by;
        return this.#count;
      }
    }
    const log: string[] = [];
    const woven = weave(new Service(), { process: 'host', prefix: 'svc.' }, [recorder(log)]);
    expect(woven.bump(2)).toBe(2);
    expect(woven.bump(3)).toBe(5);
    expect(woven.label).toBe('svc');
    expect(log.filter((l) => l.includes('before'))).toEqual([
      'a:before:svc.bump',
      'a:before:svc.bump',
    ]);
  });
});

describe('exception stacks in logs (02 §8.4)', () => {
  it('includes stack frames only with debug logging and excludes the exception message', async () => {
    const { write, lines } = entries();
    const error = Object.assign(new Error('Payee “Dr. Smith”'), { code: 'unexpected' });
    error.stack = 'Error: Payee “Dr. Smith”\n    at request (src/service.ts:12:3)';
    const fail = () =>
      advise(() => Promise.reject(error), { name: 'request', process: 'host' }, [
        rpcLogging(write, { host: true }),
        stepLogging(write),
      ])();

    await expect(fail()).rejects.toThrow();
    expect(JSON.stringify(lines)).not.toContain('stack');
    expect(JSON.stringify(lines)).not.toContain('Smith');

    setDebug(true);
    await expect(fail()).rejects.toThrow();
    const debugCall = lines.find(
      (entry) =>
        entry.level === 'debug' &&
        entry.message === 'rpc.call' &&
        (entry.data as Record<string, unknown> | undefined)?.['ok'] === false,
    );
    expect(debugCall?.data).toMatchObject({ stack: ['    at request (src/service.ts:12:3)'] });
    expect(JSON.stringify(lines)).not.toContain('Smith');
  });

  it('adds stack frames to error-boundary data only when debug logging is enabled', () => {
    const error = new Error('sensitive exception text');
    error.stack = 'Error: sensitive exception text\n    at startup (src/main.ts:5:1)';
    expect(describeError(error)).toEqual({ message: 'sensitive exception text' });
    expect(describeError(error, true)).toEqual({
      message: 'sensitive exception text',
      stack: ['    at startup (src/main.ts:5:1)'],
    });
  });
});

describe('steps and announce', () => {
  it('a step passes its result and error through and is woven once per process', async () => {
    const log: string[] = [];
    weaveSteps('host', [recorder(log)]);
    expect(step('one', () => 1)).toBe(1);
    await expect(step('two', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(log).toEqual(['a:before:one', 'a:returned:"number"', 'a:before:two', 'a:threw:no']);
  });

  it('announce runs the aspects with the facts', () => {
    const { write, lines } = entries();
    announce(
      'conn.state',
      'host',
      [eventLogging(write, 'info')],
      () => 3,
    )({
      from: 'Online',
      to: 'Syncing',
    });
    expect(lines).toEqual([
      { level: 'info', message: 'conn.state', data: { from: 'Online', to: 'Syncing', callId: 3 } },
    ]);
  });
});

describe('the logging aspects and the level (02 §8.3)', () => {
  it('with the level off, a debug aspect does no work', async () => {
    const { write, lines } = entries();
    const aspects = [
      rpcLogging(write, { host: true }),
      handlerLogging(write, 'shell', 'channel'),
      eventLogging(write, 'debug'),
    ];
    const fn = advise(
      (p: { a: number }) => Promise.resolve([p.a]),
      { name: 'm', process: 'host' },
      aspects,
    );
    await fn({ a: 1 });
    expect(lines).toEqual([]);
    expect(shapeModule.shape).not.toHaveBeenCalled();
  });

  it('with the level on, rpc.call is logged on entry and exit', async () => {
    setDebug(true);
    const { write, lines } = entries();
    const fn = advise(
      (p: { a: number }) => Promise.resolve([p.a]),
      { name: 'accounts.list', process: 'host', callId: () => 9, args: ([p]) => p },
      [rpcLogging(write, { host: true })],
    );
    await fn({ a: 1 });
    expect(lines).toEqual([
      {
        level: 'debug',
        message: 'rpc.call',
        data: { method: 'accounts.list', phase: 'start', params: { fields: ['a'] }, callId: 9 },
      },
      {
        level: 'debug',
        message: 'rpc.call',
        data: {
          method: 'accounts.list',
          ok: true,
          ms: expect.any(Number) as number,
          result: { array: 1 },
          callId: 9,
        },
      },
    ]);
  });

  it('logs an error result whatever the level: error for internal, warn otherwise', async () => {
    const { write, lines } = entries();
    const fail = (e: Error) =>
      advise(() => Promise.reject(e), { name: 'x', process: 'host' }, [
        rpcLogging(write, { host: true }),
      ])();
    await expect(fail(new Error('kaput'))).rejects.toThrow();
    await expect(fail(new RpcError('offline', 'nope'))).rejects.toThrow();
    expect(lines.map((l) => [l.level, l.message])).toEqual([
      ['error', 'rpc.error'],
      ['warn', 'rpc.error'],
    ]);
  });

  it('logs the message only when it is our own RpcError’s, never an Actual error’s (02 §8.4)', async () => {
    const { write, lines } = entries();
    const fail = (e: unknown) =>
      advise(() => Promise.reject(e as Error), { name: 'x', process: 'host' }, [
        rpcLogging(write, { host: true }),
        stepLogging(write),
      ])();
    await expect(
      fail(Object.assign(new Error('Payee “Dr. Smith”'), { code: 'oops' })),
    ).rejects.toThrow();
    await expect(fail(new RpcError('offline', "Couldn't reach the server."))).rejects.toThrow();
    const text = JSON.stringify(lines);
    expect(text).not.toContain('Smith');
    expect(text).toContain("Couldn't reach the server.");
    expect(lines.find((l) => l.message === 'step.failed')?.data).toMatchObject({ code: 'oops' });
  });

  it('the client side logs no rpc.error, only the debug rpc.call', async () => {
    const { write, lines } = entries();
    const fn = advise(
      () => Promise.reject(new RpcError('offline', 'nope')),
      { name: 'x', process: 'renderer' },
      [rpcLogging(write, { host: false })],
    );
    await expect(fn()).rejects.toThrow();
    expect(lines).toEqual([]);
    setDebug(true);
    await expect(fn()).rejects.toThrow();
    expect(lines.map((l) => [l.level, l.message])).toEqual([['debug', 'rpc.call']]);
  });

  it('queue jobs: slow and timed-out jobs always, queue.job in debug', () => {
    const { write, lines } = entries();
    const aspect = queueLogging(write);
    const jp = (waitMs: number) => ({
      name: 'job',
      process: 'host' as const,
      callId: undefined,
      argShape: () => 'undefined' as const,
      facts: () => ({ kind: 'read', depth: 2, waitMs }),
    });
    aspect(jp(6_000))?.returned?.({ ms: 10, resultShape: () => 'null', resultFacts: () => ({}) });
    aspect(jp(0))?.threw?.({ ms: 60_000, error: new RpcError('timeout', 'slow') });
    expect(lines.map((l) => l.message)).toEqual(['queue.slow', 'queue.timeout']);
    setDebug(true);
    aspect(jp(0))?.returned?.({ ms: 1, resultShape: () => 'null', resultFacts: () => ({}) });
    expect(lines.at(-1)).toEqual({
      level: 'debug',
      message: 'queue.job',
      data: { job: 'job', kind: 'read', depth: 2, waitMs: 0, ms: 1, outcome: 'ok' },
    });
  });
});

describe('redact (02 §8.4)', () => {
  it('replaces secret-looking keys at any depth, down to 6 levels', () => {
    const out = redact({
      password: 'p',
      nested: { token: 't', list: [{ Authorization: 'a', cookie: 'c', ok: 1 }] },
      e2eKey: 'k',
      name: 'n',
    });
    expect(out).toEqual({
      password: REDACTED,
      nested: { token: REDACTED, list: [{ Authorization: REDACTED, cookie: REDACTED, ok: 1 }] },
      e2eKey: REDACTED,
      name: 'n',
    });
    expect(redact({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toEqual({
      a: { b: { c: { d: { e: { f: REDACTED } } } } },
    });
  });

  it('cuts long strings and shows the home folder as ~', () => {
    const long = redact({ s: 'x'.repeat(2_000) }) as { s: string };
    expect(long.s.length).toBe(MAX_STRING + 1);
    expect(redact('C:\\Users\\me\\AppData\\x', { home: 'C:\\Users\\me' })).toBe('~\\AppData\\x');
    // As the Actual API prints a path on stdout, and with forward slashes.
    expect(redact("'C:\\\\Users\\\\me\\\\cache'", { home: 'C:\\Users\\me' })).toBe("'~\\\\cache'");
    expect(redact('C:/Users/me/cache', { home: 'C:\\Users\\me' })).toBe('~/cache');
  });
});
