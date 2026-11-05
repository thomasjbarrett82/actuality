// `npm run docs:sync [base] [head]` (21 §4.5): checks that the changes from base to head keep the spec,
// the user guide and the UI strings in step. Defaults: origin/main and HEAD. The pre-push hook runs it with
// the defaults; CI runs it on pull requests.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { DocFile } from './docs-check-lib';
import { checkSync, messageValues } from './docs-sync-lib';

const root = join(import.meta.dirname, '..');
const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
const STRINGS = 'src/shared/i18n/en/';

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = (s: string): string[] => s.split('\n').filter(Boolean);

/** Markdown files under a folder at a commit. */
function docsAt(ref: string, dir: string): DocFile[] {
  return lines(git('ls-tree', '-r', '--name-only', ref, '--', dir))
    .filter((p) => p.endsWith('.md'))
    .map((path) => ({ path, text: git('show', `${ref}:${path}`) }));
}

/** Every English UI string at a commit. */
function stringsAt(ref: string): string[] {
  return lines(git('ls-tree', '-r', '--name-only', ref, '--', STRINGS))
    .filter((p) => p.endsWith('.json'))
    .flatMap((p) => messageValues(JSON.parse(git('show', `${ref}:${p}`)) as unknown));
}

/** True when origin answers and has no main: the repo's first push, so there's no base to compare with. */
function originHasNoMain(): boolean {
  try {
    return git('ls-remote', 'origin', 'refs/heads/main') === '';
  } catch {
    return false;
  }
}

for (const ref of [base, head]) {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    if (ref === 'origin/main' && originHasNoMain()) {
      console.log('docs:sync: origin has no main yet, nothing to compare.');
      process.exit(0);
    }
    console.error(
      `docs:sync: can't find ${ref}. Run \`git fetch\`, or pass the base: npm run docs:sync -- <base>.`,
    );
    process.exit(1);
  }
}

const range = `${base}...${head}`;
const guides = docsAt(head, 'website/docs');
const problems = checkSync({
  changed: lines(git('diff', '--name-only', range)),
  messages: git('log', '--format=%B%x00', `${base}..${head}`).split('\0'),
  guides,
  docs: [...docsAt(head, 'docs/app-spec'), ...guides],
  stringsBefore: stringsAt(git('merge-base', base, head).trim()),
  stringsAfter: stringsAt(head),
});
for (const p of problems) console.error(`${p.path}:${p.line}: ${p.message}`);
if (problems.length > 0) {
  console.error(`docs:sync found ${problems.length} problem(s) in ${range}.`);
  process.exit(1);
}
console.log(`docs:sync: ${range} OK.`);
