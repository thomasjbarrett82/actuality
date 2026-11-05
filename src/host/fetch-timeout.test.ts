import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  installFetchTimeout,
  timeoutFor,
  withTimeout,
} from './fetch-timeout';

/** A fetch that answers only when its signal aborts (then rejects like a real fetch), or after `ms`. */
function slowFetch(ms = Infinity): typeof fetch & { inits: (RequestInit | undefined)[] } {
  const inits: (RequestInit | undefined)[] = [];
  const f = (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    inits.push(init);
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
      if (Number.isFinite(ms)) {
        setTimeout(() => {
          resolve(new Response('ok'));
        }, ms);
      }
    });
  };
  return Object.assign(f, { inits });
}

describe('fetch timeout wrapper (03 §3, S-9)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives budget download and upload 120 s, and everything else 15 s', () => {
    expect(timeoutFor('https://x/sync/download-user-file')).toBe(DOWNLOAD_TIMEOUT_MS);
    expect(timeoutFor('https://x/sync/upload-user-file/')).toBe(DOWNLOAD_TIMEOUT_MS);
    expect(timeoutFor('https://x/sync/sync')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor('https://x/account/login')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor('not a url')).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('passes a quick request through unchanged, with a signal added', async () => {
    const inner = slowFetch(0);
    const onSlow = vi.fn();
    const wrapped = withTimeout(inner, { onSlow, timeoutFor: () => 1_000 });
    const res = await wrapped('https://x/sync/sync', { method: 'POST', body: 'payload' });
    await expect(res.text()).resolves.toBe('ok');
    expect(inner.inits[0]).toMatchObject({ method: 'POST', body: 'payload' });
    expect(inner.inits[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('aborts a hanging request at its timeout and reports it without the body', async () => {
    const onSlow = vi.fn();
    const wrapped = withTimeout(slowFetch(), { onSlow, timeoutFor: () => 20 });
    await expect(
      wrapped(new Request('https://x/sync/sync', { method: 'POST', body: 'secret' })),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(onSlow).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/sync/sync', timedOut: true }),
    );
    expect(JSON.stringify(onSlow.mock.calls)).not.toContain('secret');
  });

  it("keeps the caller's own signal working", async () => {
    const wrapped = withTimeout(slowFetch(), { timeoutFor: () => 60_000 });
    const caller = new AbortController();
    const pending = wrapped('https://x/info', { signal: caller.signal });
    caller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('reports a request slower than 5 s that still succeeds', async () => {
    vi.useFakeTimers();
    const onSlow = vi.fn();
    const wrapped = withTimeout(slowFetch(6_000), { onSlow, timeoutFor: () => 60_000 });
    const pending = wrapped('https://x/sync/list-user-files');
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(pending).resolves.toBeInstanceOf(Response);
    expect(onSlow).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/sync/list-user-files', timedOut: false }),
    );
  });

  it('sends a request once more after a stale socket was reset, and only then', async () => {
    const reset = () =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('read'), { code: 'ECONNRESET' }),
      });
    const refused = () =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      });
    const inner = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce(new Response('ok'));
    const onResend = vi.fn();
    const wrapped = withTimeout(inner, { onResend, timeoutFor: () => 1_000 });
    const res = await wrapped('https://x/sync/sync', { method: 'POST', body: new Uint8Array(3) });
    await expect(res.text()).resolves.toBe('ok');
    expect(inner).toHaveBeenCalledTimes(2);
    expect(onResend).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/sync/sync' });

    const upload = vi.fn<typeof fetch>().mockRejectedValue(reset());
    const onUploadResend = vi.fn();
    await expect(
      withTimeout(upload, { onResend: onUploadResend })('https://x/sync/upload-user-file', {
        method: 'POST',
        body: new Uint8Array(3),
      }),
    ).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onUploadResend).not.toHaveBeenCalled();

    const twice = vi.fn<typeof fetch>().mockRejectedValue(reset());
    await expect(withTimeout(twice)('https://x/sync/sync', { method: 'POST' })).rejects.toThrow();
    expect(twice).toHaveBeenCalledTimes(2);
    const down = vi.fn<typeof fetch>().mockRejectedValue(refused());
    await expect(withTimeout(down)('https://x/sync/sync')).rejects.toThrow();
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('installs on globalThis.fetch once per process', () => {
    const original = globalThis.fetch;
    try {
      installFetchTimeout();
      const installed = globalThis.fetch;
      expect(installed).not.toBe(original);
      installFetchTimeout();
      expect(globalThis.fetch).toBe(installed);
    } finally {
      globalThis.fetch = original;
    }
  });
});
