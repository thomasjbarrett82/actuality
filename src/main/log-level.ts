// Applies the debug logging preference (02 §8.3): main's own flag at once, then the host's over the control
// channel. The supervisor sends the level again after every host start.
import { isDebug, setDebug } from '@shared/aspects/level';

export interface LogLevelTargets {
  /** Sends `log:level` to the host. */
  sendToHost: (level: { debug: boolean }) => void;
  /** The `log.level` join point: one entry each time it is switched (02 §8.3 step 5). */
  onSwitch?: (level: { debug: boolean }) => void;
}

/** Applies `debug` if it changed. */
export function applyDebugLogging(debug: boolean, targets: LogLevelTargets): void {
  if (debug === isDebug()) return;
  setDebug(debug);
  targets.sendToHost({ debug });
  targets.onSwitch?.({ debug });
}
