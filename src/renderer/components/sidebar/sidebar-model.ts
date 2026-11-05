// The sidebar's view model (08 §5): accounts by group with their totals and badges, which groups show,
// where selection goes when the selected account disappears (08 §2.3), and the tree's typeahead (22 §2.3).
// Pure, so it's tested without a DOM.
import {
  ACCOUNT_GROUPS,
  bySortOrder,
  groupOf,
  placeAccount,
  type AccountGroup,
} from '@shared/domain/accounts';
import type { Account, ErrorLevel, Money } from '@shared/domain/types';
import { ERROR_RANK } from '@shared/domain/types';

export type SidebarAccount = Pick<
  Account,
  'id' | 'name' | 'note' | 'onBudget' | 'closed' | 'sortIndex' | 'attention'
> & { workingBalance: Money };

export interface SidebarGroupVm {
  group: AccountGroup;
  accounts: SidebarAccount[];
  total: Money;
  attention: { count: number; maxLevel: ErrorLevel };
}

export interface SidebarVm {
  /** Every account, open or closed, on or off budget (08 §2.1). */
  allAccountsBalance: Money;
  groups: Record<AccountGroup, SidebarGroupVm>;
}

export function toSidebarAccount(a: Account): SidebarAccount {
  return {
    id: a.id,
    name: a.name,
    note: a.note,
    onBudget: a.onBudget,
    closed: a.closed,
    sortIndex: a.sortIndex,
    attention: a.attention,
    workingBalance: a.balances.working,
  };
}

function summarize(group: AccountGroup, accounts: SidebarAccount[]): SidebarGroupVm {
  let maxLevel: ErrorLevel = 'none';
  let count = 0;
  let total = 0;
  for (const a of accounts) {
    total += a.workingBalance;
    count += a.attention.count;
    if (ERROR_RANK[a.attention.maxLevel] > ERROR_RANK[maxLevel]) maxLevel = a.attention.maxLevel;
  }
  return { group, accounts, total, attention: { count, maxLevel } };
}

export function buildSidebar(accounts: readonly SidebarAccount[]): SidebarVm {
  const sorted = [...accounts].sort(bySortOrder);
  const groups = Object.fromEntries(
    ACCOUNT_GROUPS.map((g) => [
      g,
      summarize(
        g,
        sorted.filter((a) => groupOf(a) === g),
      ),
    ]),
  ) as Record<AccountGroup, SidebarGroupVm>;
  return {
    allAccountsBalance: sorted.reduce((sum, a) => sum + a.workingBalance, 0),
    groups,
  };
}

/** Budget Accounts always shows; Off-Budget and Closed hide when empty (08 §2.3). */
export function groupShown(vm: SidebarVm, group: AccountGroup): boolean {
  return group === 'onBudget' || vm.groups[group].accounts.length > 0;
}

/** The groups searched, in order, for an account in this state (08 §2.3). */
function searchOrder(a: Pick<SidebarAccount, 'onBudget' | 'closed'>): AccountGroup[] {
  if (!a.closed) return a.onBudget ? ['offBudget'] : ['onBudget'];
  return a.onBudget ? ['onBudget', 'offBudget'] : ['offBudget', 'onBudget'];
}

/**
 * Where selection moves when the selected account's group collapses, or it is closed or deleted
 * (08 §2.3). `old` is the account in its new state (closed for a closed or deleted one). Only expanded
 * groups are searched; in each, the first account with a `sortIndex` ≥ the old one wins, else the
 * nearest lower one. Nothing found: All Accounts.
 */
export function nextSelection(
  vm: SidebarVm,
  old: Pick<SidebarAccount, 'id' | 'onBudget' | 'closed' | 'sortIndex'>,
  expanded: Readonly<Record<AccountGroup, boolean>>,
): string {
  for (const group of searchOrder(old)) {
    if (!expanded[group]) continue;
    const candidates = vm.groups[group].accounts.filter((a) => a.id !== old.id);
    const after = candidates.find((a) => a.sortIndex >= old.sortIndex);
    const before = candidates.filter((a) => a.sortIndex < old.sortIndex).at(-1);
    const found = after ?? before;
    if (found) return found.id;
  }
  return 'all';
}

/**
 * Tree typeahead (22 §2.3): the next item after `from` whose label starts with `text` (ignoring case),
 * wrapping round; the current item itself counts last. -1 when none matches.
 */
export function typeahead(labels: readonly string[], from: number, text: string): number {
  const needle = text.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const i = (from + step) % labels.length;
    if (labels[i]?.toLocaleLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

/**
 * The accounts as they'll be after a move within the account's group (08 §4), for an optimistic update
 * while the host writes it: the `sort_order` the host will write (04 §3).
 */
export function applyMove(
  accounts: readonly Account[],
  id: string,
  beforeId: string | null,
): Account[] {
  const moved = accounts.find((a) => a.id === id);
  if (!moved) return [...accounts];
  const group = groupOf(moved);
  const others = accounts.filter((a) => a.id !== id && groupOf(a) === group).sort(bySortOrder);
  const placement = placeAccount(others, id, beforeId);
  const orders = new Map(
    placement.kind === 'single'
      ? [[id, placement.sortOrder]]
      : placement.orders.map((o) => [o.id, o.sortOrder] as const),
  );
  return accounts.map((a) => {
    const sortIndex = orders.get(a.id) ?? a.sortIndex;
    return { ...a, sortIndex };
  });
}

/**
 * The `beforeId` for Move Up / Move Down (Alt+↑/↓, 22 §2.4) inside the account's group, or undefined
 * at the group's edge: a move never leaves its group.
 */
export function moveWithinGroup(
  group: readonly Pick<SidebarAccount, 'id'>[],
  id: string,
  direction: -1 | 1,
): string | null | undefined {
  const at = group.findIndex((a) => a.id === id);
  if (at === -1) return undefined;
  if (direction === -1) return at === 0 ? undefined : (group[at - 1]?.id ?? undefined);
  if (at === group.length - 1) return undefined;
  return group[at + 2]?.id ?? null;
}
