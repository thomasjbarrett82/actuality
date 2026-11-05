// The few direct HTTP calls the host makes to the server (03 §7). They use the global fetch, which has the
// timeout wrapper installed, and they run in the host, so they share the API's TLS settings.
import type { LoginProbe } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';

interface LoginResponse {
  status?: string;
  reason?: string;
  data?: { token?: string };
}

/**
 * Exchanges the server password for a session token: `POST {server}/account/login` with an explicit
 * `loginMethod: 'password'` (03 §7 step 1). The password is never stored.
 * Errors: `auth` with `details.code = 'invalid-password'`, or `offline` with `details.code = 'network-failure'`.
 */
export async function loginWithPassword(serverUrl: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl.replace(/\/+$/, '')}/account/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginMethod: 'password', password }),
    });
  } catch {
    throw new RpcError('offline', "Couldn't reach the server.", { code: 'network-failure' });
  }
  let body: LoginResponse = {};
  try {
    body = (await res.json()) as LoginResponse;
  } catch {
    // A non-JSON answer falls through to the generic error below.
  }
  const token = body.data?.token;
  if (res.ok && body.status === 'ok' && typeof token === 'string' && token) return token;
  if (body.reason === 'invalid-password') {
    throw new RpcError('auth', 'That password is incorrect.', { code: 'invalid-password' });
  }
  throw new RpcError('actual', `Sign-in failed (${body.reason ?? String(res.status)}).`, {
    code: body.reason ?? 'login-failed',
  });
}

const base = (serverUrl: string): string => serverUrl.replace(/\/+$/, '');

async function getJson(url: string, init?: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new RpcError('offline', "Couldn't reach the server.", { code: 'network-failure' });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON answers are handled by the callers.
  }
  return { res, body };
}

export type { LoginProbe } from '@shared/rpc/host-api';

/**
 * The server's active sign-in method (03 §7): `GET /account/login-methods`. `active` is 1/0, and
 * `true` counts as 1 too. A server that doesn't list methods (older servers) signs in with a password.
 */
export async function probeLoginMethods(serverUrl: string): Promise<LoginProbe> {
  const { res, body } = await getJson(`${base(serverUrl)}/account/login-methods`);
  const methods = (
    body as { methods?: { method?: unknown; active?: unknown; displayName?: unknown }[] } | null
  )?.methods;
  if (!res.ok || !Array.isArray(methods)) return { method: 'password', displayName: '' };
  const active = methods.find((m) => m.active === 1 || m.active === true);
  const displayName = typeof active?.displayName === 'string' ? active.displayName : '';
  if (active?.method === 'password') return { method: 'password', displayName };
  if (active?.method === 'openid')
    return { method: 'openid', displayName: displayName || 'OpenID' };
  return { method: 'unsupported', displayName };
}

/**
 * Starts an OpenID sign-in (03 §7 step 2): `POST /account/login { loginMethod: 'openid', returnUrl }`.
 * Returns the identity provider's URL for the browser. `returnUrl` must be spelled `localhost`.
 */
export async function requestOpenIdLogin(serverUrl: string, returnUrl: string): Promise<string> {
  const { res, body } = await getJson(`${base(serverUrl)}/account/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginMethod: 'openid', returnUrl }),
  });
  const data = body as { status?: string; reason?: string; data?: { returnUrl?: string } } | null;
  const url = data?.data?.returnUrl;
  if (res.ok && data?.status === 'ok' && typeof url === 'string' && /^https?:/i.test(url))
    return url;
  throw new RpcError('actual', `Sign-in failed (${data?.reason ?? String(res.status)}).`, {
    code: data?.reason ?? 'openid-failed',
  });
}

export interface TokenUser {
  userId: string;
  userName: string;
  displayName: string;
  loginMethod: string;
}

/** Who a token belongs to (03 §7 step 7): `GET /account/validate` with the token header. */
export async function validateToken(serverUrl: string, token: string): Promise<TokenUser> {
  const { res, body } = await getJson(`${base(serverUrl)}/account/validate`, {
    headers: { 'x-actual-token': token },
  });
  const data = (body as { status?: string; data?: Record<string, unknown> } | null)?.data;
  if (!res.ok || !data) {
    throw new RpcError('auth', 'Sign in again.', { code: 'token-expired' });
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    userId: str(data['userId']),
    userName: str(data['userName']),
    displayName: str(data['displayName']),
    loginMethod: str(data['loginMethod']),
  };
}

/** The server's version from `GET /info` (`build.version`), or null when it can't be read. */
export async function serverVersion(serverUrl: string): Promise<string | null> {
  try {
    const { res, body } = await getJson(`${base(serverUrl)}/info`);
    const version = (body as { build?: { version?: unknown } } | null)?.build?.version;
    return res.ok && typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
