// Playwright global setup for the E2E suite: the fixture budgets for this month (21 §2), and the test server
// when it needs starting. A returned function is Playwright's teardown.
import { ensureFixtures } from '../fixtures/ensure-fixtures';
import { startTestServer } from '../int/test-server';

export default async function globalSetup(): Promise<(() => void) | undefined> {
  ensureFixtures();
  return startTestServer();
}
