import type { Account } from '@shared/domain/types';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  buildSidebar,
  groupShown,
  moveWithinGroup,
  nextSelection,
  toSidebarAccount,
  typeahead,
} from './sidebar-model';

function account(a: Partial<Account> & { id: string; name: string }): Account {
  return {
    onBudget: true,
    closed: false,
    sortIndex: 0,
    note: null,
    lastReconciledDate: null,
    accountGroupId: null,
    balances: { cleared: 0, uncleared: 0, working: 0, reconciled: 0 },
    attention: { count: 0, maxLevel: 'none' },
    hasTransactions: false,
    scheduledCount: 0,
    ...a,
  };
}

const ACCOUNTS: Account[] = [
  account({
    id: 'chk',
    name: 'Checking',
    sortIndex: 1,
    balances: { cleared: 0, uncleared: 0, working: 2000, reconciled: 0 },
    attention: { count: 2, maxLevel: 'needsCategory' },
  }),
  account({
    id: 'visa',
    name: 'Visa',
    sortIndex: 3,
    balances: { cleared: 0, uncleared: 0, working: -500, reconciled: 0 },
    attention: { count: 1, maxLevel: 'error' },
  }),
  account({ id: 'sav', name: 'Savings', sortIndex: 2 }),
  account({
    id: 'house',
    name: 'House',
    onBudget: false,
    sortIndex: 1,
    balances: { cleared: 0, uncleared: 0, working: 100_000, reconciled: 0 },
  }),
  account({
    id: 'old',
    name: 'Old',
    closed: true,
    sortIndex: 1,
    balances: { cleared: 0, uncleared: 0, working: 7, reconciled: 0 },
  }),
];

const vm = buildSidebar(ACCOUNTS.map(toSidebarAccount));
const names = (list: { name: string }[]): string[] => list.map((a) => a.name);

describe('the sidebar view model (08 §5)', () => {
  it('groups and orders the accounts, with totals', () => {
    expect(names(vm.groups.onBudget.accounts)).toEqual(['Checking', 'Savings', 'Visa']);
    expect(names(vm.groups.offBudget.accounts)).toEqual(['House']);
    expect(names(vm.groups.closed.accounts)).toEqual(['Old']);
    expect(vm.groups.onBudget.total).toBe(1500);
    expect(vm.allAccountsBalance).toBe(1500 + 100_000 + 7);
  });

  it('sums the group badge and keeps the worst level (08 §2.3)', () => {
    expect(vm.groups.onBudget.attention).toEqual({ count: 3, maxLevel: 'error' });
    expect(vm.groups.offBudget.attention).toEqual({ count: 0, maxLevel: 'none' });
  });

  it('hides empty Off-Budget and Closed groups', () => {
    const empty = buildSidebar([]);
    expect(groupShown(empty, 'onBudget')).toBe(true);
    expect(groupShown(empty, 'offBudget')).toBe(false);
    expect(groupShown(empty, 'closed')).toBe(false);
    expect(groupShown(vm, 'closed')).toBe(true);
  });
});

describe('selection fallback (08 §2.3)', () => {
  const all = { onBudget: true, offBudget: true, closed: false };

  it('an open on-budget account whose group collapsed: the Off-Budget group', () => {
    const sav = toSidebarAccount(ACCOUNTS[2] as Account);
    expect(nextSelection(vm, sav, { ...all, onBudget: false })).toBe('house');
  });

  it('an open off-budget account: the Budget group, first sortIndex ≥ the old one', () => {
    const offAt2 = { id: 'x', onBudget: false, closed: false, sortIndex: 2 };
    expect(nextSelection(vm, offAt2, all)).toBe('sav');
  });

  it('else the nearest lower one', () => {
    const offAt9 = { id: 'x', onBudget: false, closed: false, sortIndex: 9 };
    expect(nextSelection(vm, offAt9, all)).toBe('visa');
  });

  it('a closed on-budget account: Budget, then Off-Budget; only expanded groups', () => {
    const closed = { id: 'sav', onBudget: true, closed: true, sortIndex: 2 };
    expect(nextSelection(vm, closed, all)).toBe('visa');
    expect(nextSelection(vm, closed, { ...all, onBudget: false })).toBe('house');
    expect(nextSelection(vm, closed, { ...all, onBudget: false, offBudget: false })).toBe('all');
  });

  it('a closed off-budget account: Off-Budget, then Budget', () => {
    const closed = { id: 'house', onBudget: false, closed: true, sortIndex: 1 };
    expect(nextSelection(vm, closed, all)).toBe('chk');
  });
});

describe('keyboard helpers (22 §2.3–2.4)', () => {
  it('typeahead finds the next match after the current item, wrapping', () => {
    const labels = ['Budget', 'Reports', 'All Accounts', 'Savings', 'Settle'];
    expect(typeahead(labels, 0, 's')).toBe(3);
    expect(typeahead(labels, 3, 's')).toBe(4);
    expect(typeahead(labels, 4, 's')).toBe(3);
    expect(typeahead(labels, 2, 'SET')).toBe(4);
    expect(typeahead(labels, 0, 'zz')).toBe(-1);
  });

  it('Move Up / Move Down stay inside the group', () => {
    const group = vm.groups.onBudget.accounts;
    expect(moveWithinGroup(group, 'chk', -1)).toBeUndefined();
    expect(moveWithinGroup(group, 'sav', -1)).toBe('chk');
    expect(moveWithinGroup(group, 'chk', 1)).toBe('visa');
    expect(moveWithinGroup(group, 'sav', 1)).toBeNull();
    expect(moveWithinGroup(group, 'visa', 1)).toBeUndefined();
    expect(moveWithinGroup(group, 'nope', 1)).toBeUndefined();
  });
});

describe('optimistic moves (08 §4)', () => {
  it('moves an account within its group, between its new neighbors, keeping its state', () => {
    const moved = applyMove(ACCOUNTS, 'visa', 'chk');
    expect(moved.find((a) => a.id === 'visa')).toMatchObject({ onBudget: true, closed: false });
    expect(names(buildSidebar(moved.map(toSidebarAccount)).groups.onBudget.accounts)).toEqual([
      'Visa',
      'Checking',
      'Savings',
    ]);
    expect(applyMove(ACCOUNTS, 'nope', null)).toEqual(ACCOUNTS);
  });
});
