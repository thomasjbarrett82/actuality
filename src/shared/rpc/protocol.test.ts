import { describe, expect, it } from 'vitest';
import { isEvent, isRequest, isResponse, RpcError, toErrorData } from './protocol';

describe('rpc protocol', () => {
  it('classifies messages', () => {
    expect(isRequest({ id: 1, method: 'x', params: {} })).toBe(true);
    expect(isResponse({ id: 1, ok: true, result: null })).toBe(true);
    expect(isEvent({ event: 'data:changed', payload: {} })).toBe(true);
    expect(isRequest(null)).toBe(false);
    expect(isResponse('x')).toBe(false);
    expect(isEvent(1)).toBe(false);
  });

  it('round-trips errors with their code', () => {
    const e = new RpcError('offline', "You're offline", { at: 1 });
    const back = RpcError.from(e.toData());
    expect(back.code).toBe('offline');
    expect(back.details).toEqual({ at: 1 });
    expect(new RpcError('timeout', 't').toData()).toEqual({ code: 'timeout', message: 't' });
  });

  it('maps unknown errors to internal', () => {
    expect(toErrorData(new Error('boom'))).toEqual({ code: 'internal', message: 'boom' });
    expect(toErrorData('plain')).toEqual({ code: 'internal', message: 'plain' });
    expect(toErrorData(new RpcError('auth', 'a')).code).toBe('auth');
  });
});
