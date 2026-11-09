// `tsx scripts/release-notes.ts <x.y.z>` (02 §5.1): prints that version's CHANGELOG.md section, the body of
// the release pull request and of the GitHub release. Exits 1 when CHANGELOG.md has no such section.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection } from './changelog-lib';

const changelog = join(import.meta.dirname, '..', 'CHANGELOG.md');
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: tsx scripts/release-notes.ts <major.minor.patch>');
  process.exit(2);
}
if (!existsSync(changelog)) {
  console.error('There is no CHANGELOG.md yet: the first release creates it.');
  process.exit(1);
}

const body = changelogSection(readFileSync(changelog, 'utf8'), version);
if (body === null) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
process.stdout.write(`${body || 'No user-visible changes.'}\n`);
