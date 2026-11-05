// Generates the English message files from the catalog in 20 §4, once; afterwards they're
// maintained by hand (20 §1). Locale-data bundles and omitted keys aren't ported. Existing keys are
// never overwritten. New keys are added to the pending list.
//   npm run i18n:catalog
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PENDING_KEYS_FILE } from './i18n-pending';

const root = join(import.meta.dirname, '..');
const catalogDoc = readFileSync(join(root, 'docs/app-spec/20-strings.md'), 'utf8');

/** Bundles that hold per-locale formatting data, not UI text (20 §4): date-fns and Intl do this now. */
const SKIPPED_BUNDLES = new Set(['SharedResources', 'culture', 'currency', 'datetime', 'printing']);

/** Escapes characters that are syntax in vue-i18n messages, keeping {placeholders}. */
export function escapeMessage(text: string): string {
  return text.replace(/[@$|]/g, (c) => `{'${c}'}`);
}

export function portText(text: string): string {
  return escapeMessage(text);
}

export function parseCatalog(doc: string): Map<string, Map<string, string>> {
  const start = doc.indexOf('## 4.');
  const section = doc.slice(start, doc.indexOf('### Omitted keys', start));
  const bundles = new Map<string, Map<string, string>>();
  let current: string | null = null;
  for (const line of section.split(/\r?\n/)) {
    const bundle = /^### Bundle `([^`]+)`/.exec(line);
    if (bundle?.[1]) {
      current = SKIPPED_BUNDLES.has(bundle[1]) ? null : bundle[1];
      if (current) bundles.set(current, new Map());
      continue;
    }
    if (!current) continue;
    const row = /^\| `([^`]+)` \| (.*) \|$/.exec(line);
    if (row?.[1] && row[2] !== undefined) {
      const raw = row[2].trim();
      const value =
        raw === '*(empty)*' ? '' : raw.replace(/^`` (.*) ``$/, '$1').replace(/^`(.*)`$/, '$1');
      bundles.get(current)?.set(row[1], portText(value));
    }
  }
  return bundles;
}

function main(): void {
  const dir = join(root, 'src/shared/i18n/en');
  const pending = new Set(JSON.parse(readFileSync(PENDING_KEYS_FILE, 'utf8')) as string[]);
  for (const [bundle, keys] of parseCatalog(catalogDoc)) {
    const file = join(dir, `${bundle}.json`);
    const existing = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>)
      : {};
    const merged: Record<string, string> = { ...existing };
    for (const [k, v] of keys) {
      if (!(k in merged)) {
        merged[k] = v;
        pending.add(`${bundle}.${k}`);
      }
    }
    const sorted = Object.fromEntries(
      Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  writeFileSync(PENDING_KEYS_FILE, `${JSON.stringify([...pending].sort(), null, 2)}\n`);
  console.log('Catalog written to src/shared/i18n/en.');
}

if (process.argv[1]?.endsWith('i18n-catalog.ts')) main();
