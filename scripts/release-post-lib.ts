// The blog post for a release (02 §3.1), which release.yml writes into the release pull request with
// `tsx scripts/release-post.ts <x.y.z>`. The post opts in to the news feed, and its CHANGELOG.md section
// becomes the feed entry's `details`.
import { DETAILS_MARKER } from './news-feed-lib';

/** Must match the repository URLs in .versionrc.json. */
const RELEASES_URL = 'https://github.com/thomasjbarrett82/actuality/releases';

export interface ReleasePost {
  /** File name in website/blog/: `YYYY-MM-DD-release-x.y.z.md`, dated in UTC. */
  fileName: string;
  text: string;
}

/**
 * CHANGELOG.md's section as post Markdown: its `###` category headings become `##` (the post's title is the
 * page's only H1), and its `*` list items become `-`, as Prettier writes them.
 */
export function changesMarkdown(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^###(?=\s)/, '##').replace(/^(\s*)\* /, '$1- '))
    .join('\n')
    .trim();
}

/** The post for `version`, published at `now` (second precision, UTC). */
export function releasePost(version: string, changelogBody: string, now: Date): ReleasePost {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const changes = changesMarkdown(changelogBody);
  const lines = [
    '---',
    `title: Actuality ${version}`,
    `slug: release-${version}`,
    `date: ${date}`,
    'tags: [release]',
    'in_app_notification: true',
    '---',
    '',
    `Actuality ${version} is out. Download it for Windows, macOS or Linux from the [releases page](${RELEASES_URL}).`,
    '',
    '<!-- truncate -->',
    '',
    ...(changes ? [DETAILS_MARKER, '', changes] : ['This release has no user-visible changes.']),
    '',
  ];
  return { fileName: `${date.slice(0, 10)}-release-${version}.md`, text: lines.join('\n') };
}
