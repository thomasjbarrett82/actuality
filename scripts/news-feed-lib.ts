// Pure functions behind `npm run news:build` and `news:check` (02 §3.1): blog posts that opt in become the
// entries of the news feed. The CLI in news-feed.ts reads the posts and writes the file.
import { parse as parseYaml } from 'yaml';
import {
  BLOG_ROUTE,
  NEWS_FEED_SCHEMA_VERSION,
  RELEASE_VERSION,
  SITE_URL,
  newsFeedSchema,
  type NewsEntry,
  type NewsFeed,
} from '../src/shared/news/feed';

/** Each type is capped on its own, so a run of posts can't push the releases out, or the reverse. */
export const MAX_ENTRIES_PER_TYPE = 10;

/**
 * Marks the end of a release post's highlights: the rest is the full list of changes (`details`).
 * scripts/release-post.ts writes it.
 */
export const DETAILS_MARKER = '<!-- release-details -->';

export interface PostSource {
  /** Path relative to website/, with forward slashes: `blog/2026-11-08-release-0.2.1.md`. */
  path: string;
  text: string;
}

export class NewsFeedError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

export interface BuiltFeed {
  feed: NewsFeed;
  warnings: string[];
}

interface FrontMatter {
  data: Record<string, unknown>;
  content: string;
}

/** Splits a post into its YAML front matter and its Markdown content. */
export function splitFrontMatter(text: string): FrontMatter {
  const normalized = text.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!m) return { data: {}, content: normalized };
  const parsed: unknown = parseYaml(m[1] ?? '');
  const data =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, content: normalized.slice(m[0].length) };
}

/**
 * A front matter `date` in canonical UTC form, or null when it has no time or no zone. The `yaml` package's
 * default schema keeps timestamps as strings, so the value arrives exactly as written.
 */
export function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const ms = Date.parse(m[0]);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The file name without its folder. A folder post (`2026-11-08-foo/index.md`) is named by its folder. */
function postName(path: string): string {
  const parts = path.split('/');
  const file = parts.at(-1) ?? '';
  return /^index\.mdx?$/.test(file) ? (parts.at(-2) ?? file) : file;
}

/** The slug Docusaurus gives a post: front matter `slug`, else the file name minus its date and extension. */
export function slugOf(path: string, data: Record<string, unknown>): string {
  const slug = data['slug'];
  if (typeof slug === 'string' && slug.trim()) return slug.trim().replace(/^\/+|\/+$/g, '');
  return postName(path)
    .replace(/\.mdx?$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

const postUrl = (slug: string): string => `${SITE_URL}/${BLOG_ROUTE}/${slug}`;

/** Where an HTML comment still open at the end of `line` would leave the scan: `inComment` going in. */
function endsInComment(line: string, inComment: boolean): boolean {
  let open = inComment;
  let at = 0;
  for (;;) {
    if (open) {
      const close = line.indexOf('-->', at);
      if (close === -1) return true;
      open = false;
      at = close + 3;
    } else {
      const start = line.indexOf('<!--', at);
      if (start === -1) return false;
      open = true;
      at = start + 4;
    }
  }
}

/**
 * The Markdown cut into prose and fenced code blocks, in order. A fence opens with three or more backticks or
 * tildes, indented up to three spaces, and closes with at least as many of the same character (or at the end).
 * Inside an HTML comment there are no fences, so a comment never spans two prose parts, and an unterminated
 * one runs to the end in a single prose part.
 */
export function splitFences(markdown: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = [];
  let current: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let inComment = false;
  const flush = (code: boolean) => {
    if (current.length > 0) parts.push({ text: current.join('\n'), code });
    current = [];
  };
  for (const line of markdown.split('\n')) {
    if (fence) {
      current.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close?.startsWith(fence.char) && close.length >= fence.length) {
        flush(true);
        fence = null;
      }
      continue;
    }
    const open = inComment ? undefined : /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (
      open &&
      !(open.startsWith('`') && line.slice(line.indexOf(open) + open.length).includes('`'))
    ) {
      flush(false);
      fence = { char: open.charAt(0), length: open.length };
      current.push(line);
      continue;
    }
    current.push(line);
    inComment = endsInComment(line, inComment);
  }
  flush(fence !== null);
  // Each part ended at a line break that the join dropped: put it back on all but the last part.
  return parts.map((p, i) => (i < parts.length - 1 ? { ...p, text: `${p.text}\n` } : p));
}

/** Text outside fenced code blocks goes through `fn`; fenced blocks are left as they are. */
function outsideFences(markdown: string, fn: (prose: string) => string): string {
  return splitFences(markdown)
    .map((part) => (part.code ? part.text : fn(part.text)))
    .join('');
}

/**
 * Removes HTML comments, repeating until nothing changes, so overlapping markers such as `<!-<!---->-` can't
 * reassemble into a new comment opener. An unterminated `<!--` and everything after it are dropped.
 */
export function stripComments(markdown: string): string {
  let text = markdown;
  for (let next = ''; next !== text;) {
    next = text;
    text = text.replace(/<!--[\s\S]*?-->/g, '');
  }
  // Every opener left has no `-->` after it.
  const open = text.indexOf('<!--');
  return open === -1 ? text : text.slice(0, open);
}

/** Removes MDX: `import` lines, `{/* comments *\/}` and capitalized component tags. Lowercase HTML stays. */
function stripMdx(prose: string): string {
  return prose
    .replace(/^import\s.+$\n?/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<\/?[A-Z][\w.]*(?:\s[^<>]*)?\/?>/g, '');
}

interface LinkContext {
  /** The post's path relative to website/. */
  path: string;
  /** Post file names (and folder names, for folder posts) → slugs, for links between posts. */
  slugs: ReadonlyMap<string, string>;
  warnings: string[];
}

/** An absolute URL for one link or image target, or the target unchanged. */
function absolutize(target: string, image: boolean, ctx: LinkContext): string {
  if (!target || target.startsWith('#') || target.startsWith('//')) return target;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return target;

  // A link to another post by its source file: its public URL.
  const [file = '', hash = ''] = target.split(/(?=#)/);
  const linked = ctx.slugs.get(postName(file.replace(/^\.\//, '')));
  if (!image && linked && /^(?:\.\/)?[^/]+\.mdx?$/.test(file)) return postUrl(linked) + hash;

  if (image && !target.startsWith('/')) {
    ctx.warnings.push(
      `${ctx.path}: image ${target} is bundled by Docusaurus at a path the feed can't know; put it in website/static/img/blog/ and link it as /img/blog/…`,
    );
  }
  const dir = ctx.path.slice(0, ctx.path.lastIndexOf('/') + 1);
  try {
    const url = new URL(target, `${SITE_URL}/${dir}`);
    url.pathname = url.pathname.replace(/\.mdx?$/, '');
    return url.href;
  } catch {
    ctx.warnings.push(`${ctx.path}: left the link ${target} as it is, because it can't be parsed`);
    return target;
  }
}

/**
 * Rewrites relative and root-relative Markdown links, images and link reference definitions to absolute
 * URLs on the website, without `.md`/`.mdx`. Scheme, protocol-relative and `#anchor` links stay as they are.
 */
export function absolutizeLinks(prose: string, ctx: LinkContext): string {
  return prose
    .replace(
      /(!?)\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/g,
      (_m, bang: string, text: string, rawTarget: string, title: string) => {
        const wrapped = rawTarget.startsWith('<');
        const target = wrapped ? rawTarget.slice(1, -1) : rawTarget;
        const out = absolutize(target, bang === '!', ctx);
        // A link around an image: the image inside has a target too.
        return `${bang}[${absolutizeLinks(text, ctx)}](${wrapped ? `<${out}>` : out}${title})`;
      },
    )
    .replace(
      // Link reference definitions; `[^1]:` footnotes aren't links.
      /^( {0,3}\[(?!\^)[^\]]+\]:[ \t]*)(\S+)/gm,
      (_m, head: string, target: string) => head + absolutize(target, false, ctx),
    );
}

/**
 * The cleaned Markdown the feed carries: no leading H1 (the title is shown separately), no HTML comments or
 * MDX, absolute links, and no runs of blank lines. Fenced code blocks are carried exactly as written.
 */
export function cleanBody(markdown: string, ctx: LinkContext): string {
  const text = outsideFences(markdown.replace(/\r\n?/g, '\n'), (prose) =>
    absolutizeLinks(stripMdx(stripComments(prose)), ctx).replace(/\n{3,}/g, '\n\n'),
  );
  return text.replace(/^\s*# [^\n]*\n?/, '').trim();
}

/** A release post's highlights and, after {@link DETAILS_MARKER}, its full list of changes. */
export function splitRelease(content: string): { body: string; details: string | null } {
  const at = content.indexOf(DETAILS_MARKER);
  if (at === -1) return { body: content, details: null };
  return { body: content.slice(0, at), details: content.slice(at + DETAILS_MARKER.length) };
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((t: unknown) => {
    if (typeof t === 'string') return [t];
    if (t && typeof t === 'object' && 'label' in t && typeof t.label === 'string') return [t.label];
    return [];
  });
}

/** The post's entry, null when it doesn't opt in (or is a draft or unlisted). Problems go to `problems`. */
export function parsePost(
  source: PostSource,
  slugs: ReadonlyMap<string, string>,
  problems: string[],
  warnings: string[],
): NewsEntry | null {
  const { data, content } = splitFrontMatter(source.text);
  if (data['in_app_notification'] !== true || data['draft'] === true || data['unlisted'] === true) {
    return null;
  }
  const slug = slugOf(source.path, data);
  const date = canonicalTimestamp(data['date']);
  if (!date) {
    problems.push(
      `${source.path}: front matter \`date\` needs a time and a zone, such as 2026-11-08T14:30:00Z (got ${JSON.stringify(data['date'] ?? null)})`,
    );
  }
  const h1 = /^\s*# ([^\n]+)/.exec(content)?.[1]?.trim();
  const fmTitle = typeof data['title'] === 'string' ? data['title'].trim() : '';
  const title = fmTitle || h1 || slug;
  const ctx: LinkContext = { path: source.path, slugs, warnings };

  if (tagNames(data['tags']).includes('release')) {
    const version = /^release-(.+)$/.exec(slug)?.[1];
    if (!version || !RELEASE_VERSION.test(version)) {
      problems.push(
        `${source.path}: a post tagged release needs the slug release-X.Y.Z (got ${slug})`,
      );
      return null;
    }
    if (!date) return null;
    // Split first: the marker is a comment, and cleaning removes comments.
    const { body, details } = splitRelease(content);
    const cleanDetails = details === null ? '' : cleanBody(details, ctx);
    return {
      id: `release-${version}`,
      type: 'release',
      title,
      date,
      version,
      url: postUrl(slug),
      body: cleanBody(body, ctx),
      ...(cleanDetails ? { details: cleanDetails } : {}),
    };
  }
  if (!date) return null;
  return {
    id: `post-${slug}`,
    type: 'post',
    title,
    date,
    url: postUrl(slug),
    body: cleanBody(content, ctx),
  };
}

/** Newest first; plain string order is chronological for canonical timestamps. */
const newestFirst = (a: NewsEntry, b: NewsEntry): number =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;

/** The feed for a set of posts. Throws a {@link NewsFeedError} listing every problem found. */
export function buildFeed(sources: readonly PostSource[]): BuiltFeed {
  const problems: string[] = [];
  const warnings: string[] = [];
  const slugs = new Map<string, string>();
  for (const s of sources)
    slugs.set(postName(s.path), slugOf(s.path, splitFrontMatter(s.text).data));

  const entries = sources
    .map((s) => ({ path: s.path, entry: parsePost(s, slugs, problems, warnings) }))
    .filter((e): e is { path: string; entry: NewsEntry } => e.entry !== null);

  // One read-state high-water mark separates the entries cleanly only when no two share a timestamp.
  const dates = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const { path, entry } of entries) {
    const sameDate = dates.get(entry.date);
    if (sameDate) {
      problems.push(
        `${path}: has the same date as ${sameDate} (${entry.date}); move one of them by at least a second`,
      );
    } else dates.set(entry.date, path);
    const sameId = ids.get(entry.id);
    if (sameId) problems.push(`${path}: has the same slug as ${sameId} (${entry.id})`);
    else ids.set(entry.id, path);
  }
  if (problems.length > 0) throw new NewsFeedError(problems);

  const all = entries.map((e) => e.entry).sort(newestFirst);
  const capped = [
    ...all.filter((e) => e.type === 'release').slice(0, MAX_ENTRIES_PER_TYPE),
    ...all.filter((e) => e.type === 'post').slice(0, MAX_ENTRIES_PER_TYPE),
  ].sort(newestFirst);
  const feed: NewsFeed = { schemaVersion: NEWS_FEED_SCHEMA_VERSION, entries: capped };
  // The published file must satisfy the contract its readers check. Parsing would reorder the keys, so this
  // only validates, and the file keeps the order the entries are built in.
  const check = newsFeedSchema.safeParse(feed);
  if (!check.success)
    throw new NewsFeedError([`the feed doesn't match its schema: ${check.error.message}`]);
  return { feed, warnings };
}

/** The file's exact text: two-space JSON and a final newline. */
export function renderFeed(feed: NewsFeed): string {
  return `${JSON.stringify(feed, null, 2)}\n`;
}
