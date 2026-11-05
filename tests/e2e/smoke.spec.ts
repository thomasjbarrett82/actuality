import { expect, test, type ElectronApplication } from '@playwright/test';
import { APP_NAME } from '../../src/shared/app';
import { launchApp } from './launch';

/** The API host's process id, from Electron's process list (`02` §1: a utilityProcess named "API host"). */
async function hostPid(app: ElectronApplication): Promise<number | null> {
  return app.evaluate(({ app: electronApp }) => {
    const host = electronApp
      .getAppMetrics()
      .find((m) => m.type === 'Utility' && m.name === 'API host');
    return host?.pid ?? null;
  });
}

test('the main window opens with the sandboxed renderer @smoke', async () => {
  const app = await launchApp();
  const errors: string[] = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#app')).toBeAttached();
  const hasNode = await page.evaluate(
    () => typeof (globalThis as { require?: unknown }).require !== 'undefined',
  );
  expect(hasNode).toBe(false);
  // A fresh install starts on the Connect screen (07 §1), and main titles the window (06 §1).
  await expect(
    page.getByRole('heading', { name: 'Connect to your Actual Budget server' }),
  ).toBeVisible();
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()))
    .toBe(APP_NAME);
  expect(errors).toEqual([]);
  await app.close();
});

test('? opens Keyboard Shortcuts outside a text field, and Esc closes it (06 §6.1) @smoke', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  await expect(
    page.getByRole('heading', { name: 'Connect to your Actual Budget server' }),
  ).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  // In the server field, ? is just typed.
  const field = page.getByRole('textbox').first();
  await field.focus();
  await page.keyboard.press('?');
  await expect(dialog).toBeHidden();
  await field.blur();
  await page.keyboard.press('?');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Register' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await app.close();
});

test('a renderer call round-trips to the API host, and a killed host restarts (02 §4, 03 §6.5) @smoke', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  const html = page.locator('html');
  // session.state answered through the MessagePort main brokered.
  await expect(html).toHaveAttribute('data-host-ready', 'true');
  const first = await hostPid(app);
  expect(first).not.toBeNull();

  process.kill(first ?? 0);
  await expect.poll(() => hostPid(app), { timeout: 15_000 }).not.toBe(first);
  await expect.poll(() => hostPid(app)).not.toBeNull();
  await expect(html).toHaveAttribute('data-host-status', 'running');
  await expect(html).toHaveAttribute('data-host-ready', 'true', { timeout: 15_000 });
  await app.close();
});

/** Closes the main window as the title bar's X does, and resolves once the app process has exited. */
async function closeWindowAndWait(app: ElectronApplication): Promise<void> {
  const exited = new Promise<void>((resolve) =>
    app.process().once('exit', () => {
      resolve();
    }),
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await exited;
}

test('closing the window quits the app (06 §5) @smoke', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('data-host-ready', 'true');
  await closeWindowAndWait(app);
});

test('the window still closes when the page never loaded the app (06 §5) @smoke', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('data-host-ready', 'true');
  // Like a dev-server page that is gone: nothing answers main's close request.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.loadURL('data:text/html,<p>blank</p>'),
  );
  await closeWindowAndWait(app);
});
