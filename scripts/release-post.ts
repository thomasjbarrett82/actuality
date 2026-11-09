// `tsx scripts/release-post.ts <x.y.z>` (02 §3.1, §5.1): writes the release's blog post into website/blog/
// from its CHANGELOG.md section. release.yml runs it in the release pull request, then regenerates the news
// feed. Exits 1 when CHANGELOG.md has no such section, or the release already has a post.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection } from './changelog-lib';
import { releasePost } from './release-post-lib';

const root = join(import.meta.dirname, '..');
const blogDir = join(root, 'website', 'blog');
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: tsx scripts/release-post.ts <major.minor.patch>');
  process.exit(2);
}

const changelog = join(root, 'CHANGELOG.md');
const section = existsSync(changelog)
  ? changelogSection(readFileSync(changelog, 'utf8'), version)
  : null;
if (section === null) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const existing = readdirSync(blogDir).find((name) =>
  new RegExp(`(^|-)release-${version.replaceAll('.', '\\.')}\\.mdx?$`).test(name),
);
if (existing) {
  console.error(`website/blog/${existing} already announces ${version}`);
  process.exit(1);
}

const post = releasePost(version, section, new Date());
writeFileSync(join(blogDir, post.fileName), post.text);
console.log(`release-post: wrote website/blog/${post.fileName}`);
