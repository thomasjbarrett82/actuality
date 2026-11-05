import { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import { startLoopback } from './openid';

const PAGE = '<p>Signed in.</p>';
const HAS_IPV6_LOOPBACK = Object.values(networkInterfaces())
  .flat()
  .some((i) => i?.address === '::1');

describe('OpenID loopback listener (03 §7, S-17)', () => {
  it('uses localhost, ignores other requests, and accepts the first GET with a token', async () => {
    const listener = await startLoopback(PAGE);
    expect(listener.returnUrl).toMatch(/^http:\/\/localhost:\d+$/);
    const port = new URL(listener.returnUrl).port;
    expect((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/openid-cb`)).status).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${port}/openid-cb?token=t`, { method: 'POST' })).status,
    ).toBe(404);
    const ok = await fetch(`http://127.0.0.1:${port}/openid-cb?token=abc-123`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(PAGE);
    await expect(listener.result).resolves.toEqual({ kind: 'token', token: 'abc-123' });
    // Closed afterwards.
    await expect(fetch(`http://127.0.0.1:${port}/openid-cb?token=again`)).rejects.toThrow();
  });

  it.skipIf(!HAS_IPV6_LOOPBACK)(
    'answers on ::1 as well (the address Windows used in S-17)',
    async () => {
      const listener = await startLoopback(PAGE);
      const port = new URL(listener.returnUrl).port;
      expect((await fetch(`http://[::1]:${port}/openid-cb?token=v6`)).status).toBe(200);
      await expect(listener.result).resolves.toEqual({ kind: 'token', token: 'v6' });
    },
  );

  it('times out, and can be cancelled', async () => {
    const slow = await startLoopback(PAGE, 20);
    await expect(slow.result).resolves.toEqual({ kind: 'timeout' });
    const cancelled = await startLoopback(PAGE);
    cancelled.cancel();
    await expect(cancelled.result).resolves.toEqual({ kind: 'cancelled' });
  });
});
