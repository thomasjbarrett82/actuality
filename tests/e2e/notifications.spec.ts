// Notifications (24) against the built app, without a server: on the Connect screen, with the test
// overrides for the update check and the news feed (24 §3.5, §4.2). Ordinary runs make no request at all.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, NEWS_FIXTURE, newUserData } from './launch';

const CONNECT = 'Connect to your Actual Budget server';

async function menuCommand(app: ElectronApplication, command: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, c) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    main?.webContents.send('shell:menuCommand', c);
  }, command);
}

/** The Help menu's labels, as main built them. */
async function helpItems(app: ElectronApplication): Promise<{ label: string; visible: boolean }[]> {
  return app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Help');
    return (help?.submenu?.items ?? []).map((i) => ({ label: i.label, visible: i.visible }));
  });
}

async function onConnect(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: CONNECT })).toBeVisible();
  return page;
}

test('the update toast shows once per version, is the last F6 region, and Esc closes it (24 §3.3, §5) @smoke', async () => {
  const userData = newUserData();
  let app = await launchApp(userData, { ACTUAL_DESKTOP_LATEST_VERSION: 'v99.9.9' });
  let page = await onConnect(app);
  const toasts = page.getByRole('region', { name: 'Messages' });
  await expect(toasts.getByText('A new version of Actuality is available')).toBeVisible();
  await expect(toasts.getByText('Version 99.9.9 of Actuality has been released.')).toBeVisible();
  // It never takes focus; F6 reaches it after the screen's own region.
  await expect(toasts.locator(':focus')).toHaveCount(0);
  const field = page.getByLabel('Server address:');
  await field.focus();
  await page.keyboard.press('F6');
  await expect(toasts.getByRole('button', { name: 'View release notes' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toasts).toBeHidden();
  await expect(field).toBeFocused();
  await app.close();

  // Closed for 99.9.9 on this device: it stays away after a restart.
  app = await launchApp(userData, { ACTUAL_DESKTOP_LATEST_VERSION: 'v99.9.9' });
  page = await onConnect(app);
  await expect(page.locator('html')).toHaveAttribute('data-host-ready', 'true');
  await expect(page.getByRole('region', { name: 'Messages' })).toBeHidden();
  await app.close();
});

test('makes no update or news request in an ordinary E2E run (24 §3.5) @smoke', async () => {
  const app = await launchApp();
  const page = await onConnect(app);
  await expect(page.locator('html')).toHaveAttribute('data-host-ready', 'true');
  await expect(page.getByRole('region', { name: 'Messages' })).toBeHidden();
  await menuCommand(app, 'help.notifications');
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.getByText("The latest news isn't available right now.")).toBeVisible({
    timeout: 10_000,
  });
  await app.close();
});

test("the what's new toast opens Notifications, which renders the feed (24 §4.6–4.7) @smoke", async () => {
  const userData = newUserData();
  // A device that has seen the news up to before the fixture's 0.0.1 release.
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, lastSeenNewsAt: '2026-10-01T00:00:00Z' }),
  );
  const app = await launchApp(userData, { ACTUAL_DESKTOP_NEWS_URL: NEWS_FIXTURE });
  const page = await onConnect(app);
  expect(await helpItems(app)).toContainEqual({ label: 'Notifications…', visible: true });

  const toasts = page.getByRole('region', { name: 'Messages' });
  await expect(toasts.getByText("What's new in Actuality 0.0.1")).toBeVisible();
  await toasts.getByRole('button', { name: "See what's new" }).click();
  await expect(toasts).toBeHidden();

  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
    'A fixture announcement',
    'Actuality 0.0.1',
  ]);
  await expect(dialog.getByText('Unread')).toHaveCount(2);
  await expect(dialog.getByRole('heading', { level: 4, name: 'A heading' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Show all changes' }).click();
  await expect(dialog.getByRole('heading', { level: 4, name: 'Features' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toBeHidden();

  // Opening it marked everything seen: it opens again without unread dots.
  await menuCommand(app, 'help.notifications');
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(2);
  await expect(dialog.getByText('Unread')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Turning the feed off hides Help ▸ Notifications… and stops the dialog opening.
  await page.evaluate(async () => {
    await (
      globalThis as unknown as {
        app: { shell: { settings: { set: (k: string, v: boolean) => Promise<unknown> } } };
      }
    ).app.shell.settings.set('showNewsFeed', false);
  });
  await expect
    .poll(async () => (await helpItems(app)).find((i) => i.label === 'Notifications…')?.visible)
    .toBe(false);
  await menuCommand(app, 'help.notifications');
  await expect(dialog).toBeHidden();
  await app.close();
});
