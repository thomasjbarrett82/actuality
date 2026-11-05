// Vitest setup file for the integration suite. The Actual server allows each client 500 requests per
// fixed 60 s window and answers 429 past that, on every route, and the whole suite goes over it. So a
// file that might not fit in what is left of the window waits for the next one.
import { beforeAll } from 'vitest';

// The heaviest file makes 113 requests.
const MIN_REMAINING = 150;

beforeAll(async () => {
  const server = process.env['ACTUAL_TEST_SERVER_URL'];
  if (!server) return;
  // A server that can't be reached is for the tests themselves to report.
  const headers = (await fetch(`${server}/info`).catch(() => undefined))?.headers;
  const remaining = headers?.get('ratelimit-remaining');
  const reset = headers?.get('ratelimit-reset');
  if (remaining == null || reset == null || Number(remaining) >= MIN_REMAINING) return;
  await new Promise((done) => setTimeout(done, (Number(reset) + 1) * 1000));
});
