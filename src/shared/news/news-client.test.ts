// The update check's version rules (24 §3.2) and the news read state (24 §4.4, §4.7).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NewsEntry } from './feed';
import { advance, markAllSeen, newestTimestamp, releaseToNotify, unseen } from './read-state';
import { compareVersions, isOutdated, normalizeVersion, parseVersion } from './version';

const release = (version: string, date: string): NewsEntry => ({
  id: `release-${version}`,
  type: 'release',
  title: `Actuality ${version}`,
  date,
  version,
  url: `https://actualitydesktop.org/blog/release-${version}`,
  body: 'Highlights',
});
const post = (slug: string, date: string): NewsEntry => ({
  id: `post-${slug}`,
  type: 'post',
  title: slug,
  date,
  url: `https://actualitydesktop.org/blog/${slug}`,
  body: 'Body',
});

describe('version comparison (24 §3.2)', () => {
  it('reads plain versions, with or without one leading v', () => {
    expect(parseVersion('0.2.1')).toEqual([0, 2, 1]);
    expect(parseVersion('v10.0.3')).toEqual([10, 0, 3]);
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
  });

  it('treats anything else as unknown, pre-releases included', () => {
    for (const s of ['v1.0.0-beta.1', '1.0', 'vv1.0.0', '1.0.0.0', '', 'latest', ' 1.0.0'])
      expect(parseVersion(s), s).toBeNull();
    expect(compareVersions('1.0.0', 'v1.0.0-beta.1')).toBeNull();
  });

  it('compares numerically, part by part', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    fc.assert(
      fc.property(
        fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)),
        fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)),
        (a, b) => {
          const d = compareVersions(a.join('.'), b.join('.')) ?? NaN;
          const r = compareVersions(b.join('.'), a.join('.')) ?? NaN;
          return Math.sign(d) === -Math.sign(r);
        },
      ),
    );
  });

  it('is outdated only when the latest version is known and newer', () => {
    expect(isOutdated('0.2.1', '0.3.0')).toBe(true);
    expect(isOutdated('0.2.1', '0.2.1')).toBe(false);
    expect(isOutdated('0.4.0', '0.3.0')).toBe(false); // a development build ahead of the release
    expect(isOutdated('0.2.1', null)).toBe(false);
  });
});

describe('read state (24 §4.4)', () => {
  const morning = post('morning', '2026-11-08T09:00:00Z');
  const afternoon = post('afternoon', '2026-11-08T15:00:00Z');
  const older = release('0.2.0', '2026-10-01T12:00:00Z');
  const entries = [afternoon, morning, older];

  it('has nothing unseen on a first run', () => {
    expect(unseen(entries, null)).toEqual([]);
  });

  it('uses a strict comparison on the timestamp', () => {
    expect(unseen(entries, morning.date)).toEqual([afternoon]);
    expect(unseen(entries, '2026-10-01T11:59:59Z')).toEqual(entries);
  });

  it('keeps two entries of the same day apart', () => {
    const seen = advance(null, morning.date);
    expect(unseen(entries, seen)).toEqual([afternoon]);
  });

  it('only takes values from the feed, and never moves back', () => {
    expect(newestTimestamp(entries)).toBe(afternoon.date);
    expect(newestTimestamp([])).toBeNull();
    expect(markAllSeen(entries, morning.date)).toBe(afternoon.date);
    expect(markAllSeen([], morning.date)).toBe(morning.date);
    expect(markAllSeen([older], afternoon.date)).toBe(afternoon.date);
    expect(advance(afternoon.date, morning.date)).toBe(afternoon.date);
    expect(advance(null, null)).toBeNull();
  });
});

describe('the "what\'s new" release (24 §4.7)', () => {
  const r020 = release('0.2.0', '2026-10-01T12:00:00Z');
  const r021 = release('0.2.1', '2026-11-08T20:13:29Z');
  const later = post('later-that-day', '2026-11-08T21:00:00Z');
  const r030 = release('0.3.0', '2026-12-01T12:00:00Z');
  const entries = [r030, later, r021, r020];

  it('is the newest unseen release at or below the running version', () => {
    expect(releaseToNotify(entries, '2026-09-01T00:00:00Z', '0.2.1')).toBe(r021);
    expect(releaseToNotify(entries, '2026-09-01T00:00:00Z', '0.2.0')).toBe(r020);
  });

  it('ignores posts and newer releases, and nothing on a first run', () => {
    expect(releaseToNotify([r030, later], '2026-09-01T00:00:00Z', '0.2.1')).toBeNull();
    expect(releaseToNotify(entries, null, '0.2.1')).toBeNull();
  });

  it('marks only that release as seen when closed, so a later post stays unread', () => {
    const lastSeen = advance('2026-09-01T00:00:00Z', r021.date);
    expect(unseen(entries, lastSeen)).toEqual([r030, later]);
    expect(releaseToNotify(entries, lastSeen, '0.2.1')).toBeNull();
    // After upgrading to 0.3.0, its own toast is still to come.
    expect(releaseToNotify(entries, lastSeen, '0.3.0')).toBe(r030);
  });
});
