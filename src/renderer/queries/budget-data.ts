// Vue Query access to the open budget's data (02 §1, 03 §4.1). Keys start with the roots in
// rpc/query-keys.ts, so `data:changed` refetches them. Nothing is fetched without an open budget.
import { budgetFormatOf, DEFAULT_BUDGET_FORMAT, type BudgetFormat } from '@shared/budget-format';
import type { Rule } from '@shared/domain/rules';
import type { Account, CategoryGroup, Payee, TagEntity, Transaction } from '@shared/domain/types';
import { useQuery } from '@tanstack/vue-query';
import { computed, type ComputedRef, type Ref } from 'vue';
import { host } from '../rpc/host-client';
import { useConnection } from '../stores/connection';

export const accountsQuery = {
  queryKey: ['accounts'] as const,
  queryFn: (): Promise<Account[]> => host.call('accounts.list', {}),
};

export const categoriesQuery = {
  queryKey: ['categories'] as const,
  queryFn: (): Promise<CategoryGroup[]> => host.call('categories.tree', {}),
};

export const payeesQuery = {
  queryKey: ['payees'] as const,
  queryFn: (): Promise<Payee[]> => host.call('payees.list', {}),
};

export const rulesQuery = {
  queryKey: ['rules'] as const,
  queryFn: (): Promise<Rule[]> => host.call('rules.list', {}),
};

export const tagsQuery = {
  queryKey: ['tags'] as const,
  queryFn: (): Promise<TagEntity[]> => host.call('tags.list', {}),
};

/** The register's transactions (10 §4): one account, or 'all'. */
export const registerQuery = (accountId: string) => ({
  queryKey: ['register', accountId] as const,
  queryFn: (): Promise<Transaction[]> => host.call('transactions.list', { accountId }),
});

const prefsQuery = {
  queryKey: ['prefs', 'synced'] as const,
  queryFn: (): Promise<Record<string, string>> => host.call('prefs.synced', {}),
};

function budgetOpen(): ComputedRef<boolean> {
  const connection = useConnection();
  return computed(() => connection.info.budget !== null && connection.hostReady);
}

/** `accounts.list` (08 §5): every account with balances, attention and metadata. */
export function useAccounts() {
  return useQuery({ ...accountsQuery, enabled: budgetOpen() });
}

/** `categories.tree` (04 §2). */
export function useCategories() {
  return useQuery({ ...categoriesQuery, enabled: budgetOpen() });
}

/** `payees.list` (14 §1): usage, enabled state and rules. */
export function usePayees() {
  return useQuery({ ...payeesQuery, enabled: budgetOpen() });
}

/** `rules.list` (23 §4): every rule, in run order. */
export function useRules() {
  return useQuery({ ...rulesQuery, enabled: budgetOpen() });
}

/** `tags.list` (04 §5.2): the tag entities. */
export function useTags() {
  return useQuery({ ...tagsQuery, enabled: budgetOpen() });
}

/** Tag name → entity, for the pills' colors. Tags with no entity are not in the map. */
export function useTagMap(): ComputedRef<ReadonlyMap<string, TagEntity>> {
  const tags = useTags();
  return computed(() => new Map((tags.data.value ?? []).map((t) => [t.tag, t])));
}

/** `transactions.list` for a register. */
export function useRegisterTransactions(accountId: Ref<string>) {
  const open = budgetOpen();
  return useQuery(computed(() => ({ ...registerQuery(accountId.value), enabled: open.value })));
}

/** The budget's money and date formats (07 §4.2). */
export function useBudgetFormat(): ComputedRef<BudgetFormat> {
  const prefs = useQuery({ ...prefsQuery, enabled: budgetOpen() });
  return computed(() =>
    prefs.data.value ? budgetFormatOf(prefs.data.value) : DEFAULT_BUDGET_FORMAT,
  );
}
