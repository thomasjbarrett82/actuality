// The news feed and update check requests (24 §3.1, §3.5, §4.2): the feed URL order, the gating by the
// preferences, the request shape, and every failure resolving to null.
import { LATEST_RELEASE_API_URL, NEWS_FEED_URL, type NewsFeed } from '@shared/news/feed';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getFeed,
  getLatest,
  MAX_BODY_BYTES,
  USER_AGENT,
  type NewsDeps,
  type RequestFacts,
} from './news';

const feed: NewsFeed = {
  schemaVersion: 1,
  entries: [
    {
      id: 'release-0.2.1',
      type: 'release',
      title: 'Actuality 0.2.1',
      date: '2026-11-08T20:13:29Z',
      version: '0.2.1',
      url: 'https://actualitydesktop.org/blog/release-0.2.1',
      body: 'Highlights',
    },
  ],
};

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function deps(overrides: Partial<NewsDeps> = {}): NewsDeps & {
  fetch: ReturnType<typeof vi.fn>;
  facts: RequestFacts[];
} {
  const facts: RequestFacts[] = [];
  const fetch = vi.fn((url: string) =>
    Promise.resolve(url === NEWS_FEED_URL ? json(feed) : json({ tag_name: 'v0.3.0' })),
  );
  return {
    fetch,
    readFile: vi.fn(() => Promise.resolve(JSON.stringify(feed))),
    env: {},
    isPackaged: true,
    settings: () => ({ notifyWhenUpdateIsAvailable: true, showNewsFeed: true }),
    onRequest: (f) => facts.push(f),
    facts,
    ...overrides,
  } as NewsDeps & { fetch: ReturnType<typeof vi.fn>; facts: RequestFacts[] };
}

describe('the news feed request (24 §4.2)', () => {
  it('returns a well-formed feed, validated', async () => {
    const d = deps();
    expect(await getFeed(d)).toEqual(feed);
    expect(d.fetch).toHaveBeenCalledWith(NEWS_FEED_URL, expect.anything());
    expect(d.facts).toEqual([expect.objectContaining({ request: 'news.feed', outcome: 'ok' })]);
  });

  it('sends a plain anonymous GET with the fixed User-Agent and no query string', async () => {
    const d = deps();
    await getFeed(d);
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).search).toBe('');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ Accept: 'application/json', 'User-Agent': USER_AGENT });
    expect(USER_AGENT).toBe('Actuality');
  });

  it('makes no request while the feed is off, even when asked', async () => {
    const d = deps({
      settings: () => ({ notifyWhenUpdateIsAvailable: true, showNewsFeed: false }),
    });
    expect(await getFeed(d)).toBeNull();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.facts[0]?.outcome).toBe('off');
  });

  it('resolves null for an invalid feed, a non-2xx status, a network error or bad JSON', async () => {
    const cases: [Response | Error, string][] = [
      [json({ ...feed, schemaVersion: 2 }), 'invalid'],
      [json(feed, { status: 503 }), 'status'],
      [new Error('offline'), 'network'],
      [new Response('<html>', { status: 200 }), 'json'],
    ];
    for (const [result, outcome] of cases) {
      const d = deps({
        fetch: vi.fn(() =>
          result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
        ),
      });
      expect(await getFeed(d), outcome).toBeNull();
      expect(d.facts[0]?.outcome).toBe(outcome);
    }
  });

  it('refuses a body over 1 MiB, declared or streamed', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    const declared = deps({
      fetch: vi.fn(() =>
        Promise.resolve(new Response('{}', { headers: { 'content-length': String(big.length) } })),
      ),
    });
    expect(await getFeed(declared)).toBeNull();
    expect(declared.facts[0]?.outcome).toBe('tooLarge');
    const streamed = deps({ fetch: vi.fn(() => Promise.resolve(new Response(big))) });
    expect(await getFeed(streamed)).toBeNull();
    expect(streamed.facts[0]?.outcome).toBe('tooLarge');
  });

  it('gives up after the timeout', async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const d = deps({ fetch: hanging, timeoutMs: 5 });
    expect(await getFeed(d)).toBeNull();
    expect(d.facts[0]?.outcome).toBe('timeout');
  });

  it('takes the feed URL from the override (unpackaged only), else none under E2E', async () => {
    const local = deps({ isPackaged: false, env: { ACTUAL_DESKTOP_NEWS_URL: '/tmp/news.json' } });
    expect(await getFeed(local)).toEqual(feed);
    expect(local.readFile).toHaveBeenCalledWith('/tmp/news.json');
    expect(local.fetch).not.toHaveBeenCalled();

    const remote = deps({
      isPackaged: false,
      env: { ACTUAL_DESKTOP_NEWS_URL: 'http://localhost:3000/news.json' },
      fetch: vi.fn(() => Promise.resolve(json(feed))),
    });
    expect(await getFeed(remote)).toEqual(feed);
    expect(remote.fetch).toHaveBeenCalledWith('http://localhost:3000/news.json', expect.anything());

    const e2e = deps({ isPackaged: false, env: { ACTUAL_DESKTOP_E2E: '1' } });
    expect(await getFeed(e2e)).toBeNull();
    expect(e2e.fetch).not.toHaveBeenCalled();
    expect(e2e.facts[0]?.outcome).toBe('e2e');

    // An installed copy ignores the override.
    const packaged = deps({ env: { ACTUAL_DESKTOP_NEWS_URL: '/tmp/news.json' } });
    expect(await getFeed(packaged)).toEqual(feed);
    expect(packaged.readFile).not.toHaveBeenCalled();
    expect(packaged.fetch).toHaveBeenCalledWith(NEWS_FEED_URL, expect.anything());
  });

  it('accepts the E2E feed fixture (tests/fixtures/news/news.json)', async () => {
    const d = deps({
      isPackaged: false,
      env: {
        ACTUAL_DESKTOP_NEWS_URL: join(import.meta.dirname, '../../tests/fixtures/news/news.json'),
      },
      readFile: (path) => readFile(path, 'utf8'),
    });
    expect((await getFeed(d))?.entries.map((e) => e.id)).toEqual([
      'post-fixture-announcement',
      'release-0.0.1',
    ]);
  });
});

describe('the latest version request (24 §3.1)', () => {
  it("reads GitHub's latest release tag as X.Y.Z", async () => {
    const d = deps();
    expect(await getLatest(d)).toBe('0.3.0');
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LATEST_RELEASE_API_URL);
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Actuality',
    });
  });

  it('makes no request while the update check is off', async () => {
    const d = deps({
      settings: () => ({ notifyWhenUpdateIsAvailable: false, showNewsFeed: true }),
    });
    expect(await getLatest(d)).toBeNull();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('is unknown for a pre-release tag, a missing tag, a rate limit or an error', async () => {
    for (const response of [
      json({ tag_name: 'v1.0.0-beta.1' }),
      json({ name: 'v1.0.0' }),
      json({ message: 'API rate limit exceeded' }, { status: 403 }),
    ]) {
      expect(await getLatest(deps({ fetch: vi.fn(() => Promise.resolve(response)) }))).toBeNull();
    }
    expect(
      await getLatest(deps({ fetch: vi.fn(() => Promise.reject(new Error('offline'))) })),
    ).toBeNull();
  });

  it('honors ACTUAL_DESKTOP_LATEST_VERSION in unpackaged builds, and makes no request under E2E', async () => {
    const override = deps({
      isPackaged: false,
      env: { ACTUAL_DESKTOP_E2E: '1', ACTUAL_DESKTOP_LATEST_VERSION: 'v99.9.9' },
    });
    expect(await getLatest(override)).toBe('99.9.9');
    expect(override.fetch).not.toHaveBeenCalled();

    const e2e = deps({ isPackaged: false, env: { ACTUAL_DESKTOP_E2E: '1' } });
    expect(await getLatest(e2e)).toBeNull();
    expect(e2e.fetch).not.toHaveBeenCalled();

    const packaged = deps({ env: { ACTUAL_DESKTOP_LATEST_VERSION: 'v99.9.9' } });
    expect(await getLatest(packaged)).toBe('0.3.0');
  });
});
