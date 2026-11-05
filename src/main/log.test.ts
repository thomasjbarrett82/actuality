import { setDebug } from '@shared/aspects/level';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initLog, LOG_FILE, toLogEntry, writeLog } from './log';
import { applyDebugLogging } from './log-level';

const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-log-'));
const lines = (): string[] => {
  try {
    return readFileSync(join(dir, LOG_FILE), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

beforeAll(() => {
  initLog(dir);
});
afterEach(() => {
  setDebug(false);
  rmSync(join(dir, LOG_FILE), { force: true });
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the log sink (02 §8.1, §8.3, §8.4)', () => {
  it('drops a debug entry from any process while debug logging is off', () => {
    for (const source of ['main', 'host', 'renderer'] as const)
      writeLog({ at: 0, level: 'debug', source, message: 'rpc.call' });
    writeLog({ at: 0, level: 'info', source: 'host', message: 'conn.state' });
    expect(lines()).toEqual([expect.stringMatching(/ INFO \[host\] conn\.state$/)]);
    setDebug(true);
    writeLog({ at: 0, level: 'debug', source: 'renderer', message: 'rpc.call' });
    expect(lines().at(-1)).toMatch(/ DEBUG \[renderer\] rpc\.call$/);
  });

  it('redacts secrets, long strings and the home folder before writing', () => {
    writeLog({
      at: 0,
      level: 'warn',
      source: 'host',
      message: 'step.failed',
      data: { token: 'abc', nested: { password: 'pw' }, path: join(homedir(), 'x') },
    });
    const [line] = lines();
    expect(line).not.toContain('abc');
    expect(line).not.toContain('pw"');
    expect(line).toContain('"token":"[redacted]"');
    expect(line).toContain('~');
  });

  it('accepts only well-formed entries from other processes, tagged with their source', () => {
    expect(toLogEntry({ level: 'loud', message: 'x' }, 'renderer')).toBeNull();
    expect(toLogEntry('nope', 'host')).toBeNull();
    expect(toLogEntry({ at: 1, level: 'info', source: 'main', message: 'm' }, 'renderer')).toEqual({
      at: 1,
      level: 'info',
      source: 'renderer',
      message: 'm',
    });
  });
});

describe('applyDebugLogging (02 §8.3)', () => {
  it('applies a change at once, sends it to the host and records the switch, once per change', () => {
    const sendToHost = vi.fn();
    const onSwitch = vi.fn();
    applyDebugLogging(true, { sendToHost, onSwitch });
    applyDebugLogging(true, { sendToHost, onSwitch });
    applyDebugLogging(false, { sendToHost, onSwitch });
    expect(sendToHost.mock.calls).toEqual([[{ debug: true }], [{ debug: false }]]);
    expect(onSwitch).toHaveBeenCalledTimes(2);
  });
});
