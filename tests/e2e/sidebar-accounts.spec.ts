// The sidebar and accounts against the built app: the sidebar's badges equal the fixture's error counts,
// dragging an account reorders it within its group in Actual and a drop on another group changes nothing,
// the keyboard moves an account, Create Account opens the new register, its header renames it, and the
// last screen is restored after a restart. Needs a test server: see tests/int/README.md.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FIXTURE_NAMES, TYPICAL_ATTENTION } from '../fixtures/fixture-facts';
import { launchApp, newUserData, type PageGlobals } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';
const root = join(import.meta.dirname, '../..');

/** Runs the fixture helper with tsx; returns its last output line. */
function serverFixture(...args: string[]): string {
  const out = execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      'tsconfig.node.json',
      'tests/e2e/server-fixture.ts',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', timeout: 180_000 },
  );
  return out.trim().split(/\r?\n/).at(-1) ?? '';
}

interface ServerAccount {
  name: string;
  offbudget: boolean;
  closed: boolean;
}

const account = (page: Page, name: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^${name}\\s*,`) });

/** The account names of a sidebar group, in order: the tree items after its header, up to the next one. */
async function groupNames(page: Page, header: string): Promise<string[]> {
  const rows = await Promise.all(
    (await page.getByRole('treeitem').all()).map(async (el) => ({
      level: await el.getAttribute('aria-level'),
      name: (await el.locator('.row__label').first().innerText()).trim(),
    })),
  );
  const start = rows.findIndex((r) => r.level === '1' && r.name.startsWith(header));
  const out: string[] = [];
  for (const r of rows.slice(start + 1)) {
    if (r.level !== '2') break;
    out.push(r.name.split(',')[0] ?? '');
  }
  return out;
}

/** An element's box once it has stopped moving (the canvas slides in for 350 ms, 06 §2). */
async function settledBox(locator: Locator) {
  let last = '';
  for (;;) {
    const box = await locator.boundingBox();
    const now = JSON.stringify(box);
    if (box && now === last) return box;
    last = now;
    await new Promise((r) => setTimeout(r, 150));
  }
}

test.describe('sidebar and accounts', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);
  let cloudFileId = '';

  test.beforeAll(() => {
    test.setTimeout(240_000);
    cloudFileId = (JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string })
      .cloudFileId;
  });

  test.afterAll(() => {
    if (cloudFileId) serverFixture('delete', cloudFileId);
  });

  test('badges, drag within a group, keyboard moves, Create Account, rename and the last screen', async () => {
    const userData = newUserData();
    const app = await launchApp(userData);
    const page = await app.firstWindow();
    await page.getByLabel('Server address:').fill(SERVER);
    await page.getByLabel('Server address:').blur();
    await page.getByLabel('Password:').fill(PASSWORD);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByRole('button', { name: /Open an existing budget/ }).click();
    await page
      .getByRole('row', { name: new RegExp(FIXTURE_NAMES.typical) })
      .first()
      .click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const tree = page.getByRole('tree', { name: 'Accounts' });
    await expect(tree).toBeVisible({ timeout: 180_000 });

    // The badges equal the fixture's error counts.
    for (const [name, { count }] of Object.entries(TYPICAL_ATTENTION)) {
      await expect(account(page, name)).toHaveAccessibleName(
        new RegExp(`There (is|are) ${String(count)} transactions? that requires? your attention`),
      );
    }
    await expect(account(page, 'Savings')).not.toHaveAccessibleName(/attention/);
    expect(await groupNames(page, 'Budget Accounts')).toEqual([
      'Checking',
      'Savings',
      'Visa',
      'Cash',
    ]);
    expect(await groupNames(page, 'Off-Budget Accounts')).toEqual(['Mortgage', '401k']);

    /** Drags an account past the 11 px threshold to a point (08 §4), once the canvas has slid in. */
    async function drag(name: string, to: Locator): Promise<void> {
      const from = await settledBox(account(page, name));
      const target = await settledBox(to);
      await page.mouse.move(from.x + 40, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + from.height / 2 + 15, { steps: 3 });
      await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 10 });
      await page.mouse.up();
    }

    // A drop on another group's header changes nothing (08 §4).
    await drag('Savings', page.getByRole('treeitem', { name: /^Off-Budget Accounts/ }));
    expect(await groupNames(page, 'Off-Budget Accounts')).toEqual(['Mortgage', '401k']);
    // A drop on Checking moves Savings to the top of Budget Accounts.
    await drag('Savings', account(page, 'Checking'));
    await expect
      .poll(() => groupNames(page, 'Budget Accounts'))
      .toEqual(['Savings', 'Checking', 'Visa', 'Cash']);
    // The order reached the server, and Savings is still on budget.
    await expect
      .poll(
        () =>
          (JSON.parse(serverFixture('accounts', cloudFileId)) as ServerAccount[])
            .filter((a) => !a.offbudget && !a.closed)
            .map((a) => a.name),
        { timeout: 60_000, intervals: [2_000] },
      )
      .toEqual(['Savings', 'Checking', 'Visa', 'Cash']);

    // 22 §2.4: Alt+↓ moves the focused account inside its group.
    await account(page, 'Checking').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect
      .poll(() => groupNames(page, 'Budget Accounts'))
      .toEqual(['Savings', 'Visa', 'Checking', 'Cash']);
    await expect(account(page, 'Checking')).toBeFocused();

    // Create Account opens the new account's register; a balance owed is typed negative.
    await page.getByRole('button', { name: 'Add Account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a New Account' });
    await dialog.getByLabel('Name:').fill('E2E Card');
    await dialog.getByLabel('Balance:', { exact: true }).fill('-500');
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Card' })).toBeVisible();
    await expect(account(page, 'E2E Card')).toHaveAccessibleName(/-\$?500\.00/);
    await expect(account(page, 'E2E Card')).toHaveAttribute('aria-selected', 'true');

    // The account header renames in place (13 §3).
    await page.getByRole('button', { name: 'Rename account' }).click();
    await page.getByRole('textbox', { name: 'Account name' }).fill('E2E Visa');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Visa' })).toBeVisible();
    await expect(account(page, 'E2E Visa')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Rename account' })).toBeFocused();

    // F6 cycles the sidebar and the panel, back to each region's last focused item (22 §2.1).
    await page.evaluate(() => {
      (globalThis as unknown as PageGlobals).document.activeElement?.blur();
    });
    await page.keyboard.press('F6');
    await expect(
      page.getByRole('navigation', { name: 'Accounts and budget' }).locator(':focus'),
    ).toHaveCount(1);
    await page.keyboard.press('F6');
    await expect(page.locator('main.panel:focus-within')).toHaveCount(1);

    const staySignedIn = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).app.shell.secrets.available(),
    );
    await app.close();

    // A restart reopens the budget on the last screen.
    // eslint-disable-next-line playwright/no-conditional-in-test -- the token is stored only with secure storage
    if (!staySignedIn) return;
    const again = await launchApp(userData);
    const page2 = await again.firstWindow();
    await expect(page2.getByRole('heading', { level: 1, name: 'E2E Visa' })).toBeVisible({
      timeout: 180_000,
    });
    await expect(account(page2, 'E2E Visa')).toHaveAttribute('aria-selected', 'true');
    await again.close();
  });
});
