// Reading RPC errors (03 §8–9), the connection-diagnosis messages (03 §9.1), and the server version check.
import { RpcError } from '@shared/rpc/protocol';
import { describe, expect, it } from 'vitest';
import { errorInfo, unreachableMessage, versionOlderThan } from './errors';

describe('errorInfo', () => {
  it("reads the host's details, ignoring values that aren't strings", () => {
    expect(
      errorInfo(
        new RpcError('actual', 'unreachable', {
          code: 'network-failure',
          diagnosis: 'tls-untrusted',
          errorCode: 'SELF_SIGNED_CERT_IN_CHAIN',
        }),
      ),
    ).toEqual({
      code: 'actual',
      detail: 'network-failure',
      diagnosis: 'tls-untrusted',
      errorCode: 'SELF_SIGNED_CERT_IN_CHAIN',
      message: 'unreachable',
    });
    expect(errorInfo(new RpcError('actual', 'x', { code: 7, diagnosis: null }))).toMatchObject({
      detail: null,
      diagnosis: 'none',
      errorCode: null,
    });
    expect(errorInfo(new RpcError('actual', 'x'))).toMatchObject({ detail: null });
  });

  it('reads anything else as unknown', () => {
    expect(errorInfo(new Error('boom'))).toEqual({
      code: 'unknown',
      detail: null,
      diagnosis: 'none',
      errorCode: null,
      message: 'boom',
    });
    expect(errorInfo('plain').message).toBe('plain');
  });
});

describe('unreachableMessage (03 §9.1)', () => {
  const url = 'https://budget.example:5006/';
  const at = (diagnosis: Parameters<typeof unreachableMessage>[1]['diagnosis'], errorCode = null) =>
    unreachableMessage(url, { diagnosis, errorCode });

  it('picks the message and action for each diagnosis', () => {
    expect(at('none')).toEqual({ key: 'app.cantReachServerAt', params: { url }, action: null });
    expect(at('tls-name-mismatch')).toEqual({
      key: 'app.diagnosisNameMismatch',
      params: { url, host: 'budget.example' },
      action: 'learnMore',
    });
    expect(at('tls-untrusted').action).toBe('trustCertificate');
    expect(at('tls-expired')).toEqual({
      key: 'app.diagnosisExpired',
      params: { url },
      action: null,
    });
    expect(at('needs-https')).toEqual({
      key: 'app.diagnosisNeedsHttps',
      params: { url },
      action: 'useHttps',
    });
  });

  it("shows Node's error code for another TLS failure", () => {
    expect(unreachableMessage(url, { diagnosis: 'tls-other', errorCode: 'EPROTO' })).toEqual({
      key: 'app.diagnosisOther',
      params: { url, code: 'EPROTO' },
      action: null,
    });
    expect(at('tls-other').params).toEqual({ url, code: '' });
  });

  it('keeps the text as typed for the host when it is not a URL', () => {
    expect(
      unreachableMessage('not a url', { diagnosis: 'tls-name-mismatch', errorCode: null }).params,
    ).toEqual({ url: 'not a url', host: 'not a url' });
  });
});

describe('versionOlderThan', () => {
  it('compares dotted versions part by part', () => {
    expect(versionOlderThan('26.1.9', '26.2.0')).toBe(true);
    expect(versionOlderThan('26.2.0', '26.2.0')).toBe(false);
    expect(versionOlderThan('26.10.0', '26.2.0')).toBe(false);
    expect(versionOlderThan('25.12.3', '26.2.0')).toBe(true);
  });

  it('reads missing parts as 0 and ignores a pre-release suffix and a fourth part', () => {
    expect(versionOlderThan('26.2', '26.2.0')).toBe(false);
    expect(versionOlderThan('26', '26.2.0')).toBe(true);
    expect(versionOlderThan('26.2.0-beta.1', '26.2.0')).toBe(false);
    expect(versionOlderThan('26.1.0.9', '26.1.1')).toBe(true);
  });

  it('reads parts that are not numbers as 0', () => {
    expect(versionOlderThan('dev', '26.2.0')).toBe(true);
    expect(versionOlderThan('26.x.5', '26.0.4')).toBe(false);
  });
});
