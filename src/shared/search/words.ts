// The words of the register search language (10 §4). Every word is a key in the `search` bundle; the
// parser accepts the UI language's words and English (20 §3.8). Month names come from date-fns.
import { MESSAGES, SOURCE_LOCALE } from '../i18n/locales';

export type Keyword =
  | 'payee'
  | 'category'
  | 'account'
  | 'notes'
  | 'check'
  | 'tag'
  | 'is'
  | 'on'
  | 'after'
  | 'before'
  | 'outflow'
  | 'inflow'
  | 'income';

/** The `Is:` values. The two compound ones are written with the `or` word. */
export type IsValue =
  | 'approved'
  | 'unapproved'
  | 'error'
  | 'reminder'
  | 'needsCategory'
  | 'cleared'
  | 'uncleared'
  | 'reconciled'
  | 'clearedOrReconciled'
  | 'unreconciled'
  | 'expense'
  | 'incomeOrExpense';

/** The special `Account:` values (10 §4). */
export type AccountSet = 'budget' | 'offBudget' | 'closed' | 'closedBudget' | 'closedOffBudget';

/** The message keys of every search word. Literal keys, so `i18n:check` sees them used (20 §3.7). */
export const SEARCH_KEYS = {
  keywords: {
    payee: 'search.kwPayee',
    category: 'search.kwCategory',
    account: 'search.kwAccount',
    notes: 'search.kwNotes',
    check: 'search.kwCheck',
    tag: 'search.kwTag',
    is: 'search.kwIs',
    on: 'search.kwOn',
    after: 'search.kwAfter',
    before: 'search.kwBefore',
    outflow: 'search.kwOutflow',
    inflow: 'search.kwInflow',
    income: 'search.kwIncome',
  },
  is: {
    approved: 'search.isApproved',
    unapproved: 'search.isUnapproved',
    error: 'search.isError',
    reminder: 'search.isReminder',
    needsCategory: 'search.isNeedsCategory',
    cleared: 'search.isCleared',
    uncleared: 'search.isUncleared',
    reconciled: 'search.isReconciled',
    unreconciled: 'search.isUnreconciled',
    expense: 'search.isExpense',
    income: 'search.isIncome',
  },
  accounts: {
    budget: 'search.accountsBudget',
    offBudget: 'search.accountsOffBudget',
    closed: 'search.accountsClosed',
    closedBudget: 'search.accountsClosedBudget',
    closedOffBudget: 'search.accountsClosedOffBudget',
  },
  or: 'search.or',
} as const;

export interface SearchWords {
  keywords: Record<Keyword, string>;
  is: Record<IsValue, string>;
  accounts: Record<AccountSet, string>;
  or: string;
  /** Full month names, January first. */
  months: readonly string[];
  /** Abbreviated month names, January first. */
  monthsShort: readonly string[];
}

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const mapValues = <K extends string>(
  keys: Record<K, string>,
  lookup: (key: string) => string,
): Record<K, string> =>
  Object.fromEntries(Object.entries<string>(keys).map(([k, key]) => [k, lookup(key)])) as Record<
    K,
    string
  >;

/** Builds the words from a message lookup (`t` in the renderer) and the locale's month names. */
export function searchWords(
  lookup: (key: string) => string,
  months: readonly string[],
  monthsShort: readonly string[],
): SearchWords {
  const isWords = mapValues(SEARCH_KEYS.is, lookup);
  const or = lookup(SEARCH_KEYS.or);
  return {
    keywords: mapValues(SEARCH_KEYS.keywords, lookup),
    is: {
      approved: isWords.approved,
      unapproved: isWords.unapproved,
      error: isWords.error,
      reminder: isWords.reminder,
      needsCategory: isWords.needsCategory,
      cleared: isWords.cleared,
      uncleared: isWords.uncleared,
      reconciled: isWords.reconciled,
      clearedOrReconciled: `${isWords.cleared} ${or} ${isWords.reconciled}`,
      unreconciled: isWords.unreconciled,
      expense: isWords.expense,
      incomeOrExpense: `${isWords.income} ${or} ${isWords.expense}`,
    },
    accounts: mapValues(SEARCH_KEYS.accounts, lookup),
    or,
    months,
    monthsShort,
  };
}

const enMessages: Readonly<Record<string, string>> = MESSAGES[SOURCE_LOCALE]?.['search'] ?? {};

/** The English words, which the parser always accepts (10 §4). */
export const ENGLISH_WORDS: SearchWords = searchWords(
  (key) => enMessages[key.slice('search.'.length)] ?? key,
  ENGLISH_MONTHS,
  ENGLISH_MONTHS.map((m) => m.slice(0, 3)),
);
