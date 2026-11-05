import { RpcError } from '@shared/rpc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue, jobTimeout, STUCK_AFTER_TIMEOUT_MS, type JobInfo } from './queue';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('JobQueue (03 §3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes timeouts, with +100 ms per transaction for bulk jobs', () => {
    expect(jobTimeout({ kind: 'read' })).toBe(60_000);
    expect(jobTimeout({ kind: 'write', transactions: 2000 })).toBe(260_000);
    expect(jobTimeout({ kind: 'write', timeoutMs: 600_000, transactions: 10 })).toBe(601_000);
  });

  it('runs jobs one at a time, in order', async () => {
    const q = new JobQueue();
    const order: string[] = [];
    const a = deferred<undefined>();
    const p1 = q.run(
      'a',
      async () => {
        order.push('a start');
        await a.promise;
        order.push('a end');
        return 1;
      },
      { kind: 'read' },
    );
    const p2 = q.run(
      'b',
      () => {
        order.push('b');
        return Promise.resolve(2);
      },
      { kind: 'write' },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(q.running?.label).toBe('a');
    expect(q.size).toBe(2);
    a.resolve(undefined);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(order).toEqual(['a start', 'a end', 'b']);
    expect(q.running).toBeNull();
    expect(q.size).toBe(0);
  });

  it('passes errors to the caller and continues', async () => {
    const q = new JobQueue();
    const failed = q.run('bad', () => Promise.reject(new RpcError('validation', 'nope')), {
      kind: 'write',
    });
    const next = q.run('next', () => Promise.resolve('ok'), { kind: 'read' });
    await expect(failed).rejects.toMatchObject({ code: 'validation' });
    await expect(next).resolves.toBe('ok');
  });

  it('times out the caller at once, but waits for the call to settle before the next job', async () => {
    const timeouts: [JobInfo, boolean][] = [];
    const late: [JobInfo, boolean][] = [];
    const q = new JobQueue({
      onTimeout: (j, fatal) => timeouts.push([j, fatal]),
      onLateSettle: (j, ok) => late.push([j, ok]),
    });
    const slow = deferred<string>();
    const p1 = q.run('slow', () => slow.promise, { kind: 'write', timeoutMs: 1000 });
    let secondStarted = false;
    const p2 = q.run(
      'second',
      () => {
        secondStarted = true;
        return Promise.resolve('second');
      },
      { kind: 'read' },
    );
    const caught = p1.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toMatchObject({ code: 'timeout' });
    expect(timeouts.map(([j, f]) => [j.label, f])).toEqual([['slow', false]]);
    expect(secondStarted).toBe(false);
    slow.resolve('done');
    await expect(p2).resolves.toBe('second');
    expect(late.map(([j, ok]) => [j.label, ok])).toEqual([['slow', true]]);
  });

  it('reports a late failure and marks fatal timeouts', async () => {
    const late: boolean[] = [];
    const fatal: boolean[] = [];
    const q = new JobQueue({
      onTimeout: (_j, f) => fatal.push(f),
      onLateSettle: (_j, ok) => late.push(ok),
    });
    const slow = deferred<string>();
    const p = q
      .run('open', () => slow.promise, { kind: 'sync', timeoutMs: 10, fatalOnTimeout: true })
      .catch(() => 'x');
    await vi.advanceTimersByTimeAsync(10);
    await p;
    slow.reject(new Error('later'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fatal).toEqual([true]);
    expect(late).toEqual([false]);
  });

  it('declares the host stuck when a timed-out call never settles', async () => {
    const stuck: string[] = [];
    const q = new JobQueue({ onStuck: (j) => stuck.push(j.label) });
    const p = q
      .run('hung', () => new Promise<never>(() => undefined), { kind: 'read', timeoutMs: 10 })
      .catch(() => 'x');
    await vi.advanceTimersByTimeAsync(10);
    await p;
    await vi.advanceTimersByTimeAsync(STUCK_AFTER_TIMEOUT_MS - 1);
    expect(stuck).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stuck).toEqual(['hung']);
  });

  it('does not report stuck when the call settles in time', async () => {
    const stuck: string[] = [];
    const q = new JobQueue({ onStuck: (j) => stuck.push(j.label) });
    const slow = deferred<undefined>();
    const p = q.run('slow', () => slow.promise, { kind: 'read', timeoutMs: 10 }).catch(() => 'x');
    await vi.advanceTimersByTimeAsync(10);
    await p;
    slow.resolve(undefined);
    await vi.advanceTimersByTimeAsync(STUCK_AFTER_TIMEOUT_MS * 2);
    expect(stuck).toEqual([]);
  });
});
