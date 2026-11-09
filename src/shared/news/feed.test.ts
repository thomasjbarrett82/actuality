import { describe, expect, it } from 'vitest';
import { CANONICAL_TIMESTAMP, NEWS_FEED_SCHEMA_VERSION, parseNewsFeed } from './feed';

const release = {
  id: 'release-2.4.0',
  type: 'release',
  title: 'Actuality 2.4.0',
  date: '2026-09-01T14:30:00Z',
  version: '2.4.0',
  url: 'https://actualitydesktop.org/blog/release-2.4.0',
  body: 'Highlights',
  details: '## Features',
};
const post = {
  id: 'post-survey',
  type: 'post',
  title: 'Survey results',
  date: '2026-08-20T09:00:00Z',
  url: 'https://actualitydesktop.org/blog/survey',
  body: 'Summary',
};
const feed = (entries: unknown[], schemaVersion: unknown = NEWS_FEED_SCHEMA_VERSION) => ({
  schemaVersion,
  entries,
});

describe('news feed contract (02 §3.1)', () => {
  it('accepts a well-formed feed, and drops fields it does not know', () => {
    expect(parseNewsFeed(feed([release, post]))).toEqual(feed([release, post]));
    expect(parseNewsFeed(feed([{ ...post, image: 'x.png' }]))?.entries[0]).toEqual(post);
    expect(parseNewsFeed(feed([{ ...release, details: undefined }]))).not.toBeNull();
  });

  it('rejects another schema version', () => {
    expect(parseNewsFeed(feed([post], 2))).toBeNull();
    expect(parseNewsFeed({ entries: [] })).toBeNull();
    expect(parseNewsFeed(null)).toBeNull();
  });

  it('rejects the whole feed when one entry is malformed', () => {
    const bad = [
      { ...post, date: '2026-08-20' },
      { ...post, date: '2026-08-20T09:00:00+02:00' },
      { ...post, date: '2026-08-20T09:00:00.000Z' },
      { ...post, url: '/blog/survey' },
      { ...post, url: 'javascript:alert(1)' },
      { ...post, type: 'video' },
      { ...post, title: 3 },
      { ...release, version: '2.4.0-beta.1' },
      { ...release, version: undefined },
      { ...release, details: 1 },
    ];
    for (const entry of bad) {
      expect(parseNewsFeed(feed([release, entry])), JSON.stringify(entry)).toBeNull();
    }
    expect(parseNewsFeed({ schemaVersion: 1, entries: {} })).toBeNull();
  });

  it('rejects entries out of order, sharing a date, or sharing an id', () => {
    expect(parseNewsFeed(feed([post, release]))).toBeNull();
    expect(parseNewsFeed(feed([release, { ...post, date: release.date }]))).toBeNull();
    expect(parseNewsFeed(feed([release, { ...post, id: release.id }]))).toBeNull();
    expect(parseNewsFeed(feed([]))).toEqual(feed([]));
  });

  it('uses a fixed-width timestamp form whose string order is chronological', () => {
    const times = ['2026-09-01T14:30:00Z', '2026-09-01T09:00:00Z', '2025-12-31T23:59:59Z'];
    for (const t of times) expect(CANONICAL_TIMESTAMP.test(t)).toBe(true);
    expect([...times].sort()).toEqual([...times].sort((a, b) => Date.parse(a) - Date.parse(b)));
  });
});
