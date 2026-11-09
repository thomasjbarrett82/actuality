// The news feed and update check requests (24 §3.1, §4.2). Main makes them, because the renderer's CSP
// allows no remote host (02 §6). Each is a plain anonymous GET: no cookies, no query string, no ids, and a
// fixed User-Agent without a version. A preference that is off stops its request here, whatever the
// renderer asks. Every failure resolves to null; being offline is normal. The composition root weaves the
// one log line per request through `onRequest` (02 §8.2), which sees the outcome, never the content.
import {
  LATEST_RELEASE_API_URL,
  NEWS_FEED_URL,
  parseNewsFeed,
  type NewsFeed,
} from '@shared/news/feed';
import { normalizeVersion } from '@shared/news/version';
import type { AppSettings } from '@shared/settings';
import { fileURLToPath } from 'node:url';

/** GitHub's API requires a User-Agent; Electron's default would carry the app and Electron versions. */
export const USER_AGENT = 'Actuality';
export const REQUEST_TIMEOUT_MS = 10_000;
/** Bodies over 1 MiB are refused. */
export const MAX_BODY_BYTES = 1024 * 1024;

export type RequestOutcome =
  | 'ok'
  | 'off'
  | 'override'
  | 'e2e'
  | 'network'
  | 'timeout'
  | 'status'
  | 'tooLarge'
  | 'json'
  | 'invalid';

export interface RequestFacts {
  [key: string]: string | number;
  request: 'news.feed' | 'updates.latest';
  outcome: RequestOutcome;
}

export interface NewsDeps {
  /** Electron's `net.fetch`: Chromium's network stack, so the system proxy applies. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Reads a local feed for `ACTUAL_DESKTOP_NEWS_URL` given as a path. */
  readFile: (path: string) => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  /** Overrides are honored only in an unpackaged (development or test) build. */
  isPackaged: boolean;
  settings: () => Pick<AppSettings, 'notifyWhenUpdateIsAvailable' | 'showNewsFeed'>;
  onRequest?: (facts: RequestFacts) => void;
  timeoutMs?: number;
}

class RequestFailed extends Error {
  constructor(
    readonly outcome: RequestOutcome,
    readonly status?: number,
  ) {
    super(outcome);
  }
}

async function readLimited(res: Response, limit: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) throw new RequestFailed('tooLarge');
  if (!res.body) return '';
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new RequestFailed('tooLarge');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** GETs `url` and parses its JSON body, or throws a `RequestFailed`. */
async function getJson(deps: NewsDeps, url: string, accept: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let text: string;
  try {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: 'GET',
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      throw new RequestFailed(controller.signal.aborted ? 'timeout' : 'network');
    }
    if (!res.ok) throw new RequestFailed('status', res.status);
    try {
      text = await readLimited(res, MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof RequestFailed) throw e;
      throw new RequestFailed(controller.signal.aborted ? 'timeout' : 'network');
    }
  } finally {
    clearTimeout(timer);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestFailed('json');
  }
}

async function readLocal(deps: NewsDeps, location: string): Promise<unknown> {
  let text: string;
  try {
    text = await deps.readFile(location.startsWith('file:') ? fileURLToPath(location) : location);
  } catch {
    throw new RequestFailed('network');
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new RequestFailed('tooLarge');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestFailed('json');
  }
}

async function run<T>(
  deps: NewsDeps,
  request: RequestFacts['request'],
  body: () => Promise<{ value: T | null; outcome: RequestOutcome }>,
): Promise<T | null> {
  const started = Date.now();
  let value: T | null = null;
  let facts: RequestFacts;
  try {
    const r = await body();
    value = r.value;
    facts = { request, outcome: r.outcome };
  } catch (e) {
    const failed = e instanceof RequestFailed ? e : new RequestFailed('network');
    facts = {
      request,
      outcome: failed.outcome,
      ...(failed.status === undefined ? {} : { status: failed.status }),
    };
  }
  deps.onRequest?.({ ...facts, ms: Date.now() - started });
  return value;
}

const devOverride = (deps: NewsDeps, name: string): string | null => {
  if (deps.isPackaged) return null;
  const v = deps.env[name];
  return v ? v : null;
};

const isE2E = (deps: NewsDeps): boolean => deps.env['ACTUAL_DESKTOP_E2E'] === '1';

/**
 * The validated news feed (24 §4.2), from the first of: `ACTUAL_DESKTOP_NEWS_URL` (a URL or an absolute
 * path; unpackaged builds only), nothing under `ACTUAL_DESKTOP_E2E`, then `NEWS_FEED_URL`. One malformed
 * entry rejects the whole feed.
 */
export function getFeed(deps: NewsDeps): Promise<NewsFeed | null> {
  return run(deps, 'news.feed', async () => {
    if (!deps.settings().showNewsFeed) return { value: null, outcome: 'off' };
    const override = devOverride(deps, 'ACTUAL_DESKTOP_NEWS_URL');
    let raw: unknown;
    if (override) {
      raw = /^https?:\/\//i.test(override)
        ? await getJson(deps, override, 'application/json')
        : await readLocal(deps, override);
    } else if (isE2E(deps)) {
      return { value: null, outcome: 'e2e' };
    } else {
      raw = await getJson(deps, NEWS_FEED_URL, 'application/json');
    }
    const feed = parseNewsFeed(raw);
    if (!feed) throw new RequestFailed('invalid');
    return { value: feed, outcome: override ? 'override' : 'ok' };
  });
}

/**
 * The latest published version as `X.Y.Z` (24 §3.1): `ACTUAL_DESKTOP_LATEST_VERSION` (unpackaged builds
 * only), nothing under `ACTUAL_DESKTOP_E2E`, else GitHub's latest release. A tag that isn't a plain
 * version is unknown.
 */
export function getLatest(deps: NewsDeps): Promise<string | null> {
  return run(deps, 'updates.latest', async () => {
    if (!deps.settings().notifyWhenUpdateIsAvailable) return { value: null, outcome: 'off' };
    const override = devOverride(deps, 'ACTUAL_DESKTOP_LATEST_VERSION');
    if (override) {
      const v = normalizeVersion(override);
      if (!v) throw new RequestFailed('invalid');
      return { value: v, outcome: 'override' };
    }
    if (isE2E(deps)) return { value: null, outcome: 'e2e' };
    const raw = await getJson(deps, LATEST_RELEASE_API_URL, 'application/vnd.github+json');
    const tag = raw && typeof raw === 'object' && 'tag_name' in raw ? raw.tag_name : null;
    const v = typeof tag === 'string' ? normalizeVersion(tag) : null;
    if (!v) throw new RequestFailed('invalid');
    return { value: v, outcome: 'ok' };
  });
}
