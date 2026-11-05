import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagnosisFor, probe, requestInfo } from './diagnose';

describe('connection diagnosis (03 §9.1)', () => {
  it('maps Node error codes', () => {
    expect(diagnosisFor('ERR_TLS_CERT_ALTNAME_INVALID', 'https://x')).toBe('tls-name-mismatch');
    expect(diagnosisFor('DEPTH_ZERO_SELF_SIGNED_CERT', 'https://x')).toBe('tls-untrusted');
    expect(diagnosisFor('UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'https://x')).toBe('tls-untrusted');
    expect(diagnosisFor('CERT_HAS_EXPIRED', 'https://x')).toBe('tls-expired');
    expect(diagnosisFor('CERT_NOT_YET_VALID', 'https://x')).toBe('tls-expired');
    expect(diagnosisFor('ERR_SSL_WRONG_VERSION_NUMBER', 'https://x')).toBe('tls-other');
    expect(diagnosisFor('CERT_REVOKED', 'https://x')).toBe('tls-other');
    expect(diagnosisFor('EPROTO', 'https://x')).toBe('tls-other');
    expect(diagnosisFor('EPROTO', 'http://x')).toBe('none');
    expect(diagnosisFor('ECONNREFUSED', 'https://x')).toBe('none');
    expect(diagnosisFor(undefined, 'https://x')).toBe('none');
  });

  it('detects an http:// address on an https-only server', async () => {
    const calls: string[] = [];
    const fake = (url: string): Promise<string | null> => {
      calls.push(url);
      return Promise.resolve(
        url.startsWith('http:') ? 'ECONNRESET' : 'DEPTH_ZERO_SELF_SIGNED_CERT',
      );
    };
    await expect(probe('http://budget.lan:5006', fake)).resolves.toEqual({
      reachable: false,
      diagnosis: 'needs-https',
      code: 'ECONNRESET',
    });
    expect(calls).toEqual(['http://budget.lan:5006', 'https://budget.lan:5006']);
  });

  it('reports a refused http:// address without needs-https', async () => {
    const fake = (url: string): Promise<string | null> =>
      Promise.resolve(url.startsWith('http:') ? 'ECONNRESET' : 'ECONNREFUSED');
    await expect(probe('http://x', fake)).resolves.toMatchObject({
      diagnosis: 'none',
      reachable: false,
    });
  });

  describe('against a real socket', () => {
    let server: http.Server;
    let url = '';
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        res.writeHead(req.url === '/info' ? 200 : 404).end('{}');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      server.close();
    });

    it('finds a server that answers', async () => {
      await expect(probe(url)).resolves.toEqual({ reachable: true, diagnosis: 'none' });
    });

    it('reports a closed port', async () => {
      const closed = http.createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((r) =>
        closed.close(() => {
          r();
        }),
      );
      await expect(requestInfo(`http://127.0.0.1:${port}`)).resolves.toBe('ECONNREFUSED');
    });

    it('times out a server that never answers', async () => {
      const silent = http.createServer(() => undefined);
      await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
      const port = (silent.address() as AddressInfo).port;
      await expect(requestInfo(`http://127.0.0.1:${port}`, 200)).resolves.toBe('TIMEOUT');
      silent.closeAllConnections();
      silent.close();
    });

    it('rejects a malformed address', async () => {
      await expect(requestInfo('not a url')).resolves.toBe('EINVAL');
    });
  });
});
