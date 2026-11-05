// Reports view state (15 §1–3): the active tab, the linked filters every page shares, the pages that loaded
// a saved filter (an override, isolated from the linked filters), and the page options, Comparison's
// Compare Period among them. None of it is persisted: each launch, and each budget opened, starts on
// Summary with the default filters (19 §2). Saved filter definitions persist per budget and device in the
// budget settings file.
import { today as todayOf } from '@shared/dates';
import type { Id } from '@shared/domain/types';
import {
  DEFAULT_BREAKDOWN,
  DEFAULT_FILTERS,
  DEFAULT_NET_WORTH,
  type AccountSelection,
  type BreakdownOptions,
  type CommonFilters,
  type ComparisonOptions,
  type NetWorthOptions,
  type ReportPage,
  type SavedFilter,
  type Selection,
} from '@shared/reporting/model';
import { defaultComparison } from '@shared/reporting/periods';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useBudgetSettings } from '../stores/budget-settings';

/** A filter bar control: a common filter, or Comparison's Compare Period. */
export type FilterKey = keyof CommonFilters | 'comparePeriod';

/** The filters a page shows (15 §2.1): Comparison has Compare Period, Net Worth no Categories or Payees. */
export function pageFilterKeys(page: ReportPage): FilterKey[] {
  if (page === 'netWorth') return ['timeframe', 'accounts'];
  return [
    'categories',
    page === 'comparison' ? 'comparePeriod' : 'timeframe',
    'payees',
    'accounts',
  ];
}

/** A selection whose ids pass `keep`, in a stable order (equal selections compare equal). */
function mapIds<T extends Selection | AccountSelection>(s: T, keep: (ids: Id[]) => Id[]): T {
  return s.kind === 'ids' ? { ...s, ids: keep(s.ids) } : s;
}

/** A page's filters with sorted ids and the keys in one order, so equal filters compare equal. */
function normalized<F extends Partial<CommonFilters>>(filters: F): F {
  const sortIds = <T extends Selection | AccountSelection>(s: T): T =>
    mapIds(s, (ids) => [...ids].sort());
  const { categories, timeframe, payees, accounts } = filters;
  return {
    ...(categories && { categories: sortIds(categories) }),
    ...(timeframe && { timeframe }),
    ...(payees && { payees: sortIds(payees) }),
    ...(accounts && { accounts: sortIds(accounts) }),
  } as F;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A page's current selections as a saved definition (15 §3). */
export function definitionOf(
  page: ReportPage,
  name: string,
  filters: CommonFilters,
  breakdown: BreakdownOptions,
  comparison: ComparisonOptions,
  netWorth: NetWorthOptions,
): SavedFilter {
  const f = normalized(filters);
  switch (page) {
    case 'breakdown':
      return { page, name, filters: f, options: { ...breakdown } };
    case 'comparison':
      return {
        page,
        name,
        filters: { categories: f.categories, payees: f.payees, accounts: f.accounts },
        options: { unit: comparison.unit, start: comparison.start },
      };
    case 'netWorth':
      return {
        page,
        name,
        filters: { timeframe: f.timeframe, accounts: f.accounts },
        options: { ...netWorth },
      };
    default:
      return { page, name, filters: f };
  }
}

/** The selections part of a definition, without its name: what "exactly matches" compares. */
const selections = (d: SavedFilter): unknown => ({
  ...d,
  name: '',
  filters: normalized(d.filters),
});

/** Saved names are unique without regard to case within a page (15 §3). */
export const foldName = (name: string): string => name.trim().toLocaleLowerCase();

export const useReportsView = defineStore('reportsView', () => {
  const tab = ref<ReportPage>('summary');
  /** The linked filters (15 §2.1). */
  const shared = ref<CommonFilters>(DEFAULT_FILTERS);
  /** Pages in saved-filter override, with their own filters. */
  const overrides = ref<Partial<Record<ReportPage, CommonFilters>>>({});
  const breakdown = ref<BreakdownOptions>({ ...DEFAULT_BREAKDOWN });
  /** Comparison's Compare Period: page-specific, never linked or overridden (15 §2.1). */
  const comparison = ref<ComparisonOptions>(defaultComparison(todayOf(new Date())));
  const netWorth = ref<NetWorthOptions>({ ...DEFAULT_NET_WORTH });

  const budgetSettings = useBudgetSettings();

  /** A page's effective committed filters. */
  const filtersOf = (page: ReportPage): CommonFilters => overrides.value[page] ?? shared.value;
  const isOverride = (page: ReportPage): boolean => overrides.value[page] !== undefined;

  /** Done on a filter (15 §2.1): an override page keeps it to itself; a linked page shares it. */
  function setFilters(page: ReportPage, patch: Partial<CommonFilters>): void {
    const own = overrides.value[page];
    if (own) overrides.value = { ...overrides.value, [page]: { ...own, ...patch } };
    else shared.value = { ...shared.value, ...patch };
  }

  /** Use linked filters: drop the page's override and adopt the shared filters. */
  function useLinked(page: ReportPage): void {
    overrides.value = Object.fromEntries(
      Object.entries(overrides.value).filter(([p]) => p !== page),
    );
  }

  function setBreakdown(patch: Partial<BreakdownOptions>): void {
    breakdown.value = { ...breakdown.value, ...patch };
  }

  function setComparison(options: ComparisonOptions): void {
    comparison.value = { ...options };
  }

  function setNetWorth(patch: Partial<NetWorthOptions>): void {
    netWorth.value = { ...netWorth.value, ...patch };
  }

  /** Load a saved definition (15 §3): only this page, which goes into override. */
  function load(def: SavedFilter): void {
    const filters: CommonFilters = { ...shared.value, ...def.filters };
    overrides.value = { ...overrides.value, [def.page]: filters };
    if (def.page === 'breakdown') breakdown.value = { ...def.options };
    if (def.page === 'comparison') comparison.value = { ...def.options };
    if (def.page === 'netWorth') netWorth.value = { ...def.options };
  }

  // ---------------------------------------------------------------------------------- saved filters

  const savedByPage = computed(() => budgetSettings.settings.reports.savedFiltersByPage);
  const saved = (page: ReportPage): SavedFilter[] => savedByPage.value[page] ?? [];

  /** The page's current selections as a definition named `name`. */
  const current = (page: ReportPage, name = ''): SavedFilter =>
    definitionOf(page, name, filtersOf(page), breakdown.value, comparison.value, netWorth.value);

  /** The saved definition that exactly matches the page's selections, if any (15 §3). */
  function matching(page: ReportPage): SavedFilter | null {
    const now = selections(current(page));
    return saved(page).find((d) => same(selections(d), now)) ?? null;
  }

  function writeSaved(page: ReportPage, list: SavedFilter[]): Promise<void> {
    return budgetSettings.patch((s) => ({
      reports: {
        savedFiltersByPage: { ...s.reports.savedFiltersByPage, [page]: list },
      },
    }));
  }

  /** Save the current selections under a new name (15 §3). */
  async function save(page: ReportPage, name: string): Promise<void> {
    await writeSaved(page, [...saved(page), current(page, name.trim())]);
  }

  /** Replace a definition's selections with the current ones, keeping its name. */
  async function replace(page: ReportPage, name: string): Promise<void> {
    const key = foldName(name);
    await writeSaved(
      page,
      saved(page).map((d) => (foldName(d.name) === key ? current(page, d.name) : d)),
    );
  }

  async function rename(page: ReportPage, from: string, to: string): Promise<void> {
    const key = foldName(from);
    await writeSaved(
      page,
      saved(page).map((d) => (foldName(d.name) === key ? { ...d, name: to.trim() } : d)),
    );
  }

  async function remove(page: ReportPage, name: string): Promise<void> {
    const key = foldName(name);
    await writeSaved(
      page,
      saved(page).filter((d) => foldName(d.name) !== key),
    );
  }

  /**
   * Drops ids that no longer exist from every saved definition (19 §2), writing only when something went.
   * `known` holds every current category, payee and account id.
   */
  async function prune(known: ReadonlySet<Id>): Promise<void> {
    const tally = { changed: false };
    const keep = <T extends Selection | AccountSelection>(s: T): T =>
      mapIds(s, (ids) => {
        const kept = ids.filter((id) => known.has(id));
        if (kept.length !== ids.length) tally.changed = true;
        return kept;
      });
    const next: Partial<Record<ReportPage, SavedFilter[]>> = {};
    for (const [page, list] of Object.entries(savedByPage.value) as [ReportPage, SavedFilter[]][])
      next[page] = list.map((d): SavedFilter => {
        if (d.page === 'netWorth')
          return { ...d, filters: { ...d.filters, accounts: keep(d.filters.accounts) } };
        if (d.page === 'comparison') {
          const { categories, payees, accounts } = d.filters;
          return {
            ...d,
            filters: {
              categories: keep(categories),
              payees: keep(payees),
              accounts: keep(accounts),
            },
          };
        }
        const f = d.filters;
        const filters = {
          ...f,
          categories: keep(f.categories),
          payees: keep(f.payees),
          accounts: keep(f.accounts),
        };
        return { ...d, filters };
      });
    if (tally.changed) await budgetSettings.patch({ reports: { savedFiltersByPage: next } });
  }

  /** Back to Summary with the defaults: every launch and every budget opened (15 §1, 19 §2). */
  function reset(): void {
    tab.value = 'summary';
    shared.value = DEFAULT_FILTERS;
    overrides.value = {};
    breakdown.value = { ...DEFAULT_BREAKDOWN };
    comparison.value = defaultComparison(todayOf(new Date()));
    netWorth.value = { ...DEFAULT_NET_WORTH };
  }

  return {
    tab,
    shared,
    overrides,
    breakdown,
    comparison,
    netWorth,
    filtersOf,
    isOverride,
    setFilters,
    useLinked,
    setBreakdown,
    setComparison,
    setNetWorth,
    load,
    saved,
    matching,
    save,
    replace,
    rename,
    remove,
    prune,
    reset,
  };
});
