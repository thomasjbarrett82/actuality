// What the rule dialogs share (23 §2–3): the text context (names, amounts and dates in the budget's
// formats, through privacy mode) and the picker entries for payees, accounts, categories and groups.
import { categoryLabel } from '@shared/domain/categories';
import type { Payee } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AutoCompleteEntry } from '../components/common/autocomplete-list';
import { moneyText } from '../money-display';
import { useAccounts, useBudgetFormat, useCategories, usePayees } from '../queries/budget-data';
import type { IdEntity } from './form';
import type { TextContext } from './text';

export interface RuleData {
  text: ComputedRef<TextContext>;
  entries: ComputedRef<Record<IdEntity, AutoCompleteEntry[]>>;
  payeeName: (p: Payee) => string;
}

export function useRuleData(): RuleData {
  const { t } = useI18n();
  const payeesQ = usePayees();
  const accountsQ = useAccounts();
  const categoriesQ = useCategories();
  const format = useBudgetFormat();

  const accounts = computed(() => accountsQ.data.value ?? []);
  const accountMap = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
  const payeeName = (p: Payee): string =>
    p.transferAccountId
      ? t('app.transferPayee', {
          account: accountMap.value.get(p.transferAccountId)?.name ?? p.name,
        })
      : p.name;
  const payees = computed(() =>
    [...(payeesQ.data.value ?? [])].sort((a, b) =>
      payeeName(a).localeCompare(payeeName(b), undefined, { sensitivity: 'base' }),
    ),
  );
  const groups = computed(() => categoriesQ.data.value ?? []);

  const text = computed<TextContext>(() => {
    const payeeMap = new Map(payees.value.map((p) => [p.id, payeeName(p)]));
    const categories = new Map(
      groups.value.flatMap((g) => g.categories.map((c) => [c.id, categoryLabel(g, c)] as const)),
    );
    const groupMap = new Map(groups.value.map((g) => [g.id, g.name]));
    const settings = format.value;
    return {
      t: (key, params) => t(key, params ?? {}),
      payee: (id) => payeeMap.get(id),
      account: (id) => accountMap.value.get(id)?.name,
      category: (id) => categories.get(id),
      group: (id) => groupMap.get(id),
      money: (m) => moneyText(m, settings.money),
      date: (d) => dateShort(d, settings.dateFormat),
    };
  });

  const entries = computed<Record<IdEntity, AutoCompleteEntry[]>>(() => ({
    payee: payees.value.map((p) => ({ kind: 'item', id: p.id, label: payeeName(p) })),
    account: [...accounts.value]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ kind: 'item', id: a.id, label: a.name })),
    category: groups.value.flatMap((g): AutoCompleteEntry[] => [
      { kind: 'heading', id: `g:${g.id}`, label: `${g.name}:` },
      ...g.categories.map((c): AutoCompleteEntry => ({
        kind: 'item',
        id: c.id,
        label: categoryLabel(g, c),
        text: c.name,
      })),
    ]),
    category_group: groups.value.map((g) => ({ kind: 'item', id: g.id, label: g.name })),
  }));

  return { text, entries, payeeName };
}
