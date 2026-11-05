// The editor's drop-down lists (11 §4): payees with the transfer entries, and categories with the split
// item, the income heading and each visible expense group. Also their filters.
import { categoryLabel } from '@shared/domain/categories';
import { ENGLISH_TRANSFER_PREFIX, transferAccountName } from '@shared/domain/payees';
import type { Account, CategoryGroup, Id, Payee } from '@shared/domain/types';
import { Split } from 'lucide-vue-next';
import { markRaw } from 'vue';
import {
  containsFilter,
  filterWith,
  type AutoCompleteEntry,
  type AutoCompleteFilter,
} from '../components/common/autocomplete-list';

export const PAYEE_PREFIX = 'p:';
export const TRANSFER_PREFIX = 't:';
export const CATEGORY_PREFIX = 'c:';
export const SPLIT_ITEM = 'split';
export const ADD_CATEGORY_ITEM = 'add-category';

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * The payee list (11 §4.1): enabled non-transfer payees, alphabetical; then "Transfer to/from account:"
 * and a transfer entry for every open account except `ownId`. `transfersOnly` excludes regular payees
 * (for the register's Transfer button and split lines).
 */
export function payeeEntries(
  payees: readonly Payee[],
  accounts: readonly Account[],
  ownId: Id | null,
  texts: { heading: string; transfer: (account: string) => string },
  transfersOnly = false,
): AutoCompleteEntry[] {
  const out: AutoCompleteEntry[] = [];
  if (!transfersOnly)
    for (const p of [...payees].filter((x) => x.enabled && !x.transferAccountId).sort(byName))
      out.push({ kind: 'item', id: `${PAYEE_PREFIX}${p.id}`, label: p.name });
  const targets = accounts.filter((a) => !a.closed && a.id !== ownId);
  if (targets.length > 0) {
    out.push({ kind: 'heading', id: 'transfer-heading', label: texts.heading });
    for (const a of targets)
      out.push({ kind: 'item', id: `${TRANSFER_PREFIX}${a.id}`, label: texts.transfer(a.name) });
  }
  return out;
}

/**
 * "contains" (11 §4.1), except that a complete transfer prefix lists the transfer entries whose account
 * name contains the rest.
 */
export function payeeFilter(prefix: string): AutoCompleteFilter {
  return (entries, query) => {
    const name = transferAccountName(query, [prefix, ENGLISH_TRANSFER_PREFIX]);
    if (name === null) return containsFilter(entries, query);
    const lower = name.toLocaleLowerCase();
    return entries.filter(
      (e) =>
        e.kind === 'heading' ||
        (e.id.startsWith(TRANSFER_PREFIX) &&
          (transferAccountName(e.label, [prefix, ENGLISH_TRANSFER_PREFIX]) ?? '')
            .toLocaleLowerCase()
            .includes(lower)),
    );
  };
}

/**
 * The category list (11 §4.2): the split item (main row only), the income heading and categories, then each
 * visible expense group and its visible categories. Labels are "Group: Category"; the list shows the name.
 */
export function categoryEntries(
  groups: readonly CategoryGroup[],
  opts: { split?: string; addNew?: string },
): AutoCompleteEntry[] {
  const out: AutoCompleteEntry[] = [];
  if (opts.split)
    out.push({ kind: 'item', id: SPLIT_ITEM, label: opts.split, icon: markRaw(Split) });
  if (opts.addNew) out.push({ kind: 'item', id: ADD_CATEGORY_ITEM, label: opts.addNew });
  const ordered = [...groups.filter((g) => g.isIncome), ...groups.filter((g) => !g.isIncome)];
  for (const g of ordered) {
    if (g.hidden) continue;
    const visible = g.categories.filter((c) => !c.hidden);
    if (visible.length === 0) continue;
    out.push({ kind: 'heading', id: `g:${g.id}`, label: `${g.name}:` });
    for (const c of visible)
      out.push({
        kind: 'item',
        id: `${CATEGORY_PREFIX}${c.id}`,
        label: categoryLabel(g, c),
        text: c.name,
      });
  }
  return out;
}

/**
 * Prefix matching (11 §4.2): a category matches when its name or "Group: Name" starts with the text;
 * "Ma: Su" matches a group prefix plus a category prefix. A heading stays when it or a child matches.
 */
export const categoryFilter: AutoCompleteFilter = filterWith((label, query) => {
  const l = label.toLocaleLowerCase();
  const q = query.trim().toLocaleLowerCase();
  if (q === '' || l.startsWith(q)) return true;
  const colon = l.indexOf(':');
  const name = colon === -1 ? l : l.slice(colon + 1).trim();
  if (name.startsWith(q)) return true;
  const qc = q.indexOf(':');
  if (qc === -1 || colon === -1) return false;
  const group = l.slice(0, colon).trim();
  return group.startsWith(q.slice(0, qc).trim()) && name.startsWith(q.slice(qc + 1).trim());
});
