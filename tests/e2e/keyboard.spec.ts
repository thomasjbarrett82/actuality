// The keyboard-only versions of the journeys not covered by register.spec.ts and budget.spec.ts (22 §7):
// connect, open a budget, move between screens through the sidebar, and the slate wipe dialog.
// Every step uses the keyboard; only the menu commands (OS menu accelerators, which Playwright can't press)
// are sent from main. Needs a test server: see tests/int/README.md.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

/** Presses `key` until `target` has focus, so reachability is proved without a fixed key count. */
async function pressUntilFocused(
  page: Page,
  target: Locator,
  key: string,
  max: number,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    const focused = await expect(target)
      .toBeFocused({ timeout: 300 })
      .then(
        () => true,
        () => false,
      );
    if (focused) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

const tabTo = (page: Page, target: Locator): Promise<void> =>
  pressUntilFocused(page, target, 'Tab', 40);

test.describe('keyboard-only journeys (22 §7)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('connect, open a budget, change screens and cancel slate wipe', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();

      // Journey 1: Connect with Tab and Enter.
      const address = page.getByLabel('Server address:');
      await expect(address).toBeVisible({ timeout: 60_000 });
      await address.focus();
      await page.keyboard.type(SERVER);
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Password:')).toBeFocused();
      await page.keyboard.type(PASSWORD);
      await page.keyboard.press('Enter');

      await tabTo(page, page.getByRole('button', { name: /Open an existing budget/ }));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Open Budget' })).toBeVisible();

      // The list is a roving-tabindex grid: arrows pick the fixture, Enter opens it.
      const row = page.getByRole('row', { name: new RegExp(FIXTURE_NAMES.typical) }).first();
      await expect(row).toBeVisible();
      await tabTo(page, page.locator('.open__row[tabindex="0"]'));
      await page.keyboard.press('Home');
      await pressUntilFocused(page, row, 'ArrowDown', 20);
      await expect(row).toBeFocused();
      await page.keyboard.press('Enter');

      const budget = page.getByRole('treeitem', { name: 'Budget', exact: true });
      await expect(budget).toBeVisible({ timeout: 180_000 });

      // The sidebar: F6 enters it, arrows move, Enter opens the screen (22 §2.1).
      await page.evaluate(() => {
        (
          globalThis as unknown as { document: { activeElement?: { blur: () => void } } }
        ).document.activeElement?.blur();
      });
      await page.keyboard.press('F6');
      await expect(
        page.getByRole('navigation', { name: 'Accounts and budget' }).locator(':focus'),
      ).toHaveCount(1);
      await page.keyboard.press('Home');
      await expect(budget).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-month-header]').first()).toBeVisible({ timeout: 60_000 });
      await budget.focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('treeitem', { name: 'Reports', exact: true })).toBeFocused();
      // The Budget panel ignores navigation until its first load ends (06 §3), so redo the sidebar step
      // until it takes. Reports moves focus to its heading (22 §4.1).
      await expect(async () => {
        await budget.focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('treeitem', { name: 'Reports', exact: true })).toBeFocused({
          timeout: 1_000,
        });
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeFocused({
          timeout: 2_000,
        });
      }).toPass({ timeout: 60_000 });

      // Slate wipe: Alt reveals the cutoff, Tab stays inside the dialog and Esc cancels.
      await app.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
        main?.webContents.send('shell:menuCommand', 'file.slateWipe');
      });
      const dialog = page.getByRole('dialog', { name: 'Wipe the Slate Clean' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(/^Delete transactions before/)).toHaveCount(0);
      await page.keyboard.press('Alt');
      await expect(dialog.getByRole('combobox')).toBeVisible();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        await expect(dialog.locator(':focus')).toHaveCount(1);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
  });
});
