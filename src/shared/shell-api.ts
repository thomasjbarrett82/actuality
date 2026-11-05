// The renderer→main bridge, `window.app.shell` (02 §4): main-process services over ipcRenderer.invoke.
// Secrets are limited to available/has/forget: no value ever reaches the renderer (02 §4, 19 §4).
import type { LogEntry } from './aspects/log-entry';
import type {
  AppSettings,
  BudgetSettings,
  BudgetSettingsPatch,
  RendererWritableAppKey,
} from './settings';

/** Native menu command ids (06 §4). Clicks reach the renderer's command dispatcher. */
export const MENU_COMMANDS = [
  'file.newBudget',
  'file.open',
  'file.syncNow',
  'file.exportBackup',
  'file.slateWipe',
  'file.importTransactions',
  'file.budgetProperties',
  'file.export',
  'file.print',
  'file.closeBudget',
  'file.preferences',
  'edit.renameAccount',
  'edit.editAccountNote',
  'edit.closeAccount',
  'edit.reopenAccount',
  'view.goAccounts',
  'view.goBudget',
  'view.goReports',
  'view.goPayeeSettings',
  'view.goRules',
  'view.toggleSidebar',
  'help.keyboardShortcuts',
  'help.about',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

/** Enabled/visible state pushed by the renderer whenever it changes (06 §4). */
export interface MenuState {
  budgetOpen: boolean;
  canEdit: boolean;
  /** SignedIn: Create a New Budget is allowed without an open budget. */
  signedIn: boolean;
  /** The register shows a single account. */
  singleAccount: boolean;
  /** That account is closed: the Edit menu offers Re-open Account instead of Close Account. */
  accountClosed: boolean;
}

export const INITIAL_MENU_STATE: MenuState = {
  budgetOpen: false,
  canEdit: false,
  signedIn: false,
  singleAccount: false,
  accountClosed: false,
};

export interface ContextMenuItem {
  id: string;
  /** Already translated. Omit for a separator. */
  label?: string;
  enabled?: boolean;
  checked?: boolean;
  /** Shown for a disabled item where the OS supports it (macOS). Already translated. */
  toolTip?: string;
  submenu?: ContextMenuItem[];
}

/** A file dialog filter: a translated name and extensions without dots. */
/** What the About dialog shows (18 §1). */
export interface AppInfo {
  version: string;
  /** The short git commit the build was made from, or '' when unknown. */
  gitSha: string;
  electron: string;
  chromium: string;
  node: string;
  /** The bundled `@actual-app/api` version. */
  actualApi: string;
  /** Whether the bundled third-party license file exists (it's written by `npm run build`). */
  licenses: boolean;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** A print view for the preview window (16 §3): a whole HTML document, styled for paper. */
export interface PrintDocument {
  html: string;
  /** The default file name for Save as PDF…. */
  pdfName: string;
}

/** The API host's status, for the "Reconnecting…" banner and the crash-limit dialog (03 §6.5). */
export type HostStatus = 'running' | 'restarting' | 'failed';

export type SettingsChangeEvent =
  | { scope: 'app'; settings: AppSettings }
  | { scope: 'budget'; cloudFileId: string; settings: BudgetSettings | null };

/** Budget settings the renderer may change: everything except the host's keys. */
export type RendererBudgetPatch = Omit<
  BudgetSettingsPatch,
  'localId' | 'lastSyncAt' | 'schemaVersion'
>;

export interface ShellApi {
  readonly platform: 'win32' | 'darwin' | 'linux';
  settings: {
    get(): Promise<AppSettings>;
    set<K extends RendererWritableAppKey>(key: K, value: AppSettings[K]): Promise<AppSettings>;
    getBudget(cloudFileId: string): Promise<BudgetSettings>;
    patchBudget(cloudFileId: string, patch: RendererBudgetPatch): Promise<BudgetSettings>;
    onChange(listener: (change: SettingsChangeEvent) => void): () => void;
  };
  secrets: {
    available(): Promise<boolean>;
    has(key: string): Promise<boolean>;
    forget(key: string): Promise<void>;
  };
  /** The OS's preferred languages, for `language: 'system'` (20 §3.3). */
  systemLanguages(): Promise<string[]>;
  setTitle(title: string): Promise<void>;
  setMenuState(state: MenuState): void;
  /** Shows a native context menu; resolves with the chosen id, or null if dismissed. */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  showLogsFolder(): Promise<void>;
  /** Versions for the About dialog (18 §1). */
  appInfo(): Promise<AppInfo>;
  /** About ▸ View licenses: opens the bundled third-party license file (18 §1). */
  openLicenses(): Promise<void>;
  /** The offline cache folder, `{userData}/actual-cache` (07 §7). */
  cacheFolder(): Promise<string>;
  showCacheFolder(): Promise<void>;
  /**
   * Trust a certificate file… (07 §7, 03 §9.1): a file dialog, then `extraCaCertPath`. It takes effect
   * after a restart. Resolves with the chosen path, or null when cancelled.
   */
  chooseCertificateFile(): Promise<string | null>;
  removeCertificateFile(): Promise<void>;
  /** Restart now: quit (the renderer has run its checks) and start again. */
  relaunch(): Promise<void>;
  setZoom(factor: number): Promise<void>;
  /** Sends a renderer log entry to main, the only writer (02 §8.1). One-way: never awaited. */
  log(entry: Omit<LogEntry, 'source'>): void;
  /** File dialogs and folders (16 §1–3). Paths go to the API host, which reads and writes the files. */
  files: {
    openFile(opts: { title: string; filters: FileFilter[] }): Promise<string | null>;
    saveFile(opts: {
      title: string;
      defaultName: string;
      /** Default: the last export folder, else Documents. */
      folder?: string | null;
      filters: FileFilter[];
    }): Promise<string | null>;
    /** `name` in the default save folder (the last export folder, else Documents): slate wipe's backup. */
    defaultPath(name: string): Promise<string>;
    /** An export folder: default the last one used, else Documents (16 §2.1). Remembered. */
    chooseExportFolder(title: string): Promise<string | null>;
    openFolder(path: string): Promise<void>;
    /** Shows a file in the OS file manager: the Backup saved dialog's Show in Folder (07 §6). */
    showInFolder(path: string): Promise<void>;
    /** Saves the bundled sample CSV (16 §1.3), default on the Desktop; resolves with its path. */
    saveSampleImport(title: string): Promise<string | null>;
  };
  /** Shows the print preview window (16 §3); one at a time. */
  printPreview(doc: PrintDocument): Promise<void>;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  onHostStatus(listener: (status: HostStatus) => void): () => void;
  /** Window close / quit (06 §5): main asks first; the renderer runs its checks, then calls `quit()`. */
  onCloseRequested(listener: () => void): () => void;
  quit(): Promise<void>;
}

/** The IPC channel names used by preload and main. */
export const IPC = {
  settingsGet: 'shell:settings:get',
  settingsSet: 'shell:settings:set',
  settingsGetBudget: 'shell:settings:getBudget',
  settingsPatchBudget: 'shell:settings:patchBudget',
  settingsChanged: 'shell:settings:changed',
  secretsAvailable: 'shell:secrets:available',
  secretsHas: 'shell:secrets:has',
  secretsForget: 'shell:secrets:forget',
  systemLanguages: 'shell:systemLanguages',
  setTitle: 'shell:setTitle',
  setMenuState: 'shell:setMenuState',
  showContextMenu: 'shell:showContextMenu',
  openExternal: 'shell:openExternal',
  showLogsFolder: 'shell:showLogsFolder',
  appInfo: 'shell:appInfo',
  openLicenses: 'shell:openLicenses',
  cacheFolder: 'shell:cacheFolder',
  showCacheFolder: 'shell:showCacheFolder',
  chooseCertificateFile: 'shell:chooseCertificateFile',
  removeCertificateFile: 'shell:removeCertificateFile',
  relaunch: 'shell:relaunch',
  setZoom: 'shell:setZoom',
  log: 'shell:log',
  menuCommand: 'shell:menuCommand',
  hostStatus: 'shell:hostStatus',
  hostPort: 'shell:hostPort',
  closeRequested: 'shell:closeRequested',
  /** Preload tells main whether the page has a close listener; without one, main quits directly. */
  closeHandler: 'shell:closeHandler',
  quit: 'shell:quit',
  openFile: 'shell:files:open',
  saveFile: 'shell:files:save',
  defaultPath: 'shell:files:defaultPath',
  chooseExportFolder: 'shell:files:chooseExportFolder',
  openFolder: 'shell:files:openFolder',
  showInFolder: 'shell:files:showInFolder',
  saveSampleImport: 'shell:files:saveSampleImport',
  printPreview: 'shell:printPreview',
} as const;

/** The message preload posts to the page with the host MessagePort attached (02 §4). */
export const HOST_PORT_MESSAGE = 'app:host-port';
