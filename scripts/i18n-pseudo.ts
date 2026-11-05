// Generates the en-XA pseudo-locale from en for development builds (20 §3.6). The output folder is
// git-ignored and excluded from release builds.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pseudoLocalize } from './i18n-check-lib';

const i18nDir = join(import.meta.dirname, '../src/shared/i18n');
const out = join(i18nDir, 'en-XA');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of readdirSync(join(i18nDir, 'en')).filter(
  (f) => f.endsWith('.json') && f !== 'meta.json',
)) {
  const messages = JSON.parse(readFileSync(join(i18nDir, 'en', file), 'utf8')) as Record<
    string,
    string
  >;
  const pseudo = Object.fromEntries(
    Object.entries(messages).map(([k, v]) => [k, pseudoLocalize(v)]),
  );
  writeFileSync(join(out, file), `${JSON.stringify(pseudo, null, 2)}\n`);
}
console.log('en-XA generated.');
