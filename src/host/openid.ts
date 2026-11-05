// The OpenID loopback listener (03 §7 steps 1, 4). One HTTP listener on a random port, bound to both
// 127.0.0.1 and ::1 so `localhost` works whichever address the browser picks (on Windows it can be ::1);
// if one can't be bound, the other is enough. It accepts the first GET that carries a `token`, answers with
// a short page, and closes. Anything else gets a 404. It times out after 5 minutes, and can be cancelled.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const OPENID_TIMEOUT_MS = 5 * 60_000;

export type LoopbackOutcome =
  { kind: 'token'; token: string } | { kind: 'timeout' } | { kind: 'cancelled' };

export interface LoopbackListener {
  /** `http://localhost:{port}`: the server accepts only `localhost`. */
  readonly returnUrl: string;
  /** Resolves once: with the token, on timeout, or on cancel. */
  readonly result: Promise<LoopbackOutcome>;
  cancel(): void;
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => {
      reject(e);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Starts the listener. `page` is the HTML sent when the token arrives ("You're signed in to Actuality.
 * You can close this tab."), already translated and escaped by the caller.
 */
export async function startLoopback(
  page: string,
  timeoutMs = OPENID_TIMEOUT_MS,
): Promise<LoopbackListener> {
  let settle: (outcome: LoopbackOutcome) => void = () => undefined;
  const result = new Promise<LoopbackOutcome>((resolve) => {
    settle = resolve;
  });
  let done = false;
  const servers: Server[] = [];
  const finish = (outcome: LoopbackOutcome): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const s of servers) s.close();
    settle(outcome);
  };

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');
    if (done || req.method !== 'GET' || url.pathname !== '/openid-cb' || !token) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      .end(page);
    finish({ kind: 'token', token });
  };

  // ::1 first, then 127.0.0.1 on the same port; either alone is enough.
  let port = 0;
  for (const host of ['::1', '127.0.0.1']) {
    const server = createServer(handle);
    try {
      port = await listen(server, host, port);
      servers.push(server);
    } catch {
      server.close();
    }
  }
  if (servers.length === 0) throw new Error('Could not open a local port for the sign-in.');

  const timer = setTimeout(() => {
    finish({ kind: 'timeout' });
  }, timeoutMs);

  return {
    returnUrl: `http://localhost:${String(port)}`,
    result,
    cancel: () => {
      finish({ kind: 'cancelled' });
    },
  };
}
