// Vue Query keys and scoped invalidation (03 §4.1): `data:changed.tables` → the queries to refetch.
// Any other or unknown table invalidates every host query. Only active queries refetch. Queries that
// aren't host data (the news feed and update check, 24 §4.3) are never invalidated here.
import type { QueryClient } from '@tanstack/vue-query';

/** Query key roots. Each feature's keys start with one of these. */
export const QUERY_ROOTS = [
  'register',
  'budgetMonth',
  'accounts',
  'reports',
  'categories',
  'payees',
  'rules',
  'tags',
  'schedules',
  'notes',
  'metadata',
  'prefs',
] as const;

export type QueryRoot = (typeof QUERY_ROOTS)[number];

/** Roots of queries main answers, not the host (news/use-news.ts): `data:changed` never touches them. */
const SHELL_QUERY_ROOTS: readonly unknown[] = ['news', 'updates', 'app'];

// The host derives some fields from other tables, so a table also refreshes the queries that read it:
// payee names on register rows, transfer names and on/off-budget error states from accounts, account
// notes and `ad:payees` metadata from notes, schedule counts in accounts and payees, and
// schedule names and merged payees in the rules list (23 §2). Reports read transactions, accounts,
// categories, payees and the format prefs (15 §7), and nothing else.
const TABLE_ROOTS: Record<string, readonly QueryRoot[]> = {
  transactions: ['register', 'budgetMonth', 'accounts', 'reports'],
  categories: ['categories', 'budgetMonth', 'reports'],
  category_groups: ['categories', 'budgetMonth', 'reports'],
  category_mapping: ['categories', 'budgetMonth', 'reports'],
  zero_budgets: ['categories', 'budgetMonth'],
  reflect_budgets: ['categories', 'budgetMonth'],
  payees: ['payees', 'register', 'rules', 'reports'],
  payee_mapping: ['payees', 'register', 'rules', 'reports'],
  rules: ['payees', 'rules'],
  tags: ['tags', 'register'],
  schedules: ['schedules', 'accounts', 'payees', 'rules'],
  notes: ['notes', 'metadata', 'accounts', 'categories', 'payees'],
  accounts: ['accounts', 'register', 'budgetMonth', 'payees', 'reports'],
  preferences: ['prefs', 'reports'],
};

/** The query roots to invalidate for a set of changed tables, or 'all'. */
export function rootsFor(tables: readonly string[]): Set<QueryRoot> | 'all' {
  const roots = new Set<QueryRoot>();
  for (const table of tables) {
    const mapped = TABLE_ROOTS[table];
    if (!mapped) return 'all';
    for (const r of mapped) roots.add(r);
  }
  return roots;
}

export async function invalidateTables(
  client: QueryClient,
  tables: readonly string[],
): Promise<void> {
  const roots = rootsFor(tables);
  if (roots === 'all') {
    await client.invalidateQueries({
      predicate: (q) => !SHELL_QUERY_ROOTS.includes(q.queryKey[0]),
      refetchType: 'active',
    });
    return;
  }
  await Promise.all(
    [...roots].map((root) => client.invalidateQueries({ queryKey: [root], refetchType: 'active' })),
  );
}
