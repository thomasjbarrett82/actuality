import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loginWithPassword,
  probeLoginMethods,
  requestOpenIdLogin,
  serverVersion,
  validateToken,
} from './server-api';

const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200): Response => new Response(body, { status });
const answer = (res: Response): void => {
  fetchMock.mockResolvedValueOnce(res);
};
const unreachable = (): void => {
  fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('loginWithPassword (03 §7 step 1)', () => {
  it('posts the password login and returns the token', async () => {
    answer(json({ status: 'ok', data: { token: 'tok' } }));
    await expect(loginWithPassword('https://x.test//', 'pw')).resolves.toBe('tok');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://x.test/account/login');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(init?.body as string)).toEqual({ loginMethod: 'password', password: 'pw' });
  });

  it('tells a wrong password from other failures', async () => {
    answer(json({ status: 'error', reason: 'invalid-password' }, 400));
    await expect(loginWithPassword('https://x.test', 'bad')).rejects.toMatchObject({
      code: 'auth',
      details: { code: 'invalid-password' },
    });
    answer(json({ status: 'error', reason: 'proxy-only' }, 400));
    await expect(loginWithPassword('https://x.test', 'pw')).rejects.toMatchObject({
      code: 'actual',
      message: 'Sign-in failed (proxy-only).',
      details: { code: 'proxy-only' },
    });
  });

  it('fails on an answer that is not JSON, or an ok answer with no token', async () => {
    answer(text('<html>Bad gateway</html>', 502));
    await expect(loginWithPassword('https://x.test', 'pw')).rejects.toMatchObject({
      code: 'actual',
      message: 'Sign-in failed (502).',
      details: { code: 'login-failed' },
    });
    answer(json({ status: 'ok', data: { token: '' } }));
    await expect(loginWithPassword('https://x.test', 'pw')).rejects.toMatchObject({
      details: { code: 'login-failed' },
    });
  });

  it('is offline when the server cannot be reached', async () => {
    unreachable();
    await expect(loginWithPassword('https://x.test', 'pw')).rejects.toMatchObject({
      code: 'offline',
      details: { code: 'network-failure' },
    });
  });
});

describe('probeLoginMethods (03 §7, S-16)', () => {
  it('reads the active method', async () => {
    answer(
      json({
        methods: [
          { method: 'password', active: 0, displayName: 'Password' },
          { method: 'openid', active: 1, displayName: 'Company SSO' },
        ],
      }),
    );
    await expect(probeLoginMethods('https://x.test/')).resolves.toEqual({
      method: 'openid',
      displayName: 'Company SSO',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://x.test/account/login-methods');
    answer(json({ methods: [{ method: 'openid', active: true }] }));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'openid',
      displayName: 'OpenID',
    });
    answer(json({ methods: [{ method: 'password', active: 1, displayName: 'Password' }] }));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'password',
      displayName: 'Password',
    });
  });

  it('is unsupported for another method or none active', async () => {
    answer(json({ methods: [{ method: 'header', active: 1, displayName: 7 }] }));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'unsupported',
      displayName: '',
    });
    answer(json({ methods: [{ method: 'password', active: 0 }] }));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'unsupported',
      displayName: '',
    });
  });

  it('signs in with a password on a server that lists no methods', async () => {
    answer(text('Not found', 404));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'password',
      displayName: '',
    });
    answer(json({ status: 'ok' }));
    await expect(probeLoginMethods('https://x.test')).resolves.toEqual({
      method: 'password',
      displayName: '',
    });
  });

  it('is offline when the server cannot be reached', async () => {
    unreachable();
    await expect(probeLoginMethods('https://x.test')).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('requestOpenIdLogin (03 §7 step 2)', () => {
  it("posts the return URL and gives the identity provider's URL", async () => {
    answer(json({ status: 'ok', data: { returnUrl: 'https://idp.test/auth?x=1' } }));
    await expect(requestOpenIdLogin('https://x.test', 'http://localhost:4321')).resolves.toBe(
      'https://idp.test/auth?x=1',
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://x.test/account/login');
    expect(JSON.parse(init?.body as string)).toEqual({
      loginMethod: 'openid',
      returnUrl: 'http://localhost:4321',
    });
  });

  it('refuses a failure or a URL that is not http(s)', async () => {
    answer(json({ status: 'error', reason: 'openid-not-configured' }, 400));
    await expect(requestOpenIdLogin('https://x.test', 'http://localhost:1')).rejects.toMatchObject({
      code: 'actual',
      details: { code: 'openid-not-configured' },
    });
    answer(json({ status: 'ok', data: { returnUrl: 'javascript:alert(1)' } }));
    await expect(requestOpenIdLogin('https://x.test', 'http://localhost:1')).rejects.toMatchObject({
      details: { code: 'openid-failed' },
    });
    answer(text('oops', 500));
    await expect(requestOpenIdLogin('https://x.test', 'http://localhost:1')).rejects.toMatchObject({
      message: 'Sign-in failed (500).',
    });
  });
});

describe('validateToken (03 §7 step 7)', () => {
  it('reads the user, sending the token', async () => {
    answer(
      json({
        status: 'ok',
        data: { userId: 'u1', userName: 'sam', displayName: 'Sam', loginMethod: 'openid' },
      }),
    );
    await expect(validateToken('https://x.test', 'tok')).resolves.toEqual({
      userId: 'u1',
      userName: 'sam',
      displayName: 'Sam',
      loginMethod: 'openid',
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://x.test/account/validate');
    expect(init?.headers).toEqual({ 'x-actual-token': 'tok' });
  });

  it('blanks fields that are not text', async () => {
    answer(json({ status: 'ok', data: { userId: 1, userName: null } }));
    await expect(validateToken('https://x.test', 'tok')).resolves.toEqual({
      userId: '',
      userName: '',
      displayName: '',
      loginMethod: '',
    });
  });

  it('asks to sign in again for a token the server refuses', async () => {
    answer(json({ status: 'error', reason: 'unauthorized' }, 403));
    await expect(validateToken('https://x.test', 'old')).rejects.toMatchObject({
      code: 'auth',
      details: { code: 'token-expired' },
    });
  });
});

describe('serverVersion', () => {
  it('reads build.version, or null', async () => {
    answer(json({ build: { name: 'server', version: '26.2.0' } }));
    await expect(serverVersion('https://x.test/')).resolves.toBe('26.2.0');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://x.test/info');
    answer(json({ build: { version: 26 } }));
    await expect(serverVersion('https://x.test')).resolves.toBeNull();
    answer(json({ build: { version: '26.2.0' } }, 500));
    await expect(serverVersion('https://x.test')).resolves.toBeNull();
    unreachable();
    await expect(serverVersion('https://x.test')).resolves.toBeNull();
  });
});
