// Print (16 §3, §4 criterion 4) against the built app: File ▸ Print… on the Budget and
// Register screens, and the active report, opens the "Print Preview" window, and its PDF isn't empty. The menu command is sent
// the way the native menu sends it. Needs a test server: see tests/int/README.md.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

/** File ▸ Print… as the native menu sends it; resolves with the preview's PDF size in bytes. */
async function printPdfSize(app: ElectronApplication): Promise<number> {
  const preview = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    main?.webContents.send('shell:menuCommand', 'file.print');
  });
  const page = await preview;
  await page.waitForLoadState('load');
  await expect(page.locator('#pp-print')).toBeVisible();
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Print Preview');
    if (!win) return 0;
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    win.close();
    return pdf.length;
  });
}

test.describe('print preview (16 §3)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('prints the Budget, a register and a report to a non-empty PDF', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1400, height: 900 });
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);

      // A screen shown for the first time is busy until it has loaded; navigation waits for it (06 §3).
      const settled = () =>
        expect(page.locator('.panel-host[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });

      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click({ timeout: 180_000 });
      await expect(page.locator('[data-month-header]').first()).toBeVisible({ timeout: 60_000 });
      await settled();
      expect(await printPdfSize(app)).toBeGreaterThan(1000);

      await page.getByRole('treeitem', { name: /^Savings\s*,/ }).click();
      await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
      await settled();
      expect(await printPdfSize(app)).toBeGreaterThan(1000);

      // Reports prints its active report: Spending Breakdown's chart and table (15 §7).
      await page.getByRole('treeitem', { name: 'Reports', exact: true }).click();
      await page.getByRole('tab', { name: 'Spending Breakdown' }).click();
      await expect(page.getByRole('table', { name: /^Spending by/ })).toBeVisible({
        timeout: 60_000,
      });
      expect(await printPdfSize(app)).toBeGreaterThan(1000);
    } finally {
      await app.close();
      // Every spec opens the fixture by name: its copy must not outlive the test.
      serverFixture('delete', cloudFileId);
    }
  });
});
