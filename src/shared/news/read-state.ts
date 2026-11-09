// The news feed's read state (24 §4.4): one canonical timestamp per device, `lastSeenNewsAt`. Entries
// strictly after it are unseen. It is only ever copied from an entry's `date`, never from the clock, and it
// only moves forward. Canonical timestamps compare chronologically as plain strings (02 §3.1).
import type { NewsEntry } from './feed';
import { compareVersions } from './version';

/** The entries after `lastSeen`. On a first run (`null`) nothing is unseen. */
export function unseen(entries: readonly NewsEntry[], lastSeen: string | null): NewsEntry[] {
  if (lastSeen === null) return [];
  return entries.filter((e) => e.date > lastSeen);
}

/** The newest entry's timestamp: the feed is strictly newest first. Null for an empty feed. */
export function newestTimestamp(entries: readonly NewsEntry[]): string | null {
  return entries[0]?.date ?? null;
}

/** `lastSeen` moved forward to `to`, never back. */
export function advance(lastSeen: string | null, to: string | null): string | null {
  if (to === null) return lastSeen;
  return lastSeen === null || to > lastSeen ? to : lastSeen;
}

/** The read state once every entry has been seen. */
export function markAllSeen(entries: readonly NewsEntry[], lastSeen: string | null): string | null {
  return advance(lastSeen, newestTimestamp(entries));
}

export type ReleaseEntry = Extract<NewsEntry, { type: 'release' }>;

/**
 * The release the "what's new" toast announces (24 §4.7): the newest unseen release at or below the
 * running version. Newer releases belong to the update check; posts never get a toast.
 */
export function releaseToNotify(
  entries: readonly NewsEntry[],
  lastSeen: string | null,
  clientVersion: string,
): ReleaseEntry | null {
  for (const e of unseen(entries, lastSeen)) {
    if (e.type !== 'release') continue;
    const d = compareVersions(e.version, clientVersion);
    if (d !== null && d <= 0) return e;
  }
  return null;
}
