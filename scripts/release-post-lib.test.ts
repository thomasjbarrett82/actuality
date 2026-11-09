import { describe, expect, it } from 'vitest';
import { changelogSection } from './changelog-lib';
import { buildFeed, DETAILS_MARKER } from './news-feed-lib';
import { changesMarkdown, releasePost } from './release-post-lib';

const changelog = [
  '# Changelog',
  '',
  '## [1.3.0](https://example.org/compare/v1.2.0...v1.3.0) (2026-12-01)',
  '',
  '### Features',
  '',
  '* new thing ([abc1234](https://example.org/commit/abc1234))',
  '',
  '### Bug fixes',
  '',
  '* old thing',
  '',
  '## 1.2.0 (2026-11-01)',
  '',
  '## 1.1.0 (2026-10-01)',
  '',
  '### Features',
  '',
  '* first',
].join('\n');

describe('changelogSection (02 §5.1)', () => {
  it("returns a version's section, empty when it has no changes, null when it is missing", () => {
    expect(changelogSection(changelog, '1.3.0')).toBe(
      '### Features\n\n* new thing ([abc1234](https://example.org/commit/abc1234))\n\n### Bug fixes\n\n* old thing',
    );
    expect(changelogSection(changelog, '1.2.0')).toBe('');
    expect(changelogSection(changelog, '1.1.0')).toBe('### Features\n\n* first');
    expect(changelogSection(changelog, '9.9.9')).toBeNull();
    expect(changelogSection(changelog.replaceAll('\n', '\r\n'), '1.1.0')).toBe(
      '### Features\n\n* first',
    );
  });
});

describe('releasePost (02 §3.1)', () => {
  const now = new Date('2026-12-01T18:04:05.678Z');

  it('turns the changelog section into post Markdown', () => {
    expect(changesMarkdown('### Features\n\n* one\n  * nested')).toBe(
      '## Features\n\n- one\n  - nested',
    );
  });

  it('writes a dated post that opts in to the news feed', () => {
    const { fileName, text } = releasePost(
      '1.3.0',
      changelogSection(changelog, '1.3.0') ?? '',
      now,
    );
    expect(fileName).toBe('2026-12-01-release-1.3.0.md');
    expect(text).toContain('\ndate: 2026-12-01T18:04:05Z\n');
    expect(text).toContain(`<!-- truncate -->\n\n${DETAILS_MARKER}\n\n## Features`);

    const { feed } = buildFeed([{ path: `blog/${fileName}`, text }]);
    expect(feed.entries).toEqual([
      expect.objectContaining({
        id: 'release-1.3.0',
        type: 'release',
        title: 'Actuality 1.3.0',
        date: '2026-12-01T18:04:05Z',
        version: '1.3.0',
        url: 'https://actualitydesktop.org/blog/release-1.3.0',
        details:
          '## Features\n\n- new thing ([abc1234](https://example.org/commit/abc1234))\n\n## Bug fixes\n\n- old thing',
      }),
    ]);
    expect(feed.entries[0]?.body).toMatch(/^Actuality 1\.3\.0 is out\./);
  });

  it('says so when a release has no user-visible changes', () => {
    const { text } = releasePost('1.2.0', '', now);
    expect(text).not.toContain(DETAILS_MARKER);
    // The site build fails on a post without an excerpt marker (onUntruncatedBlogPosts).
    expect(text).toContain('<!-- truncate -->');
    expect(text).toContain('This release has no user-visible changes.');
  });
});
