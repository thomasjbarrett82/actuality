// The main window (06 §1): one window, remembered bounds clamped to the visible displays, the palette's
// background color before first paint, and no navigation away from the app (02 §6).
import { APP_NAME } from '@shared/app';
import type { AppSettings } from '@shared/settings';
import { app, BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { join } from 'node:path';
import pngIcon from '../../resources/icons/png/actuality-icon-512.png?asset';
import icoIcon from '../../resources/icons/windows/actuality.ico?asset';

export const DEFAULT_SIZE = { width: 1020, height: 700 };
export const MIN_SIZE = { width: 800, height: 560 };
const MIN_SAVED = 125;

/** `--app-bg` per appearance (05 §1.1): the first screen is always a blue-canvas one. */
const APP_BG = { light: '#22779B', dark: '#17435A' };

export function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? APP_BG.dark : APP_BG.light;
}

/** Saved bounds if they still overlap a display, clamped to it; otherwise null (center the default). */
export function restoredBounds(
  saved: AppSettings['window'],
  displays: Rectangle[],
): Rectangle | null {
  if (!saved) return null;
  const width = Math.max(MIN_SIZE.width, saved.width);
  const height = Math.max(MIN_SIZE.height, saved.height);
  const area = displays.find(
    (d) =>
      saved.x < d.x + d.width &&
      saved.x + width > d.x &&
      saved.y < d.y + d.height &&
      saved.y + height > d.y,
  );
  if (!area) return null;
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - w);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - h);
  return { x, y, width: w, height: h };
}

/** The bounds to save, or null when they shouldn't be (minimized, or too small) (06 §1). */
export function boundsToSave(win: BrowserWindow): AppSettings['window'] {
  if (win.isMinimized()) return null;
  const b = win.getNormalBounds();
  if (b.width <= MIN_SAVED || b.height <= MIN_SAVED) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: win.isMaximized() };
}

/**
 * The window icon (05 §5). Linux windows always need it. Packaged Windows and macOS builds take it from the
 * app bundle, but unpackaged runs are the stock Electron binary and would show its icon.
 */
function windowIcon(): { icon?: string } {
  if (process.platform === 'linux') return { icon: pngIcon };
  if (process.platform === 'win32' && !app.isPackaged) return { icon: icoIcon };
  return {};
}

/**
 * Lays the native menu bar out again after the menu is rebuilt (06 §4). At fractional display scales the
 * rebuilt buttons are one device pixel taller than the bar, which leaves a step under the menu items. Hiding
 * and showing in one tick repeats the layout. A bar that is already hidden stays hidden (full screen), and
 * macOS has no bar on the window.
 */
export function relayoutMenuBar(win: BrowserWindow): void {
  if (process.platform === 'darwin' || win.isDestroyed() || !win.isMenuBarVisible()) return;
  win.setMenuBarVisibility(false);
  win.setMenuBarVisibility(true);
}

export function createMainWindow(settings: AppSettings): BrowserWindow {
  const bounds = restoredBounds(
    settings.window,
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const win = new BrowserWindow({
    ...(bounds ?? DEFAULT_SIZE),
    ...(bounds ? {} : { center: true }),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP_NAME,
    show: false,
    backgroundColor: backgroundColor(),
    ...windowIcon(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (settings.window?.isMaximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
  });

  // No new windows; external links open in the OS browser (http/https only) (02 §6).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!(devUrl && url.startsWith(devUrl)) && !url.startsWith('file:')) e.preventDefault();
  });
  // Main sets the title (06 §1); the page's <title> must not replace it.
  win.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}
