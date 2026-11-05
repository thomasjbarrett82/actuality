// Vitest global setup for the integration suite: the fixture budgets for this month (21 §2), and the test
// server when it needs starting.
import { ensureFixtures } from '../fixtures/ensure-fixtures';
import { startTestServer } from './test-server';

export default async function setup(): Promise<(() => void) | undefined> {
  ensureFixtures();
  return startTestServer();
}
