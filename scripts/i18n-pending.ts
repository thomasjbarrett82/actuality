import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Message keys that no feature uses yet. `npm run i18n:check` allows exactly these to be unused, and fails
 * once a listed key is used in src/, so the list only shrinks.
 */
const PENDING_KEYS_FILE = join(import.meta.dirname, 'i18n-pending.json');

export const pendingKeys: readonly string[] = JSON.parse(
  readFileSync(PENDING_KEYS_FILE, 'utf8'),
) as string[];
