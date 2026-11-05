// Settings for the server-backed suites (21 §1), read by their configs before any test process starts: the
// environment wins, then the git-ignored .env.test.local (KEY=value lines). See tests/int/README.md.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadTestEnv(): void {
  const envFile = resolve(import.meta.dirname, '../.env.test.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m?.[1] && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2]?.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  // Node reads the extra CA when a process starts, so it must be set before the test processes start.
  const ca = process.env['ACTUAL_TEST_CA_CERT'];
  if (ca) process.env['NODE_EXTRA_CA_CERTS'] = ca;
}
