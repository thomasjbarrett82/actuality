// One register's state (10, 11): its data, the sort order (applied on load and after a commit, on F5 and
// on filter changes, never live while a row is being edited), the filters, the rows the grid shows (split
// lines as extra rows), the running balances, the selection, the summary totals and the editor's lifecycle.
// The panel creates it and its children inject it.
import { monthOf } from '@shared/dates';
import { categoryLabel } from '@shared/domain/categories';
import {
  comparator,
  nextSortKeys,
  RECONCILE_SORT,
  runningBalancesById,
  type ColumnSetting,
  type RegisterColumn,
  type RegisterSort,
  type RunningBalance,
  type ToggleableColumn,
} from '@shared/domain/register';
import type { Account, ErrorLevel, Id, ISODate, Money, Transaction } from '@shared/domain/types';
import { compileSearch, isShown, type MatchResult } from '@shared/search/match';
import { parseSearch } from '@shared/search/parser';
import { useQueryClient } from '@tanstack/vue-query';
import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  reactive,
  ref,
  watch,
  type InjectionKey,
  type Ref,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../a11y/announcer';
import { dateLocale } from '../i18n';
import { keyboard } from '../keyboard/dispatcher';
import {
  useAccounts,
  useBudgetFormat,
  useCategories,
  usePayees,
  useRegisterTransactions,
} from '../queries/budget-data';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import { useSettings } from '../stores/settings';
import { dismissUndo } from './actions';
import { runCommit, type CommitOutcome } from './commit';
import { setEditGuard } from './edit-guard';
import {
  blankEdit,
  changesOf,
  cloneEdit,
  fromTransaction,
  isBlankNew,
  type EditableTransaction,
} from './editable';
import { buildRows, rowContext, type LineView, type RowView } from './rows';
import { parseContext, quotedSearch, uiSearchWords } from './search';
import {
  initialColumns,
  isFiltered,
  readDateFilter,
  saveColumns,
  sortOf,
  todayDate,
  useRegisterSession,
  writeDateFilter,
  type AccountView,
  type DateFilter,
} from './view-state';

/** A row of the grid: a transaction, a split line, or the new transaction's editor at the top. */
export type GridItem =
  | {
      kind: 'row';
      key: string;
      row: RowView;
      /** Position among the shown transactions, for alternating colors and aria-rowindex. */
      index: number;
      match: MatchResult | null;
      balance: RunningBalance | null;
      /** Shown only for context in a search (10 §2.1): never for a parent row. */
      expanded: boolean;
    }
  | { kind: 'line'; key: string; row: RowView; line: LineView; lineIndex: number; matched: boolean }
  | { kind: 'new'; key: 'new' };

/** A transaction the filters let through, with what matched. */
export interface Shown {
  row: RowView;
  match: MatchResult | null;
}

export type EditField =
  'account' | 'date' | 'check' | 'payee' | 'category' | 'notes' | 'outflow' | 'inflow';

export interface EditorState {
  /** The transaction edited; null for a new transaction. */
  id: Id | null;
  draft: EditableTransaction;
  original: EditableTransaction;
  /** The field to focus when the editor opens. */
  focus: EditField;
  /** Transfer: open the payee list on "Transfer :" (11 §1). */
  transfer: boolean;
  /** Bumped when a blocked click makes the button row glow (10 §9). */
  glow: number;
  busy: boolean;
}

export type CommitMode = 'done' | 'approve' | 'approveNext' | 'save' | 'saveAdd';

/** Debounce for the search filter (21 §5). */
const SEARCH_DEBOUNCE_MS = 100;
/** The search result announcement waits for this much idle time (22 §4.5). */
const ANNOUNCE_IDLE_MS = 500;

function levelCount(rows: readonly RowView[], level: ErrorLevel): number {
  return rows.filter((r) => r.t.errorLevel === level).length;
}

export function createRegister(accountId: Ref<string>) {
  const { t } = useI18n();
  const connection = useConnection();
  const budgetSettings = useBudgetSettings();
  const appSettings = useSettings();
  const session = useRegisterSession();
  const queryClient = useQueryClient();
  const format = useBudgetFormat();
  const accountsQ = useAccounts();
  const categoriesQ = useCategories();
  const payeesQ = usePayees();
  const txQ = useRegisterTransactions(accountId);

  const isAll = computed(() => accountId.value === 'all');
  const accounts = computed<Account[]>(() => accountsQ.data.value ?? []);
  const accountMap = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
  const account = computed(() => accountMap.value.get(accountId.value));
  const groups = computed(() => categoriesQ.data.value ?? []);
  const payees = computed(() => payeesQ.data.value ?? []);
  const canEdit = computed(() => connection.canEdit);
  const loaded = computed(
    () =>
      txQ.data.value !== undefined &&
      accountsQ.data.value !== undefined &&
      categoriesQ.data.value !== undefined,
  );

  // ----------------------------------------------------------------------------------- view state

  const allViews = computed(() => budgetSettings.settings.register.accounts);
  const saved = computed<AccountView | undefined>(() => allViews.value[accountId.value]);
  const sessionView = computed(() => session.view(accountId.value));
  const today = ref<ISODate>(todayDate());

  const columns = computed<ColumnSetting[]>(() => initialColumns(allViews.value, accountId.value));
  /** Reconciliation in progress (13 §6.2): sorted by date, unreconciled rows up to the statement date. */
  const reconcile = computed(() => (isAll.value ? null : sessionView.value.reconcile));
  const reconciling = computed(() => reconcile.value !== null);
  /** The sort keys, primary first (10 §2); reconciling forces Date ascending without changing them. */
  const sort = computed<RegisterSort[]>(() =>
    reconciling.value ? [RECONCILE_SORT] : sortOf(saved.value),
  );
  const dateFilter = computed<DateFilter>(() =>
    readDateFilter(saved.value?.dateFilter, today.value),
  );
  const showReconciledSaved = computed(() => saved.value?.showReconciled ?? true);

  async function patchView(p: Partial<AccountView>): Promise<void> {
    const id = accountId.value;
    await budgetSettings.patch(({ register }) => ({
      register: {
        ...register,
        accounts: { ...register.accounts, [id]: { ...register.accounts[id], ...p } },
      },
    }));
  }

  async function setColumns(next: readonly ColumnSetting[], applyToAll = false): Promise<void> {
    const id = accountId.value;
    const ids = applyToAll ? accounts.value.map((a) => a.id) : null;
    await budgetSettings.patch(({ register }) => ({
      register: { ...register, accounts: saveColumns(register.accounts, id, next, ids) },
    }));
  }

  /** Which columns show (10 §2). */
  const visible = computed(() => {
    const v = (field: string): boolean =>
      columns.value.find((c) => c.field === field)?.visible ?? true;
    const onBudget = isAll.value || account.value?.onBudget !== false;
    const errorShown = isAll.value
      ? rows.value.some((r) => r.t.errorLevel !== 'none')
      : (account.value?.attention.maxLevel ?? 'none') !== 'none';
    const set = new Set<RegisterColumn>(['select', 'date', 'payee', 'outflow', 'inflow']);
    if (isAll.value) set.add('account');
    if (v('check')) set.add('check');
    if (errorShown) set.add('error');
    if (onBudget) set.add('category');
    if (v('notes')) set.add('notes');
    if (v('balance') && !isAll.value) set.add('balance');
    if (v('cleared') || reconciling.value) set.add('cleared');
    return set;
  });

  // ----------------------------------------------------------------------------------- rows

  const texts = computed(() => ({
    transfer: (name: string) => t('app.transferPayee', { account: name }),
    split: t('register.splitCategoryOption'),
    notNeeded: t('app.regCategoryNotNeeded'),
  }));
  const ctx = computed(() => rowContext(accounts.value, groups.value, texts.value));
  const rows = computed<RowView[]>(() => buildRows(ctx.value, txQ.data.value ?? []));
  const byId = computed(() => new Map(rows.value.map((r) => [r.t.id, r])));

  const editor = ref<EditorState | null>(null);

  /** The sort order, as ids. Not re-sorted live while an edit is open. */
  const order = ref<Id[]>([]);
  function resort(): void {
    const cmp = comparator(sort.value, { sameDayByAmount: true });
    order.value = [...rows.value].sort((a, b) => cmp(a.sort, b.sort)).map((r) => r.t.id);
  }
  function mergeOrder(): void {
    const known = new Set(rows.value.map((r) => r.t.id));
    const kept = order.value.filter((id) => known.has(id));
    const have = new Set(kept);
    order.value = [...kept, ...rows.value.filter((r) => !have.has(r.t.id)).map((r) => r.t.id)];
  }
  watch(
    [rows, sort],
    () => {
      if (editor.value) mergeOrder();
      else resort();
    },
    { immediate: true },
  );
  const ordered = computed(() => order.value.flatMap((id) => byId.value.get(id) ?? []));

  /**
   * Running balances over the unfiltered list in the balance order derived from the Date, Outflow and
   * Inflow keys, whatever else the display sort is (10 §7.4, §11 criterion 3); not in All Accounts.
   */
  const balances = computed(() =>
    isAll.value
      ? new Map<Id, RunningBalance>()
      : runningBalancesById(
          rows.value.map((r) => r.sort),
          sort.value,
        ),
  );

  // ----------------------------------------------------------------------------------- filters

  /** The session's scroll position (10 §10): −1 is the bottom. */
  const scroll = computed({
    get: () => sessionView.value.scroll,
    set: (v: number) => {
      sessionView.value.scroll = v;
    },
  });
  const searchText = computed({
    get: () => sessionView.value.search,
    set: (v: string) => {
      sessionView.value.search = v;
    },
  });
  const appliedSearch = ref(searchText.value);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  watch(searchText, (v) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      appliedSearch.value = v;
    }, SEARCH_DEBOUNCE_MS);
  });
  watch(accountId, () => {
    appliedSearch.value = searchText.value;
  });
  const searching = computed(() => quotedSearch(appliedSearch.value) !== '');
  const dateFiltered = computed(() => !reconciling.value && isFiltered(dateFilter.value));
  /** The register is filtered: search text, a date filter, or reconciling (10 §3). */
  const filtered = computed(() => searching.value || dateFiltered.value || reconciling.value);
  const showReconciled = computed(
    () => !reconciling.value && (filtered.value || showReconciledSaved.value),
  );

  const words = computed(() => uiSearchWords(dateLocale.value));
  const matcher = computed(() => {
    const terms = parseSearch(
      appliedSearch.value,
      parseContext(
        words.value,
        format.value.money.numberFormat,
        format.value.dateFormat,
        today.value,
      ),
    );
    return compileSearch(terms, {
      payeeNames: new Set(
        payees.value.map((p) =>
          (p.transferAccountId
            ? t('app.transferPayee', {
                account: accountMap.value.get(p.transferAccountId)?.name ?? p.name,
              })
            : p.name
          ).toLocaleLowerCase(),
        ),
      ),
      categoryNames: new Set(
        groups.value.flatMap((g) =>
          g.categories.map((c) => categoryLabel(g, c).toLocaleLowerCase()),
        ),
      ),
      numberFormat: format.value.money.numberFormat,
    });
  });

  // Re-sort when the filters change (10 §2).
  watch([appliedSearch, dateFilter, showReconciled], () => {
    if (!editor.value) resort();
  });

  // Splits' expand/collapse state and scroll from before the first search come back after it (10 §4).
  watch(searching, (now, before) => {
    const v = sessionView.value;
    if (now && !before) v.beforeSearch = { expanded: new Set(v.expanded), scroll: v.scroll };
    else if (!now && before && v.beforeSearch) {
      v.expanded = v.beforeSearch.expanded;
      v.scroll = v.beforeSearch.scroll;
      v.beforeSearch = null;
    }
  });

  const shown = computed<Shown[]>(() => {
    const f = dateFilter.value;
    const m = matcher.value;
    const hideReconciled = !showReconciled.value;
    const until = reconcile.value?.statementDate ?? null;
    const out: Shown[] = [];
    for (const row of ordered.value) {
      if (hideReconciled && row.t.cleared === 'R') continue;
      if (until !== null && row.t.date > until) continue;
      if (until === null && f.from && f.to) {
        const month = monthOf(row.t.date);
        if (month < f.from || month > f.to) continue;
      }
      if (m) {
        const match = m(row.search);
        if (!isShown(match)) continue;
        out.push({ row, match });
      } else out.push({ row, match: null });
    }
    return out;
  });

  /** The split is open: by the user, or because a search left some of it unmatched (10 §4). */
  function isExpanded(s: Shown): boolean {
    if (s.row.lines.length === 0) return false;
    if (s.match && (!s.match.row || s.match.lines.some((l) => !l))) return true;
    return sessionView.value.expanded.has(s.row.t.id);
  }

  const items = computed<GridItem[]>(() => {
    const out: GridItem[] = [];
    const editing = editor.value?.id ?? null;
    // The toolbar's Add and Transfer open the new transaction's editor as the first row (10 §3).
    if (editor.value && editing === null) out.push({ kind: 'new', key: 'new' });
    shown.value.forEach((s, index) => {
      const expanded = isExpanded(s);
      out.push({
        kind: 'row',
        key: s.row.t.id,
        row: s.row,
        index,
        match: s.match,
        balance: balances.value.get(s.row.t.id) ?? null,
        expanded,
      });
      if (!expanded || editing === s.row.t.id) return;
      s.row.lines.forEach((line, lineIndex) => {
        out.push({
          kind: 'line',
          key: `${s.row.t.id}:${line.line.id}`,
          row: s.row,
          line,
          lineIndex,
          matched: s.match ? (s.match.lines[lineIndex] ?? false) : true,
        });
      });
    });
    return out;
  });

  function toggleExpanded(id: Id, open?: boolean): void {
    const set = sessionView.value.expanded;
    const want = open ?? !set.has(id);
    if (want) set.add(id);
    else set.delete(id);
  }

  // ----------------------------------------------------------------------------------- selection

  const selection = computed(() => sessionView.value.selection);
  const selectedRows = computed(() =>
    shownIds.value.flatMap((id) =>
      selection.value.has(id) ? [byId.value.get(id)?.t ?? []].flat() : [],
    ),
  );
  const shownIds = computed(() => shown.value.map((s) => s.row.t.id));

  function select(id: Id, mods: { toggle?: boolean; range?: boolean } = {}): void {
    const v = sessionView.value;
    if (mods.range && v.anchor) {
      const ids = shownIds.value;
      const a = ids.indexOf(v.anchor);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        v.selection = new Set(ids.slice(lo, hi + 1));
        return;
      }
    }
    if (mods.toggle) {
      const next = new Set(v.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      v.selection = next;
    } else {
      v.selection = new Set([id]);
    }
    v.anchor = id;
  }

  function selectAll(on = true): void {
    sessionView.value.selection = on ? new Set(shownIds.value) : new Set();
  }

  /** ↑/↓ (10 §9): moves the selection; Shift extends it. Returns the newly focused row. */
  function moveSelection(delta: 1 | -1, extend: boolean): Id | null {
    const ids = shownIds.value;
    if (ids.length === 0) return null;
    const v = sessionView.value;
    const current = [...v.selection].map((id) => ids.indexOf(id)).filter((i) => i !== -1);
    const focusAt = v.focus !== null ? ids.indexOf(v.focus) : -1;
    const from =
      focusAt !== -1
        ? focusAt
        : delta > 0
          ? Math.max(-1, ...current)
          : current.length
            ? Math.min(...current)
            : ids.length;
    const to = Math.min(Math.max(from + delta, 0), ids.length - 1);
    const id = ids[to] ?? null;
    if (id === null) return null;
    if (extend) select(id, { range: true });
    else select(id);
    v.focus = id;
    if (!extend) v.anchor = id;
    return id;
  }

  // Selection that's no longer shown is dropped.
  watch(shownIds, (ids) => {
    const set = new Set(ids);
    const v = sessionView.value;
    const kept = [...v.selection].filter((id) => set.has(id));
    if (kept.length !== v.selection.size) v.selection = new Set(kept);
  });

  // ----------------------------------------------------------------------------------- summary

  const balancesTotal = computed(() => {
    const list = isAll.value ? accounts.value : account.value ? [account.value] : [];
    return list.reduce(
      (s, a) => ({
        cleared: s.cleared + a.balances.cleared,
        uncleared: s.uncleared + a.balances.uncleared,
        working: s.working + a.balances.working,
      }),
      { cleared: 0, uncleared: 0, working: 0 },
    );
  });
  const selectedTotal = computed(() => selectedRows.value.reduce((s, x) => s + x.amount, 0));
  /** Search Total counts only the matching lines of splits (10 §4). */
  const searchTotal = computed<{ total: Money; count: number }>(() => {
    let total = 0;
    for (const s of shown.value) {
      if (s.match && s.row.lines.length > 0 && s.match.lines.some(Boolean)) {
        s.row.lines.forEach((l, i) => {
          if (s.match?.lines[i]) total += l.line.amount;
        });
      } else total += s.row.t.amount;
    }
    return { total, count: shown.value.length };
  });

  /** The reconciliation footer's numbers (13 §6.2), over the unfiltered reconcile list. */
  const reconcileTotals = computed(() => {
    const r = reconcile.value;
    const reconciled = account.value?.balances.reconciled ?? 0;
    if (!r) return { reconciled, clearedAbove: 0, clearedAsOf: reconciled, difference: 0 };
    const clearedAbove = rows.value
      .filter((x) => x.t.cleared === 'C' && x.t.date <= r.statementDate)
      .reduce((s, x) => s + x.t.amount, 0);
    const clearedAsOf = reconciled + clearedAbove;
    return { reconciled, clearedAbove, clearedAsOf, difference: clearedAsOf - r.target };
  });

  /** Begin (or adjust) reconciliation (13 §6.1): the search is cleared and restored afterwards. */
  function beginReconcile(statementDate: ISODate, target: Money): void {
    const v = sessionView.value;
    const first = v.reconcile === null;
    v.reconcile = { statementDate, target, savedSearch: v.reconcile?.savedSearch ?? v.search };
    if (first) v.search = '';
    appliedSearch.value = v.search;
    resort();
  }

  /** Leaves reconcile mode (Stop Reconciling, or after Finish): the previous search comes back. */
  function stopReconcile(): void {
    const v = sessionView.value;
    if (!v.reconcile) return;
    v.search = v.reconcile.savedSearch;
    appliedSearch.value = v.search;
    v.reconcile = null;
    resort();
  }

  /** The notifier counts (10 §5), over the whole register. */
  const notifiers = computed(() => ({
    error: levelCount(rows.value, 'error'),
    needsCategory: levelCount(rows.value, 'needsCategory'),
    forReview: levelCount(rows.value, 'forReview'),
  }));

  // "Showing n transactions." after 500 ms of idle searching (22 §4.5).
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  watch([appliedSearch, () => shown.value.length], () => {
    if (announceTimer) clearTimeout(announceTimer);
    if (!filtered.value) return;
    announceTimer = setTimeout(() => {
      const n = shown.value.length;
      announce(n === 0 ? t('a11y.searchNone') : t('a11y.searchShowing', { n }, n));
    }, ANNOUNCE_IDLE_MS);
  });

  // ----------------------------------------------------------------------------------- editor

  const categoryText = (id: Id | null): string => {
    const found = id ? ctx.value.categories.get(id) : undefined;
    return found ? categoryLabel(found.group, found.category) : '';
  };
  const editTexts = computed(() => ({ transfer: texts.value.transfer, categoryText }));

  const dirty = computed(() =>
    editor.value ? changesOf(editor.value.draft, editor.value.original).any : false,
  );

  /** The account a new transaction goes to: this one, or in All Accounts the first open one (11 §2). */
  function newAccountId(): Id | null {
    if (!isAll.value) return accountId.value;
    const last = lastAddAccount.value;
    if (last && accountMap.value.get(last)?.closed === false) return last;
    const open = accounts.value.filter((a) => !a.closed);
    return (open.find((a) => a.onBudget) ?? open[0])?.id ?? null;
  }
  const lastAddAccount = ref<Id | null>(null);
  /** Transfer is offered only when another open account can be its other side (10 §3). */
  const canTransfer = computed(() => {
    const from = newAccountId();
    return accounts.value.some((a) => !a.closed && a.id !== from);
  });

  /** Closes the editor without saving. */
  function closeEditor(): void {
    editor.value = null;
    resort();
  }

  /**
   * The one rule for an open edit (11 §1): unchanged → cancelled silently (true); changed → committed
   * first, and false if that fails or is cancelled.
   */
  async function settleOpenEdit(): Promise<boolean> {
    const e = editor.value;
    if (!e) return true;
    if (!dirty.value) {
      closeEditor();
      return true;
    }
    const outcome = await commit(e.id === null ? 'save' : 'done');
    return outcome?.status === 'saved';
  }

  function openEditor(state: Omit<EditorState, 'glow' | 'busy'>): void {
    editor.value = { ...state, glow: 0, busy: false };
    dismissUndo();
  }

  /** Opens the editor on a stored transaction (11 §1). */
  async function beginEdit(id: Id, focus: EditField = 'date'): Promise<boolean> {
    if (!canEdit.value) return false;
    if (editor.value?.id === id) return true;
    if (!(await settleOpenEdit())) return false;
    const row = byId.value.get(id);
    if (!row) return false;
    const draft = fromTransaction(row.t, editTexts.value, accountMap.value);
    openEditor({ id, draft, original: cloneEdit(draft), focus, transfer: false });
    select(id);
    return true;
  }

  /** A new transaction (11 §1): dated with the last date saved for one, else today. */
  async function beginNew(opts: { transfer?: boolean } = {}): Promise<boolean> {
    if (!canEdit.value) return false;
    if (!(await settleOpenEdit())) return false;
    const target = newAccountId();
    if (!target) return false;
    const draft = blankEdit(target, session.state.lastAddDate ?? today.value);
    if (opts.transfer) draft.payeeText = t('app.transferPrefix') + ' ';
    openEditor({
      id: null,
      draft,
      original: cloneEdit(blankEdit(target, draft.date)),
      focus: opts.transfer ? 'payee' : 'date',
      transfer: opts.transfer === true,
    });
    sessionView.value.selection = new Set();
    return true;
  }

  /** Esc twice or Cancel (11 §1 step 4). */
  function cancelEdit(): void {
    if (keyboard.modalOpen) return;
    const id = editor.value?.id ?? null;
    closeEditor();
    if (id) focusRow.value = id;
  }

  /** The row to focus, scroll to and briefly highlight after a commit (11 §6 "1 s glow"). */
  const focusRow = ref<Id | null>(null);
  const glowRow = ref<Id | null>(null);
  /** The "Just Checking..." callout is due for this row (11 §6 step 8). */
  const incomeOutflowRow = ref<Id | null>(null);

  async function commit(mode: CommitMode): Promise<CommitOutcome | null> {
    const e = editor.value;
    if (!e || e.busy) return null;
    // While a modal dialog is open, commit and cancel are refused (11 §1 step 5).
    if (keyboard.modalOpen) return null;
    if (e.id === null && isBlankNew(e.draft)) {
      closeEditor();
      return { status: 'saved', id: '', incomeOutflow: false };
    }
    e.busy = true;
    let outcome: CommitOutcome;
    const stored = e.id ? byId.value.get(e.id) : undefined;
    try {
      outcome = await runCommit(
        e.draft,
        {
          accounts: accounts.value,
          payees: payees.value,
          groups: groups.value,
          canEdit: canEdit.value,
          money: format.value.money,
          original: stored ? { t: stored.t, edit: e.original } : null,
          categoryText,
        },
        { approve: mode === 'approve' || mode === 'approveNext' },
      );
    } finally {
      if (editor.value === e) e.busy = false;
    }
    if (outcome.status === 'keep') return outcome;
    const isNew = e.id === null;
    const accountUsed = e.draft.accountId;
    if (editor.value === e) editor.value = null;
    if (outcome.status === 'cancel') {
      resort();
      return outcome;
    }
    if (isNew) {
      session.state.lastAddDate = e.draft.date;
      lastAddAccount.value = accountUsed;
    }
    announce(t(isNew ? 'a11y.transactionAdded' : 'a11y.transactionSaved'));
    if (outcome.matched) {
      const payee = payees.value.find((p) => p.id === outcome.matched?.payeeId);
      const transfer = payee?.transferAccountId
        ? accountMap.value.get(payee.transferAccountId)
        : null;
      const name = transfer
        ? t('app.transferPayee', { account: transfer.name })
        : (payee?.name ?? '');
      session.state.matched = t('app.schedMatched', { payee: name });
      announce(session.state.matched);
    }
    await queryClient.invalidateQueries({ queryKey: ['register'] });
    resort();
    focusRow.value = outcome.id;
    glowRow.value = outcome.id;
    if (!isAll.value && accountUsed !== accountId.value) focusRow.value = null;
    else sessionView.value.selection = new Set([outcome.id]);
    if (outcome.incomeOutflow) incomeOutflowRow.value = outcome.id;
    if (mode === 'saveAdd') {
      await beginNew();
    } else if (mode === 'approveNext') {
      const next = nextForReview(outcome.id);
      if (next) await beginEdit(next);
    }
    return outcome;
  }

  /** The next needs-review transaction after `id` in the current order, wrapping to the top (11 §2). */
  function nextForReview(id: Id): Id | null {
    const ids = shownIds.value;
    const at = ids.indexOf(id);
    for (let i = 1; i <= ids.length; i++) {
      const candidate = ids[(at + i) % ids.length];
      if (candidate && candidate !== id && byId.value.get(candidate)?.t.needsReview)
        return candidate;
    }
    return null;
  }

  /** The transaction shown just above `id`, if any (Shift+Enter, 11 §9). */
  function idAbove(id: Id): Id | null {
    const ids = shownIds.value;
    const at = ids.indexOf(id);
    return at > 0 ? (ids[at - 1] ?? null) : null;
  }

  /** A click outside a changed edit is blocked and the button row glows (10 §9). Returns true if blocked. */
  function blockIfDirty(): boolean {
    if (!editor.value || !dirty.value) return false;
    editor.value.glow++;
    return true;
  }

  // Leaving by navigation, search or quit commits a changed edit first (11 §1).
  const removeGuard = setEditGuard(() => {
    if (!editor.value) return true;
    if (!dirty.value) {
      closeEditor();
      return true;
    }
    return settleOpenEdit();
  });

  // ----------------------------------------------------------------------------------- misc

  /** Re-applies the sort (F5, 10 §9). */
  function applySort(): void {
    if (!editor.value) resort();
  }

  /** A header click sorts by that column alone; with Shift it adds or cycles a sort key (10 §2). */
  async function setSort(field: RegisterColumn, add = false): Promise<void> {
    if (reconciling.value) return;
    await patchView({ mainSort: nextSortKeys(sort.value, field, add) });
  }

  async function setDateFilter(f: DateFilter): Promise<void> {
    await patchView({ dateFilter: writeDateFilter(f) });
  }

  async function setShowReconciled(on: boolean): Promise<void> {
    await patchView({ showReconciled: on });
  }

  async function toggleColumn(field: ToggleableColumn): Promise<void> {
    const next = columns.value.map((c) => (c.field === field ? { ...c, visible: !c.visible } : c));
    await setColumns(next);
  }

  async function resizeColumn(field: RegisterColumn, width: number): Promise<void> {
    const next = columns.value.map((c) => (c.field === field ? { ...c, width } : c));
    await setColumns(next);
  }

  /** The first and last transaction months, the date filter's range (10 §3). */
  const monthRange = computed(() => {
    const dates = rows.value.map((r) => r.t.date).sort();
    const first = dates[0] ?? today.value;
    const last = dates.at(-1) ?? today.value;
    return { from: monthOf(first), to: monthOf(last) };
  });

  // Today moves on at midnight.
  const dayTimer = setInterval(() => {
    const now = todayDate();
    if (now !== today.value) today.value = now;
  }, 60_000);

  onBeforeUnmount(() => {
    removeGuard();
    clearInterval(dayTimer);
    if (debounce) clearTimeout(debounce);
    if (announceTimer) clearTimeout(announceTimer);
  });

  const autofill = computed(() => ({
    category: appSettings.app.autofillCategory,
    notes: appSettings.app.autofillNotes,
    amount: appSettings.app.autofillAmount,
  }));

  /** The stored transaction behind an editor. */
  const stored = (id: Id): Transaction | undefined => byId.value.get(id)?.t;

  return reactive({
    stored,
    accountId,
    isAll,
    account,
    accounts,
    accountMap,
    groups,
    payees,
    format,
    canEdit,
    loaded,
    columns,
    visible,
    sort,
    dateFilter,
    reconcile,
    reconciling,
    reconcileTotals,
    beginReconcile,
    stopReconcile,
    showReconciled,
    showReconciledSaved,
    filtered,
    searching,
    dateFiltered,
    searchText,
    appliedSearch,
    scroll,
    words,
    rows,
    byId,
    shown,
    items,
    selection,
    selectedRows,
    balancesTotal,
    selectedTotal,
    searchTotal,
    notifiers,
    editor,
    dirty,
    focusRow,
    glowRow,
    incomeOutflowRow,
    autofill,
    monthRange,
    today,
    categoryText,
    editTexts,
    select,
    selectAll,
    moveSelection,
    toggleExpanded,
    beginEdit,
    beginNew,
    canTransfer,
    cancelEdit,
    commit,
    settleOpenEdit,
    blockIfDirty,
    applySort,
    setSort,
    setDateFilter,
    setShowReconciled,
    toggleColumn,
    resizeColumn,
    setColumns,
    patchView,
    nextForReview,
    idAbove,
  });
}

export type Register = ReturnType<typeof createRegister>;

const KEY: InjectionKey<Register> = Symbol('register');

export function provideRegister(r: Register): void {
  provide(KEY, r);
}

export function useRegister(): Register {
  const r = inject(KEY);
  if (!r) throw new Error('useRegister() outside a register');
  return r;
}
