// The register search in the renderer (10 §4): the UI language's search words, the parse and match
// contexts, the drop-down suggestions, and the texts programmatic searches write.
import { dateOrder, isISODate, monthOf, parseLoose } from '@shared/dates';
import type { Account } from '@shared/domain/types';
import { dateShort, monthHeader } from '@shared/format';
import { parse as parseMoney, type NumberFormat } from '@shared/money';
import type { ParseContext } from '@shared/search/parser';
import { splitTerms } from '@shared/search/parser';
import { searchWords, type IsValue, type SearchWords } from '@shared/search/words';
import type { Locale } from 'date-fns';
import { format as formatDate } from 'date-fns';
import { escapeRichText } from '../components/common/rich-text';
import { tr } from './dialogs';

/** The UI language's search words; month names from its date-fns locale (10 §4). */
export function uiSearchWords(locale: Locale): SearchWords {
  const months = Array.from({ length: 12 }, (_, i) =>
    formatDate(new Date(2000, i, 1), 'LLLL', { locale }),
  );
  const short = Array.from({ length: 12 }, (_, i) =>
    formatDate(new Date(2000, i, 1), 'LLL', { locale }),
  );
  return searchWords((key) => tr(key), months, short);
}

/** "Keyword: value" in the UI language. */
const term = (words: SearchWords, keyword: keyof SearchWords['keywords'], value: string): string =>
  `${words.keywords[keyword]}: ${value}`;

/** Programmatic searches (10 §4), written with the UI language's words. */
export const programmatic = {
  is: (words: SearchWords, value: IsValue): string => `${words.keywords.is}:${words.is[value]},`,
  payee: (words: SearchWords, name: string): string => `${term(words, 'payee', name)},`,
  category: (words: SearchWords, label: string): string => `${term(words, 'category', label)},`,
  tag: (words: SearchWords, tag: string): string => `${term(words, 'tag', tag)},`,
};

export interface Suggestion {
  /** A non-selectable header row (the "Dates" header). */
  header?: boolean;
  /** Rich text: the label with its bold part. */
  html: string;
  /** The term this suggestion puts in the box. */
  value: string;
}

export interface SuggestContext {
  words: SearchWords;
  dateFormat: string;
  numberFormat: NumberFormat;
  today: string;
  locale: Locale;
  /** All Accounts: accounts are suggested too, before Income. */
  allAccounts: boolean;
  accounts: readonly Account[];
  payeeNames: readonly string[];
  categoryLabels: readonly string[];
  /** The managed tags' names, without the `#` (04 §5.2). */
  tagNames: readonly string[];
}

const MAX_LIST = 20;

/** The term being typed: the text after the last separating comma. */
export function currentToken(
  text: string,
  numberFormat: NumberFormat,
): { before: string; token: string } {
  const terms = splitTerms(`${text}\u0000`, numberFormat);
  const last = terms.at(-1) ?? '';
  const token = last.replace('\u0000', '').trimStart();
  const at = text.length - token.length;
  return { before: text.slice(0, at), token };
}

/** The drop-down's rows for what's being typed, in the 10 §4 order. */
export function suggestions(text: string, ctx: SuggestContext): Suggestion[] {
  const { token } = currentToken(text, ctx.numberFormat);
  const x = token.trim();
  const lower = x.toLocaleLowerCase();
  const w = ctx.words;
  const has = (label: string): boolean => lower === '' || label.toLocaleLowerCase().includes(lower);
  const out: Suggestion[] = [];
  const bold = (key: string, value: string): string => tr(key, { value: escapeRichText(value) });

  // 1. Dates.
  const date = x === '' ? null : parseLoose(x, dateOrder(ctx.dateFormat), ctx.today as never);
  if (date && isISODate(date)) {
    const shown = dateShort(date, ctx.dateFormat);
    out.push({
      header: true,
      html: `${tr('search.datesHeader')} ${tr('search.datesHint', { format: ctx.dateFormat.toUpperCase() })}`,
      value: '',
    });
    out.push({ html: bold('search.onDate', shown), value: term(w, 'on', shown) });
    out.push({ html: bold('search.onOrBefore', shown), value: term(w, 'before', shown) });
    out.push({ html: bold('search.onOrAfter', shown), value: term(w, 'after', shown) });
  }
  const accounts = (): void => {
    if (!ctx.allAccounts) return;
    for (const a of ctx.accounts.filter((a) => has(a.name)).slice(0, MAX_LIST))
      out.push({
        html: escapeRichText(term(w, 'account', a.name)),
        value: term(w, 'account', a.name),
      });
  };
  const amounts = (): void => {
    const amount = /^[\d.,\s]+$/.test(x) ? parseMoney(x, { numberFormat: ctx.numberFormat }) : null;
    if (amount === null) return;
    out.push(
      { html: bold('search.outflowEquals', x), value: term(w, 'outflow', x) },
      { html: bold('search.outflowMore', x), value: term(w, 'outflow', `>${x}`) },
      { html: bold('search.outflowLess', x), value: term(w, 'outflow', `<${x}`) },
      { html: bold('search.inflowEquals', x), value: term(w, 'inflow', x) },
      { html: bold('search.inflowMore', x), value: term(w, 'inflow', `>${x}`) },
      { html: bold('search.inflowLess', x), value: term(w, 'inflow', `<${x}`) },
    );
  };
  const income = (): void => {
    const label = `${w.keywords.income}:`;
    if (
      lower !== '' &&
      !label.toLocaleLowerCase().startsWith(lower) &&
      !lower.startsWith(w.keywords.income.toLocaleLowerCase())
    )
      return;
    const month = monthHeader(monthOf(ctx.today as never), ctx.locale);
    out.push({
      html: `${escapeRichText(label)} ${tr('search.incomeHint', { month })}`,
      value: `${label} `,
    });
  };
  // 2–4. In All Accounts, accounts come before Income and amounts after it.
  if (ctx.allAccounts) {
    accounts();
    income();
    amounts();
  } else {
    amounts();
    income();
  }
  // 5. Tags matching the typed name (only once something is typed); names are matched as written.
  if (lower !== '')
    for (const t of ctx.tagNames.filter(has).slice(0, MAX_LIST))
      out.push({ html: escapeRichText(term(w, 'tag', t)), value: term(w, 'tag', t) });
  const isRow = (v: IsValue): void => {
    const label = term(w, 'is', w.is[v]);
    if (has(label)) out.push({ html: escapeRichText(label), value: label });
  };
  // 6–7.
  for (const v of ['approved', 'unapproved'] as const) isRow(v);
  for (const v of [
    'cleared',
    'uncleared',
    'reconciled',
    'clearedOrReconciled',
    'unreconciled',
  ] as const)
    isRow(v);
  // 8–9. Matching payees and categories (only once something is typed).
  if (lower !== '') {
    for (const p of ctx.payeeNames.filter(has).slice(0, MAX_LIST))
      out.push({ html: escapeRichText(term(w, 'payee', p)), value: term(w, 'payee', p) });
    for (const c of ctx.categoryLabels.filter(has).slice(0, MAX_LIST))
      out.push({ html: escapeRichText(term(w, 'category', c)), value: term(w, 'category', c) });
    // 10. Find in a field.
    out.push(
      { html: bold('search.findAny', x), value: x },
      { html: bold('search.findPayee', x), value: term(w, 'payee', x) },
      { html: bold('search.findCategory', x), value: term(w, 'category', x) },
      { html: bold('search.findNotes', x), value: term(w, 'notes', x) },
      { html: bold('search.findCheck', x), value: term(w, 'check', x) },
    );
  }
  // 11.
  for (const v of ['error', 'needsCategory', 'reminder'] as const) isRow(v);
  return out;
}

/** Puts a chosen suggestion in place of the token being typed, followed by ", " (10 §3). */
export function applySuggestion(text: string, value: string, numberFormat: NumberFormat): string {
  const { before } = currentToken(text, numberFormat);
  const head = before.replace(/\s+$/, '');
  return `${head}${head === '' || head.endsWith(',') ? (head === '' ? '' : ' ') : ', '}${value}${value.endsWith(' ') ? '' : ', '}`;
}

/** The search text as the info bar quotes it: without a trailing comma (10 §4). */
export const quotedSearch = (text: string): string => text.trim().replace(/,\s*$/, '');

export function parseContext(
  words: SearchWords,
  numberFormat: NumberFormat,
  dateFormat: string,
  today: string,
): ParseContext {
  return { words, numberFormat, dateFormat, today: today as never };
}
