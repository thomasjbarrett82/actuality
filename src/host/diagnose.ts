// Reachability probe and connection diagnosis (03 §4.2, §9.1). One `GET {server}/info` with Node's
// http/https module and a 5 s timeout, outside the job queue and independent of the API. It uses the same
// TLS settings as the API (NODE_EXTRA_CA_CERTS), because it runs in the host.
import type { Diagnosis } from '@shared/connection';
import http from 'node:http';
import https from 'node:https';

export const PROBE_TIMEOUT_MS = 5_000;

export interface ProbeResult {
  /** The server answered /info (any HTTP status). */
  reachable: boolean;
  diagnosis: Diagnosis;
  /** Node's error code, logged; certificate contents never are (03 §9.1). */
  code?: string;
}

const UNTRUSTED = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
]);
const EXPIRED = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID']);

/** Maps a Node error code to a diagnosis (03 §9.1 table). `needs-https` needs a second probe: see probe(). */
export function diagnosisFor(code: string | undefined, url: string): Diagnosis {
  if (!code) return 'none';
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'tls-name-mismatch';
  if (UNTRUSTED.has(code)) return 'tls-untrusted';
  if (EXPIRED.has(code)) return 'tls-expired';
  if (/^(ERR_TLS_|ERR_SSL_|CERT_)/.test(code)) return 'tls-other';
  if (code === 'EPROTO' && url.startsWith('https:')) return 'tls-other';
  return 'none';
}

/** The `{url}/info` request, resolving with Node's error code (or 'EMPTY'/'TIMEOUT'), or null on any answer. */
export function requestInfo(
  serverUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(`${serverUrl.replace(/\/+$/, '')}/info`);
    } catch {
      resolve('EINVAL');
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      resolve(e.code ?? (e.message.includes('socket hang up') ? 'ECONNRESET' : 'EMPTY'));
    });
  });
}

/**
 * Probes `{url}/info` and diagnoses a failure. An http:// address that is reset or answers nothing gets a
 * second probe over https://; if that answers (with any TLS outcome), the diagnosis is `needs-https`.
 */
export async function probe(serverUrl: string, request = requestInfo): Promise<ProbeResult> {
  const code = await request(serverUrl);
  if (code === null) return { reachable: true, diagnosis: 'none' };
  if (
    serverUrl.startsWith('http:') &&
    ['ECONNRESET', 'EMPTY', 'HPE_INVALID_CONSTANT'].includes(code)
  ) {
    const httpsCode = await request(serverUrl.replace(/^http:/, 'https:'));
    if (httpsCode === null || diagnosisFor(httpsCode, 'https:') !== 'none') {
      return { reachable: false, diagnosis: 'needs-https', code };
    }
  }
  return { reachable: false, diagnosis: diagnosisFor(code, serverUrl), code };
}
