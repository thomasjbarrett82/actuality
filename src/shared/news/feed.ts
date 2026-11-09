// The news feed contract (02 §3.1, 24 §4.1): the JSON document `scripts/news-feed.ts` publishes as
// https://actualitydesktop.org/news.json, built from the blog posts that opt in. The generator validates its
// output with this schema, and the app validates what it fetches with the same one, so the two can't drift
// apart. The site's addresses live here too, so the generator and the app share them.
import { z } from 'zod';

/** The published site. Must match `url` in website/docusaurus.config.ts. */
export const SITE_URL = 'https://actualitydesktop.org';

/** The blog's route, `routeBasePath` in website/docusaurus.config.ts. */
export const BLOG_ROUTE = 'blog';

/** Where the app fetches the feed (24 §4.2). */
export const NEWS_FEED_URL = `${SITE_URL}/news.json`;

/** The blog's front page. */
export const BLOG_URL = `${SITE_URL}/${BLOG_ROUTE}`;

/** Every release's notes: the blog's `release` tag. */
export const RELEASE_NOTES_URL = `${BLOG_URL}/tags/release`;

/** A release's post on the blog, which links the download page (scripts/release-post.ts). */
export const releasePostUrl = (version: string): string => `${BLOG_URL}/release-${version}`;

/** GitHub's "latest release": published releases only, never drafts or pre-releases (24 §3.1). */
export const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/thomasjbarrett82/actuality/releases/latest';

/**
 * The feed format version. A reader built for one version rejects a feed with any other, so bump it only for
 * a breaking change: every installed reader stops showing news until it is updated. Adding an optional field
 * is not a breaking change.
 */
export const NEWS_FEED_SCHEMA_VERSION = 1;

/**
 * The only timestamp form in the feed: UTC, second precision, a literal `Z`. Values of this fixed-width form
 * sort chronologically as plain strings, and readers rely on that.
 */
export const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** A plain release version, `MAJOR.MINOR.PATCH`. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

const entryFields = {
  /** Stable and unique: `release-<version>` or `post-<slug>`. */
  id: z.string().min(1),
  /** Plain text. */
  title: z.string().min(1),
  /** The publication instant, in canonical form, unique across the feed. */
  date: z.string().regex(CANONICAL_TIMESTAMP),
  /** The post's page on the website. */
  url: z.url({ protocol: /^https?$/ }),
  /** Markdown whose links are all absolute. For a release, the highlights only. */
  body: z.string(),
};

const releaseEntrySchema = z.object({
  ...entryFields,
  type: z.literal('release'),
  version: z.string().regex(RELEASE_VERSION),
  /** Markdown: the full list of changes, shown on demand. */
  details: z.string().optional(),
});

const postEntrySchema = z.object({ ...entryFields, type: z.literal('post') });

const newsEntrySchema = z.discriminatedUnion('type', [releaseEntrySchema, postEntrySchema]);

/**
 * Unknown fields are allowed (and dropped), so adding an optional field never breaks a reader. The entries
 * are strictly newest first, so no two share a `date` and a single "last seen" timestamp always separates
 * read from unread; and no two share an `id`.
 */
export const newsFeedSchema = z
  .object({
    schemaVersion: z.literal(NEWS_FEED_SCHEMA_VERSION),
    entries: z.array(newsEntrySchema),
  })
  .superRefine(({ entries }, ctx) => {
    const ids = new Set<string>();
    entries.forEach((entry, i) => {
      const previous = entries[i - 1];
      if (previous && entry.date >= previous.date) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', i, 'date'],
          message: `not older than the entry before it (${previous.date})`,
        });
      }
      if (ids.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: ['entries', i, 'id'], message: 'duplicate id' });
      }
      ids.add(entry.id);
    });
  });

export type NewsEntry = z.infer<typeof newsEntrySchema>;
export type NewsFeed = z.infer<typeof newsFeedSchema>;

/**
 * The feed in `value`, or null when it doesn't match the contract. One malformed entry rejects the whole
 * feed: accepting part of it would make read state unpredictable.
 */
export function parseNewsFeed(value: unknown): NewsFeed | null {
  const result = newsFeedSchema.safeParse(value);
  return result.success ? result.data : null;
}
