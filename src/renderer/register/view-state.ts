// Per-account register view state (10 §10, 19 §2). Saved per budget and device: columns, sort, date
// filter, show-reconciled and the scheduler pane. In memory for the session: search text, selection, the
// expanded splits, scroll position, the last date saved for a new transaction and the undo notifier.
import { addMonths, monthOf, today } from '@shared/dates';
import {
  DEFAULT_SORT,
  defaultColumns,
  MAX_SORT_KEYS,
  SORTABLE_COLUMNS,
  visibilityKey,
  type ColumnSetting,
  type RegisterColumn,
  type RegisterSort,
} from '@shared/domain/register';
import type { Id, ISODate, Money, Month } from '@shared/domain/types';
import type { BudgetSettings } from '@shared/settings';
import { defineStore } from 'pinia';
import { reactive } from 'vue';

export type AccountView = BudgetSettings['register']['accounts'][string];

/** The date filter presets (10 §3), plus a custom range. */
export type DatePreset = 'all' | 'thisMonth' | 'latest3' | 'thisYear' | 'lastYear' | 'custom';

export interface DateFilter {
  preset: DatePreset;
  /** Inclusive months; null for All Dates. */
  from: Month | null;
  to: Month | null;
}

export const ALL_DATES: DateFilter = { preset: 'all', from: null, to: null };

/** The months a preset covers, relative to today (10 §3). */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, on: ISODate): DateFilter {
  const month = monthOf(on);
  const year = on.slice(0, 4);
  switch (preset) {
    case 'all':
      return ALL_DATES;
    case 'thisMonth':
      return { preset, from: month, to: month };
    case 'latest3':
      return { preset, from: addMonths(month, -2), to: month };
    case 'thisYear':
      return { preset, from: `${year}-01` as Month, to: `${year}-12` as Month };
    case 'lastYear': {
      const last = String(Number(year) - 1);
      return { preset, from: `${last}-01` as Month, to: `${last}-12` as Month };
    }
  }
}

/** A saved filter (19 §2 `dateFilter {label, start, end}`): presets are re-evaluated for today. */
export function readDateFilter(saved: AccountView['dateFilter'], on: ISODate): DateFilter {
  if (!saved) return ALL_DATES;
  const preset = saved.label as DatePreset;
  if (preset === 'custom')
    return saved.start && saved.end
      ? { preset, from: saved.start as Month, to: saved.end as Month }
      : ALL_DATES;
  if (['thisMonth', 'latest3', 'thisYear', 'lastYear'].includes(preset))
    return presetRange(preset, on);
  return ALL_DATES;
}

export function writeDateFilter(f: DateFilter): NonNullable<AccountView['dateFilter']> {
  return { label: f.preset, start: f.from ?? '', end: f.to ?? '' };
}

export const isFiltered = (f: DateFilter): boolean => f.preset !== 'all';

/** The column settings for an account, completed with defaults for any missing column. */
export function columnsOf(view: AccountView | undefined): ColumnSetting[] {
  const saved = view?.mainColumns ?? [];
  return defaultColumns().map((d) => saved.find((c) => c.field === d.field) ?? d);
}

/**
 * The first time an account is shown it copies the **widths** (not visibility) of the first other account
 * with the same visible columns (10 §2).
 */
export function initialColumns(
  accounts: BudgetSettings['register']['accounts'],
  accountId: Id,
): ColumnSetting[] {
  const own = columnsOf(accounts[accountId]);
  if (accounts[accountId]?.mainColumns) return own;
  const key = visibilityKey(own);
  const donor = Object.entries(accounts).find(
    ([id, v]) => id !== accountId && v.mainColumns && visibilityKey(columnsOf(v)) === key,
  );
  if (!donor) return own;
  const widths = columnsOf(donor[1]);
  return own.map((c) => ({
    ...c,
    width: widths.find((w) => w.field === c.field)?.width ?? c.width,
  }));
}

/**
 * Saving an account's columns also copies its widths to every other account with the same visible
 * columns (10 §2). With `all`, every account takes the whole setting ("Apply current settings to all
 * existing accounts").
 */
export function saveColumns(
  accounts: BudgetSettings['register']['accounts'],
  accountId: Id,
  columns: readonly ColumnSetting[],
  all: readonly Id[] | null = null,
): BudgetSettings['register']['accounts'] {
  const next = { ...accounts, [accountId]: { ...accounts[accountId], mainColumns: [...columns] } };
  if (all) {
    for (const id of all) next[id] = { ...next[id], mainColumns: columns.map((c) => ({ ...c })) };
    return next;
  }
  const key = visibilityKey(columns);
  for (const [id, v] of Object.entries(next)) {
    if (id === accountId || !v.mainColumns || visibilityKey(columnsOf(v)) !== key) continue;
    next[id] = {
      ...v,
      mainColumns: columnsOf(v).map((c) => ({
        ...c,
        width: columns.find((x) => x.field === c.field)?.width ?? c.width,
      })),
    };
  }
  return next;
}

/**
 * The register's sort keys (10 §2, 19 §2): a saved single key reads as one key; unknown and repeated
 * columns are dropped, and an empty list is the default.
 */
export function sortOf(view: AccountView | undefined): RegisterSort[] {
  const s = view?.mainSort;
  const saved = !s ? [] : Array.isArray(s) ? s : [s];
  const keys: RegisterSort[] = [];
  for (const k of saved) {
    const field = k.field as RegisterColumn;
    if (!SORTABLE_COLUMNS.has(field) || keys.some((x) => x.field === field)) continue;
    keys.push({ field, desc: k.desc });
  }
  return keys.length ? keys.slice(0, MAX_SORT_KEYS) : [DEFAULT_SORT];
}

/** The Undo notifier's state (10 §5): the token and the text to show. */
export interface UndoNotice {
  token: string;
  kind: 'deleted' | 'moved' | 'dated';
  count: number;
  account?: string;
}

/** Reconciliation in progress (13 §6.1): kept for the session only, never saved. */
export interface ReconcileSession {
  statementDate: ISODate;
  /** The statement balance, signed as stored. */
  target: Money;
  /** The search before reconciling, restored afterwards (13 §6.3). */
  savedSearch: string;
}

/** What each register keeps for the session (10 §10, 19 §5). */
export interface SessionView {
  search: string;
  selection: Set<Id>;
  /** The row a Shift+click or Shift+↑/↓ extends from. */
  anchor: Id | null;
  /** The row ↑/↓ move from (the grid's focused row). */
  focus: Id | null;
  expanded: Set<Id>;
  /** −1 means the bottom. */
  scroll: number;
  /** Before the first search: restored when the search is cleared (10 §4). */
  beforeSearch: { expanded: Set<Id>; scroll: number } | null;
  reconcile: ReconcileSession | null;
}

export const useRegisterSession = defineStore('registerSession', () => {
  const views = reactive(new Map<string, SessionView>());
  /** The last date saved for a new transaction, for the session (11 §3). */
  const state = reactive<{
    lastAddDate: ISODate | null;
    undo: UndoNotice | null;
    /** "Matched to scheduled transaction '{payee}'" after a commit (12 §2). */
    matched: string | null;
    /** A schedule just made from a transaction (12 §4): the panel shows and selects it. */
    scheduled: Id | null;
  }>({
    lastAddDate: null,
    undo: null,
    matched: null,
    scheduled: null,
  });

  function view(accountId: string): SessionView {
    let v = views.get(accountId);
    if (!v) {
      v = {
        search: '',
        selection: new Set(),
        anchor: null,
        focus: null,
        expanded: new Set(),
        scroll: -1,
        beforeSearch: null,
        reconcile: null,
      };
      views.set(accountId, v);
    }
    return views.get(accountId) ?? v;
  }

  /** A budget opened: forget the previous budget's registers. */
  function reset(): void {
    views.clear();
    state.lastAddDate = null;
    state.undo = null;
    state.matched = null;
    state.scheduled = null;
  }

  return { views, state, view, reset };
});

/** "Today" in the user's time zone, as the register uses it. */
export const todayDate = (): ISODate => today(new Date());
