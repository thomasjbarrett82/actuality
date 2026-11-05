// Builds the native application menu from the template (06 §4), in the UI language (20 §3.4).
import { availableLocales, resolveLocale } from '@shared/i18n/locales';
import { createTranslator } from '@shared/i18n/translate';
import { Menu } from 'electron';
import { menuTemplate, type MenuOptions } from './menu-template';

export type BuildMenuOptions = Omit<MenuOptions, 't'> & { systemLanguages: readonly string[] };

export function buildMenu(o: BuildMenuOptions): Menu {
  const locale = resolveLocale(o.settings.language, o.systemLanguages, availableLocales());
  return Menu.buildFromTemplate(menuTemplate({ ...o, t: createTranslator(locale) }));
}
