// vue-i18n setup (20 §3): the shared message files, fallback chain, UI language setting, and matching
// date-fns locale for month/day names and the week start.
import type { WeekDay } from '@shared/budget-format';
import {
  availableLocales,
  fallbackChain,
  LOCALE_META,
  MESSAGES,
  resolveLocale,
  SOURCE_LOCALE,
} from '@shared/i18n/locales';
import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { computed, shallowRef } from 'vue';
import { createI18n } from 'vue-i18n';

export const i18n = createI18n({
  legacy: false,
  locale: SOURCE_LOCALE,
  fallbackLocale: [SOURCE_LOCALE],
  messages: MESSAGES,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false,
  warnHtmlMessage: false,
});

/** The date-fns locale of the UI language (20 §3.3). */
export const dateLocale = shallowRef<Locale>(enUS);

/** The open budget's `firstDayOfWeekIdx`, or null when unset or no budget is open (07 §4). */
export const budgetWeekStart = shallowRef<WeekDay | null>(null);

/** The calendars' first weekday: the budget's choice, else the UI locale's week start (20 §3.3). */
export const weekStartsOn = computed(
  (): WeekDay => budgetWeekStart.value ?? dateLocale.value.options?.weekStartsOn ?? 0,
);

async function loadDateLocale(name: string): Promise<Locale> {
  if (name === 'enUS') return enUS;
  const all = (await import('date-fns/locale')) as unknown as Record<string, Locale | undefined>;
  return all[name] ?? enUS;
}

/** Applies the `language` setting (20 §3.3). Takes effect immediately, with no restart. */
export async function applyLanguage(
  setting: string,
  systemLanguages: readonly string[],
): Promise<string> {
  const locale = resolveLocale(setting, systemLanguages, availableLocales());
  i18n.global.locale.value = locale;
  i18n.global.fallbackLocale.value = fallbackChain(locale).slice(1);
  dateLocale.value = await loadDateLocale(LOCALE_META[locale]?.dateFnsLocale ?? 'enUS');
  document.documentElement.lang = locale;
  return locale;
}
