// Preload (sandboxed): exposes `window.app.shell` (main services) and forwards the API host's MessagePort
// to the page (02 §4). contextBridge can't carry a MessagePort, so the port is transferred to the main
// world with window.postMessage, as Electron recommends.
import type { AppSettings, RendererWritableAppKey } from '@shared/settings';
import {
  HOST_PORT_MESSAGE,
  IPC,
  type ContextMenuItem,
  type HostStatus,
  type MenuCommand,
  type MenuState,
  type RendererBudgetPatch,
  type SettingsChangeEvent,
  type ShellApi,
} from '@shared/shell-api';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Main sends each channel the value its listener expects (shell-api.ts IPC), so the value is passed through.
function subscribe(channel: string, listener: (value: never) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: unknown): void => {
    listener(value as never);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let closeListeners = 0;

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const shell: ShellApi = {
  platform: process.platform as ShellApi['platform'],
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: <K extends RendererWritableAppKey>(key: K, value: AppSettings[K]) =>
      invoke(IPC.settingsSet, key, value),
    getBudget: (cloudFileId: string) => invoke(IPC.settingsGetBudget, cloudFileId),
    patchBudget: (cloudFileId: string, patch: RendererBudgetPatch) =>
      invoke(IPC.settingsPatchBudget, cloudFileId, patch),
    onChange: (listener: (change: SettingsChangeEvent) => void) =>
      subscribe(IPC.settingsChanged, listener),
  },
  secrets: {
    available: () => invoke(IPC.secretsAvailable),
    has: (key: string) => invoke(IPC.secretsHas, key),
    forget: (key: string) => invoke(IPC.secretsForget, key),
  },
  systemLanguages: () => invoke(IPC.systemLanguages),
  setTitle: (title: string) => invoke(IPC.setTitle, title),
  setMenuState: (state: MenuState) => {
    ipcRenderer.send(IPC.setMenuState, state);
  },
  showContextMenu: (items: ContextMenuItem[]) => invoke(IPC.showContextMenu, items),
  openExternal: (url: string) => invoke(IPC.openExternal, url),
  showLogsFolder: () => invoke(IPC.showLogsFolder),
  appInfo: () => invoke(IPC.appInfo),
  openLicenses: () => invoke(IPC.openLicenses),
  cacheFolder: () => invoke(IPC.cacheFolder),
  showCacheFolder: () => invoke(IPC.showCacheFolder),
  chooseCertificateFile: () => invoke(IPC.chooseCertificateFile),
  removeCertificateFile: () => invoke(IPC.removeCertificateFile),
  relaunch: () => invoke(IPC.relaunch),
  setZoom: (factor: number) => invoke(IPC.setZoom, factor),
  log: (entry) => {
    ipcRenderer.send(IPC.log, entry);
  },
  files: {
    openFile: (opts) => invoke(IPC.openFile, opts),
    saveFile: (opts) => invoke(IPC.saveFile, opts),
    defaultPath: (name: string) => invoke(IPC.defaultPath, name),
    chooseExportFolder: (title: string) => invoke(IPC.chooseExportFolder, title),
    openFolder: (path: string) => invoke(IPC.openFolder, path),
    showInFolder: (path: string) => invoke(IPC.showInFolder, path),
    saveSampleImport: (title: string) => invoke(IPC.saveSampleImport, title),
  },
  printPreview: (doc) => invoke(IPC.printPreview, doc),
  onMenuCommand: (listener: (command: MenuCommand) => void) => subscribe(IPC.menuCommand, listener),
  onHostStatus: (listener: (status: HostStatus) => void) => subscribe(IPC.hostStatus, listener),
  // Main asks the page before closing only while it listens (06 §5).
  onCloseRequested: (listener: () => void) => {
    const unsubscribe = subscribe(IPC.closeRequested, listener);
    closeListeners += 1;
    ipcRenderer.send(IPC.closeHandler, true);
    return () => {
      unsubscribe();
      closeListeners -= 1;
      ipcRenderer.send(IPC.closeHandler, closeListeners > 0);
    };
  },
  quit: () => invoke(IPC.quit),
};

contextBridge.exposeInMainWorld('app', { shell });

ipcRenderer.on(IPC.hostPort, (e) => {
  window.postMessage({ type: HOST_PORT_MESSAGE }, '*', e.ports);
});
