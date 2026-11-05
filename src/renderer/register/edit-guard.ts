// The open-edit rule (11 §1): leaving an edit by switching account or screen, searching or quitting runs the
// commit pipeline first when it has changes, and cancels it silently when it hasn't. The register that has
// an editor open registers its guard here; navigation and quit ask it.

/** Resolves true when it's fine to leave (nothing open, unchanged, or committed). */
type Guard = () => boolean | Promise<boolean>;

let guard: Guard | null = null;

/** Installs the open register's guard; the returned function removes it. */
export function setEditGuard(g: Guard): () => void {
  guard = g;
  return () => {
    if (guard === g) guard = null;
  };
}

/**
 * Asks the open editor whether the action may go ahead. Synchronous `true` when nothing has changed, so
 * callers can carry on at once; a promise when the commit pipeline has to run.
 */
export function leaveEdit(): boolean | Promise<boolean> {
  return guard ? guard() : true;
}
