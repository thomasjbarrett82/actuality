// The accessibility audit (22 §7, 21 §6) against the built app: axe-core at WCAG 2.2 A/AA on
// every screen and dialog of the journeys, in Light and Dark; at 200 % zoom, no horizontal page scroll and
// no control cut off outside the grids. Target size is axe-core's WCAG 2.5.8 rule (24 × 24 CSS px, or the
// spacing exception); boxes under 24 px are listed in the test's annotations for review (22 §7).
// axe-core runs inside the page through `evaluate`, so the renderer's CSP doesn't block it. Needs a test
// server: see tests/int/README.md.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_NAMES } from '../fixtures/fixture-facts';
import { launchApp, newUserData, serverFixture, type PageGlobals } from './launch';

const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';
const DIALOG = '[role="dialog"], [role="alertdialog"]';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface Violation {
  where: string;
  id: string;
  impact: string | null;
  nodes: string[];
}

interface AxeGlobals {
  axe?: {
    run: (
      context: unknown,
      options: unknown,
    ) => Promise<{
      violations: {
        id: string;
        impact: string | null;
        nodes: { target: unknown[]; failureSummary?: string; html: string }[];
      }[];
    }>;
  };
  document: unknown;
}

/** axe-core's WCAG 2.2 A/AA violations on the page as it is now. */
async function axeRun(page: Page, where: string, scope: string | null): Promise<Violation[]> {
  await page.evaluate(AXE);
  const found = await page.evaluate(async (within) => {
    const g = globalThis as unknown as AxeGlobals;
    if (!g.axe) return [];
    const result = await g.axe.run(within ?? g.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes
        .slice(0, 5)
        .map(
          (n) =>
            `${n.target.map(String).join(' ')} — ${(n.failureSummary ?? '').replace(/\s+/g, ' ')} — ${n.html.slice(0, 400)}`,
        ),
    }));
  }, scope);
  return found.map((v) => ({ where, ...v }));
}

async function setTheme(page: Page, appearance: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (a) => {
    await (globalThis as unknown as PageGlobals).app.shell.settings.set('appearance', a);
  }, appearance);
  await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
}

/**
 * axe in Light and Dark. A dialog is audited on its own (`scope`): the page behind its backdrop is
 * audited as a screen.
 */
async function audit(
  page: Page,
  where: string,
  into: Violation[],
  scope: string | null = null,
): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    into.push(...(await axeRun(page, `${where} (${theme})`, scope)));
  }
  await setTheme(page, 'light');
}

interface LayoutGlobals {
  innerWidth: number;
  document: {
    documentElement: { scrollWidth: number; clientWidth: number };
    querySelectorAll: (s: string) => ArrayLike<{
      getBoundingClientRect: () => { left: number; right: number; width: number; height: number };
      closest: (s: string) => unknown;
      checkVisibility?: () => boolean;
      outerHTML: string;
    }>;
  };
}

/** Horizontal page scroll, and controls cut off at the window's edges outside the grids (22 §7 Zoom). */
async function zoomProblems(page: Page, where: string): Promise<string[]> {
  // Screens slide in (350 ms): measure once the screen has stopped moving.
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await page.locator('.screen').first().boundingBox());
      const still = box === last;
      last = box;
      return still;
    })
    .toBe(true);
  const found = await page.evaluate(() => {
    const g = globalThis as unknown as LayoutGlobals;
    const out: string[] = [];
    const root = g.document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1)
      out.push(
        `page scrolls horizontally (${String(root.scrollWidth)} > ${String(root.clientWidth)})`,
      );
    for (const el of Array.from(g.document.querySelectorAll('button, input, select, a[href]'))) {
      if (el.checkVisibility && !el.checkVisibility()) continue;
      // Grids scroll horizontally at high zoom (22 §8, 1.4.10 exception).
      if (el.closest('[role="grid"], [role="treegrid"], .register, .budget-grid, table')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -1 || r.right > g.innerWidth + 1)
        out.push(
          `cut off (${String(Math.round(r.left))}–${String(Math.round(r.right))} of ${String(g.innerWidth)}): ${el.outerHTML.slice(0, 120)}`,
        );
    }
    return out;
  });
  return found.map((f) => `${where}: ${f}`);
}

/**
 * Clickable boxes under 24 × 24 CSS px at 100 %, for review: axe's target-size rule already fails those that
 * the WCAG 2.5.8 spacing exception doesn't cover.
 */
async function smallTargets(
  page: Page,
  where: string,
  scope: string | null = null,
): Promise<string[]> {
  const found = await page.evaluate((within) => {
    const g = globalThis as unknown as LayoutGlobals;
    const out: string[] = [];
    const selector =
      'button, a[href], [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], select';
    for (const el of Array.from(g.document.querySelectorAll(selector))) {
      if (el.checkVisibility && !el.checkVisibility()) continue;
      if (within && !el.closest(within)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Inline links in running text are exempt (2.5.8 "Inline").
      if (el.closest('p, li') && el.outerHTML.startsWith('<a')) continue;
      if (r.width < 23.5 || r.height < 23.5)
        out.push(
          `${String(Math.round(r.width))}×${String(Math.round(r.height))} ${el.outerHTML.slice(0, 120)}`,
        );
    }
    return out;
  }, scope);
  return found.map((f) => `${where}: ${f}`);
}

async function menuCommand(app: ElectronApplication, command: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, c) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    main?.webContents.send('shell:menuCommand', c);
  }, command);
}

async function setZoom(page: Page, factor: number): Promise<void> {
  await page.evaluate(async (f) => {
    await (globalThis as unknown as PageGlobals).app.shell.setZoom(f);
  }, factor);
}

test.describe('accessibility audit (22 §7)', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- runs only where a test server is configured
  test.skip(!SERVER || !PASSWORD, 'needs ACTUAL_TEST_SERVER_URL and ACTUAL_TEST_PASSWORD');
  test.setTimeout(300_000);

  test('every screen and dialog passes axe in Light and Dark, and reflows at 200 %', async () => {
    const cloudFileId = (
      JSON.parse(serverFixture('upload', 'typical.zip')) as { cloudFileId: string }
    ).cloudFileId;
    const app = await launchApp(newUserData());
    const violations: Violation[] = [];
    const layout: string[] = [];
    const targets: string[] = [];
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1280, height: 800 });
      // No transitions: axe would see colors mid-fade (the app honors reduced motion, 21 §6).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const settled = () =>
        expect(page.locator('.panel-host[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });

      // Blue-canvas screens.
      await expect(page.getByLabel('Server address:')).toBeVisible({ timeout: 60_000 });
      await audit(page, 'Connect', violations);
      targets.push(...(await smallTargets(page, 'Connect')));
      await page.getByLabel('Server address:').fill(SERVER);
      await page.getByLabel('Server address:').blur();
      await page.getByLabel('Password:').fill(PASSWORD);
      await page.getByRole('button', { name: 'Connect' }).click();
      await expect(page.getByRole('button', { name: /Open an existing budget/ })).toBeVisible({
        timeout: 60_000,
      });
      await audit(page, 'Budget List', violations);
      await page.getByRole('button', { name: /Open an existing budget/ }).click();
      await expect(
        page.getByRole('row', { name: new RegExp(FIXTURE_NAMES.typical) }).first(),
      ).toBeVisible();
      await audit(page, 'Open Budget', violations);
      targets.push(...(await smallTargets(page, 'Open Budget')));
      await page.getByRole('button', { name: 'Import a budget file…' }).click();
      await expect(page.locator(DIALOG)).toBeVisible();
      await audit(page, 'Import a budget file', violations, DIALOG);
      targets.push(...(await smallTargets(page, 'Import a budget file', DIALOG)));
      await page.keyboard.press('Escape');
      await expect(page.locator(DIALOG)).toHaveCount(0);
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('button', { name: /Open an existing budget/ }).click();
      await connectAndOpenFromList(page);

      // The main canvas.
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click({ timeout: 180_000 });
      await expect(page.locator('[data-month-header]').first()).toBeVisible({ timeout: 60_000 });
      await settled();
      await audit(page, 'Budget', violations);
      targets.push(...(await smallTargets(page, 'Budget')));

      // Dialogs, from the Budget screen (its File ▸ Export… is the TaskDialog).
      await menuCommand(app, 'help.about');
      await expect(page.getByRole('dialog', { name: /About/ })).toBeVisible();
      await audit(page, 'About', violations, DIALOG);
      await page.keyboard.press('Escape');
      await menuCommand(app, 'file.slateWipe');
      await expect(page.getByRole('dialog', { name: 'Wipe the Slate Clean' })).toBeVisible();
      await audit(page, 'Wipe the Slate Clean', violations, DIALOG);
      targets.push(...(await smallTargets(page, 'Wipe the Slate Clean', DIALOG)));
      await page.keyboard.press('Escape');
      await menuCommand(app, 'file.export');
      await expect(page.getByRole('dialog', { name: /Export/ })).toBeVisible();
      await audit(page, 'Export (TaskDialog)', violations, DIALOG);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add Account' }).click();
      await expect(page.getByRole('dialog', { name: 'Create a New Account' })).toBeVisible();
      await audit(page, 'Create a New Account', violations, DIALOG);
      targets.push(...(await smallTargets(page, 'Create a New Account', DIALOG)));
      await page.keyboard.press('Escape');
      await expect(page.locator(DIALOG)).toHaveCount(0);

      await page.getByRole('treeitem', { name: /^Checking\s*,/ }).click();
      await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });
      await settled();
      const toggle = page.getByRole('button', { name: /^Scheduled\s+Transactions/ });
      // A new device starts with the pane closed (12 §3).
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await audit(page, 'Register with the scheduler', violations);
      targets.push(...(await smallTargets(page, 'Register')));

      // Register dialogs: Reconcile, and Import Transactions with its file chosen through a stubbed
      // native dialog (the intro and the CSV mapping dialog).
      await page.getByRole('button', { name: /^Reconcile\s+Account/ }).click();
      // It opens on the date field with the calendar, a dialog of its own, so this audits both (11 §3).
      await expect(page.getByRole('dialog', { name: 'Reconcile Account' })).toBeVisible();
      await expect(page.locator('.calendar')).toBeVisible();
      await audit(page, 'Reconcile Account', violations, DIALOG);
      targets.push(...(await smallTargets(page, 'Reconcile Account', DIALOG)));
      // The first Esc closes the calendar, the second the dialog (22 §2.2).
      await page.keyboard.press('Escape');
      await expect(page.locator('.calendar')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator(DIALOG)).toHaveCount(0);
      const csv = join(mkdtempSync(join(tmpdir(), 'a11y-')), 'bank.csv');
      writeFileSync(
        csv,
        'Date,Payee,Amount\n2026-09-01,Corner Shop,-5.00\n2026-09-02,Cafe,-3.50\n',
      );
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
      }, csv);
      await menuCommand(app, 'file.importTransactions');
      await expect(page.locator(DIALOG)).toBeVisible();
      await audit(page, 'Import Transactions (intro)', violations, DIALOG);
      await page.getByRole('button', { name: 'Choose file to import...' }).click();
      await expect(page.locator(DIALOG).getByRole('button', { name: 'Import' })).toBeVisible({
        timeout: 30_000,
      });
      await audit(page, 'Import Transactions (mapping)', violations, DIALOG);
      targets.push(...(await smallTargets(page, 'Import Transactions (mapping)', DIALOG)));
      await page.keyboard.press('Escape');
      await expect(page.locator(DIALOG)).toHaveCount(0);

      await page.getByRole('treeitem', { name: 'Reports', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeFocused();
      await settled();
      // Every report tab, once its data has loaded (15 §8, 22 §7).
      for (const tab of [
        'Summary',
        'Spending Breakdown',
        'Spending Comparison',
        'Inflow vs Outflow',
        'Net Worth',
      ]) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.locator('#reports-tabpanel[aria-busy="true"]')).toHaveCount(0, {
          timeout: 60_000,
        });
        await expect(page.locator('#reports-tabpanel table').first()).toBeAttached({
          timeout: 60_000,
        });
        await audit(page, `Reports: ${tab}`, violations);
        targets.push(...(await smallTargets(page, `Reports: ${tab}`)));
      }
      await page.getByRole('tab', { name: 'Summary' }).click();

      // Zoom at 200 % (22 §7): Budget, the register with its scheduler, Reports, a blue-canvas screen and
      // a dialog, at the default window size.
      await setZoom(page, 2);
      await page.getByRole('treeitem', { name: 'Budget', exact: true }).click();
      await settled();
      layout.push(...(await zoomProblems(page, 'Budget 200%')));
      await page.getByRole('treeitem', { name: /^Checking\s*,/ }).click();
      await settled();
      layout.push(...(await zoomProblems(page, 'Register 200%')));
      await page.getByRole('treeitem', { name: 'Reports', exact: true }).click();
      await settled();
      layout.push(...(await zoomProblems(page, 'Reports 200%')));
      await menuCommand(app, 'help.about');
      await expect(page.getByRole('dialog', { name: /About/ })).toBeVisible();
      layout.push(...(await zoomProblems(page, 'About 200%')));
      await page.keyboard.press('Escape');
      await menuCommand(app, 'file.preferences');
      await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
      layout.push(...(await zoomProblems(page, 'Preferences 200%')));
      await setZoom(page, 1);
      await audit(page, 'Preferences', violations);
      targets.push(...(await smallTargets(page, 'Preferences')));
      await menuCommand(app, 'file.budgetProperties');
      await expect(
        page.getByRole('heading', { name: /Budget Properties|Budget Setup/ }),
      ).toBeVisible();
      await settled();
      await audit(page, 'Budget Properties', violations);
      targets.push(...(await smallTargets(page, 'Budget Properties')));
    } finally {
      await app.close();
      serverFixture('delete', cloudFileId);
    }
    expect(violations).toEqual([]);
    expect(layout).toEqual([]);
    test.info().annotations.push({
      type: 'targets under 24 px (spacing exception)',
      description: targets.join('; '),
    });
  });
});

/** Opens the fixture from the Open Budget screen. */
async function connectAndOpenFromList(page: Page): Promise<void> {
  await page
    .getByRole('row', { name: new RegExp(FIXTURE_NAMES.typical) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
}
