// `npm run docs:check` second step (after markdownlint-cli2): cross-references, CSS tokens, links, and the
// user guide's map to the spec (21 §4.5).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkDocs, checkGuide, type DocFile } from './docs-check-lib';

const root = join(import.meta.dirname, '..');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith('.md') ? [full] : [];
  });
}

const read = (full: string): DocFile => ({
  path: relative(root, full).replaceAll('\\', '/'),
  text: readFileSync(full, 'utf8'),
});
const files = markdownFiles(join(root, 'docs')).map(read);
const guideDir = join(root, 'website/docs');
const guides = existsSync(guideDir) ? markdownFiles(guideDir).map(read) : [];
const tokensPath = join(root, 'src/renderer/styles/tokens.css');
const tokensCss = existsSync(tokensPath) ? readFileSync(tokensPath, 'utf8') : null;

const problems = [
  ...checkDocs(files, tokensCss, (p) => existsSync(join(root, p))),
  ...checkGuide(guides, files),
];
for (const p of problems) console.error(`${p.path}:${p.line}: ${p.message}`);
if (problems.length > 0) {
  console.error(`docs:check found ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`docs:check: ${files.length} spec files and ${guides.length} guide pages OK.`);
