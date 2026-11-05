// Puts a fixture budget on the E2E test server and takes it away again (21 §2). Run with tsx, because the
// API loads only in Node:
//   tsx --tsconfig tsconfig.node.json tests/e2e/server-fixture.ts upload typical.zip
//   tsx --tsconfig tsconfig.node.json tests/e2e/server-fixture.ts delete {cloudFileId}
//   tsx --tsconfig tsconfig.node.json tests/e2e/server-fixture.ts accounts {cloudFileId}
//   tsx --tsconfig tsconfig.node.json tests/e2e/server-fixture.ts months {cloudFileId} 2026-09,2026-10
//   tsx --tsconfig tsconfig.node.json tests/e2e/server-fixture.ts token -
// `upload` prints the server's file entry, `accounts` the server copy's accounts, `months` its
// `getBudgetMonth` values and `token` the session token (for the log canary, 02 §8.6), as JSON on the last
// line.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealActualForTests } from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { bootstrapServer } from '../fixtures/bootstrap-server';

const server = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const password = process.env['ACTUAL_TEST_PASSWORD'] ?? '';
const [command, arg] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!server || !password || !command || !arg)
    throw new Error(
      'usage: upload <zip> | delete <id> | accounts <id> | months <id> <months> | token -',
    );
  await bootstrapServer(server, password);
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-e2e-fixture-'));
  // The API still writes to its folder for a moment after shutdown(): remove it only on exit.
  process.on('exit', () => {
    rmSync(dir, { recursive: true, force: true });
  });
  const { fixtures } = await createRealActualForTests(dir);
  const token = await loginWithPassword(server, password);
  if (command === 'upload') {
    const zip = readFileSync(join(import.meta.dirname, '../fixtures/budgets', arg));
    const file = await fixtures.uploadBudgetZip(server, token, new Uint8Array(zip));
    console.log(JSON.stringify(file));
  } else if (command === 'months') {
    const months = (process.argv[4] ?? '').split(',');
    console.log(JSON.stringify(await fixtures.serverBudgetMonths(server, token, arg, months)));
  } else if (command === 'token') {
    console.log(JSON.stringify({ token }));
  } else if (command === 'accounts') {
    console.log(JSON.stringify(await fixtures.serverAccounts(server, token, arg)));
  } else {
    await fixtures.deleteServerBudget(server, token, arg);
  }
}

await main();
// The API may keep timers alive; exiting also runs the cleanup above.
process.exit(0);
