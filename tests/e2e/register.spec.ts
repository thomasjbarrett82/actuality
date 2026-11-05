// The register against the built app: keyboard-only entry of five transactions, and the
// register's performance targets with the 20,000-transaction fixture (21 §5: open < 1.5 s, search < 200 ms
// per keystroke after its 100 ms debounce, scrolling at 60 fps). Needs a test server: see tests/int/README.md.
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_NAMES, LARGE_TRANSACTIONS } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

const account = (page: Page, name: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^${name}\\s*,`) });

test.describe('register', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('enters five transactions with the keyboard only (10 §9)', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      await expect(account(page, 'Savings')).toBeVisible({ timeout: 180_000 });
      await account(page, 'Savings').click();
      await expect(page.getByRole('heading', { name: 'Savings', level: 1 })).toBeFocused();

      // Ctrl+N opens a new transaction's editor on Date; Tab moves through Payee, Category, Notes, Outflow;
      // Enter presses "Save and add another", which opens the next one on Date (11 §1, §2, §6).
      await page.keyboard.press('Control+n');
      const entries = [
        ['Keyboard Payee 1', 'Groceries', 'one', '1.11'],
        ['Keyboard Payee 2', 'Fuel', 'two', '2.22'],
        ['Keyboard Payee 3', 'Groceries', 'three', '3.33'],
        ['Keyboard Payee 4', 'Fuel', 'four', '4.44'],
        ['Keyboard Payee 5', 'Groceries', 'five', '5.55'],
      ];
      for (const [payee, category, notes, amount] of entries) {
        await expect(page.locator('[data-editor] [data-field="date"] input')).toBeFocused();
        await page.keyboard.press('Tab');
        await page.keyboard.type(payee ?? '');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Tab');
        await page.keyboard.type(category ?? '');
        await page.keyboard.press('Tab');
        await page.keyboard.type(notes ?? '');
        await page.keyboard.press('Tab');
        await page.keyboard.type(amount ?? '');
        await page.keyboard.press('Enter');
      }
      await expect(page.locator('[data-editor] [data-field="date"] input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-editor]')).toHaveCount(0);

      // All five are in the register, with their categories and amounts.
      await page.keyboard.press('Control+f');
      await page.keyboard.type('Keyboard Payee');
      await expect(page.getByText('Showing 5 results for "Keyboard Payee"')).toBeVisible();
      for (const [payee, category, notes, amount] of entries) {
        const row = page.locator('[data-row-id]').filter({ hasText: payee ?? '' });
        await expect(row).toContainText(`: ${category ?? ''}`);
        await expect(row).toContainText(notes ?? '');
        await expect(row).toContainText(amount ?? '');
      }
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
  });

  test('meets the performance targets with 20,000 transactions (21 §5)', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'large.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    try {
      const page = await app.firstWindow();
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.large);
      await expect(account(page, 'Checking')).toBeVisible({ timeout: 180_000 });

      // Opening: from the click to the rows on screen. The panel's loading illustration stays for at least
      // 1 s the first time a screen shows (06 §2), so this times the register's data and render directly.
      const opened = await page.evaluate(async () => {
        const start = performance.now();
        const doc = globalThis as unknown as {
          document: {
            querySelectorAll: (s: string) => Iterable<{
              textContent: string | null;
              parentElement: { click: () => void } | null;
            }>;
            querySelector: (s: string) => unknown;
          };
          requestAnimationFrame: (cb: () => void) => void;
        };
        [...doc.document.querySelectorAll('.row__label--account')]
          .find((l) => l.textContent === 'Checking')
          ?.parentElement?.click();
        for (;;) {
          if (doc.document.querySelector('[data-row-id]')) return performance.now() - start;
          await new Promise<void>((r) => {
            doc.requestAnimationFrame(r);
          });
        }
      });
      test.info().annotations.push({
        type: 'timing',
        description: `register open: ${opened.toFixed(0)} ms`,
      });
      expect(opened).toBeLessThan(1500);
      await expect(page.getByRole('treegrid', { name: 'Transactions' })).toHaveAttribute(
        'aria-rowcount',
        String(LARGE_TRANSACTIONS + 1),
      );

      // Searching: a keystroke to the filtered count, minus the 100 ms debounce.
      const search = page.getByRole('combobox', { name: 'Search Checking' });
      await search.click();
      await search.pressSequentially('Store ');
      await expect(page.getByText(/^Showing \d+ results for "Store"/)).toBeVisible();
      const start = Date.now();
      await search.press('A');
      await expect(
        page.getByText(`Showing ${String(LARGE_TRANSACTIONS / 5)} results for "Store A"`),
      ).toBeVisible();
      const searched = Date.now() - start - 100;
      test.info().annotations.push({
        type: 'timing',
        description: `search keystroke: ${String(searched)} ms after the debounce`,
      });
      expect(searched).toBeLessThan(150);
      // The first Esc closes the suggestions, the second clears the search (10 §3).
      await search.press('Escape');
      await search.press('Escape');
      await expect(page.locator('.info-bar')).toHaveCount(0);

      // Scrolling: frame times while the grid scrolls through the list.
      const frames = await page.evaluate(async () => {
        const g = globalThis as unknown as {
          document: {
            querySelector: (s: string) => { scrollTop: number; scrollHeight: number } | null;
          };
          requestAnimationFrame: (cb: (t: number) => void) => void;
        };
        const scroller = g.document.querySelector('.reg-grid__scroller');
        if (!scroller) return [];
        scroller.scrollTop = 0;
        const times: number[] = [];
        let last = 0;
        await new Promise<void>((done) => {
          const step = (t: number): void => {
            if (last) times.push(t - last);
            last = t;
            scroller.scrollTop += 120;
            if (times.length >= 180) done();
            else g.requestAnimationFrame(step);
          };
          g.requestAnimationFrame(step);
        });
        return times;
      });
      const sorted = [...frames].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      test.info().annotations.push({
        type: 'timing',
        description: `scroll frames: median ${median.toFixed(1)} ms, p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)} ms`,
      });
      // 60 fps is a 16.7 ms frame; allow the timer's jitter.
      expect(median).toBeLessThan(20);
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
  });
});
