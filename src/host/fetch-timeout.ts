// Fetch timeout wrapper (03 §3). @actual-app/api sets no request timeouts, so a half-open server
// hangs init/sync/shutdown. This wrapper adds an AbortSignal timeout to every request. It must be installed
// before the API is first imported, because the API reads `globalThis.fetch` once, at load.
// It adds a signal, and sends a request once more when a reused keep-alive socket was reset before any
// response (after a long write job the first sync push can fail with ECONNRESET, while the same
// push right after succeeds), except for uploads, and reports each resend. Requests and responses are
// never rewritten.

export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const SLOW_REQUEST_MS = 5_000;

/** 120 s for budget download/upload, 15 s for everything else (sync, login, validate, list files, keys). */
export function timeoutFor(url: string): number {
  const path = pathOf(url);
  return path.endsWith('/download-user-file') || path.endsWith('/upload-user-file')
    ? DOWNLOAD_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/** A connection reset before any response: a stale keep-alive socket. */
function isReset(e: unknown): boolean {
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause;
  return e instanceof TypeError && cause?.code === 'ECONNRESET';
}

/** Whether the request can be sent again: its body isn't a one-shot stream, and it isn't an upload. */
function replayable(input: Parameters<typeof fetch>[0], init?: RequestInit): boolean {
  if (input instanceof Request) return false;
  // An upload may have been stored before the reset: only sync, login and reads are repeated.
  if (pathOf(urlOf(input)).endsWith('/upload-user-file')) return false;
  const body = init?.body;
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export interface FetchTimeoutOptions {
  /** Called for requests slower than 5 s, and for timeouts: method, path, duration. Never the body. */
  onSlow?: (info: { method: string; path: string; ms: number; timedOut: boolean }) => void;
  /** Called when a request is sent again after a reset socket: method and path. Never the body. */
  onResend?: (info: { method: string; path: string }) => void;
  /** Overrides for tests. */
  timeoutFor?: (url: string) => number;
}

/** Wraps a fetch implementation with per-request timeouts. */
export function withTimeout(inner: typeof fetch, opts: FetchTimeoutOptions = {}): typeof fetch {
  const pick = opts.timeoutFor ?? timeoutFor;
  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = urlOf(input);
    const timeout = AbortSignal.timeout(pick(url));
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const started = Date.now();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    try {
      try {
        return await inner(input, { ...init, signal });
      } catch (e) {
        if (!isReset(e) || signal.aborted || !replayable(input, init)) throw e;
        opts.onResend?.({ method, path: pathOf(url) });
        return await inner(input, { ...init, signal });
      }
    } finally {
      const ms = Date.now() - started;
      if (ms > SLOW_REQUEST_MS || timeout.aborted) {
        opts.onSlow?.({ method, path: pathOf(url), ms, timedOut: timeout.aborted });
      }
    }
  };
  return wrapped;
}

export interface InstallOptions extends FetchTimeoutOptions {
  /** Wraps the timeout wrapper from the outside: the HTTP join point (02 §8.2). */
  outer?: (wrapped: typeof fetch) => typeof fetch;
}

let installed = false;

/** Installs the wrapper on globalThis.fetch, once per process. */
export function installFetchTimeout(opts: InstallOptions = {}): void {
  if (installed) return;
  const wrapped = withTimeout(globalThis.fetch.bind(globalThis), opts);
  globalThis.fetch = opts.outer ? opts.outer(wrapped) : wrapped;
  installed = true;
}

/** What the HTTP join point exposes about a request: method and path, never the query or body. */
export function requestFacts(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): { method: string; path: string } {
  return {
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    path: pathOf(urlOf(input)),
  };
}
