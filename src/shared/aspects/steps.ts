// Fallible steps (02 §8.2): a named piece of work whose failure the caller handles itself (it carries on,
// falls back, or rethrows). The step is a join point: the composition root weaves the failure logging here
// once, with `weaveSteps`, so the code that runs steps never logs. Each process has its own copy.
import { advise, type Aspect, type ProcessName } from './weave';

let woven: { process: ProcessName; aspects: readonly Aspect[]; callId?: () => number | undefined } =
  { process: 'main', aspects: [] };

export function weaveSteps(
  process: ProcessName,
  aspects: readonly Aspect[],
  callId?: () => number | undefined,
): void {
  woven = { process, aspects, ...(callId ? { callId } : {}) };
}

/** Runs `fn` as the step `name`. Its result and error pass through unchanged. */
export function step<T>(name: string, fn: () => T): T {
  const { process, aspects, callId } = woven;
  return advise(fn, { name, process, ...(callId ? { callId: () => callId() } : {}) }, aspects)();
}
