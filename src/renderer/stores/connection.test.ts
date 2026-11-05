import type { HostStatus } from '@shared/shell-api';
import { describe, expect, it, vi } from 'vitest';
import { host } from '../rpc/host-client';
import { useConnection } from './connection';

describe('connection store', () => {
  it('rejects host calls once main reports the host failed for good (03 §6.5)', () => {
    let report: (status: HostStatus) => void = () => undefined;
    window.app.shell.onHostStatus = (listener) => {
      report = listener;
      return () => undefined;
    };
    const fail = vi.spyOn(host, 'fail').mockImplementation(() => undefined);
    const connection = useConnection();
    connection.start();
    report('restarting');
    expect(fail).not.toHaveBeenCalled();
    report('failed');
    expect(fail).toHaveBeenCalledOnce();
    expect(connection.canEdit).toBe(false);
    fail.mockRestore();
  });
});
