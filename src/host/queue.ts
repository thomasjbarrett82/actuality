// Serial FIFO job queue (03 §3). The API keeps global state, so every API call runs inside a job and two
// jobs never overlap, not even after a timeout: an API call can't be cancelled, so the queue waits for a
// timed-out job's pending call to settle before it starts the next job. The caller gets `timeout` at once.
// Each job is a join point (02 §8.2): the aspects run around what its caller sees, from the job's start.
import { advise, type Aspect } from '@shared/aspects/weave';
import { RpcError } from '@shared/rpc/protocol';

export type JobKind = 'read' | 'write' | 'sync';

export const DEFAULT_JOB_TIMEOUT_MS = 60_000;
/** Opening a budget and a re-init retry (03 §3). */
export const OPEN_JOB_TIMEOUT_MS = 180_000;
/** Import (03 §3, 16 §1). */
export const IMPORT_JOB_TIMEOUT_MS = 600_000;
/** Wipe the Slate Clean: 10 min, plus the bulk allowance per transaction (03 §3, 18 §2). */
export const SLATE_WIPE_TIMEOUT_MS = 600_000;
/** Bulk jobs: + 100 ms per touched transaction (03 §3). */
export const PER_TRANSACTION_MS = 100;
/** A job still pending this long after its timeout means the host is stuck (03 §3). */
export const STUCK_AFTER_TIMEOUT_MS = 60_000;

export interface JobOptions {
  kind: JobKind;
  /** Base timeout. Default 60 s. */
  timeoutMs?: number;
  /** Transactions this job touches one by one through the settling wrappers (bulk jobs). */
  transactions?: number;
  /** Only the jobs that run init/downloadBudget: a timeout means the API state is unknown (03 §3). */
  fatalOnTimeout?: boolean;
}

export interface JobInfo {
  id: number;
  label: string;
  kind: JobKind;
}

export interface QueueHooks {
  /** A job timed out. `fatal` jobs move the connection to Error. */
  onTimeout?: (job: JobInfo, fatal: boolean) => void;
  /** A timed-out job's pending call finally settled. An abandoned write may still have succeeded. */
  onLateSettle?: (job: JobInfo, ok: boolean) => void;
  /** A timed-out job is still pending STUCK_AFTER_TIMEOUT_MS later: the host must exit (03 §3, §6.5). */
  onStuck?: (job: JobInfo) => void;
}

/** The effective timeout of a job. */
export function jobTimeout(opts: JobOptions): number {
  return (opts.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS) + (opts.transactions ?? 0) * PER_TRANSACTION_MS;
}

export class JobQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private current: JobInfo | null = null;
  private pending = 0;

  constructor(
    private readonly hooks: QueueHooks = {},
    private readonly aspects: readonly Aspect[] = [],
    /** The RPC call a job belongs to (02 §8.2). */
    private readonly callId: () => number | undefined = () => undefined,
  ) {}

  /** The job that is running now, if any. */
  get running(): JobInfo | null {
    return this.current;
  }

  /** Jobs queued or running. */
  get size(): number {
    return this.pending;
  }

  run<T>(label: string, fn: () => Promise<T>, opts: JobOptions): Promise<T> {
    const job: JobInfo = { id: this.nextId++, label, kind: opts.kind };
    this.pending++;
    const depth = this.pending;
    const queuedAt = Date.now();
    const callId = this.callId();
    return new Promise<T>((resolve, reject) => {
      this.tail = this.tail.then(async () => {
        let done: Promise<void> = Promise.resolve();
        const outcome = advise(
          () =>
            new Promise<T>((res, rej) => {
              done = this.execute(job, fn, opts, res, rej);
            }),
          {
            name: label,
            process: 'host',
            callId: () => callId,
            facts: () => ({ kind: opts.kind, depth, waitMs: Date.now() - queuedAt }),
          },
          this.aspects,
        )();
        outcome.then(resolve, reject);
        await done;
      });
    });
  }

  private async execute<T>(
    job: JobInfo,
    fn: () => Promise<T>,
    opts: JobOptions,
    resolve: (v: T) => void,
    reject: (e: unknown) => void,
  ): Promise<void> {
    this.current = job;
    const timeoutMs = jobTimeout(opts);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stuckTimer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => fn())();
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => {
        r('timeout');
      }, timeoutMs);
    });
    try {
      const first = await Promise.race([
        work.then(
          () => 'done' as const,
          () => 'done' as const,
        ),
        timeout,
      ]);
      if (first === 'timeout') {
        timedOut = true;
        this.hooks.onTimeout?.(job, opts.fatalOnTimeout === true);
        reject(
          new RpcError('timeout', `The operation "${job.label}" took too long.`, {
            label: job.label,
          }),
        );
        stuckTimer = setTimeout(() => this.hooks.onStuck?.(job), STUCK_AFTER_TIMEOUT_MS);
      }
      try {
        const value = await work;
        if (timedOut) this.hooks.onLateSettle?.(job, true);
        else resolve(value);
      } catch (e) {
        if (timedOut) this.hooks.onLateSettle?.(job, false);
        else reject(e);
      }
    } finally {
      clearTimeout(timer);
      clearTimeout(stuckTimer);
      this.current = null;
      this.pending--;
    }
  }
}
