// A small Actual export zip for host tests (03 §6.1, 07 §3.4): `db.sqlite` with a `preferences` table (or
// none, like exports from before Actual had one) and `metadata.json`.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zip } from '../zip';

export function exportZip(options: {
  /** The `preferences` table's rows, or null for no table. */
  prefs: Record<string, string> | null;
  metadata?: Record<string, unknown>;
}): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'export-zip-'));
  try {
    const path = join(dir, 'db.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
    if (options.prefs) {
      db.exec('CREATE TABLE preferences (id TEXT PRIMARY KEY, value TEXT)');
      const insert = db.prepare('INSERT INTO preferences (id, value) VALUES (?, ?)');
      for (const [id, value] of Object.entries(options.prefs)) insert.run(id, value);
    }
    db.close();
    return zip([
      { name: 'db.sqlite', data: new Uint8Array(readFileSync(path)) },
      {
        name: 'metadata.json',
        data: new TextEncoder().encode(JSON.stringify(options.metadata ?? { id: 'local-x' })),
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
