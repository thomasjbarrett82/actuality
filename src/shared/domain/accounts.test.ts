import { describe, expect, it } from 'vitest';
import {
  accountNameError,
  bySortOrder,
  groupOf,
  placeAccount,
  SORT_STEP,
  uniqueName,
} from './accounts';

describe('account names (13 §1–2)', () => {
  const accounts = [
    { id: 'a', name: 'Checking' },
    { id: 'b', name: 'Savings ' },
  ];

  it('refuses empty, backtick and duplicate names, ignoring case and spaces', () => {
    expect(accountNameError('  ', accounts)).toBe('empty');
    expect(accountNameError('My `acct`', accounts)).toBe('backtick');
    expect(accountNameError(' CHECKING ', accounts)).toBe('duplicate');
    expect(accountNameError('savings', accounts)).toBe('duplicate');
    expect(accountNameError('Cash', accounts)).toBeNull();
  });

  it('lets an account keep its own name', () => {
    expect(accountNameError('checking', accounts, 'a')).toBeNull();
  });

  it('appends " 2", " 3"… to a taken default name', () => {
    expect(uniqueName('New Account', ['Checking'])).toBe('New Account');
    expect(uniqueName('New Account', ['new account', 'New Account 2'])).toBe('New Account 3');
  });
});

describe('groups and order (08 §2.3, 04 §3)', () => {
  it('puts closed accounts in Closed whatever their budget state', () => {
    expect(groupOf({ onBudget: true, closed: false })).toBe('onBudget');
    expect(groupOf({ onBudget: false, closed: false })).toBe('offBudget');
    expect(groupOf({ onBudget: false, closed: true })).toBe('closed');
  });

  it('sorts by sort_order, then name', () => {
    const list = [
      { sortIndex: 2, name: 'B' },
      { sortIndex: 1, name: 'Z' },
      { sortIndex: 2, name: 'A' },
    ].sort(bySortOrder);
    expect(list.map((a) => a.name)).toEqual(['Z', 'A', 'B']);
  });

  const group = [
    { id: 'a', sortIndex: 100 },
    { id: 'b', sortIndex: 200 },
  ];

  it('places a move at the midpoint, or a step past either end', () => {
    expect(placeAccount(group, 'x', 'b')).toEqual({ kind: 'single', sortOrder: 150 });
    expect(placeAccount(group, 'x', 'a')).toEqual({ kind: 'single', sortOrder: 100 - SORT_STEP });
    expect(placeAccount(group, 'x', null)).toEqual({ kind: 'single', sortOrder: 200 + SORT_STEP });
    expect(placeAccount(group, 'x', 'gone')).toEqual({
      kind: 'single',
      sortOrder: 200 + SORT_STEP,
    });
    expect(placeAccount([], 'x', null)).toEqual({ kind: 'single', sortOrder: SORT_STEP });
  });

  it('renumbers the group when the neighbors are too close', () => {
    const tight = [
      { id: 'a', sortIndex: 1 },
      { id: 'b', sortIndex: 1.001 },
    ];
    expect(placeAccount(tight, 'x', 'b')).toEqual({
      kind: 'renumber',
      orders: [
        { id: 'a', sortOrder: SORT_STEP },
        { id: 'x', sortOrder: 2 * SORT_STEP },
        { id: 'b', sortOrder: 3 * SORT_STEP },
      ],
    });
  });
});
