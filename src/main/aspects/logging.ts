// Main's logging aspects (02 §8.2), on main's sink. main/index.ts weaves them at the join points.
import { eventLogging, handlerLogging, stepLogging } from '@shared/aspects/logging';
import { write } from '../log';

/** `shell.*` IPC handlers: `shell.call` (debug), `shell.error`. */
export const shellAspect = handlerLogging(write, 'shell', 'channel');

/** Requests the host sends main over the control channel: `control.call` (debug), `control.error`. */
export const controlAspect = handlerLogging(write, 'control', 'method');

/** Lifecycle events (`app.start`, `host.start`, `host.status`, `app.quit`) and `log.level`. */
export const lifecycleAspect = eventLogging(write, 'info');

/** The host's stdout: the Actual API's own progress messages (`host.stdout`), debug only. */
export const chatterAspect = eventLogging(write, 'debug');

/** The host's stderr. */
export const warningAspect = eventLogging(write, 'warn');

/** The host exited unexpectedly (`host.exit`). */
export const failureAspect = eventLogging(write, 'error');

/** Fallible steps of the quit flow (`step.failed`). */
export const stepAspect = stepLogging(write);
