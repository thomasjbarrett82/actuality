import { describe, expect, it } from 'vitest';
import { RpcEndpoint, type Transport } from './endpoint';
import { RpcError, type RpcMessage } from './protocol';

/** Two transports wired to each other, delivering asynchronously like a MessagePort. */
function pair(): [Transport, Transport] {
  const listeners: [((m: unknown) => void) | null, ((m: unknown) => void) | null] = [null, null];
  const make = (self: 0 | 1): Transport => ({
    send: (m: RpcMessage) => {
      const copy: unknown = JSON.parse(JSON.stringify(m));
      queueMicrotask(() => listeners[self === 0 ? 1 : 0]?.(copy));
    },
    listen: (h) => {
      listeners[self] = h;
      return () => {
        listeners[self] = null;
      };
    },
  });
  return [make(0), make(1)];
}

describe('RpcEndpoint', () => {
  it('round-trips requests and results', async () => {
    const [a, b] = pair();
    const client = new RpcEndpoint(a);
    const server = new RpcEndpoint(b);
    server.handle((method, params) => Promise.resolve({ method, params }));
    await expect(client.call('session.state', { x: 1 })).resolves.toEqual({
      method: 'session.state',
      params: { x: 1 },
    });
  });

  it('sends undefined results as null', async () => {
    const [a, b] = pair();
    const client = new RpcEndpoint(a);
    new RpcEndpoint(b).handle(() => Promise.resolve(undefined));
    await expect(client.call('x', {})).resolves.toBeNull();
  });

  it('carries error codes across', async () => {
    const [a, b] = pair();
    const client = new RpcEndpoint(a);
    new RpcEndpoint(b).handle(() =>
      Promise.reject(new RpcError('offline', "You're offline", { why: 1 })),
    );
    const e = await client.call('notes.set', {}).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(RpcError);
    expect(e).toMatchObject({ code: 'offline', message: "You're offline", details: { why: 1 } });
  });

  it('answers internal when nothing handles requests', async () => {
    const [a, b] = pair();
    const client = new RpcEndpoint(a);
    new RpcEndpoint(b);
    await expect(client.call('x', {})).rejects.toMatchObject({ code: 'internal' });
  });

  it('delivers events', async () => {
    const [a, b] = pair();
    const host = new RpcEndpoint(a);
    const renderer = new RpcEndpoint(b);
    const got = new Promise((resolve) =>
      renderer.onEvent((event, payload) => {
        resolve({ event, payload });
      }),
    );
    host.emit('data:changed', { tables: ['notes'] });
    await expect(got).resolves.toEqual({ event: 'data:changed', payload: { tables: ['notes'] } });
  });

  it('rejects pending calls on close and refuses new ones', async () => {
    const [a, b] = pair();
    const client = new RpcEndpoint(a);
    new RpcEndpoint(b).handle(() => new Promise(() => undefined));
    const p = client.call('slow', {});
    client.close('host restarted');
    await expect(p).rejects.toMatchObject({ code: 'internal', message: 'host restarted' });
    await expect(client.call('x', {})).rejects.toMatchObject({ code: 'internal' });
    client.close();
    client.emit('ignored', {});
  });

  it('ignores responses to unknown ids and unknown messages', () => {
    let deliver: (m: unknown) => void = () => undefined;
    const t: Transport = {
      send: () => undefined,
      listen: (h) => {
        deliver = h;
        return () => undefined;
      },
    };
    new RpcEndpoint(t);
    expect(() => {
      deliver({ id: 99, ok: true, result: 1 });
      deliver('garbage');
    }).not.toThrow();
  });
});
