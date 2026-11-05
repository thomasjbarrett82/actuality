// The register search language (10 §4, §11 criterion 2): every term, OR-ing within the Payee, Category,
// Account and Tag kinds, split lines, comma-decimal locales, and words in the UI language and English.
import { describe, expect, it } from 'vitest';
import type { ISODate } from '../domain/types';
import { MESSAGES } from '../i18n/locales';
import type { NumberFormat } from '../money';
import {
  compileSearch,
  isShown,
  type MatchContext,
  type SearchLine,
  type SearchRow,
} from './match';
import { parseMonth, parseSearch, splitTerms, type ParseContext } from './parser';
import { ENGLISH_WORDS, searchWords, type SearchWords } from './words';

const TODAY = '2026-10-20' as ISODate;

const ctx = (
  words: SearchWords = ENGLISH_WORDS,
  numberFormat: NumberFormat = 'comma-dot',
): ParseContext => ({
  words,
  numberFormat,
  dateFormat: 'MM/dd/yyyy',
  today: TODAY,
});

function row(r: Partial<SearchRow> = {}): SearchRow {
  return {
    date: '2026-10-05',
    amount: -5210,
    payeeText: 'Kroger',
    categoryText: 'Everyday Expenses: Groceries',
    categoryId: 'c-groceries',
    notes: 'weekly shop #groceries #Trip2025',
    checkNumber: null,
    accountName: 'Checking',
    accountOnBudget: true,
    accountClosed: false,
    tags: ['groceries', 'Trip2025'],
    needsReview: false,
    errorLevel: 'none',
    cleared: 'U',
    isIncome: false,
    transferKind: 'none',
    lines: [],
    ...r,
  };
}

function splitLine(l: Partial<SearchLine> = {}): SearchLine {
  return {
    transferText: '',
    categoryText: 'Everyday Expenses: Groceries',
    categoryId: 'c-groceries',
    notes: '',
    tags: [],
    amount: -1000,
    isIncome: false,
    transferKind: 'none',
    errorLevel: 'none',
    ...l,
  };
}

const MATCH: MatchContext = {
  payeeNames: new Set(['kroger', 'kroger fuel', 'walmart', 'transfer : savings']),
  categoryNames: new Set([
    'everyday expenses: groceries',
    'everyday expenses: fuel',
    'income: salary',
  ]),
  numberFormat: 'comma-dot',
};

function matches(
  text: string,
  r: SearchRow,
  p: ParseContext = ctx(),
  m: MatchContext = MATCH,
): boolean {
  const f = compileSearch(parseSearch(text, p), m);
  return f === null ? true : isShown(f(r));
}

describe('splitTerms (10 §4)', () => {
  it('splits at commas and drops empty terms', () => {
    expect(splitTerms('Payee: Kroger, notes ,, ', 'comma-dot')).toEqual(['Payee: Kroger', 'notes']);
  });
  it('keeps a comma between two digits as a decimal point when the decimal separator is a comma', () => {
    expect(splitTerms('Outflow: 12,34, Kroger', 'dot-comma')).toEqual(['Outflow: 12,34', 'Kroger']);
    expect(splitTerms('Outflow: 12,34', 'comma-dot')).toEqual(['Outflow: 12', '34']);
    expect(splitTerms('12, 34', 'dot-comma')).toEqual(['12', '34']);
  });
});

describe('parseSearch: keywords and values', () => {
  it('reads keywords case-insensitively and trims values', () => {
    expect(parseSearch('pAyEe:  Kroger ', ctx())).toEqual([{ kind: 'payee', value: 'Kroger' }]);
  });
  it('reads text without a colon as free text', () => {
    expect(parseSearch('kro', ctx())).toEqual([{ kind: 'text', value: 'kro' }]);
  });
  it('reads an unknown keyword as free text for its value', () => {
    expect(parseSearch('Foo: bar', ctx())).toEqual([{ kind: 'text', value: 'bar' }]);
  });
  it('reads the special Account: values', () => {
    expect(parseSearch('Account: Closed Budget Accounts', ctx())).toEqual([
      { kind: 'accountSet', set: 'closedBudget' },
    ]);
    expect(parseSearch('Account: Visa', ctx())).toEqual([{ kind: 'account', value: 'Visa' }]);
  });
  it('reads Is: values, the compound ones with the or word', () => {
    expect(parseSearch('is:Cleared or Reconciled', ctx())).toEqual([
      { kind: 'is', value: 'clearedOrReconciled' },
    ]);
    expect(parseSearch('Is: income  or   expense', ctx())).toEqual([
      { kind: 'is', value: 'incomeOrExpense' },
    ]);
    expect(parseSearch('is: needscategory', ctx())).toEqual([
      { kind: 'is', value: 'needsCategory' },
    ]);
  });
  it('reads dates with the 11 §3 rules, and an unreadable date matches nothing', () => {
    expect(parseSearch('On: 10/5', ctx())).toEqual([
      { kind: 'date', op: 'on', date: '2026-10-05' },
    ]);
    expect(parseSearch('After: 100526', ctx())).toEqual([
      { kind: 'date', op: 'after', date: '2026-10-05' },
    ]);
    expect(parseSearch('Before: soon', ctx())).toEqual([{ kind: 'never' }]);
  });
  it('reads amounts with =, ≥ and ≤', () => {
    expect(parseSearch('Outflow: 12.34', ctx())).toEqual([
      { kind: 'amount', field: 'outflow', op: 'eq', amount: 1234 },
    ]);
    expect(parseSearch('Inflow: >12', ctx())).toEqual([
      { kind: 'amount', field: 'inflow', op: 'gte', amount: 1200 },
    ]);
    expect(parseSearch('Inflow: <12', ctx())).toEqual([
      { kind: 'amount', field: 'inflow', op: 'lte', amount: 1200 },
    ]);
    expect(parseSearch('Outflow: lots', ctx())).toEqual([{ kind: 'never' }]);
  });
  it('reads amounts with a comma decimal in a comma locale', () => {
    expect(parseSearch('Outflow: 12,34', ctx(ENGLISH_WORDS, 'dot-comma'))).toEqual([
      { kind: 'amount', field: 'outflow', op: 'eq', amount: 1234 },
    ]);
  });
  it('reads Income: months by full or short name, or YYYY-MM', () => {
    expect(parseMonth('January 2026', ENGLISH_WORDS)).toBe('2026-01');
    expect(parseMonth('jan 2026', ENGLISH_WORDS)).toBe('2026-01');
    expect(parseMonth('2026-03', ENGLISH_WORDS)).toBe('2026-03');
    expect(parseSearch('Income: Smarch 2026', ctx())).toEqual([{ kind: 'never' }]);
  });
});

describe('search words in the UI language and English (10 §4, 20 §3.8)', () => {
  const german = searchWords(
    (key) =>
      ({
        'search.kwPayee': 'Empfänger',
        'search.kwIs': 'Ist',
        'search.isCleared': 'Abgeglichen',
        'search.or': 'oder',
        'search.isReconciled': 'Ausgeglichen',
        'search.kwTag': 'Markierung',
        'search.kwIncome': 'Einnahmen',
        // "Notes" means the payee here, to check that the UI language wins.
        'search.kwNotes': 'Payee',
      })[key] ??
      MESSAGES['en']?.['search']?.[key.slice('search.'.length)] ??
      key,
    [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    [
      'Jan.',
      'Feb.',
      'März',
      'Apr.',
      'Mai',
      'Juni',
      'Juli',
      'Aug.',
      'Sept.',
      'Okt.',
      'Nov.',
      'Dez.',
    ],
  );
  it('accepts the UI language’s words', () => {
    expect(parseSearch('Empfänger: Kroger', ctx(german))).toEqual([
      { kind: 'payee', value: 'Kroger' },
    ]);
    expect(parseSearch('Ist: Abgeglichen oder Ausgeglichen', ctx(german))).toEqual([
      { kind: 'is', value: 'clearedOrReconciled' },
    ]);
    expect(parseSearch('Markierung: Trip', ctx(german))).toEqual([{ kind: 'tag', value: 'Trip' }]);
    expect(parseMonth('Oktober 2026', german)).toBe('2026-10');
  });
  it('keeps accepting English', () => {
    expect(parseSearch('Tag: Trip, is: Cleared', ctx(german))).toEqual([
      { kind: 'tag', value: 'Trip' },
      { kind: 'is', value: 'cleared' },
    ]);
    expect(parseMonth('October 2026', german)).toBe('2026-10');
  });
  it('lets the UI language win when a word means different things', () => {
    expect(parseSearch('Payee: lunch', ctx(german))).toEqual([{ kind: 'notes', value: 'lunch' }]);
  });
});

describe('matching: free text (10 §4)', () => {
  it('matches payee, category, notes or check number, case-insensitively', () => {
    expect(matches('KROG', row())).toBe(true);
    expect(matches('grocer', row())).toBe(true);
    expect(matches('weekly', row())).toBe(true);
    expect(matches('101', row({ checkNumber: '1012' }))).toBe(true);
    expect(matches('zzz', row())).toBe(false);
  });
  it('matches a number against outflow or inflow equal to it', () => {
    expect(matches('52.10', row())).toBe(true);
    expect(matches('52.1', row({ amount: 5210 }))).toBe(true);
    expect(matches('52.11', row())).toBe(false);
  });
  it('tests split lines with their transfer text, category, notes and amount (not the check number)', () => {
    const split = row({
      payeeText: 'Costco',
      categoryText: 'Split (Multiple Categories)...',
      categoryId: null,
      notes: '',
      checkNumber: '77',
      lines: [
        splitLine({ notes: 'tyres', categoryText: 'Everyday Expenses: Fuel' }),
        splitLine({ transferText: 'Transfer : Savings', categoryText: '' }),
      ],
    });
    const f = compileSearch(parseSearch('tyres', ctx()), MATCH);
    expect(f?.(split)).toEqual({ row: false, lines: [true, false] });
    expect(compileSearch(parseSearch('savings', ctx()), MATCH)?.(split)).toEqual({
      row: false,
      lines: [false, true],
    });
    expect(compileSearch(parseSearch('77', ctx()), MATCH)?.(split)).toEqual({
      row: true,
      lines: [false, false],
    });
  });
});

describe('matching: Payee, Category, Account, Notes, Check (10 §4)', () => {
  it('Payee: is exact when the value names an existing payee, contains otherwise', () => {
    expect(matches('Payee: kroger', row())).toBe(true);
    expect(matches('Payee: kroger', row({ payeeText: 'Kroger Fuel' }))).toBe(false);
    expect(matches('Payee: krog', row({ payeeText: 'Kroger Fuel' }))).toBe(true);
    expect(matches('Payee:', row({ payeeText: '' }))).toBe(true);
    expect(matches('Payee:', row())).toBe(false);
  });
  it('Payee: tests split lines by their transfer text, or the parent payee', () => {
    const split = row({
      payeeText: 'Costco',
      lines: [splitLine(), splitLine({ transferText: 'Transfer : Savings' })],
    });
    expect(compileSearch(parseSearch('Payee: Transfer : Savings', ctx()), MATCH)?.(split)).toEqual({
      row: false,
      lines: [false, true],
    });
    expect(compileSearch(parseSearch('Payee: costco', ctx()), MATCH)?.(split)).toEqual({
      row: true,
      lines: [true, false],
    });
  });
  it('OR-s terms of the same kind, and AND-s the rest', () => {
    expect(matches('Payee: Kroger, Payee: Walmart', row({ payeeText: 'Walmart' }))).toBe(true);
    expect(matches('Payee: Kroger, Payee: Walmart', row({ payeeText: 'Target' }))).toBe(false);
    expect(matches('Payee: Kroger, Notes: weekly', row())).toBe(true);
    expect(matches('Payee: Kroger, Notes: monthly', row())).toBe(false);
    expect(matches('Category: Fuel, Category: Groceries', row())).toBe(true);
    expect(matches('Tag: groceries, Tag: other', row({ tags: ['other'] }))).toBe(true);
    expect(matches('Account: Visa, Account: Check', row())).toBe(true);
  });
  it('Category: is exact for an existing "Group: Category", contains otherwise; empty is uncategorized', () => {
    expect(matches('Category: Everyday Expenses: Groceries', row())).toBe(true);
    expect(matches('Category: Everyday Expenses: Fuel', row())).toBe(false);
    expect(matches('Category: groc', row())).toBe(true);
    expect(matches('Category:', row({ categoryId: null, categoryText: '' }))).toBe(true);
    expect(matches('Category:', row())).toBe(false);
  });
  it('Category: on a split matches its lines', () => {
    const split = row({
      categoryId: null,
      categoryText: 'Split (Multiple Categories)...',
      lines: [
        splitLine(),
        splitLine({ categoryText: 'Everyday Expenses: Fuel', categoryId: 'c-fuel' }),
      ],
    });
    expect(
      compileSearch(parseSearch('Category: Everyday Expenses: Fuel', ctx()), MATCH)?.(split),
    ).toEqual({
      row: false,
      lines: [false, true],
    });
  });
  it('Account: contains, and the special values', () => {
    expect(matches('Account: heck', row())).toBe(true);
    expect(matches('Account: Budget Accounts', row())).toBe(true);
    expect(matches('Account: Off-Budget Accounts', row())).toBe(false);
    expect(matches('Account: Off-Budget Accounts', row({ accountOnBudget: false }))).toBe(true);
    expect(matches('Account: Closed Accounts', row({ accountClosed: true }))).toBe(true);
    expect(matches('Account: Budget Accounts', row({ accountClosed: true }))).toBe(false);
    expect(matches('Account: Closed Budget Accounts', row({ accountClosed: true }))).toBe(true);
    expect(matches('Account: Closed Off-Budget Accounts', row({ accountClosed: true }))).toBe(
      false,
    );
    expect(
      matches(
        'Account: Closed Off-Budget Accounts',
        row({ accountClosed: true, accountOnBudget: false }),
      ),
    ).toBe(true);
  });
  it('Notes: contains', () => {
    expect(matches('Notes: SHOP', row())).toBe(true);
    expect(matches('Notes: gift', row())).toBe(false);
  });
  it('Check: contains; empty is no check number', () => {
    expect(matches('Check: 10', row({ checkNumber: '1010' }))).toBe(true);
    expect(matches('Check:', row())).toBe(true);
    expect(matches('Check:', row({ checkNumber: '5' }))).toBe(false);
  });
});

describe('matching: Tag and Is (10 §4)', () => {
  it('Tag: is exact and case-sensitive, with or without the #', () => {
    expect(matches('Tag: groceries', row())).toBe(true);
    expect(matches('Tag: #Trip2025', row())).toBe(true);
    expect(matches('Tag: trip2025', row())).toBe(false);
    expect(matches('Tag: grocer', row())).toBe(false);
    expect(matches('Tag: groceries, Tag: Trip2025', row())).toBe(true);
    expect(matches('Tag: missing', row({ tags: [] }))).toBe(false);
  });
  it('Tag: a split shows when one of its lines has the tag', () => {
    const split = row({ tags: [], lines: [splitLine({ tags: ['rent'] }), splitLine()] });
    const f = compileSearch(parseSearch('Tag: rent', ctx()), MATCH);
    const found = f?.(split);
    expect(found && isShown(found)).toBe(true);
    expect(found?.lines).toEqual([true, false]);
  });
  it('Is: Approved / Unapproved', () => {
    expect(matches('Is: Approved', row())).toBe(true);
    expect(matches('Is: Unapproved', row({ needsReview: true }))).toBe(true);
    expect(matches('Is: Unapproved', row())).toBe(false);
  });
  it('Is: Error / Reminder / NeedsCategory', () => {
    expect(matches('Is: Error', row({ errorLevel: 'error' }))).toBe(true);
    expect(matches('Is: Reminder', row({ errorLevel: 'forReview' }))).toBe(true);
    expect(matches('Is: NeedsCategory', row({ errorLevel: 'needsCategory' }))).toBe(true);
    expect(matches('Is: Error', row({ errorLevel: 'needsCategory' }))).toBe(false);
  });
  it('Is: Error on a split matches the line with the error', () => {
    const split = row({
      errorLevel: 'error',
      lines: [splitLine(), splitLine({ errorLevel: 'error' })],
    });
    expect(compileSearch(parseSearch('is:Error,', ctx()), MATCH)?.(split)).toEqual({
      row: true,
      lines: [false, true],
    });
  });
  it('Is: cleared states', () => {
    expect(matches('Is: Cleared', row({ cleared: 'C' }))).toBe(true);
    expect(matches('Is: Cleared', row({ cleared: 'R' }))).toBe(false);
    expect(matches('Is: Uncleared', row())).toBe(true);
    expect(matches('Is: Reconciled', row({ cleared: 'R' }))).toBe(true);
    expect(matches('Is: Cleared or Reconciled', row({ cleared: 'R' }))).toBe(true);
    expect(matches('Is: Cleared or Reconciled', row())).toBe(false);
    expect(matches('Is: Unreconciled', row({ cleared: 'C' }))).toBe(true);
    expect(matches('Is: Unreconciled', row({ cleared: 'R' }))).toBe(false);
  });
  it('Is: Expense: not income and not a transfer, except across the budget boundary', () => {
    expect(matches('Is: Expense', row())).toBe(true);
    expect(matches('Is: Expense', row({ isIncome: true }))).toBe(false);
    expect(matches('Is: Expense', row({ transferKind: 'onOn' }))).toBe(false);
    expect(matches('Is: Expense', row({ transferKind: 'onOff' }))).toBe(true);
  });
  it('Is: Income or Expense: any non-transfer, or across the boundary', () => {
    expect(matches('Is: Income or Expense', row({ isIncome: true }))).toBe(true);
    expect(matches('Is: Income or Expense', row({ transferKind: 'onOn' }))).toBe(false);
    expect(matches('Is: Income or Expense', row({ transferKind: 'offOff' }))).toBe(false);
    expect(matches('Is: Income or Expense', row({ transferKind: 'onOff' }))).toBe(true);
  });
});

describe('matching: dates, amounts and income (10 §4)', () => {
  it('On / After / Before (inclusive)', () => {
    expect(matches('On: 10/05/2026', row())).toBe(true);
    expect(matches('On: 10/06/2026', row())).toBe(false);
    expect(matches('After: 10/05/2026', row())).toBe(true);
    expect(matches('After: 10/06/2026', row())).toBe(false);
    expect(matches('Before: 10/05/2026', row())).toBe(true);
    expect(matches('Before: 10/04/2026', row())).toBe(false);
  });
  it('Outflow: equals / ≥ / ≤ on the outflow side only', () => {
    expect(matches('Outflow: 52.10', row())).toBe(true);
    expect(matches('Outflow: >50', row())).toBe(true);
    expect(matches('Outflow: >60', row())).toBe(false);
    expect(matches('Outflow: <60', row())).toBe(true);
    expect(matches('Outflow: <60', row({ amount: 2000 }))).toBe(false);
  });
  it('Inflow: equals / ≥ / ≤ on the inflow side only', () => {
    expect(matches('Inflow: 20', row({ amount: 2000 }))).toBe(true);
    expect(matches('Inflow: >10', row({ amount: 2000 }))).toBe(true);
    expect(matches('Inflow: <10', row({ amount: 2000 }))).toBe(false);
    expect(matches('Inflow: 52.10', row())).toBe(false);
  });
  it('amounts with a comma decimal in a comma locale', () => {
    expect(
      matches('Outflow: 52,10', row(), ctx(ENGLISH_WORDS, 'dot-comma'), {
        ...MATCH,
        numberFormat: 'dot-comma',
      }),
    ).toBe(true);
  });
  it('amounts on split lines', () => {
    const split = row({
      amount: -3000,
      lines: [splitLine({ amount: -1000 }), splitLine({ amount: -2000 })],
    });
    expect(compileSearch(parseSearch('Outflow: 20', ctx()), MATCH)?.(split)).toEqual({
      row: false,
      lines: [false, true],
    });
  });
  it('Income: income-category transactions dated in that month', () => {
    const salary = row({ amount: 300000, isIncome: true, date: '2026-01-15' });
    expect(matches('Income: January 2026', salary)).toBe(true);
    expect(matches('Income: February 2026', salary)).toBe(false);
    expect(matches('Income: January 2026', row({ date: '2026-01-15' }))).toBe(false);
  });
  it('a term that can’t be read matches nothing', () => {
    expect(matches('On: whenever', row())).toBe(false);
  });
  it('an empty search shows everything', () => {
    expect(compileSearch(parseSearch(' , ', ctx()), MATCH)).toBeNull();
  });
});
