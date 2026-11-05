// A small translator for main (menus, native dialogs, window titles), which doesn't run vue-i18n
// (20 §3.4). It reads the same messages and uses the same fallback chain and named placeholders.
import { fallbackChain, MESSAGES, type LocaleMessages } from './locales';

/** An array for positional {0} placeholders, an object for named ones (20 §1). */
export type Params = readonly (string | number)[] | Readonly<Record<string, string | number>>;

function lookup(
  messages: Record<string, LocaleMessages>,
  chain: string[],
  key: string,
): string | undefined {
  const dot = key.indexOf('.');
  const bundle = key.slice(0, dot);
  const name = key.slice(dot + 1);
  for (const locale of chain) {
    const value = messages[locale]?.[bundle]?.[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Plural forms are separated by " | "; with 2 forms: n === 1 → first, else second (20 §1). */
function pickPlural(message: string, params: Params): string {
  const forms = message.split(/\s\|\s/);
  if (forms.length === 1) return message;
  const n = Array.isArray(params) ? 0 : Number((params as Record<string, unknown>)['n'] ?? 0);
  if (forms.length === 2) return (n === 1 ? forms[0] : forms[1]) ?? message;
  return (n === 0 ? forms[0] : n === 1 ? forms[1] : forms[2]) ?? message;
}

/** Resolves named/positional placeholders and {'x'} literal escapes. */
export function interpolate(message: string, params: Params): string {
  return message.replace(
    /\{(?:'([^']*)'|([A-Za-z0-9_]+))\}/g,
    (whole, literal: string | undefined, name: string | undefined) => {
      if (literal !== undefined) return literal;
      if (name === undefined) return whole;
      const value = Array.isArray(params)
        ? /^\d+$/.test(name)
          ? (params as readonly (string | number)[])[Number(name)]
          : undefined
        : (params as Readonly<Record<string, string | number>>)[name];
      return value === undefined ? whole : String(value);
    },
  );
}

export type Translate = (key: string, params?: Params) => string;

/** A translator for one locale. A missing key falls back along the chain; the user never sees a raw key. */
export function createTranslator(
  locale: string,
  messages: Record<string, LocaleMessages> = MESSAGES,
): Translate {
  const chain = fallbackChain(locale);
  return (key, params = {}) => {
    const message = lookup(messages, chain, key);
    if (message === undefined) return key;
    return interpolate(pickPlural(message, params), params);
  };
}
