import { describe, expect, it } from 'vitest';
import {
  absolutizeLinks,
  buildFeed,
  canonicalTimestamp,
  cleanBody,
  DETAILS_MARKER,
  MAX_ENTRIES_PER_TYPE,
  NewsFeedError,
  renderFeed,
  slugOf,
  splitFences,
  splitFrontMatter,
  splitRelease,
  stripComments,
  type PostSource,
} from './news-feed-lib';

const post = (name: string, frontMatter: string, body = 'Body.'): PostSource => ({
  path: `blog/${name}`,
  text: `---\n${frontMatter}\n---\n\n${body}\n`,
});
const optIn = (date: string, extra = '') =>
  `date: ${date}\nin_app_notification: true${extra ? `\n${extra}` : ''}`;

const ctx = (path = 'blog/2026-11-08-a.md', slugs = new Map<string, string>()) => ({
  path,
  slugs,
  warnings: [] as string[],
});

/** The problems buildFeed reports, or [] when it succeeds. */
function problemsOf(sources: PostSource[]): string[] {
  try {
    buildFeed(sources);
    return [];
  } catch (e) {
    if (e instanceof NewsFeedError) return e.problems;
    throw e;
  }
}

describe('front matter (02 §3.1)', () => {
  it('reads YAML front matter, with CRLF line endings too', () => {
    const { data, content } = splitFrontMatter(
      '---\r\ntitle: Hi\r\ntags: [a, b]\r\n---\r\nText\r\n',
    );
    expect(data).toEqual({ title: 'Hi', tags: ['a', 'b'] });
    expect(content).toBe('Text\n');
    expect(splitFrontMatter('No front matter').data).toEqual({});
  });

  it('keeps dates as written, and writes them in canonical UTC', () => {
    expect(splitFrontMatter('---\ndate: 2026-09-01T16:30:00+02:00\n---\n').data['date']).toBe(
      '2026-09-01T16:30:00+02:00',
    );
    expect(canonicalTimestamp('2026-09-01T16:30:00+02:00')).toBe('2026-09-01T14:30:00Z');
    expect(canonicalTimestamp('2026-09-01T14:30:00Z')).toBe('2026-09-01T14:30:00Z');
    expect(canonicalTimestamp('2026-09-01T14:30:00.900Z')).toBe('2026-09-01T14:30:00Z');
    for (const bad of [
      '2026-09-01',
      '2026-09-01T14:30:00',
      '2026-09-01 14:30',
      'soon',
      20260901,
      null,
    ]) {
      expect(canonicalTimestamp(bad), String(bad)).toBeNull();
    }
  });

  it('takes the slug from front matter, else the file name without its date', () => {
    expect(slugOf('blog/2026-11-08-hello-world.md', {})).toBe('hello-world');
    expect(slugOf('blog/2026-11-08-hello.mdx', {})).toBe('hello');
    expect(slugOf('blog/2026-11-08-folder-post/index.md', {})).toBe('folder-post');
    expect(slugOf('blog/2026-11-08-x.md', { slug: '/custom/' })).toBe('custom');
  });
});

describe('body cleanup (02 §3.1)', () => {
  it('removes comments, including overlapping and unterminated ones', () => {
    expect(stripComments('a<!-- x -->b')).toBe('ab');
    expect(stripComments('a<!-<!---->-- y -->b')).toBe('ab');
    expect(stripComments('a<!-<!-- -->- y -->b')).not.toContain('<!--');
    expect(stripComments('keep <!-- never closed\nmore')).toBe('keep ');
  });

  it('leaves comments and blank lines in fenced code blocks exactly as written', () => {
    const md = [
      'Before <!-- gone -->',
      '',
      '```html',
      '<!-- kept -->',
      '',
      '',
      '',
      '<p>',
      '```',
      '',
      '  ~~~~',
      '<!-- also kept',
      '~~~',
      '~~~~',
      'After',
    ].join('\n');
    expect(cleanBody(md, ctx())).toBe(
      [
        'Before ',
        '',
        '```html',
        '<!-- kept -->',
        '',
        '',
        '',
        '<p>',
        '```',
        '',
        '  ~~~~',
        '<!-- also kept',
        '~~~',
        '~~~~',
        'After',
      ].join('\n'),
    );
  });

  it('sees no fence inside a comment, and drops everything after an unterminated one', () => {
    expect(cleanBody('A\n<!--\n```\ncommented out\n```\n-->\nB', ctx())).toBe('A\n\nB');
    expect(cleanBody('A\n<!-- open\n```\ncode\n```\nB', ctx())).toBe('A');
    // An unclosed fence runs to the end, and an inline code span isn't a fence.
    expect(splitFences('x\n```\n<!--').map((p) => p.code)).toEqual([false, true]);
    expect(splitFences('```a`b\n<!-- c -->').map((p) => p.code)).toEqual([false]);
  });

  it('drops a leading H1, MDX and runs of blank lines, and leaves lowercase HTML and code alone', () => {
    const md = [
      '# Title',
      '',
      "import Tabs from '@theme/Tabs';",
      '',
      '<Tabs><TabItem value="a">Inside</TabItem></Tabs>',
      '{/* truncate */}',
      '',
      '',
      '',
      'Text <kbd>Ctrl</kbd>',
      '',
      '```js',
      "import x from 'y';",
      '[link](./code.md)',
      '```',
    ].join('\n');
    expect(cleanBody(md, ctx())).toBe(
      [
        'Inside',
        '',
        'Text <kbd>Ctrl</kbd>',
        '',
        '```js',
        "import x from 'y';",
        '[link](./code.md)',
        '```',
      ].join('\n'),
    );
    expect(cleanBody('Intro\n\n# Not leading', ctx())).toBe('Intro\n\n# Not leading');
  });

  it('makes relative and root-relative links absolute, and leaves the others alone', () => {
    const c = ctx();
    expect(absolutizeLinks('[a](/docs/intro) [b](../docs/budgets/categories.md#top)', c)).toBe(
      '[a](https://actualitydesktop.org/docs/intro) [b](https://actualitydesktop.org/docs/budgets/categories#top)',
    );
    expect(absolutizeLinks('[c](./other-page.mdx "Title") [d](<../docs/a b.md>)', c)).toBe(
      '[c](https://actualitydesktop.org/blog/other-page "Title") [d](<https://actualitydesktop.org/docs/a%20b>)',
    );
    const kept =
      '[e](https://x.org/a.md) [f](//cdn.x.org/y) [g](#here) [h](mailto:a@b.c) [^1]: note';
    expect(absolutizeLinks(kept, c)).toBe(kept);
    expect(absolutizeLinks('[ref]: /img/x.png\n[![alt](/img/y.png)](/docs/intro)', c)).toBe(
      '[ref]: https://actualitydesktop.org/img/x.png\n[![alt](https://actualitydesktop.org/img/y.png)](https://actualitydesktop.org/docs/intro)',
    );
    expect(c.warnings).toEqual([]);
  });

  it('resolves links against a folder post, and to other posts by their file name', () => {
    const slugs = new Map([['2026-01-01-foo.md', 'custom-foo']]);
    expect(absolutizeLinks('[x](../../docs/intro.md)', ctx('blog/2026-11-08-p/index.md'))).toBe(
      '[x](https://actualitydesktop.org/docs/intro)',
    );
    expect(
      absolutizeLinks(
        '[x](./2026-01-01-foo.md#part) [y](2026-01-01-foo.md)',
        ctx(undefined, slugs),
      ),
    ).toBe(
      '[x](https://actualitydesktop.org/blog/custom-foo#part) [y](https://actualitydesktop.org/blog/custom-foo)',
    );
  });

  it('warns about relative images and about links it cannot parse, and leaves the latter as they are', () => {
    const c = ctx();
    expect(absolutizeLinks('![a](./pic.png)', c)).toBe(
      '![a](https://actualitydesktop.org/blog/pic.png)',
    );
    // A backslash after the slash makes `//`, a host, and `[bad` isn't one.
    expect(absolutizeLinks('[b](/\\[bad)', c)).toBe('[b](/\\[bad)');
    expect(c.warnings).toHaveLength(2);
    expect(c.warnings[0]).toContain('/img/blog/');
    expect(c.warnings[1]).toContain("can't be parsed");
  });

  it('splits a release into highlights and details at the marker', () => {
    expect(splitRelease(`High\n${DETAILS_MARKER}\n## Features`)).toEqual({
      body: 'High\n',
      details: '\n## Features',
    });
    expect(splitRelease('Only highlights')).toEqual({ body: 'Only highlights', details: null });
  });
});

describe('buildFeed (02 §3.1)', () => {
  it('includes only posts that opt in and are neither drafts nor unlisted', () => {
    const { feed } = buildFeed([
      post('2026-01-01-a.md', optIn('2026-01-01T10:00:00Z')),
      post('2026-01-02-b.md', 'date: 2026-01-02T10:00:00Z'),
      post('2026-01-03-c.md', optIn('2026-01-03T10:00:00Z', 'draft: true')),
      post('2026-01-04-d.md', optIn('2026-01-04T10:00:00Z', 'unlisted: true')),
      post('2026-01-05-e.md', 'date: 2026-01-05T10:00:00Z\nin_app_notification: "true"'),
    ]);
    expect(feed.entries.map((e) => e.id)).toEqual(['post-a']);
  });

  it('builds post and release entries', () => {
    const { feed, warnings } = buildFeed([
      post(
        '2026-01-01-hello.md',
        optIn('2026-01-01T10:00:00+01:00', 'title: Hello'),
        '# Hello\n\nSee [docs](/docs/intro).',
      ),
      post(
        '2026-02-01-release-1.2.0.md',
        optIn(
          '2026-02-01T12:00:00Z',
          'title: Actuality 1.2.0\nslug: release-1.2.0\ntags: [release]',
        ),
        `Highlights.\n\n<!-- truncate -->\n\n${DETAILS_MARKER}\n\n## Features\n\n- one`,
      ),
      post('2026-03-01-untitled.md', optIn('2026-03-01T12:00:00Z'), '# From the heading\n\nText'),
    ]);
    expect(warnings).toEqual([]);
    expect(feed).toEqual({
      schemaVersion: 1,
      entries: [
        {
          id: 'post-untitled',
          type: 'post',
          title: 'From the heading',
          date: '2026-03-01T12:00:00Z',
          url: 'https://actualitydesktop.org/blog/untitled',
          body: 'Text',
        },
        {
          id: 'release-1.2.0',
          type: 'release',
          title: 'Actuality 1.2.0',
          date: '2026-02-01T12:00:00Z',
          version: '1.2.0',
          url: 'https://actualitydesktop.org/blog/release-1.2.0',
          body: 'Highlights.',
          details: '## Features\n\n- one',
        },
        {
          id: 'post-hello',
          type: 'post',
          title: 'Hello',
          date: '2026-01-01T09:00:00Z',
          url: 'https://actualitydesktop.org/blog/hello',
          body: 'See [docs](https://actualitydesktop.org/docs/intro).',
        },
      ],
    });
    // Keys in a stable, readable order.
    expect(Object.keys(feed.entries[1] ?? {})).toEqual([
      'id',
      'type',
      'title',
      'date',
      'version',
      'url',
      'body',
      'details',
    ]);
  });

  it('leaves out details when a release has none', () => {
    const { feed } = buildFeed([
      post(
        '2026-02-01-release-1.2.0.md',
        optIn('2026-02-01T12:00:00Z', 'tags: [release]'),
        'Just highlights.',
      ),
    ]);
    expect(feed.entries[0]).not.toHaveProperty('details');
    expect(feed.entries[0]).toMatchObject({ type: 'release', version: '1.2.0' });
  });

  it('fails on a date without a time or zone, without using the file name', () => {
    const problems = problemsOf([
      post('2026-01-01-a.md', 'in_app_notification: true'),
      post('2026-01-02-b.md', optIn('2026-01-02')),
      post('2026-01-03-c.md', optIn('2026-01-03T10:00:00')),
    ]);
    expect(problems).toHaveLength(3);
    for (const p of problems) expect(p).toContain('needs a time and a zone');
  });

  it('fails on a release post whose slug is not release-X.Y.Z', () => {
    const problems = problemsOf([
      post('2026-01-01-big-news.md', optIn('2026-01-01T10:00:00Z', 'tags: [release]')),
      post('2026-01-02-x.md', optIn('2026-01-02T10:00:00Z', 'slug: release-2.0\ntags: [release]')),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('release-X.Y.Z');
  });

  it('fails on two entries with the same timestamp or slug', () => {
    expect(
      problemsOf([
        post('2026-01-01-a.md', optIn('2026-01-01T10:00:00Z')),
        post('2026-01-01-b.md', optIn('2026-01-01T12:00:00+02:00')),
      ])[0],
    ).toContain('same date');
    expect(
      problemsOf([
        post('2026-01-01-a.md', optIn('2026-01-01T10:00:00Z')),
        post('2026-01-02-b.md', optIn('2026-01-02T10:00:00Z', 'slug: a')),
      ])[0],
    ).toContain('same slug');
  });

  it('sorts newest first and caps releases and posts separately', () => {
    const sources: PostSource[] = [];
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, '0');
      sources.push(
        post(
          `2026-01-${day}-release-1.0.${i}.md`,
          optIn(`2026-01-${day}T10:00:00Z`, 'tags: [release]'),
        ),
        post(`2026-02-${day}-post-${i}.md`, optIn(`2026-02-${day}T10:00:00Z`)),
      );
    }
    const { entries } = buildFeed(sources).feed;
    expect(entries).toHaveLength(2 * MAX_ENTRIES_PER_TYPE);
    expect(entries.filter((e) => e.type === 'release')).toHaveLength(MAX_ENTRIES_PER_TYPE);
    expect(entries.map((e) => e.date)).toEqual(
      entries
        .map((e) => e.date)
        .sort()
        .reverse(),
    );
    expect(entries.at(-1)?.id).toBe('release-1.0.3');
    expect(entries.some((e) => e.id === 'post-post-2')).toBe(false);
  });

  it('renders two-space JSON with a final newline', () => {
    expect(renderFeed({ schemaVersion: 1, entries: [] })).toBe(
      '{\n  "schemaVersion": 1,\n  "entries": []\n}\n',
    );
  });
});
