// Builds the fixture budgets before the integration and E2E suites (21 §2) unless they are current: built
// this month, by this builder, with this API version. The builder runs in its own process because the API
// keeps global state and timers. Without a test server the suites skip, so nothing is built.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');

export function ensureFixtures(): void {
  if (!process.env['ACTUAL_TEST_SERVER_URL'] || !process.env['ACTUAL_TEST_PASSWORD']) return;
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      'tsconfig.node.json',
      'tests/fixtures/build-fixture.ts',
      '--if-stale',
    ],
    { cwd: root, stdio: 'inherit', timeout: 600_000 },
  );
}
