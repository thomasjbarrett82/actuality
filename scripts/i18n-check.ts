// `npm run i18n:check` (20 §3.7): every locale against en, meta.json files, and the pending-key list.
import * as dateFnsLocales from 'date-fns/locale';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkLocale,
  checkSource,
  keyUsage,
  metaProblems,
  type LocaleMetaInput,
  type Messages,
} from './i18n-check-lib';
import { pendingKeys } from './i18n-pending';

const root = join(import.meta.dirname, '..');
const i18nDir = join(root, 'src/shared/i18n');
const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

function loadLocale(locale: string): Messages {
  const dir = join(i18nDir, locale);
  const out: Messages = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'meta.json')) {
    out[file.slice(0, -5)] = (readJson(join(dir, file)) ?? {}) as Record<string, string>;
  }
  return out;
}

const locales = readdirSync(i18nDir).filter(
  (d) => statSync(join(i18nDir, d)).isDirectory() && d !== 'en-XA',
);
const source = loadLocale('en');
const errors: string[] = [];
const warnings: string[] = [];
const fnsLocales = new Set(Object.keys(dateFnsLocales));

errors.push(...checkSource(source));
for (const locale of locales) {
  const metaPath = join(i18nDir, locale, 'meta.json');
  const meta = existsSync(metaPath)
    ? (readJson(metaPath) as LocaleMetaInput | undefined)
    : undefined;
  errors.push(...metaProblems(meta, fnsLocales).map((p) => `${locale}: ${p}`));
  if (locale === 'en') continue;
  const result = checkLocale(locale, loadLocale(locale), source);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

// Pending keys (scripts/i18n-pending.json): each must exist, and must not be used yet.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'i18n' ? [] : sourceFiles(p);
    return /\.(ts|vue)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}
const code = sourceFiles(join(root, 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
for (const key of pendingKeys) {
  const [bundle = '', name = ''] = key.split(/\.(.*)/s);
  if (source[bundle]?.[name] === undefined) errors.push(`pending key ${key} is not in en`);
  if (code.includes(`'${key}'`) || code.includes(`"${key}"`)) {
    errors.push(`pending key ${key} is used now: remove it from scripts/i18n-pending.json`);
  }
}

// Keys used in code must exist; keys in en must be used or pending (20 §3.7).
const usage = keyUsage(source, code, pendingKeys);
for (const key of usage.missing) errors.push(`${key} is used in src/ but is not in en`);
for (const key of usage.unused)
  errors.push(
    `en/${key} is not used in src/: use it, delete it or add it to scripts/i18n-pending.json`,
  );

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
if (errors.length > 0) {
  console.error(`i18n:check found ${String(errors.length)} error(s).`);
  process.exit(1);
}
console.log(
  `i18n:check: ${String(locales.length)} locale(s) OK${warnings.length ? `, ${String(warnings.length)} warning(s)` : ''}.`,
);
