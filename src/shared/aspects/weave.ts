// The weaving mechanism for cross-cutting concerns (02 §8.2, §8.5). `advise` wraps one function and
// `weave` every method of an object, so that aspects (logging) run around the call without the woven code
// knowing. Aspects see a description of the call, never its arguments or result: they get the shapes, and
// the facts the join point chooses to expose. An aspect that throws is ignored; the call's own error is
// rethrown unchanged.
import { shape, type Shape } from './shape';

export type ProcessName = 'main' | 'host' | 'renderer';

/** Primitive facts about a call, safe to log (ids, counts, durations, codes). */
export type Facts = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** What an aspect learns about a call. Shapes and facts are computed only when asked for. */
export interface JoinPoint {
  readonly name: string;
  readonly process: ProcessName;
  /** The RPC request id the call belongs to (02 §8.2), when known. */
  readonly callId: number | undefined;
  argShape(): Shape;
  facts(): Facts;
}

export interface Returned {
  /** Milliseconds since the call began. */
  readonly ms: number;
  resultShape(): Shape;
  resultFacts(): Facts;
}

export interface Threw {
  readonly ms: number;
  readonly error: unknown;
}

/** The rest of the advice for one call: after returning and after throwing. */
export interface Advice {
  returned?(info: Returned): void;
  threw?(info: Threw): void;
}

/**
 * An aspect: called before the call (its body is the before advice). It returns the after advice, or
 * nothing when it has nothing more to do, so an aspect that is switched off does no work at all.
 */
export type Aspect = (jp: JoinPoint) => Advice | undefined;

export interface JoinPointMeta<A extends unknown[] = unknown[], R = unknown> {
  name: string | ((args: A) => string);
  process: ProcessName;
  /** Read when an aspect asks: the id is often only known once the call has started. */
  callId?: (args: A) => number | undefined;
  /** The arguments to shape (default: all of them). */
  args?: (args: A) => unknown;
  facts?: (args: A) => Facts;
  resultFacts?: (result: Awaited<R>) => Facts;
}

const noFacts: Facts = Object.freeze({});

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // An aspect never affects the call (02 §8.2).
  }
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** Wraps `fn` so that `aspects` run around each call. Sync calls stay sync, async ones async. */
export function advise<A extends unknown[], R>(
  fn: (...args: A) => R,
  meta: JoinPointMeta<A, R>,
  aspects: readonly Aspect[],
): (...args: A) => R {
  if (aspects.length === 0) return fn;
  return function (this: unknown, ...args: A): R {
    const jp: JoinPoint = {
      get name() {
        return typeof meta.name === 'string' ? meta.name : meta.name(args);
      },
      process: meta.process,
      get callId() {
        return meta.callId?.(args);
      },
      argShape: () => shape(meta.args ? meta.args(args) : args),
      facts: () => meta.facts?.(args) ?? noFacts,
    };
    const advice: Advice[] = [];
    for (const aspect of aspects) {
      safely(() => {
        const a = aspect(jp);
        if (a) advice.push(a);
      });
    }
    if (advice.length === 0) return fn.apply(this, args);
    const started = Date.now();
    const returned = (value: unknown): void => {
      const info: Returned = {
        ms: Date.now() - started,
        resultShape: () => shape(value),
        resultFacts: () => meta.resultFacts?.(value as Awaited<R>) ?? noFacts,
      };
      for (const a of advice) safely(() => a.returned?.(info));
    };
    const threw = (error: unknown): void => {
      const info: Threw = { ms: Date.now() - started, error };
      for (const a of advice) safely(() => a.threw?.(info));
    };
    let result: R;
    try {
      result = fn.apply(this, args);
    } catch (e) {
      threw(e);
      throw e;
    }
    if (!isThenable(result)) {
      returned(result);
      return result;
    }
    return Promise.resolve(result).then(
      (value) => {
        returned(value);
        return value;
      },
      (e: unknown) => {
        threw(e);
        throw e;
      },
    ) as R;
  };
}

/**
 * Wraps every method of `target` with a Proxy (02 §8.5): `name` is `{prefix}{method}`. Properties that
 * aren't functions pass through; methods run with the target as `this`, so private fields keep working.
 */
export function weave<T extends object>(
  target: T,
  meta: Omit<JoinPointMeta, 'name'> & { prefix?: string },
  aspects: readonly Aspect[],
): T {
  if (aspects.length === 0) return target;
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(t, prop) {
      const value: unknown = Reflect.get(t, prop, t);
      if (typeof value !== 'function' || typeof prop === 'symbol') return value;
      let wrapped = cache.get(prop);
      if (!wrapped) {
        const method = value as (...args: unknown[]) => unknown;
        wrapped = advise(
          (...args: unknown[]) => method.apply(t, args),
          { ...meta, name: `${meta.prefix ?? ''}${prop}` },
          aspects,
        );
        cache.set(prop, wrapped);
      }
      return wrapped;
    },
  });
}

/**
 * A join point for an event that isn't a call (a state transition, a timed-out job settling): the woven
 * module exposes a hook, and the composition root connects it to aspects with this.
 */
export function announce(
  name: string,
  process: ProcessName,
  aspects: readonly Aspect[],
  callId?: () => number | undefined,
): (facts: Facts) => void {
  return (facts) => {
    advise(
      () => undefined,
      { name, process, facts: () => facts, ...(callId ? { callId } : {}) },
      aspects,
    )();
  };
}
