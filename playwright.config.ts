import { defineConfig } from '@playwright/test';
import { loadTestEnv } from './tests/load-test-env';

// E2E runs against the built app (`npm run test:e2e` builds it first) through Playwright's _electron
// driver (21 §1). The journeys need a test server: see tests/int/README.md for setup.
loadTestEnv();

export default defineConfig({
  testDir: 'tests/e2e',
  // Builds the fixture budgets for this month unless they are current (21 §2), and starts the test server
  // when it needs starting.
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
