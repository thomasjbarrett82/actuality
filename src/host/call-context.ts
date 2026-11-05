// The RPC request id of the renderer call a piece of host work belongs to (02 §8.2). The host keeps it in
// an AsyncLocalStorage for the length of the call, so queue jobs and HTTP requests carry it too.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<number>();

export function runWithCallId<T>(callId: number, fn: () => T): T {
  return storage.run(callId, fn);
}

export function currentCallId(): number | undefined {
  return storage.getStore();
}
