// Electron main process (02 §1): app lifecycle, the window, shell services for the renderer, settings and
// secrets, and the API host's supervisor. It holds no budget data. It is main's composition root: the
// logging aspects are woven here (02 §8.5).
import { APP_ID, APP_NAME } from '@shared/app';
import { isDebug, setDebug } from '@shared/aspects/level';
import { describeError } from '@shared/aspects/log-entry';
import { step, weaveSteps } from '@shared/aspects/steps';
import { advise, announce } from '@shared/aspects/weave';
import { availableLocales, resolveLocale } from '@shared/i18n/locales';
import { createTranslator } from '@shared/i18n/translate';
import {
  appSettingsPatchSchema,
  budgetSettingsPatchSchema,
  RENDERER_WRITABLE_APP_KEYS,
} from '@shared/settings';
import {
  INITIAL_MENU_STATE,
  IPC,
  type ContextMenuItem,
  type MenuState,
  type SettingsChangeEvent,
} from '@shared/shell-api';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
  app,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appInfo, licensesPath } from './about';
import {
  chatterAspect,
  controlAspect,
  failureAspect,
  lifecycleAspect,
  shellAspect,
  stepAspect,
  warningAspect,
} from './aspects/logging';
import {
  chooseFolder,
  openFile,
  openFolder,
  saveFile,
  saveSampleImport,
  showInFolder,
} from './dialogs';
import { handleControl, isSafeExternalUrl, type ControlContext } from './host-control';
import { HostSupervisor, type HostLifecycle } from './host-supervisor';
import { initLog, toLogEntry, write, writeLog } from './log';
import { applyDebugLogging } from './log-level';
import { buildMenu } from './menu';
import { registerPrintHandlers, showPreview } from './print';
import { SecretsStore } from './secrets';
import { SettingsStore } from './settings-store';
import { backgroundColor, boundsToSave, createMainWindow } from './window';

app.setName(APP_NAME);
// Windows groups the taskbar button and notifications by this id; it matches electron-builder's appId.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// A second launch focuses the existing window (06 §1).
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

let win: BrowserWindow | null = null;

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// The error boundary: one handler per process (02 §8.2). The monitor leaves Electron's own handling as is.
process.on('uncaughtExceptionMonitor', (e) => {
  write('error', 'main.uncaughtException', describeError(e, isDebug()));
});
process.on('unhandledRejection', (e) => {
  write('error', 'main.unhandledRejection', describeError(e, isDebug()));
});
weaveSteps('main', [stepAspect]);

type Facts = Record<string, string | number | boolean>;
const lifecycle = (name: string): ((facts: Facts) => void) =>
  announce(name, 'main', [lifecycleAspect]);
const hostLifecycle: Record<HostLifecycle, (facts: Facts) => void> = {
  'host.start': lifecycle('host.start'),
  'host.stdout': announce('host.stdout', 'main', [chatterAspect]),
  'host.stderr': announce('host.stderr', 'main', [warningAspect]),
  'host.exit': announce('host.exit', 'main', [failureAspect]),
};

/** `ipcMain.handle`, woven: each `shell.*` handler is a join point (02 §8.2). */
function handle(
  channel: string,
  listener: (e: IpcMainInvokeEvent, ...args: never[]) => unknown,
): void {
  ipcMain.handle(
    channel,
    advise(
      listener as (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
      {
        name: channel,
        process: 'main',
        args: (args) => args.slice(1),
      },
      [shellAspect],
    ),
  );
}

function contextMenuTemplate(
  items: ContextMenuItem[],
  choose: (id: string) => void,
): MenuItemConstructorOptions[] {
  return items.map((i) =>
    i.label === undefined
      ? { type: 'separator' }
      : {
          label: i.label,
          enabled: i.enabled ?? true,
          ...(i.toolTip === undefined ? {} : { toolTip: i.toolTip }),
          ...(i.checked === undefined ? {} : { type: 'checkbox' as const, checked: i.checked }),
          ...(i.submenu
            ? { submenu: contextMenuTemplate(i.submenu, choose) }
            : {
                click: () => {
                  choose(i.id);
                },
              }),
        },
  );
}

function start(): void {
  const userData = app.getPath('userData');
  initLog(join(userData, 'logs'));
  const settings = new SettingsStore(userData);
  const secrets = new SecretsStore(userData, safeStorage);
  const initial = settings.getApp();
  setDebug(initial.debugLogging);
  lifecycle('app.start')({
    app: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    debug: initial.debugLogging,
  });
  nativeTheme.themeSource = initial.appearance;

  const mainWindow = createMainWindow(initial);
  win = mainWindow;
  const webContents = (): Electron.WebContents | null =>
    mainWindow.isDestroyed() ? null : mainWindow.webContents;

  /** Main's own UI text, in the UI language (20 §3.4). */
  const translate = (key: string, params?: Record<string, string>): string =>
    createTranslator(
      resolveLocale(
        settings.getApp().language,
        app.getPreferredSystemLanguages(),
        availableLocales(),
      ),
    )(key, params);

  const hostStatus = lifecycle('host.status');
  const control: ControlContext = {
    settings,
    secrets,
    openExternal: (url) => shell.openExternal(url),
    focusWindow: () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    },
    translate,
  };
  const supervisor = new HostSupervisor({
    userData,
    extraCaCertPath: initial.extraCaCertPath,
    webContents,
    onStatus: (status) => {
      hostStatus({ status });
    },
    onHostLog: (entry) => {
      const e = toLogEntry(entry, 'host');
      if (e) writeLog(e);
    },
    onLifecycle: (event, facts) => {
      hostLifecycle[event](facts);
    },
    serveControl: advise(
      (method: string, params: unknown) => handleControl(control, method, params),
      { name: ([method]) => method, process: 'main' },
      [controlAspect],
    ),
    control,
  });
  supervisor.start();

  // ------------------------------------------------------------------------------ zoom
  const applyZoom = (factor: number): void => {
    const clamped = Math.round(Math.min(2, Math.max(0.8, factor)) * 10) / 10;
    webContents()?.setZoomFactor(clamped);
    if (settings.getApp().zoomFactor !== clamped) settings.patchApp({ zoomFactor: clamped });
  };

  // ------------------------------------------------------------------------------ quit (06 §5)
  let quitConfirmed = false;
  let quitting = false;
  // Whether the loaded page listens for close requests. A page that failed to load (or is still
  // loading) never answers, so the window would refuse to close.
  let closeHandled = false;
  ipcMain.on(IPC.closeHandler, (_e, on: unknown) => {
    closeHandled = on === true;
  });
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) closeHandled = false;
  });
  mainWindow.webContents.on('render-process-gone', () => {
    closeHandled = false;
  });
  // Window close = quit (06 §1). The renderer runs its checks first (open edit, unsynced changes),
  // then calls shell.quit(); main then saves the window, lets the host shut down, and quits.
  const requestQuit = (): void => {
    const wc = webContents();
    if (wc && !wc.isCrashed() && closeHandled) wc.send(IPC.closeRequested);
    else void finishQuit();
  };
  // Each step may fail; the app quits regardless, or the window could never close again.
  const finishQuit = async (): Promise<void> => {
    if (quitting) return;
    quitting = true;
    quitConfirmed = true;
    lifecycle('app.quit')({});
    try {
      step('quit: save the window bounds', () => {
        if (mainWindow.isDestroyed()) return;
        const bounds = boundsToSave(mainWindow);
        if (bounds) settings.patchApp({ window: bounds });
      });
    } catch {
      // Logged by the step; the app quits regardless.
    }
    await step('quit: stop the API host', () => supervisor.stop()).catch(() => undefined);
    try {
      step('quit: clear the offline cache', () => {
        if (!settings.getApp().clearCacheOnExit || supervisor.unsyncedChanges) return;
        // The same cleanup as Clear Offline Cache (03 §2, 06 §5 step 4).
        rmSync(join(userData, 'actual-cache'), { recursive: true, force: true });
        settings.patchAllBudgets({ localId: null, lastSyncAt: null });
      });
    } catch {
      // Logged by the step.
    }
    app.quit();
  };
  mainWindow.on('close', (e) => {
    if (quitConfirmed) return;
    e.preventDefault();
    requestQuit();
  });

  // ------------------------------------------------------------------------------ menu (06 §4)
  let menuState: MenuState = INITIAL_MENU_STATE;
  const systemLanguages = app.getPreferredSystemLanguages();
  const rebuildMenu = (): void => {
    Menu.setApplicationMenu(
      buildMenu({
        platform: process.platform,
        settings: settings.getApp(),
        state: menuState,
        dev: !app.isPackaged,
        systemLanguages,
        send: (command) => webContents()?.send(IPC.menuCommand, command),
        setSetting: (patch) => {
          settings.patchApp(patch);
        },
        zoom: applyZoom,
        showLogsFolder: () => void shell.openPath(join(userData, 'logs')),
        openUrl: (url) => void shell.openExternal(url),
        quit: requestQuit,
      }),
    );
  };
  rebuildMenu();

  // The window background follows the palette, so a resize or reload never flashes the other one (05 §1.9).
  nativeTheme.on('updated', () => {
    if (!mainWindow.isDestroyed()) mainWindow.setBackgroundColor(backgroundColor());
  });

  // Settings changes reach the renderer; appearance and language also update main's own UI, and debug
  // logging every process's log level (02 §8.3).
  const logLevel = {
    sendToHost: (level: { debug: boolean }) => {
      supervisor.notify('log:level', level);
    },
    onSwitch: lifecycle('log.level'),
  };
  settings.onChange((change) => {
    webContents()?.send(IPC.settingsChanged, change satisfies SettingsChangeEvent);
    if (change.scope === 'app') {
      nativeTheme.themeSource = change.settings.appearance;
      applyDebugLogging(change.settings.debugLogging, logLevel);
      rebuildMenu();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    webContents()?.setZoomFactor(settings.getApp().zoomFactor);
    supervisor.connectRenderer();
    webContents()?.send(IPC.hostStatus, supervisor.hostStatus);
  });
  mainWindow.on('focus', () => {
    supervisor.notify('window:focus', {});
  });

  // ------------------------------------------------------------------------------ shell services (02 §4)
  // Renderer log entries (02 §8.1): one-way; main drops debug ones while debug logging is off.
  ipcMain.on(IPC.log, (_e, entry: unknown) => {
    const e = toLogEntry(entry, 'renderer');
    if (e) writeLog(e);
  });
  handle(IPC.settingsGet, () => settings.getApp());
  handle(IPC.settingsSet, (_e, key: unknown, value: unknown) => {
    if (
      typeof key !== 'string' ||
      !(RENDERER_WRITABLE_APP_KEYS as readonly string[]).includes(key)
    ) {
      throw new Error(`The setting ${String(key)} can't be changed here.`);
    }
    return settings.patchApp(appSettingsPatchSchema.parse({ [key]: value }));
  });
  handle(IPC.settingsGetBudget, (_e, id: unknown) => settings.getBudget(String(id)));
  handle(IPC.settingsPatchBudget, (_e, id: unknown, patch: unknown) => {
    // The host owns localId and lastSyncAt; the renderer only changes its own view state (19 §2).
    const allowed = budgetSettingsPatchSchema.parse(patch);
    delete allowed.localId;
    delete allowed.lastSyncAt;
    delete allowed.schemaVersion;
    return settings.patchBudget(String(id), allowed);
  });
  handle(IPC.secretsAvailable, () => secrets.available());
  handle(IPC.secretsHas, (_e, key: unknown) => secrets.has(String(key)));
  handle(IPC.secretsForget, (_e, key: unknown) => {
    secrets.delete(String(key));
  });
  handle(IPC.systemLanguages, () => systemLanguages);
  handle(IPC.setTitle, (_e, title: unknown) => {
    if (typeof title === 'string') mainWindow.setTitle(title);
  });
  ipcMain.on(IPC.setMenuState, (_e, state: MenuState) => {
    menuState = { ...INITIAL_MENU_STATE, ...state };
    rebuildMenu();
  });
  handle(IPC.showContextMenu, (_e, items: ContextMenuItem[]) => {
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null;
      Menu.buildFromTemplate(contextMenuTemplate(items, (id) => (chosen = id))).popup({
        window: mainWindow,
        callback: () => {
          resolve(chosen);
        },
      });
    });
  });
  handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !isSafeExternalUrl(url))
      throw new Error('Only http and https links can be opened.');
    await shell.openExternal(url);
  });
  handle(IPC.showLogsFolder, async () => {
    await shell.openPath(join(userData, 'logs'));
  });
  handle(IPC.appInfo, () => appInfo(app.getVersion(), existsSync(licensesPath())));
  handle(IPC.openLicenses, async () => {
    const error = await shell.openPath(licensesPath());
    if (error) throw new Error(error);
  });
  const cacheFolder = join(userData, 'actual-cache');
  handle(IPC.cacheFolder, () => cacheFolder);
  handle(IPC.showCacheFolder, async () => {
    await shell.openPath(cacheFolder);
  });
  // The CA file becomes NODE_EXTRA_CA_CERTS for the API host at its next start (02 §6).
  handle(IPC.chooseCertificateFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: translate('app.certificateFiles'), extensions: ['pem', 'crt', 'cer'] }],
    });
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    settings.patchApp({ extraCaCertPath: path });
    return path;
  });
  handle(IPC.removeCertificateFile, () => {
    settings.patchApp({ extraCaCertPath: null });
  });
  handle(IPC.relaunch, async () => {
    // Under `npm run dev` the page comes from electron-vite's dev server, which stops when this process
    // exits: a relaunched copy would show a blank window. Quit instead; start `npm run dev` again.
    if (!process.env['ELECTRON_RENDERER_URL']) app.relaunch();
    await finishQuit();
  });
  handle(IPC.setZoom, (_e, factor: unknown) => {
    if (typeof factor === 'number') applyZoom(factor);
  });
  handle(IPC.quit, () => finishQuit());

  // Files and print (16 §1–3).
  const filters = (v: unknown): { name: string; extensions: string[] }[] =>
    Array.isArray(v)
      ? v.flatMap((f: { name?: unknown; extensions?: unknown }) =>
          typeof f.name === 'string' && Array.isArray(f.extensions)
            ? [{ name: f.name, extensions: f.extensions.map(String) }]
            : [],
        )
      : [];
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const exportFolder = (): string => settings.getApp().lastExportFolder ?? app.getPath('documents');
  handle(IPC.openFile, (_e, o: { title?: unknown; filters?: unknown }) =>
    openFile(mainWindow, { title: str(o.title), filters: filters(o.filters) }),
  );
  handle(
    IPC.saveFile,
    (_e, o: { title?: unknown; defaultName?: unknown; folder?: unknown; filters?: unknown }) =>
      saveFile(mainWindow, {
        title: str(o.title),
        defaultPath: join(str(o.folder) || exportFolder(), str(o.defaultName)),
        filters: filters(o.filters),
      }),
  );
  handle(IPC.defaultPath, (_e, name: unknown) => join(exportFolder(), str(name)));
  handle(IPC.chooseExportFolder, async (_e, title: unknown) => {
    const folder = await chooseFolder(mainWindow, {
      title: str(title),
      defaultPath: exportFolder(),
    });
    if (folder) settings.patchApp({ lastExportFolder: folder });
    return folder;
  });
  handle(IPC.openFolder, (_e, path: unknown) => openFolder(str(path)));
  handle(IPC.showInFolder, (_e, path: unknown) => {
    showInFolder(str(path));
  });
  handle(IPC.saveSampleImport, (_e, title: unknown) =>
    saveSampleImport(mainWindow, str(title), app.getPath('desktop')),
  );
  registerPrintHandlers();
  handle(IPC.printPreview, (_e, doc: { html?: unknown; pdfName?: unknown }) =>
    showPreview(
      mainWindow,
      str(doc.html),
      str(doc.pdfName) || 'print.pdf',
      {
        title: translate('app.printPreviewTitle'),
        print: translate('app.printPreviewPrint'),
        savePdf: translate('app.printPreviewSavePdf'),
        pdfFilter: translate('app.printPreviewPdfFilter'),
      },
      join(import.meta.dirname, '../preload/print-preview.cjs'),
    ),
  );
}

if (primary) {
  void app.whenReady().then(start);
  app.on('window-all-closed', () => {
    app.quit();
  });
}
