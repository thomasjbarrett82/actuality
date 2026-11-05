// Rules against the built app (23 §6): View ▸ Go to Rules opens the list, a new rule is
// created and saved, and clicking it opens the editor ready to edit. Needs a test server: see
// tests/int/README.md.
import { expect, test } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

test.describe('rules', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('creates a rule, then opens it for editing (23 §2–3)', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const tag = String(Date.now());
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      await expect(page.getByRole('tree')).toBeVisible({ timeout: 180_000 });

      // The native accelerator (Ctrl+U) sends this command; Playwright's keys don't reach the menu.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('shell:menuCommand', 'view.goRules');
      });
      const list = page.getByRole('dialog', { name: 'Rules' });
      await expect(list).toBeVisible();
      await list.getByRole('button', { name: 'Create a New Rule' }).click();

      const editor = page.getByRole('dialog', { name: 'New Rule' });
      await expect(editor).toBeVisible();
      await editor.locator('[data-condition] input[data-rule-value]').fill(`E2E MERCHANT ${tag}`);
      await editor.locator('[data-action] select').selectOption('set:notes');
      await editor.locator('[data-action] input[data-rule-value]').fill('From e2e');
      await editor.getByRole('button', { name: 'Save' }).click();
      await expect(editor).toHaveCount(0);

      const row = list.getByRole('button', {
        name: `If imported payee contains "E2E MERCHANT ${tag}" then set notes to "From e2e"`,
      });
      await expect(row).toBeVisible();
      await row.click();
      const edit = page.getByRole('dialog', { name: 'Edit Rule' });
      await expect(edit).toBeVisible();
      const value = edit.locator('[data-condition] input[data-rule-value]');
      await expect(value).toHaveValue(`E2E MERCHANT ${tag}`);
      await expect(value).toBeEnabled();
      await value.fill(`E2E SHOP ${tag}`);
      await edit.getByRole('button', { name: 'Save' }).click();
      await expect(edit).toHaveCount(0);
      await expect(list.getByText(`If imported payee contains "E2E SHOP ${tag}"`)).toBeVisible();
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
  });
});
