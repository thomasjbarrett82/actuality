// The amount calculator wherever a money field opens it (09 §5.4): its keys, OK and Esc act on the calculator
// alone, and it closes once the user moves on, leaving whatever holds the field open. Needs a test server:
// see tests/int/README.md.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

/** Runs `body` with the typical budget open, then cleans up. */
async function withBudget(
  body: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const cloudFileId = (
    JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
  ).cloudFileId;
  const app = await launchApp(newUserData());
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
    await expect(page.getByRole('tree')).toBeVisible({ timeout: 180_000 });
    await body(page, app);
  } finally {
    await app.close();
    serverFixture('delete', cloudFileId);
  }
}

/** The same checks for every host. `elsewhere` is inside `holder`, out of the calculator's way. */
async function exercise(
  page: Page,
  holder: Locator,
  field: Locator,
  elsewhere: Locator,
): Promise<void> {
  const calculator = page.getByRole('dialog', { name: 'Calculator' });
  const open = async (): Promise<void> => {
    await field.click();
    await page.keyboard.press('+');
    await expect(calculator).toBeVisible();
  };

  await field.fill('25');
  await page.keyboard.press('+');
  await expect(calculator).toBeVisible();

  await test.step('clicking its keys keeps it and the holder open', async () => {
    await calculator.getByRole('button', { name: '7', exact: true }).click();
    await expect(calculator).toBeVisible();
    await expect(holder).toBeVisible();
    await expect(calculator.getByRole('status')).toHaveText('7');
  });

  await test.step('Enter on its focus puts the result in the field, holder still open', async () => {
    await calculator.focus();
    await page.keyboard.press('Enter');
    await expect(calculator).toBeHidden();
    await expect(holder).toBeVisible();
    await expect(field).toHaveValue('32.00');
    await expect(field).toBeFocused();
  });

  await test.step('OK does the same', async () => {
    await open();
    await calculator.getByRole('button', { name: '1', exact: true }).click();
    await calculator.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(calculator).toBeHidden();
    await expect(holder).toBeVisible();
    await expect(field).toHaveValue('33.00');
  });

  await test.step('Esc closes only the calculator', async () => {
    await open();
    await page.keyboard.press('Escape');
    await expect(calculator).toBeHidden();
    await expect(holder).toBeVisible();
    await expect(field).toHaveValue('33.00');
    await expect(field).toBeFocused();
  });

  await test.step('a click in the field closes it and keeps focus there', async () => {
    await open();
    await field.click();
    await expect(calculator).toBeHidden();
    await expect(field).toBeFocused();
  });

  await test.step('a click elsewhere in the holder closes it and discards the calculation', async () => {
    await open();
    await calculator.getByRole('button', { name: '9', exact: true }).click();
    await elsewhere.click();
    await expect(calculator).toBeHidden();
    await expect(holder).toBeVisible();
    await expect(field).toHaveValue('33.00');
  });
}

test.describe('the amount calculator in each host', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  /** A new transaction's editor on Savings, with the Date calendar closed (11 §1 step 4). */
  async function newTransaction(page: Page): Promise<Locator> {
    await page.getByRole('treeitem', { name: /^Savings\s*,/ }).click();
    await expect(page.getByRole('heading', { name: 'Savings', level: 1 })).toBeFocused();
    await page.keyboard.press('Control+n');
    await expect(page.locator('[data-editor] [data-field="date"] input')).toBeFocused();
    await page.keyboard.press('Escape');
    return page.locator('[data-editor]');
  }

  test('in the register editor (11 §2)', async () => {
    await withBudget(async (page) => {
      const editor = await newTransaction(page);
      await expect(editor).toBeVisible();
      await exercise(
        page,
        editor,
        editor.locator('[data-field="outflow"] input'),
        editor.locator('[data-field="notes"] input'),
      );
    });
  });

  test('in the Schedule dialog (12 §1)', async () => {
    await withBudget(async (page) => {
      // Ctrl+Shift+Enter saves the new transaction, then Make recurring… on it (11 §9).
      const editor = await newTransaction(page);
      await editor.locator('[data-field="outflow"] input').fill('10');
      await editor.locator('[data-field="notes"] input').click();
      await page.keyboard.press('Control+Shift+Enter');
      const dialog = page.locator('.std-dialog');
      await expect(dialog).toBeVisible();
      await exercise(
        page,
        dialog,
        dialog.locator('[data-field="amount"] input'),
        dialog.locator('.std-dialog__title'),
      );
    });
  });

  test('in the rule editor (23 §3)', async () => {
    await withBudget(async (page, app) => {
      // The native accelerator (Ctrl+U) sends this command; Playwright's keys don't reach the menu.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('shell:menuCommand', 'view.goRules');
      });
      await page
        .getByRole('dialog', { name: 'Rules' })
        .getByRole('button', { name: 'Create a New Rule' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'New Rule' });
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-condition] select').first().selectOption('amount');
      await exercise(
        page,
        dialog,
        dialog.locator('[data-condition] .rule-value__money input').first(),
        dialog.locator('.std-dialog__title'),
      );
    });
  });

  test('in the Hold for next month callout (09 §5.5)', async () => {
    await withBudget(async (page, app) => {
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click();
      const header = page.locator('[data-month-header]').first();
      await expect(header).toBeVisible({ timeout: 60_000 });
      // The month menu is native (09 §5.5), so main's handler is replaced to pick the item.
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('shell:showContextMenu');
        ipcMain.handle('shell:showContextMenu', () => 'hold');
      });
      await header.getByRole('button', { name: 'Quick Budget' }).click();
      const callout = page.locator('.callout');
      await expect(callout).toBeVisible();
      await exercise(page, callout, callout.locator('input'), callout.locator('.callout__title'));

      // Outside the callout, it closes as well (17 §3), without holding anything.
      await callout.locator('input').click();
      await page.keyboard.press('+');
      const calculator = page.getByRole('dialog', { name: 'Calculator' });
      await expect(calculator).toBeVisible();
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click();
      await expect(calculator).toBeHidden();
      await expect(callout).toBeHidden();
    });
  });
});
