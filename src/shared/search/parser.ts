// The register search language (10 §4): comma-separated terms, all of which must match. Keywords and
// search words are matched case-insensitively in the UI language first, then in English (20 §3.8).
// `parseSearch` turns the text into terms; `match.ts` turns terms into a predicate over register rows.
import { dateOrder, isMonth, parseLoose, toMonth } from '../dates';
import type { ISODate, Money, Month } from '../domain/types';
import { parse as parseMoney, separators, type NumberFormat } from '../money';
import {
  ENGLISH_WORDS,
  type AccountSet,
  type IsValue,
  type Keyword,
  type SearchWords,
} from './words';

export type AmountOp = 'eq' | 'gte' | 'lte';

export type Term =
  | { kind: 'text'; value: string }
  | { kind: 'payee'; value: string }
  | { kind: 'category'; value: string }
  | { kind: 'account'; value: string }
  | { kind: 'accountSet'; set: AccountSet }
  | { kind: 'notes'; value: string }
  | { kind: 'check'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'is'; value: IsValue }
  | { kind: 'date'; op: 'on' | 'after' | 'before'; date: ISODate }
  | { kind: 'amount'; field: 'outflow' | 'inflow'; op: AmountOp; amount: Money }
  | { kind: 'income'; month: Month }
  /** A keyword whose value can't be read (`On: soon`): it matches nothing. */
  | { kind: 'never' };

export interface ParseContext {
  /** The UI language's words; English is always accepted too. */
  words: SearchWords;
  numberFormat: NumberFormat;
  /** The budget's date format, for the part order and its separator (11 §3). */
  dateFormat: string;
  today: ISODate;
}

const fold = (s: string): string => s.trim().toLocaleLowerCase();

/**
 * Splits the text at commas. With a comma decimal separator, a comma between two digits is a decimal
 * point, not a separator (10 §4). Empty terms are dropped.
 */
export function splitTerms(text: string, numberFormat: NumberFormat): string[] {
  const decimalComma = separators(numberFormat).decimal === ',';
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (
      ch === ',' &&
      !(decimalComma && /\d/.test(text.charAt(i - 1)) && /\d/.test(text.charAt(i + 1)))
    ) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((t) => t.trim()).filter((t) => t !== '');
}

/** The entry of `table` whose word equals `value`, UI language first, then English. */
function lookup<K extends string>(
  value: string,
  ui: Readonly<Record<K, string>>,
  english: Readonly<Record<K, string>>,
): K | null {
  const v = fold(value);
  for (const table of [ui, english]) {
    for (const [k, word] of Object.entries<string>(table)) if (fold(word) === v) return k as K;
  }
  return null;
}

/** `Is:` values also accept the compound forms without spaces around `or` mattering. */
const squash = (s: string): string => fold(s).replace(/\s+/g, ' ');

function lookupIs(value: string, words: SearchWords): IsValue | null {
  const v = squash(value);
  for (const table of [words.is, ENGLISH_WORDS.is]) {
    for (const [k, word] of Object.entries<string>(table))
      if (squash(word) === v) return k as IsValue;
  }
  return null;
}

/** `Income: January 2026` (full or short month names, UI language or English), or `2026-01`. */
export function parseMonth(value: string, words: SearchWords): Month | null {
  const v = fold(value);
  if (isMonth(v)) return v;
  const m = /^(\p{L}+)\.?\s+(\d{4})$/u.exec(v);
  if (!m) return null;
  const name = m[1] ?? '';
  const year = Number(m[2]);
  for (const w of [words, ENGLISH_WORDS]) {
    for (const list of [w.months, w.monthsShort]) {
      const i = list.findIndex((n) => fold(n).replace(/\.$/, '') === name);
      if (i !== -1) return toMonth(year, i + 1);
    }
  }
  return null;
}

function parseAmount(value: string, field: 'outflow' | 'inflow', numberFormat: NumberFormat): Term {
  const v = value.trim();
  const op: AmountOp = v.startsWith('>') ? 'gte' : v.startsWith('<') ? 'lte' : 'eq';
  const amount = parseMoney(op === 'eq' ? v : v.slice(1), { numberFormat });
  if (amount === null) return { kind: 'never' };
  return { kind: 'amount', field, op, amount: Math.abs(amount) };
}

/** The format's own separator, which the loose date parser also accepts. */
const dateSeparator = (format: string): string => /[^dMy]/.exec(format)?.[0] ?? '/';

function parseTerm(raw: string, ctx: ParseContext): Term {
  const colon = raw.indexOf(':');
  if (colon === -1) return { kind: 'text', value: raw.trim() };
  const keyword = lookup<Keyword>(raw.slice(0, colon), ctx.words.keywords, ENGLISH_WORDS.keywords);
  const value = raw.slice(colon + 1).trim();
  switch (keyword) {
    case null:
      return { kind: 'text', value };
    case 'payee':
    case 'category':
    case 'notes':
    case 'check':
      return { kind: keyword, value };
    case 'account': {
      const set = lookup<AccountSet>(value, ctx.words.accounts, ENGLISH_WORDS.accounts);
      return set ? { kind: 'accountSet', set } : { kind: 'account', value };
    }
    case 'tag': {
      // Tag names are user data: matched exactly as written, with or without the `#`.
      const name = value.startsWith('#') ? value.slice(1) : value;
      return name === '' ? { kind: 'text', value } : { kind: 'tag', value: name };
    }
    case 'is': {
      const is = lookupIs(value, ctx.words);
      return is ? { kind: 'is', value: is } : { kind: 'text', value };
    }
    case 'on':
    case 'after':
    case 'before': {
      const date = parseLoose(
        value,
        dateOrder(ctx.dateFormat),
        ctx.today,
        dateSeparator(ctx.dateFormat),
      );
      return date ? { kind: 'date', op: keyword, date } : { kind: 'never' };
    }
    case 'outflow':
    case 'inflow':
      return parseAmount(value, keyword, ctx.numberFormat);
    case 'income': {
      const month = parseMonth(value, ctx.words);
      return month ? { kind: 'income', month } : { kind: 'never' };
    }
  }
}

/** The terms of a search text (10 §4). An empty or blank text has none. */
export function parseSearch(text: string, ctx: ParseContext): Term[] {
  return splitTerms(text, ctx.numberFormat).map((t) => parseTerm(t, ctx));
}
