// Critical journey 10 (21 §3; 15): Reports opens from the sidebar and from the menu item bound to Ctrl+R,
// on Summary with its heading focused. A linked filter changed on one page shows on another; a saved
// filter loaded on a page isolates it from the linked filters until Use linked filters adopts them again;
// Spending Comparison's Compare Period is a draft of its own that never moves the linked Timeframe.
// Playwright's key presses don't reach Electron's native menu accelerators, so the test finds the item in
// the live application menu by its `CmdOrCtrl+R` accelerator and clicks it: that covers the binding the
// built app ships, short of the OS keypress itself. Needs a test server: see tests/int/README.md.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

/** Clicks the enabled application-menu item bound to `accelerator`; returns its label, or null if none. */
async function clickAccelerator(
  app: ElectronApplication,
  accelerator: string,
): Promise<string | null> {
  return app.evaluate(({ BrowserWindow, Menu }, acc) => {
    type Item = Electron.MenuItem;
    const find = (items: readonly Item[]): Item | undefined => {
      for (const item of items) {
        if (item.accelerator === acc) return item;
        const inner = item.submenu ? find(item.submenu.items) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item?.enabled) return null;
    const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    // Electron types `click` as `Function`; it takes the event, the window and its webContents.
    const click = item.click as (event: unknown, window: unknown, contents: unknown) => void;
    click(undefined, main, main?.webContents);
    return item.label;
  }, accelerator);
}

async function expectSummary(page: Page): Promise<void> {
  const main = page.getByRole('main', { name: 'Reports' });
  await expect(main.getByRole('heading', { name: 'Reports', level: 1 })).toBeFocused({
    timeout: 10_000,
  });
  await expect(main.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('heading', { name: 'Total Inflow' })).toBeVisible({
    timeout: 60_000,
  });
}

const timeframe = (page: Page) => page.getByRole('button', { name: /^Timeframe: / });

async function pickTimeframe(page: Page, preset: string): Promise<void> {
  await timeframe(page).click();
  await page.getByRole('radio', { name: preset }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(timeframe(page)).toHaveAccessibleName(`Timeframe: ${preset}`);
}

test.describe('Reports (21 §3 journey 10)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('opens on Summary, links filters, and isolates a saved filter until relinked', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      await page
        .getByRole('treeitem', { name: 'Reports', exact: true })
        .click({ timeout: 180_000 });
      await expectSummary(page);

      // A linked filter changed on Summary shows on Inflow vs Outflow.
      await pickTimeframe(page, 'This Year');
      await page.getByRole('tab', { name: 'Inflow vs Outflow' }).click();
      await expect(timeframe(page)).toHaveAccessibleName('Timeframe: This Year');
      await expect(page.getByRole('table', { name: 'Inflow vs Outflow' })).toBeVisible({
        timeout: 60_000,
      });

      // Save it, move the linked filters on, then load the saved filter: only this page changes.
      await page.getByRole('button', { name: 'Saved Filters' }).click();
      await page.getByRole('button', { name: 'Save Current Filters…' }).click();
      await page.getByRole('textbox', { name: 'Name' }).fill('Year');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await pickTimeframe(page, 'Last Year');
      await page.getByRole('button', { name: 'Saved Filters' }).click();
      await page.getByRole('group', { name: 'Year' }).getByRole('button', { name: 'Load' }).click();
      await expect(timeframe(page)).toHaveAccessibleName('Timeframe: This Year');
      await page.getByRole('tab', { name: 'Summary' }).click();
      await expect(timeframe(page)).toHaveAccessibleName('Timeframe: Last Year');
      await page.getByRole('tab', { name: 'Inflow vs Outflow' }).click();
      await page.getByRole('button', { name: 'Use linked filters' }).click();
      await expect(timeframe(page)).toHaveAccessibleName('Timeframe: Last Year');

      // Spending Comparison has its own Compare Period, a draft that Cancel discards and Done commits;
      // it doesn't move the linked Timeframe.
      await page.getByRole('tab', { name: 'Spending Comparison' }).click();
      await expect(timeframe(page)).toHaveCount(0);
      const compare = page.getByRole('button', { name: /^Compare Period: / });
      await expect(compare).toHaveAccessibleName(/^Compare Period: This Month \(\w+ \d{4}\)$/);
      await compare.click();
      await page.getByRole('radio', { name: 'Quarter' }).click();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(compare).toHaveAccessibleName(/^Compare Period: This Month /);
      await compare.click();
      await page.getByRole('radio', { name: 'Quarter' }).click();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(compare).toHaveAccessibleName(/^Compare Period: This Quarter \(Q\d \d{4}\)$/);
      await expect(page.getByRole('heading', { name: 'Spending comparison' })).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole('tab', { name: 'Summary' }).click();
      await expect(timeframe(page)).toHaveAccessibleName('Timeframe: Last Year');

      // Ctrl+R comes back to Reports from a register, with its heading focused.
      await page.getByRole('treeitem', { name: /^Checking\s*,/ }).click();
      await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.panel-host[aria-busy="true"]')).toHaveCount(0, {
        timeout: 60_000,
      });
      expect(await clickAccelerator(app, 'CmdOrCtrl+R')).toBe('Go to Reports');
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeFocused({
        timeout: 10_000,
      });
    } finally {
      await app.close();
      // Every spec opens the fixture by name: its copy must not outlive the test.
      serverFixture('delete', cloudFileId);
    }
  });
});
