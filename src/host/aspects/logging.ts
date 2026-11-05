// The host's logging aspects (02 §8.2), on the host sink. host/index.ts weaves them at the join points.
import {
  eventLogging,
  failureLogging,
  handlerLogging,
  httpLogging,
  queueLogging,
  rpcLogging,
  stepLogging,
} from '@shared/aspects/logging';
import { RpcError } from '@shared/rpc/protocol';
import { UNAVAILABLE_HANDLER } from '../actual';
import { write } from '../log';

/** The RPC dispatcher: `rpc.call` on entry and exit (debug), `rpc.error`. */
export const rpcAspect = rpcLogging(write, { host: true });

/** The serial queue: `queue.job` (debug), `queue.slow`, `queue.timeout`. */
export const queueAspect = queueLogging(write);

/** A timed-out job's call that settled later (`queue.lateSettle`): an abandoned write may have landed. */
export const lateSettleAspect = eventLogging(write, 'info');

/** HTTP to the server: `http.request` (debug). */
export const httpAspect = httpLogging(write);

/** The fetch wrapper's slow requests, timeouts and resends (`http.slow`, `http.timeout`, `http.resend`). */
export const httpEventAspect = eventLogging(write, 'warn');

/** Connection transitions (`conn.state`). */
export const stateAspect = eventLogging(write, 'info');

/** Requests main sends the host over the control channel: `control.call` (debug), `control.error`. */
export const controlAspect = handlerLogging(write, 'control', 'method');

/** Fallible steps whose failure the caller carries on from (`step.failed`). */
export const stepAspect = stepLogging(write);

/** Data the app reads as empty or shows apart (`metadata.invalidNote`, `budget.otherAdjustments`). */
export const dataWarningAspect = eventLogging(write, 'warn');

/** The Actual API: a missing internal handler (`api.unavailable`, 03 §3). */
export const apiAspect = failureLogging(
  write,
  'api.unavailable',
  (e) =>
    e instanceof RpcError &&
    (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER,
);
