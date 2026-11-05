// Critical journey 1 (21 §3): connect to the server, pick the fixture from the server's
// budgets and open it on the main canvas, then the Budget screen's numbers for 3 months, which must equal
// `getBudgetMonth` (09 §9 criterion 1). It also checks the palettes and a shortcut on the Welcome panel,
// and a restart that signs in with the stored token. Needs a test server: see tests/int/README.md.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { APP_NAME } from '../../src/shared/app';
import { DEFAULT_MONEY_SETTINGS, format } from '../../src/shared/money';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, type PageGlobals } from './launch';

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

test.describe('journey 1: connect and open a budget', () => {
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

  test('connects, lists the server’s budgets and opens the fixture', async () => {
    const userData = newUserData();
    const app = await launchApp(userData);
    const page = await app.firstWindow();

    // A fresh install starts on Connect (07 §1).
    await expect(
      page.getByRole('heading', { name: 'Connect to your Actual Budget server' }),
    ).toBeVisible();
    await page.getByLabel('Server address:').fill(SERVER);
    await page.getByLabel('Server address:').blur();
    await page.getByLabel('Password:').fill(PASSWORD);
    await page.getByRole('button', { name: 'Connect' }).click();

    // No recent budgets yet: the two large buttons (07 §3.1).
    await page.getByRole('button', { name: /Open an existing budget/ }).click();
    await expect(page.getByRole('heading', { name: 'Open Budget' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(FIXTURE_NAMES.typical) }).first();
    await row.click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    // Loading, then the main canvas with the Welcome panel and the budget in the title (06 §1).
    await expect(
      page.getByText('Select Budget, Reports or an account on the left to get started.'),
    ).toBeVisible({ timeout: 180_000 });
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()))
      .toBe(`${APP_NAME} - ${FIXTURE_NAMES.typical}`);

    // File ▸ Open: the open budget is the only recent one, so Open Budget shows (07 §3.2); Back returns.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('shell:menuCommand', 'file.open');
    });
    await expect(page.getByRole('heading', { name: 'Open Budget' })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      page.getByText('Select Budget, Reports or an account on the left to get started.'),
    ).toBeVisible();

    // The Welcome panel's tokens in all four palettes, switched live from the settings.
    const html = page.locator('html');
    const seen = new Set<string>();
    for (const [appearance, colorVision, theme, cvd] of PALETTES) {
      await page.evaluate(
        async ([a, c]) => {
          const { settings } = (globalThis as unknown as PageGlobals).app.shell;
          await settings.set('appearance', a);
          await settings.set('colorVision', c);
        },
        [appearance, colorVision] as const,
      );
      await expect(html).toHaveAttribute('data-theme', theme);
      await expect(html).toHaveAttribute('data-cvd', cvd);
      seen.add(
        await page.evaluate(() => {
          const { document, getComputedStyle } = globalThis as unknown as PageGlobals;
          const welcome = document.querySelector('.welcome');
          return [
            welcome ? getComputedStyle(welcome).backgroundColor : 'no Welcome panel',
            getComputedStyle(document.documentElement).getPropertyValue('--money-negative').trim(),
          ].join(' ');
        }),
      );
    }
    expect(seen.size).toBe(PALETTES.length);

    // A shortcut through the keyboard dispatcher. F6 cycles the regions: the sidebar's
    // tree, then the panel (22 §2.1).
    await page.evaluate(() => {
      (globalThis as unknown as PageGlobals).document.activeElement?.blur();
    });
    await page.keyboard.press('F6');
    await expect(page.getByRole('treeitem', { name: 'Budget', exact: true })).toBeFocused();
    await page.keyboard.press('F6');
    await expect(page.locator('main.panel:focus-within')).toHaveCount(1);

    const staySignedIn = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).app.shell.secrets.available(),
    );
    await app.close();

    // A restart: settings survive it, and the host reads the stored token from main's secrets store
    // to sign in and reopen the last budget without the password (07 §1).
    // eslint-disable-next-line playwright/no-conditional-in-test -- the token is stored only with secure storage
    if (!staySignedIn) return;
    const again = await launchApp(userData);
    const page2 = await again.firstWindow();
    await expect(
      page2.getByText('Select Budget, Reports or an account on the left to get started.'),
    ).toBeVisible({ timeout: 180_000 });
    await expect(page2.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page2.locator('html')).toHaveAttribute('data-cvd', 'on');
    await again.close();
  });

  test('shows Actual’s numbers on the Budget screen (09 §9 criterion 1)', async () => {
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1400, height: 900 });
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click({ timeout: 180_000 });
      await expect(page.locator('[data-month-header]')).toHaveCount(3, { timeout: 60_000 });
      await expectActualNumbers(page, cloudFileId);
    } finally {
      await app.close();
    }
  });
});

const money = (m: number): string => format(m, DEFAULT_MONEY_SETTINGS);

/**
 * Every number of the visible months equals Actual's (09 §9 criterion 1): Available to Budget, the totals
 * row, and each category's Budgeted, Outflows and Balance. A 0 Outflows or Balance may show blank.
 */
async function expectActualNumbers(page: Page, cloudFileId: string): Promise<void> {
  const headers = page.locator('[data-month-header]');
  const months: string[] = [];
  for (let i = 0; i < (await headers.count()); i++)
    months.push((await headers.nth(i).getAttribute('data-month-header')) ?? '');
  const raw = JSON.parse(serverFixture('months', cloudFileId, months.join(','))) as {
    toBudget: number;
    totalBudgeted: number;
    totalSpent: number;
    totalBalance: number;
    categoryGroups: { is_income?: boolean; categories?: Record<string, unknown>[] }[];
  }[];
  for (const [i, m] of months.entries()) {
    const r = raw[i];
    if (!r) throw new Error(`no data for ${m}`);
    const header = page.locator(`[data-month-header="${m}"]`);
    await expect(header).toContainText(money(r.toBudget));
    const totals = page.locator('.budget-grid__totals-cell').nth(i);
    await expect(totals).toContainText(money(-r.totalBudgeted));
    await expect(totals).toContainText(money(r.totalSpent));
    await expect(totals).toContainText(money(r.totalBalance));
    for (const c of r.categoryGroups
      .filter((g) => g.is_income !== true)
      .flatMap((g) => g.categories ?? [])) {
      const name = page.locator(`[data-budget-name="c:${String(c['id'])}"]`);
      if ((await name.count()) === 0) continue; // hidden, or in a collapsed group
      const cells = (
        await name
          .locator('xpath=ancestor::*[@data-row-index][1]')
          .locator('.budget-grid__month')
          .nth(i)
          .locator('xpath=./*')
          .allTextContents()
      ).map((x) => x.trim());
      const [budgeted, outflows, balance] = cells;
      const n = (key: string): number => (c[key] as number | undefined) ?? 0;
      expect(budgeted, `${m} ${String(c['id'])} budgeted`).toBe(
        n('budgeted') === 0 ? '' : money(n('budgeted')),
      );
      const spent = n('spent');
      expect([spent === 0 ? '' : null, spent > 0 ? `+${money(spent)}` : money(spent)]).toContain(
        outflows,
      );
      const bal = n('balance');
      expect([bal === 0 ? '' : null, money(bal)]).toContain(balance);
    }
  }
}

/** appearance, colorVision → data-theme, data-cvd (05 §1.9). */
const PALETTES = [
  ['light', 'standard', 'light', 'off'],
  ['dark', 'standard', 'dark', 'off'],
  ['light', 'cvd', 'light', 'on'],
  ['dark', 'cvd', 'dark', 'on'],
] as const;
