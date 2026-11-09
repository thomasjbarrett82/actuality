// `npm run news:build` (02 §3.1): writes the news feed, website/static/news.json, from the blog posts in
// website/blog/ that opt in. `npm run news:check` (part of `check`) writes nothing and fails when the
// committed file differs from what the posts produce.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildFeed, NewsFeedError, renderFeed, type PostSource } from './news-feed-lib';

const website = join(import.meta.dirname, '..', 'website');
const blogDir = join(website, 'blog');
const feedPath = join(website, 'static', 'news.json');
const check = process.argv.includes('--check');

/** Post files, skipping what Docusaurus skips: names starting with `_`. */
function posts(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('_')) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return posts(full);
    return /\.mdx?$/.test(name) ? [full] : [];
  });
}

const sources: PostSource[] = (existsSync(blogDir) ? posts(blogDir) : []).sort().map((full) => ({
  path: relative(website, full).replaceAll('\\', '/'),
  text: readFileSync(full, 'utf8'),
}));

let text: string;
try {
  const { feed, warnings } = buildFeed(sources);
  for (const w of warnings) console.warn(`warning: ${w}`);
  text = renderFeed(feed);
} catch (e) {
  if (!(e instanceof NewsFeedError)) throw e;
  for (const p of e.problems) console.error(p);
  console.error(`The news feed can't be built: ${e.problems.length} problem(s).`);
  process.exit(1);
}

const committed = existsSync(feedPath)
  ? readFileSync(feedPath, 'utf8').replace(/\r\n/g, '\n')
  : null;
if (check) {
  if (committed !== text) {
    console.error(
      'website/static/news.json is out of date with website/blog/: run `npm run news:build`.',
    );
    process.exit(1);
  }
  console.log(`news:check: website/static/news.json is up to date (${sources.length} posts).`);
} else if (committed === text) {
  console.log('news:build: website/static/news.json is already up to date.');
} else {
  writeFileSync(feedPath, text);
  console.log('news:build: wrote website/static/news.json.');
}
