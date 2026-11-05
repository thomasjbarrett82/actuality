// An Actual export zip's budget type, read before Import a budget file uploads it (03 §6.1, 07 §3.4), so a
// budget in Actual's Tracking mode is refused before it reaches the server. The type is the synced pref
// `budgetType` in the zip's `db.sqlite`. Exports from before Actual had a `preferences` table keep it in
// `metadata.json`, which Actual copies into the table when it loads them; its old name for Tracking was
// 'report'.
import { DatabaseSync } from 'node:sqlite';
import { readZipEntry } from './zip';

const TRACKING = new Set(['tracking', 'report']);

const isTracking = (value: unknown): boolean => typeof value === 'string' && TRACKING.has(value);

/** `budgetType` from `metadata.json`, or undefined. */
function metadataBudgetType(data: Uint8Array): unknown {
  const meta = readZipEntry(data, 'metadata.json');
  if (!meta) return undefined;
  try {
    return (JSON.parse(new TextDecoder().decode(meta)) as { budgetType?: unknown } | null)
      ?.budgetType;
  } catch {
    return undefined;
  }
}

/**
 * Whether the export is a tracking budget. A file this can't read counts as not tracking: Actual's
 * importer judges it, and the open after the import refuses a tracking budget all the same.
 */
export function isTrackingExport(data: Uint8Array): boolean {
  const sqlite = readZipEntry(data, 'db.sqlite');
  if (!sqlite) return false;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(':memory:');
    db.deserialize(sqlite);
  } catch {
    db?.close();
    return false;
  }
  try {
    const row = db.prepare("SELECT value FROM preferences WHERE id = 'budgetType'").get() as
      { value?: unknown } | undefined;
    return isTracking(row?.value);
  } catch {
    // No preferences table yet: the pref is still in metadata.json.
    return isTracking(metadataBudgetType(data));
  } finally {
    db.close();
  }
}
