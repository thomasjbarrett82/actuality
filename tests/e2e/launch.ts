import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShellApi } from '../../src/shared/shell-api';

/** A fresh, throwaway userData folder. */
export const newUserData = (): string => mkdtempSync(join(tmpdir(), 'actual-desktop-e2e-'));

/** Launches the built app, with a fresh userData folder unless one is given (a restart). */
export async function launchApp(userData = newUserData()): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, ACTUAL_DESKTOP_E2E: '1' },
  });
}

/**
 * The page globals the specs use inside `page.evaluate`, typed by hand: the E2E specs compile without the
 * DOM lib, like the rest of the Node project. Use as `globalThis as unknown as PageGlobals`.
 */
export interface PageGlobals {
  app: { shell: ShellApi };
  document: {
    activeElement: { blur: () => void } | null;
    documentElement: object;
    querySelector: (selector: string) => object | null;
  };
  getComputedStyle: (el: object) => {
    backgroundColor: string;
    getPropertyValue: (name: string) => string;
  };
}

const root = join(import.meta.dirname, '../..');

/** Runs the fixture helper (server-fixture.ts) with tsx; returns its last output line. */
export function serverFixture(...args: string[]): string {
  const out = execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      'tsconfig.node.json',
      'tests/e2e/server-fixture.ts',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', timeout: 180_000 },
  );
  return out.trim().split(/\r?\n/).at(-1) ?? '';
}

/** From a fresh install: connects to the server and opens a budget from the Budget List. */
export async function connectAndOpen(
  page: Page,
  server: string,
  password: string,
  budget: string,
): Promise<void> {
  await page.getByLabel('Server address:').fill(server);
  await page.getByLabel('Server address:').blur();
  await page.getByLabel('Password:').fill(password);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: /Open an existing budget/ }).click();
  await page
    .getByRole('row', { name: new RegExp(budget) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
}
