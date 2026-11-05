import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './tests/load-test-env.ts';

// Integration tests: the host against a real Actual server (21 §1). See tests/int/README.md for setup.
loadTestEnv();

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    include: ['tests/int/**/*.int.test.ts'],
    // Builds the fixture budgets for this month unless they are current (21 §2).
    globalSetup: ['tests/int/global-setup.ts'],
    setupFiles: ['tests/int/rate-limit.ts'],
    // Actual changes behavior under NODE_ENV=test, which Vitest sets: its scheduleFullSync then syncs inline
    // inside each mutation, and a budget write right after batchBudgetUpdates never returns.
    // The app's host never runs in that mode, so the tests don't either.
    env: { NODE_ENV: 'production' },
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
