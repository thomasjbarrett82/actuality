// The native menu (06 §4), as a pure template: labels are i18n keys translated with the shared t(),
// enabled/visible state comes from the renderer's MenuState, clicks go to the renderer's command
// dispatcher. Shortcuts use CmdOrCtrl accelerators. Electron's default reload accelerators are not
// included, so Ctrl+R opens Reports instead of reloading the window.
import {
  ACTUAL_BLOG_URL,
  ACTUAL_CONTRIBUTIONS_URL,
  ACTUAL_DISCORD_URL,
  ACTUAL_DOCS_URL,
  ACTUAL_GITHUB_URL,
  ACTUAL_TOUR_URL,
  APP_DOCS_URL,
  APP_GITHUB_URL,
  APP_NAME,
} from '@shared/app';
import type { Translate } from '@shared/i18n/translate';
import type { AppSettings } from '@shared/settings';
import type { MenuCommand, MenuState } from '@shared/shell-api';
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuOptions {
  platform: NodeJS.Platform;
  settings: AppSettings;
  state: MenuState;
  dev: boolean;
  t: Translate;
  send: (command: MenuCommand) => void;
  setSetting: (
    patch: Partial<Pick<AppSettings, 'appearance' | 'colorVision' | 'privacyMode'>>,
  ) => void;
  zoom: (factor: number) => void;
  showLogsFolder: () => void;
  openUrl: (url: string) => void;
  quit: () => void;
}

/** 80–200 % in 10 % steps (06 §4, 22 §5). */
export function stepZoom(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return 1;
  const next = Math.round((current + direction * 0.1) * 10) / 10;
  return Math.min(2, Math.max(0.8, next));
}

export function menuTemplate(o: MenuOptions): MenuItemConstructorOptions[] {
  const { t, state } = o;
  const mac = o.platform === 'darwin';
  const budget = state.budgetOpen;
  const cmd = (id: MenuCommand) => (): void => {
    o.send(id);
  };
  const sep: MenuItemConstructorOptions = { type: 'separator' };

  const file: MenuItemConstructorOptions[] = [
    {
      label: t('menu.createNewBudget'),
      enabled: state.signedIn || (budget && state.canEdit),
      click: cmd('file.newBudget'),
    },
    { label: t('menu.open'), accelerator: 'CmdOrCtrl+O', click: cmd('file.open') },
    sep,
    {
      label: t('menu.syncNow'),
      accelerator: 'CmdOrCtrl+S',
      enabled: budget,
      click: cmd('file.syncNow'),
    },
    { label: t('menu.exportBudgetBackup'), enabled: budget, click: cmd('file.exportBackup') },
    {
      label: t('menu.wipeSlateClean'),
      enabled: budget && state.canEdit,
      click: cmd('file.slateWipe'),
    },
    sep,
    {
      label: t('menu.importTransactions'),
      accelerator: 'CmdOrCtrl+I',
      enabled: budget && state.canEdit,
      click: cmd('file.importTransactions'),
    },
    sep,
    { label: t('menu.budgetProperties'), enabled: budget, click: cmd('file.budgetProperties') },
    sep,
    {
      label: t('menu.export'),
      accelerator: 'CmdOrCtrl+E',
      enabled: budget,
      click: cmd('file.export'),
    },
    {
      label: t('menu.print'),
      accelerator: 'CmdOrCtrl+P',
      enabled: budget,
      click: cmd('file.print'),
    },
    sep,
    { label: t('menu.closeBudget'), enabled: budget, click: cmd('file.closeBudget') },
  ];
  if (!mac) {
    file.push(
      sep,
      { label: t('menu.preferences'), accelerator: 'CmdOrCtrl+,', click: cmd('file.preferences') },
      sep,
      { label: t('menu.exit'), click: o.quit },
    );
  }

  const edit: MenuItemConstructorOptions[] = [
    { label: t('menu.undo'), role: 'undo', accelerator: 'CmdOrCtrl+Z' },
    { label: t('menu.redo'), role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
    sep,
    { label: t('menu.cut'), role: 'cut' },
    { label: t('menu.copy'), role: 'copy' },
    { label: t('menu.paste'), role: 'paste' },
    { label: t('menu.selectAll'), role: 'selectAll' },
    sep,
    // The active account's actions (13 §3–4), for a single-account register only.
    {
      label: t('menu.renameAccount'),
      visible: state.singleAccount,
      enabled: budget && state.canEdit,
      click: cmd('edit.renameAccount'),
    },
    {
      label: t('menu.editAccountNote'),
      visible: state.singleAccount,
      enabled: budget && state.canEdit,
      click: cmd('edit.editAccountNote'),
    },
    {
      label: t('menu.closeAccount'),
      visible: state.singleAccount && !state.accountClosed,
      enabled: budget && state.canEdit,
      click: cmd('edit.closeAccount'),
    },
    {
      label: t('menu.reopenAccount'),
      visible: state.singleAccount && state.accountClosed,
      enabled: budget && state.canEdit,
      click: cmd('edit.reopenAccount'),
    },
  ];

  const zoomTo = (direction: 1 | -1 | 0) => (): void => {
    o.zoom(stepZoom(o.settings.zoomFactor, direction));
  };
  const view: MenuItemConstructorOptions[] = [
    {
      label: t('menu.goToAccounts'),
      accelerator: 'CmdOrCtrl+T',
      enabled: budget,
      click: cmd('view.goAccounts'),
    },
    {
      label: t('menu.goToBudget'),
      accelerator: 'CmdOrCtrl+B',
      enabled: budget,
      click: cmd('view.goBudget'),
    },
    {
      label: t('menu.goToReports'),
      accelerator: 'CmdOrCtrl+R',
      enabled: budget,
      click: cmd('view.goReports'),
    },
    {
      label: t('menu.goToPayeeSettings'),
      accelerator: 'CmdOrCtrl+Y',
      enabled: budget,
      click: cmd('view.goPayeeSettings'),
    },
    {
      label: t('menu.goToRules'),
      accelerator: 'CmdOrCtrl+U',
      enabled: budget,
      click: cmd('view.goRules'),
    },
    sep,
    { label: t('menu.toggleSidebar'), enabled: budget, click: cmd('view.toggleSidebar') },
    {
      label: t('menu.privacyMode'),
      accelerator: 'CmdOrCtrl+Shift+P',
      type: 'checkbox',
      checked: o.settings.privacyMode,
      enabled: budget,
      click: () => {
        o.setSetting({ privacyMode: !o.settings.privacyMode });
      },
    },
    {
      label: t('menu.appearance'),
      submenu: [
        ...(['system', 'light', 'dark'] as const).map((a): MenuItemConstructorOptions => ({
          label: t(
            a === 'system'
              ? 'menu.appearanceSystem'
              : a === 'light'
                ? 'menu.appearanceLight'
                : 'menu.appearanceDark',
          ),
          type: 'radio',
          checked: o.settings.appearance === a,
          click: () => {
            o.setSetting({ appearance: a });
          },
        })),
        sep,
        {
          label: t('menu.colorBlind'),
          type: 'checkbox',
          checked: o.settings.colorVision === 'cvd',
          click: () => {
            o.setSetting({ colorVision: o.settings.colorVision === 'cvd' ? 'standard' : 'cvd' });
          },
        },
      ],
    },
    { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+=', click: zoomTo(1) },
    {
      label: t('menu.zoomIn'),
      accelerator: 'CmdOrCtrl+Shift+=',
      visible: false,
      acceleratorWorksWhenHidden: true,
      click: zoomTo(1),
    },
    {
      label: t('menu.zoomIn'),
      accelerator: 'CmdOrCtrl+numadd',
      visible: false,
      acceleratorWorksWhenHidden: true,
      click: zoomTo(1),
    },
    { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: zoomTo(-1) },
    { label: t('menu.actualSize'), accelerator: 'CmdOrCtrl+0', click: zoomTo(0) },
    {
      label: t('menu.toggleFullScreen'),
      role: 'togglefullscreen',
      accelerator: mac ? 'Ctrl+Cmd+F' : 'F11',
    },
  ];
  if (o.dev)
    view.push({
      label: t('menu.toggleDevTools'),
      role: 'toggleDevTools',
      accelerator: 'CmdOrCtrl+Shift+I',
    });

  const help: MenuItemConstructorOptions[] = [
    {
      label: t('menu.product'),
      submenu: [
        {
          label: t('menu.docs'),
          click: () => {
            o.openUrl(APP_DOCS_URL);
          },
        },
        {
          label: t('menu.github'),
          click: () => {
            o.openUrl(APP_GITHUB_URL);
          },
        },
      ],
    },
    sep,
    {
      label: t('menu.actualBudget'),
      submenu: [
        {
          label: t('menu.tour'),
          click: () => {
            o.openUrl(ACTUAL_TOUR_URL);
          },
        },
        {
          label: t('menu.blog'),
          click: () => {
            o.openUrl(ACTUAL_BLOG_URL);
          },
        },
        {
          label: t('menu.contributions'),
          click: () => {
            o.openUrl(ACTUAL_CONTRIBUTIONS_URL);
          },
        },
        {
          label: t('menu.discord'),
          click: () => {
            o.openUrl(ACTUAL_DISCORD_URL);
          },
        },
        {
          label: t('menu.docs'),
          click: () => {
            o.openUrl(ACTUAL_DOCS_URL);
          },
        },
        {
          label: t('menu.github'),
          click: () => {
            o.openUrl(ACTUAL_GITHUB_URL);
          },
        },
      ],
    },
    sep,
    { label: t('menu.keyboardShortcuts'), click: cmd('help.keyboardShortcuts') },
    // The news feed's dialog (24 §4.6), on every screen; hidden while the feed is off.
    {
      label: t('menu.notifications'),
      visible: o.settings.showNewsFeed,
      click: cmd('help.notifications'),
    },
    { label: t('menu.showLogsFolder'), click: o.showLogsFolder },
  ];
  help.push({ label: t('menu.about'), click: cmd('help.about') });

  const template: MenuItemConstructorOptions[] = [];
  if (mac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: t('menu.about'), click: cmd('help.about') },
        sep,
        { label: t('menu.settings'), accelerator: 'Cmd+,', click: cmd('file.preferences') },
        sep,
        { label: t('menu.services'), role: 'services' },
        sep,
        { label: t('menu.hide'), role: 'hide', accelerator: 'Cmd+H' },
        { label: t('menu.hideOthers'), role: 'hideOthers' },
        { label: t('menu.showAll'), role: 'unhide' },
        sep,
        { label: t('menu.quit'), accelerator: 'Cmd+Q', click: o.quit },
      ],
    });
  }
  template.push(
    { label: t('menu.file'), submenu: file },
    { label: t('menu.edit'), submenu: edit },
    { label: t('menu.view'), submenu: view },
  );
  if (mac) {
    template.push({
      label: t('menu.window'),
      role: 'windowMenu',
      submenu: [
        { label: t('menu.minimize'), role: 'minimize' },
        { label: t('menu.zoom'), role: 'zoom' },
        sep,
        { label: t('menu.bringAllToFront'), role: 'front' },
      ],
    });
  }
  template.push({ label: t('menu.help'), submenu: help });
  return template;
}
