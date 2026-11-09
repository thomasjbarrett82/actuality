import { APP_NAME } from '@shared/app';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/settings';
import { INITIAL_MENU_STATE, type MenuState } from '@shared/shell-api';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { menuTemplate, stepZoom, type MenuOptions } from './menu-template';

function build(
  state: Partial<MenuState> = {},
  platform: NodeJS.Platform = 'win32',
  settings: Partial<AppSettings> = {},
): {
  items: MenuItemConstructorOptions[];
  send: ReturnType<typeof vi.fn>;
  openUrl: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const openUrl = vi.fn();
  const setSetting = vi.fn();
  const options: MenuOptions = {
    platform,
    settings: { ...DEFAULT_APP_SETTINGS, ...settings },
    state: { ...INITIAL_MENU_STATE, ...state },
    dev: false,
    t: (key) => (key === 'menu.product' ? APP_NAME : key),
    send,
    setSetting,
    zoom: vi.fn(),
    showLogsFolder: vi.fn(),
    openUrl,
    quit: vi.fn(),
  };
  return { items: menuTemplate(options), send, openUrl, setSetting };
}

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}

const find = (
  items: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | undefined => flat(items).find((i) => i.label === label);

describe('native menu (06 §4)', () => {
  it('enables budget items only with a budget open, and editing items only when editing is allowed', () => {
    const closed = build().items;
    expect(find(closed, 'menu.syncNow')?.enabled).toBe(false);
    expect(find(closed, 'menu.closeBudget')?.enabled).toBe(false);
    expect(find(closed, 'menu.createNewBudget')?.enabled).toBe(false);

    const offline = build({ budgetOpen: true, canEdit: false }).items;
    expect(find(offline, 'menu.syncNow')?.enabled).toBe(true);
    expect(find(offline, 'menu.wipeSlateClean')?.enabled).toBe(false);
    expect(find(offline, 'menu.importTransactions')?.enabled).toBe(false);

    const online = build({ budgetOpen: true, canEdit: true }).items;
    expect(find(online, 'menu.wipeSlateClean')?.enabled).toBe(true);
    expect(find(online, 'menu.importTransactions')?.enabled).toBe(true);
    expect(find(online, 'menu.createNewBudget')?.enabled).toBe(true);

    expect(find(build({ signedIn: true }).items, 'menu.createNewBudget')?.enabled).toBe(true);
  });

  it('sends clicks to the renderer as commands', () => {
    const { items, send } = build({ budgetOpen: true });
    const click = find(items, 'menu.syncNow')?.click as (() => void) | undefined;
    click?.();
    expect(send).toHaveBeenCalledWith('file.syncNow');
  });

  it('uses CmdOrCtrl accelerators and never binds reload to Ctrl+R', () => {
    const all = flat(build({ budgetOpen: true }).items);
    const accelerators = all
      .map((i) => i.accelerator)
      .filter((a): a is string => typeof a === 'string');
    expect(accelerators.every((a) => !a.startsWith('Ctrl+') && !a.startsWith('Cmd+'))).toBe(true);
    expect(all.some((i) => i.role === 'reload' || i.role === 'forceReload')).toBe(false);
    expect(all.find((i) => i.accelerator === 'CmdOrCtrl+R')?.label).toBe('menu.goToReports');
    expect(all.find((i) => i.accelerator === 'CmdOrCtrl+U')?.label).toBe('menu.goToRules');
  });

  it('has Go to Rules, enabled with a budget open (23 §2)', () => {
    expect(find(build().items, 'menu.goToRules')?.enabled).toBe(false);
    const open = build({ budgetOpen: true });
    const item = find(open.items, 'menu.goToRules');
    expect(item?.enabled).toBe(true);
    (item?.click as () => void)();
    expect(open.send).toHaveBeenCalledWith('view.goRules');
  });

  it('has a Privacy Mode checkbox that toggles the setting (06 §7)', () => {
    expect(find(build().items, 'menu.privacyMode')?.enabled).toBe(false);
    const off = build({ budgetOpen: true });
    const item = find(off.items, 'menu.privacyMode');
    expect(item).toMatchObject({
      type: 'checkbox',
      checked: false,
      enabled: true,
      accelerator: 'CmdOrCtrl+Shift+P',
    });
    (item?.click as () => void)();
    expect(off.setSetting).toHaveBeenCalledWith({ privacyMode: true });

    const on = build({ budgetOpen: true }, 'win32', { privacyMode: true });
    expect(find(on.items, 'menu.privacyMode')?.checked).toBe(true);
    (find(on.items, 'menu.privacyMode')?.click as () => void)();
    expect(on.setSetting).toHaveBeenCalledWith({ privacyMode: false });
  });

  it('shows the account items only for a single-account register, Close or Re-open by its state', () => {
    const labels = [
      'menu.renameAccount',
      'menu.editAccountNote',
      'menu.closeAccount',
      'menu.reopenAccount',
    ];
    const shown = (state: Parameters<typeof build>[0]) =>
      labels.filter((l) => find(build(state).items, l)?.visible);
    expect(shown({ budgetOpen: true, canEdit: true })).toEqual([]);
    expect(shown({ budgetOpen: true, canEdit: true, singleAccount: true })).toEqual([
      'menu.renameAccount',
      'menu.editAccountNote',
      'menu.closeAccount',
    ]);
    expect(
      shown({ budgetOpen: true, canEdit: true, singleAccount: true, accountClosed: true }),
    ).toEqual(['menu.renameAccount', 'menu.editAccountNote', 'menu.reopenAccount']);
    // Offline they stay visible but disabled (03 §5.3).
    const offline = build({ budgetOpen: true, singleAccount: true }).items;
    expect(find(offline, 'menu.renameAccount')?.enabled).toBe(false);
  });

  it('moves Preferences, Exit and About into the app menu on macOS', () => {
    const win = build({}, 'win32').items;
    const mac = build({}, 'darwin').items;
    expect(find(win, 'menu.preferences')).toBeDefined();
    expect(find(mac, 'menu.preferences')).toBeUndefined();
    expect(mac.length).toBeGreaterThan(win.length);
  });

  it('groups app placeholders and Actual Budget resources in Help', () => {
    const { items } = build();
    const help = find(items, 'menu.help')?.submenu as MenuItemConstructorOptions[];
    const actuality = find(help, APP_NAME)?.submenu as MenuItemConstructorOptions[];
    const actualBudget = find(help, 'menu.actualBudget')?.submenu as MenuItemConstructorOptions[];

    expect(actuality.map((item) => [item.label, item.enabled])).toEqual([
      ['menu.docs', false],
      ['menu.github', false],
    ]);
    expect(actuality.every((item) => item.click === undefined)).toBe(true);
    expect(actualBudget.map((item) => item.label)).toEqual([
      'menu.tour',
      'menu.blog',
      'menu.contributions',
      'menu.discord',
      'menu.docs',
      'menu.github',
    ]);
    expect(find(help, 'menu.keyboardShortcuts')).toBeDefined();
    expect(find(help, 'menu.showLogsFolder')).toBeDefined();
    expect(find(help, 'menu.about')).toBeDefined();
    expect(flat(items).some((item) => item.label === 'menu.walkthroughs')).toBe(false);
  });

  it('shows Help ▸ Notifications… after Keyboard Shortcuts only while the news feed is on (24 §4.6)', () => {
    const { items, send } = build();
    const help = find(items, 'menu.help')?.submenu as MenuItemConstructorOptions[];
    const labels = help.map((i) => i.label);
    expect(labels.indexOf('menu.notifications')).toBe(labels.indexOf('menu.keyboardShortcuts') + 1);
    const item = find(help, 'menu.notifications');
    expect(item?.visible).toBe(true);
    (item?.click as (() => void) | undefined)?.();
    expect(send).toHaveBeenCalledWith('help.notifications');

    const off = build({}, 'win32', { showNewsFeed: false });
    const offHelp = find(off.items, 'menu.help')?.submenu as MenuItemConstructorOptions[];
    expect(find(offHelp, 'menu.notifications')?.visible).toBe(false);
  });

  it('opens Keyboard Shortcuts from Help', () => {
    const { items, send } = build();
    const help = find(items, 'menu.help')?.submenu as MenuItemConstructorOptions[];
    (find(help, 'menu.keyboardShortcuts')?.click as (() => void) | undefined)?.();
    expect(send).toHaveBeenCalledWith('help.keyboardShortcuts');
  });

  it(`opens About ${APP_NAME} from Help on every platform`, () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const { items, send } = build({}, platform);
      const help = find(items, 'menu.help')?.submenu as MenuItemConstructorOptions[];
      (find(help, 'menu.about')?.click as (() => void) | undefined)?.();
      expect(send).toHaveBeenCalledWith('help.about');
    }
  });

  it('opens each Actual Budget resource at its specified URL', () => {
    const { items, openUrl } = build();
    const actualBudget = find(items, 'menu.actualBudget')?.submenu as MenuItemConstructorOptions[];
    const urls = [
      'https://actualbudget.org/docs/tour/',
      'https://actualbudget.org/blog/',
      'https://opencollective.com/actual',
      'https://discord.com/invite/8JfAXSgfRf',
      'https://actualbudget.org/docs/',
      'https://github.com/actualbudget/actual',
    ];

    for (const [index, item] of actualBudget.entries()) {
      (item.click as (() => void) | undefined)?.();
      expect(openUrl).toHaveBeenNthCalledWith(index + 1, urls[index]);
    }
  });
});

describe('zoom steps (22 §5)', () => {
  it('moves in 10 % steps between 80 % and 200 %, and resets to 100 %', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(0.8, -1)).toBe(0.8);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(1.5, 0)).toBe(1);
  });
});
