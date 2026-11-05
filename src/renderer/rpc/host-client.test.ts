import { describe, expect, it } from 'vitest';
import { HOST_FAILED, HostClient } from './host-client';

/** A host on the other end of a MessageChannel that never answers. */
function silentPort(): MessagePort {
  const { port1, port2 } = new MessageChannel();
  port2.start();
  return port1;
}

/** A host that answers every request with its method name. */
function echoPort(): MessagePort {
  const { port1, port2 } = new MessageChannel();
  port2.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { id: number; method: string };
    port2.postMessage({ id: m.id, ok: true, result: m.method });
  });
  port2.start();
  return port1;
}

const failed = { code: 'internal', details: { code: HOST_FAILED } };

describe('HostClient when the host fails for good (03 §6.5)', () => {
  it('rejects calls in flight and calls waiting for a port', async () => {
    const client = new HostClient();
    const attachedMeanwhile = client.call('session.state', {});
    client.attach(silentPort());
    await Promise.resolve();
    const inFlight = client.call('session.state', {});
    const another = new HostClient();
    const waitingForPort = another.call('session.state', {});
    const outcomes = Promise.allSettled([attachedMeanwhile, inFlight, waitingForPort]);
    client.fail();
    another.fail();
    for (const o of await outcomes) expect(o).toMatchObject({ status: 'rejected', reason: failed });
  });

  it('rejects later calls at once, until a new port arrives', async () => {
    const client = new HostClient();
    client.fail();
    await expect(client.call('session.state', {})).rejects.toMatchObject(failed);
    client.attach(echoPort());
    await expect(client.call('session.state', {})).resolves.toBe('session.state');
  });
});
