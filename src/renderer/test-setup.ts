// Component test setup (happy-dom): the vitest-axe matcher, the keyboard dispatcher, a stub of the
// preload bridge, a fresh Pinia per test, and unmounting after each test.
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import type { ShellApi } from '@shared/shell-api';
import { enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { keyboard } from './keyboard/dispatcher';

expect.extend(axeMatchers);
keyboard.install(window);
enableAutoUnmount(afterEach);

const noop = (): (() => void) => () => undefined;

export function stubShell(): ShellApi {
  return {
    platform: 'win32',
    settings: {
      get: vi.fn(() => Promise.resolve({ ...DEFAULT_APP_SETTINGS })),
      set: vi.fn(() => Promise.resolve({ ...DEFAULT_APP_SETTINGS })),
      getBudget: vi.fn(),
      patchBudget: vi.fn(),
      onChange: vi.fn(noop),
    },
    secrets: { available: vi.fn(), has: vi.fn(), forget: vi.fn() },
    systemLanguages: vi.fn(() => Promise.resolve(['en-US'])),
    setTitle: vi.fn(() => Promise.resolve()),
    setMenuState: vi.fn(),
    showContextMenu: vi.fn(() => Promise.resolve(null)),
    openExternal: vi.fn(() => Promise.resolve()),
    showLogsFolder: vi.fn(() => Promise.resolve()),
    appInfo: vi.fn(() =>
      Promise.resolve({
        version: '0.1.0',
        gitSha: 'abc1234',
        electron: '44.9.0',
        chromium: '140.0.0.0',
        node: '24.0.0',
        actualApi: '26.10.0',
        licenses: true,
      }),
    ),
    openLicenses: vi.fn(() => Promise.resolve()),
    cacheFolder: vi.fn(() => Promise.resolve('/user/actual-cache')),
    showCacheFolder: vi.fn(() => Promise.resolve()),
    chooseCertificateFile: vi.fn(() => Promise.resolve(null)),
    removeCertificateFile: vi.fn(() => Promise.resolve()),
    relaunch: vi.fn(() => Promise.resolve()),
    setZoom: vi.fn(() => Promise.resolve()),
    log: vi.fn(),
    files: {
      openFile: vi.fn(() => Promise.resolve(null)),
      saveFile: vi.fn(() => Promise.resolve(null)),
      defaultPath: vi.fn((name: string) => Promise.resolve(`/home/me/Documents/${name}`)),
      chooseExportFolder: vi.fn(() => Promise.resolve(null)),
      openFolder: vi.fn(() => Promise.resolve()),
      showInFolder: vi.fn(() => Promise.resolve()),
      saveSampleImport: vi.fn(() => Promise.resolve(null)),
    },
    printPreview: vi.fn(() => Promise.resolve()),
    onMenuCommand: vi.fn(noop),
    onHostStatus: vi.fn(noop),
    onCloseRequested: vi.fn(noop),
    quit: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'app', { value: { shell: stubShell() }, configurable: true });
  setActivePinia(createPinia());
  document.body.innerHTML = '';
});
