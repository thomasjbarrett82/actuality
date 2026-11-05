// A switch that takes the host "offline" (21 §1): every server request fails the way a refused
// connection does. Installed on globalThis.fetch before the API loads, so it sits beneath the fetch
// timeout wrapper and the API sees real network failures. The /info probe is switched with it.
import { probe, type ProbeResult } from '../../src/host/diagnose';

export interface NetworkSwitch {
  down(): void;
  up(): void;
  probe(serverUrl: string): Promise<ProbeResult>;
}

export function installNetworkSwitch(): NetworkSwitch {
  const real = globalThis.fetch;
  let isDown = false;
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!isDown) return real(input, init);
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return Promise.reject(new TypeError('fetch failed', { cause }));
  };
  return {
    down: () => {
      isDown = true;
    },
    up: () => {
      isDown = false;
    },
    probe: (serverUrl) =>
      isDown ? Promise.resolve({ reachable: false, diagnosis: 'none' }) : probe(serverUrl),
  };
}
