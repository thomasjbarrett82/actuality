// Reading RPC errors in the renderer (03 §8–9), and the connection-diagnosis messages (03 §9.1).
import type { Diagnosis } from '@shared/connection';
import { RpcError, type RpcErrorCode } from '@shared/rpc/protocol';

export interface ErrorInfo {
  code: RpcErrorCode | 'unknown';
  /** Actual's or the host's own code in `details.code` (invalid-password, missing-key, …). */
  detail: string | null;
  diagnosis: Diagnosis;
  /** Node's error code behind a diagnosis (shown for tls-other). */
  errorCode: string | null;
  message: string;
}

export function errorInfo(e: unknown): ErrorInfo {
  if (!(e instanceof RpcError)) {
    return {
      code: 'unknown',
      detail: null,
      diagnosis: 'none',
      errorCode: null,
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const d = (e.details ?? {}) as { code?: unknown; diagnosis?: unknown; errorCode?: unknown };
  return {
    code: e.code,
    detail: typeof d.code === 'string' ? d.code : null,
    diagnosis: typeof d.diagnosis === 'string' ? (d.diagnosis as Diagnosis) : 'none',
    errorCode: typeof d.errorCode === 'string' ? d.errorCode : null,
    message: e.message,
  };
}

/** The action a diagnosis message offers (03 §9.1). */
export type DiagnosisAction = 'learnMore' | 'trustCertificate' | 'useHttps' | null;

export interface ConnectMessage {
  key: string;
  params: Record<string, string>;
  action: DiagnosisAction;
}

/** The message for a server that couldn't be reached, by diagnosis (03 §9, §9.1). */
export function unreachableMessage(
  url: string,
  info: Pick<ErrorInfo, 'diagnosis' | 'errorCode'>,
): ConnectMessage {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // Keep the text as typed.
  }
  switch (info.diagnosis) {
    case 'tls-name-mismatch':
      return { key: 'app.diagnosisNameMismatch', params: { url, host }, action: 'learnMore' };
    case 'tls-untrusted':
      return { key: 'app.diagnosisUntrusted', params: { url }, action: 'trustCertificate' };
    case 'tls-expired':
      return { key: 'app.diagnosisExpired', params: { url }, action: null };
    case 'tls-other':
      return {
        key: 'app.diagnosisOther',
        params: { url, code: info.errorCode ?? '' },
        action: null,
      };
    case 'needs-https':
      return { key: 'app.diagnosisNeedsHttps', params: { url }, action: 'useHttps' };
    case 'none':
      return { key: 'app.cantReachServerAt', params: { url }, action: null };
  }
}

/** Dotted numeric versions, compared part by part: is `version` older than `min`? */
export function versionOlderThan(version: string, min: string): boolean {
  const parts = (v: string): number[] =>
    v
      .split(/[.-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
