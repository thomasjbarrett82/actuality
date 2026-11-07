// Debug logging (02 §8.6): with the setting off, a journey writes no DEBUG lines; after
// ticking Preferences ▸ Diagnostics ▸ "Enable debug logging", one RPC call produces `rpc.call`, `queue.job`
// and `http.request` lines with the same `callId`. A canary then greps the whole log for the test password,
// the session token and the budget's payee names. Needs a test server: see tests/int/README.md.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';
/** Payees of the Typical fixture (tests/fixtures/build-fixture.ts). */
const PAYEES = ['Kroger', 'Employer Inc', 'Landlord'];

interface Line {
  level: string;
  source: string;
  message: string;
  data: Record<string, unknown>;
}

/** Every log file, the rotated ones too, as one text. */
function logText(userData: string): string {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => f.startsWith('app.log'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

function lines(userData: string): Line[] {
  return logText(userData)
    .split(/\r?\n/)
    .flatMap((l) => {
      const m = /^\S+ (\w+) \[(\w+)\] (\S+)(?: (.*))?$/.exec(l);
      if (!m) return [];
      const [, level = '', source = '', message = '', json] = m;
      return [
        { level, source, message, data: json ? (JSON.parse(json) as Record<string, unknown>) : {} },
      ];
    });
}

/**
 * The entries of one renderer call to `method` and the host work it caused, by `callId` (02 §8.2): the
 * message names of the first call whose trace reached the server, else [].
 */
function traceOf(userData: string, method: string): string[] {
  const all = lines(userData);
  const ids = all
    .filter(
      (l) => l.source === 'renderer' && l.message === 'rpc.call' && l.data['method'] === method,
    )
    .map((l) => l.data['callId']);
  const traces = ids.map((id) => [
    ...new Set(all.filter((l) => l.data['callId'] === id).map((l) => l.message)),
  ]);
  return traces.find((t) => t.includes('http.request'))?.sort() ?? [];
}

/** The session tokens to look for: the one the app stored (Stay signed in), and the server's. */
async function sessionTokens(app: ElectronApplication, userData: string): Promise<string[]> {
  const path = join(userData, 'secrets.json');
  const secrets = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>)
    : {};
  const stored = await Promise.all(
    Object.entries(secrets)
      .filter(([k]) => k.startsWith('server:'))
      .map(([, b64]) =>
        app.evaluate(
          async ({ safeStorage }, v) =>
            (await safeStorage.decryptStringAsync(Buffer.from(v, 'base64'))).result,
          b64,
        ),
      ),
  );
  const { token } = JSON.parse(serverFixture('token', '-')) as { token: string };
  return [...stored, token].filter((t) => t.length > 0);
}

const command = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('shell:menuCommand', cmd);
  }, id);

async function setDebugLogging(app: ElectronApplication, page: Page, on: boolean): Promise<void> {
  await command(app, 'file.preferences');
  const box = page.getByRole('checkbox', { name: 'Enable debug logging' });
  await expect(box).toBeVisible();
  await box.focus();
  if ((await box.isChecked()) !== on) await page.keyboard.press('Space');
  await expect(box).toBeChecked({ checked: on });
  await page.getByRole('button', { name: 'Done' }).click();
}

test.describe('debug logging', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(240_000);
  let cloudFileId = '';

  test.beforeAll(() => {
    test.setTimeout(240_000);
    cloudFileId = (JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string })
      .cloudFileId;
  });

  test.afterAll(() => {
    if (cloudFileId) serverFixture('delete', cloudFileId);
  });

  test('is off by default, traces one call across the processes when on, and leaks nothing', async () => {
    const userData = newUserData();
    const app = await launchApp(userData);
    const page = await app.firstWindow();

    // Off: a whole connect-and-open journey writes no DEBUG line.
    await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
    await expect(
      page.getByText('Select Budget, Reports or an account on the left to get started.'),
    ).toBeVisible({ timeout: 180_000 });
    await page.getByRole('treeitem', { name: /^Checking\s*,/ }).click();
    await expect(page.getByRole('heading', { name: 'Checking', level: 1 })).toBeVisible();
    expect(lines(userData).filter((l) => l.level === 'DEBUG')).toEqual([]);

    // On: takes effect at once, with one log.level entry.
    await setDebugLogging(app, page, true);
    await expect
      .poll(() =>
        lines(userData).some((l) => l.message === 'log.level' && l.data['debug'] === true),
      )
      .toBe(true);

    // One RPC call that reaches the server: File ▸ Sync Now.
    await command(app, 'file.syncNow');
    await expect
      .poll(() => traceOf(userData, 'session.syncNow'), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['http.request', 'queue.job', 'rpc.call']));

    // The canary: never the password, the session token or budget content, at any level.
    const text = logText(userData);
    expect(text).not.toContain(PASSWORD);
    for (const token of await sessionTokens(app, userData)) expect(text).not.toContain(token);
    for (const payee of PAYEES) expect(text, payee).not.toContain(payee);

    await setDebugLogging(app, page, false);
    await app.close();
  });
});
