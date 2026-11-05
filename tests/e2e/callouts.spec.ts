// Critical journey 9 (21 §3; 17 §3 "Placement rules"): in the default window and at 200 % zoom, the
// register Timeframe callout opens below its button, lies inside the viewport with its title and Done
// visible, and scrolls its body when the list is taller than the room.
// Needs a test server: see tests/int/README.md.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { connectAndOpen, launchApp, newUserData, serverFixture, type PageGlobals } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';

async function setZoom(page: Page, factor: number): Promise<void> {
  await page.evaluate(async (f) => {
    await (globalThis as unknown as PageGlobals).app.shell.setZoom(f);
  }, factor);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The page globals used here, typed by hand (the E2E specs compile without the DOM lib). */
interface ViewportGlobals {
  innerWidth: number;
  innerHeight: number;
}

const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

/** Opens the callout from `button` and lists what breaks the placement rules. */
async function check(page: Page, button: Locator, where: string): Promise<string[]> {
  const out: string[] = [];
  await button.click();
  const callout = page.locator('.callout');
  await expect(callout).toBeVisible();
  // Let autoUpdate settle the position.
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await callout.boundingBox());
      const still = box === last;
      last = box;
      return still;
    })
    .toBe(true);
  const viewport = await page.evaluate(() => {
    const g = globalThis as unknown as ViewportGlobals;
    return { x: 0, y: 0, width: g.innerWidth, height: g.innerHeight };
  });
  const panel = await callout.boundingBox();
  const anchor = await button.boundingBox();
  const title = await callout.locator('.callout__title').boundingBox();
  const done = await callout.getByRole('button', { name: 'Done' }).boundingBox();
  if (!panel || !anchor) return [`${where}: not rendered`];
  if (panel.y < anchor.y + anchor.height - 1) out.push(`${where}: opens above its button`);
  if (!inside(panel, viewport)) out.push(`${where}: outside the viewport ${JSON.stringify(panel)}`);
  if (!title || !inside(title, panel)) out.push(`${where}: title cut off`);
  if (!done || !inside(done, panel)) out.push(`${where}: Done cut off`);
  // A list taller than the room scrolls inside the callout (17 §3 rule 3).
  const overflowing = await callout.evaluate((el) => {
    const e = el as unknown as { scrollHeight: number; clientHeight: number };
    return e.scrollHeight > e.clientHeight + 1;
  });
  if (overflowing) out.push(`${where}: content overflows the panel`);
  await page.keyboard.press('Escape');
  await expect(callout).toHaveCount(0);
  return out;
}

test.describe('callouts stay inside the window (21 §3 journey 9)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('the register Timeframe opens below, inside the viewport', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    const problems: string[] = [];
    try {
      const page = await app.firstWindow();
      await connectAndOpen(page, SERVER, PASSWORD, FIXTURE_NAMES.typical);
      const checking = page.getByRole('treeitem', { name: /^Checking\s*,/ });
      await expect(checking).toBeVisible({ timeout: 180_000 });

      for (const zoom of [1, 2]) {
        await setZoom(page, zoom);
        await checking.click();
        await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
        const dates = page.getByRole('button', { name: 'All Dates' });
        problems.push(...(await check(page, dates, `Register Timeframe ${String(zoom)}x`)));
      }
      await setZoom(page, 1);
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
    expect(problems).toEqual([]);
  });
});
