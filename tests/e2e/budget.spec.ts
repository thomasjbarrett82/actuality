// Critical journey 3 (21 §3) against the built app: edit a budget cell with the
// calculator, Tab through the cells, and fill empty cells with Quick Budget "Average outflows" after its
// confirmation. The month menu is native (09 §5.5), so main's context-menu handler is replaced to pick the
// item. Needs a test server: see tests/int/README.md.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

/** The row of a category, by name. */
const row = (page: Page, name: string) =>
  page.locator('[data-row-index]').filter({ has: page.getByRole('button', { name, exact: true }) });
/** A category's Budgeted cell in the first visible month. */
const budgetedCell = (page: Page, name: string) =>
  row(page, name).locator('[data-budget-cell="budgeted"]').first();
const editor = (page: Page) => page.locator('.budgeted__input');

/** Answers the next native context menu with `id` (the menu itself can't be driven). */
async function answerMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ ipcMain }, answer) => {
    ipcMain.removeHandler('shell:showContextMenu');
    ipcMain.handle('shell:showContextMenu', () => answer);
  }, id);
}

test.describe('journey 3: budget a month', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('edits with the calculator, tabs through cells and fills with Quick Budget', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1400, height: 900 });
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click({ timeout: 180_000 });
      await expect(budgetedCell(page, 'Groceries')).toHaveText('900.00', { timeout: 60_000 });
      const header = page.locator('[data-month-header]').first();
      const available = async (): Promise<string> =>
        (await header.locator('.month-header__value').textContent())?.trim() ?? '';
      const before = await available();

      // 100 + 50 in the calculator; OK commits 150.00 at once, so the header updates while the editor
      // is still open on the value. Enter then moves down.
      await budgetedCell(page, 'Groceries').click();
      await expect(editor(page)).toBeFocused();
      await page.keyboard.type('100');
      await page.keyboard.press('+');
      await expect(page.getByRole('dialog', { name: 'Calculator' })).toBeVisible();
      await page.keyboard.type('50');
      await page.keyboard.press('Enter');
      await expect(editor(page)).toHaveValue('150.00');
      await expect(editor(page)).toBeFocused();
      await expect.poll(available).not.toBe(before);
      await page.keyboard.press('Enter');
      await expect(budgetedCell(page, 'Groceries')).toHaveText('150.00');

      // The editor moved to the next category; Tab moves on, Shift+Tab back (09 §5.4).
      await expect(row(page, 'Birthdays').locator('.budgeted__input')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(row(page, 'Car Insurance').locator('.budgeted__input')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(row(page, 'Birthdays').locator('.budgeted__input')).toBeFocused();
      await page.keyboard.press('Escape');

      // Empty Restaurants, read its 3-month average from the per-cell list (F2), then fill from the menu.
      await budgetedCell(page, 'Restaurants').click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('0');
      await page.keyboard.press('Enter');
      await expect(budgetedCell(page, 'Restaurants')).toHaveText('');
      await budgetedCell(page, 'Restaurants').click();
      await page.keyboard.press('F2');
      const average = page.getByRole('option', { name: /Average outflows for last 3 months/ });
      const amount = ((await average.textContent()) ?? '').replace(/^.*months:/, '').trim();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await answerMenu(app, 'average3');
      await header.getByRole('button', { name: 'Quick Budget' }).click();
      await expect(
        page.getByText('Fill in empty budget cells with average outflows for the last 3 months?'),
      ).toBeVisible();
      await expect(page.getByText('This operation cannot be undone.')).toBeVisible();
      await page.getByRole('button', { name: 'Fill in empty budget cells' }).click();
      await expect(budgetedCell(page, 'Restaurants')).toHaveText(amount);
      // A cell that had an amount keeps it.
      await expect(budgetedCell(page, 'Groceries')).toHaveText('150.00');
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
  });
});
