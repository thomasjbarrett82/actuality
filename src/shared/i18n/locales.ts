// Locale discovery and message loading (20 §3). Locales are found at build time from
// `i18n/{locale}/meta.json`: adding a folder registers a locale, and the code keeps no list of locales.
// The en-XA pseudo-locale is generated for development builds only (20 §3.6).

export interface LocaleMeta {
  /** The language's name in that language, shown in Preferences. */
  name: string;
  englishName: string;
  /** The date-fns locale export name (`de`, `enUS`, `ptBR`). */
  dateFnsLocale: string;
  dir: 'ltr' | 'rtl';
}

/** bundle → key → message */
export type LocaleMessages = Record<string, Record<string, string>>;

export const SOURCE_LOCALE = 'en';
const PSEUDO_LOCALE = 'en-XA';

const metaFiles = import.meta.glob<LocaleMeta>(['./*/meta.json', '!./en-XA/meta.json'], {
  eager: true,
  import: 'default',
});
const messageFiles = import.meta.glob<Record<string, string>>(
  ['./*/*.json', '!./*/meta.json', '!./en-XA/*.json'],
  {
    eager: true,
    import: 'default',
  },
);
const pseudoFiles: Record<string, Record<string, string>> = import.meta.env.DEV
  ? import.meta.glob<Record<string, string>>('./en-XA/*.json', { eager: true, import: 'default' })
  : {};

const localeOf = (path: string): string => path.split('/')[1] ?? '';
const bundleOf = (path: string): string => (path.split('/')[2] ?? '').replace(/\.json$/, '');

function collect(files: Record<string, Record<string, string>>): Record<string, LocaleMessages> {
  const out: Record<string, LocaleMessages> = {};
  for (const [path, messages] of Object.entries(files)) {
    const locale = localeOf(path);
    (out[locale] ??= {})[bundleOf(path)] = messages;
  }
  return out;
}

/** Every locale's messages: shipped locales, plus en-XA in development builds. */
export const MESSAGES: Record<string, LocaleMessages> = {
  ...collect(messageFiles),
  ...collect(pseudoFiles),
};

/** Every locale's metadata. */
export const LOCALE_META: Record<string, LocaleMeta> = {
  ...Object.fromEntries(Object.entries(metaFiles).map(([path, meta]) => [localeOf(path), meta])),
  ...(import.meta.env.DEV && Object.keys(pseudoFiles).length > 0
    ? {
        [PSEUDO_LOCALE]: {
          name: 'Pseudo (en-XA)',
          englishName: 'Pseudo',
          dateFnsLocale: 'enUS',
          dir: 'ltr',
        },
      }
    : {}),
};

function keysOf(messages: LocaleMessages | undefined): Set<string> {
  const keys = new Set<string>();
  for (const [bundle, entries] of Object.entries(messages ?? {}))
    for (const k of Object.keys(entries)) keys.add(`${bundle}.${k}`);
  return keys;
}

/**
 * Locales offered in Preferences (20 §3.5): complete ones only, unless this is a development build, which
 * also lists incomplete locales and en-XA.
 */
export function availableLocales(dev = import.meta.env.DEV, messages = MESSAGES): string[] {
  const source = keysOf(messages[SOURCE_LOCALE]);
  return Object.keys(messages)
    .filter((locale) => {
      if (dev || locale === SOURCE_LOCALE) return true;
      const keys = keysOf(messages[locale]);
      return [...source].every((k) => keys.has(k));
    })
    .sort();
}

/** The fallback chain: the locale → its language alone → en (20 §3.5). */
export function fallbackChain(locale: string): string[] {
  const chain = [locale];
  const language = locale.split('-')[0];
  if (language && language !== locale) chain.push(language);
  if (!chain.includes(SOURCE_LOCALE)) chain.push(SOURCE_LOCALE);
  return chain;
}

/**
 * The UI locale (20 §3.3): the `language` setting if it names an available locale; otherwise ('system' or
 * an unknown tag) the OS's preferred languages in order, matching the exact tag first, then the language
 * alone; else en.
 */
export function resolveLocale(
  setting: string,
  systemLanguages: readonly string[],
  available: readonly string[],
): string {
  if (setting !== 'system' && available.includes(setting)) return setting;
  const lower = new Map(available.map((l) => [l.toLowerCase(), l]));
  for (const pref of systemLanguages) {
    const exact = lower.get(pref.toLowerCase());
    if (exact) return exact;
    const language = lower.get(pref.split('-')[0]?.toLowerCase() ?? '');
    if (language) return language;
  }
  return SOURCE_LOCALE;
}
