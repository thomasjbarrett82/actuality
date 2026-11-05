// The scheduler pane's state (12 §3): one account's schedules (or every one in All Accounts), its columns
// and sort (saved per account, 19 §2), the selection, and the pane's visibility and height. Schedules are
// edited in the Schedule dialog (12 §3.1), never inline.
import { comparator, type ColumnSetting, type SortRow } from '@shared/domain/register';
import {
  SCHEDULER_TOGGLEABLE,
  schedulerColumnsOf,
  schedulerSortOf,
  type SchedulerColumn,
  type SchedulerToggleable,
} from '@shared/domain/scheduler';
import type { Id, Schedule } from '@shared/domain/types';
import { FREQUENCIES } from '@shared/schedule/frequency';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, inject, provide, reactive, ref, type InjectionKey, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { host } from '../rpc/host-client';
import { useBudgetSettings } from '../stores/budget-settings';
import { useConnection } from '../stores/connection';
import { attempt } from './dialogs';
import { customDescription, frequencyLabel } from './frequency-text';
import { openScheduleDialog } from './schedule-dialog';
import type { Register } from './use-register';

/** The pane's default and minimum heights in rem (10 §1). */
export const SCHEDULER_DEFAULT_H = 15.5;
export const SCHEDULER_MIN_H = 14.25;

export interface ScheduleRow {
  s: Schedule;
  accountName: string;
  payeeText: string;
  categoryText: string;
  frequencyText: string;
  sort: SortRow;
}

export function createScheduler(accountId: Ref<string>, reg: Register) {
  const { t } = useI18n();
  const connection = useConnection();
  const budgetSettings = useBudgetSettings();
  const queryClient = useQueryClient();
  const enabled = computed(() => connection.info.budget !== null && connection.hostReady);

  const listQ = useQuery(
    computed(() => ({
      queryKey: ['schedules', accountId.value] as const,
      queryFn: () => host.call('schedules.list', { accountId: accountId.value }),
      enabled: enabled.value,
    })),
  );
  const supportQ = useQuery(
    computed(() => ({
      queryKey: ['schedules', 'support'] as const,
      queryFn: () => host.call('schedules.support', {}),
      enabled: enabled.value,
    })),
  );
  const canSkip = computed(() => supportQ.data.value?.skip === true);
  const skipUnavailable = computed(() => supportQ.data.value?.skip === false);

  // ----------------------------------------------------------------------------------- view state

  const saved = computed(() => budgetSettings.settings.register.accounts[accountId.value]);
  const shownPref = computed(() => saved.value?.schedulerVisible ?? false);
  const height = computed(() =>
    Math.max(saved.value?.schedulerHeight ?? SCHEDULER_DEFAULT_H, SCHEDULER_MIN_H),
  );
  const columns = computed<ColumnSetting[]>(() => schedulerColumnsOf(saved.value?.scheduleColumns));
  const sort = computed(() => schedulerSortOf(saved.value?.scheduleSort));

  async function patchView(p: Parameters<Register['patchView']>[0]): Promise<void> {
    await reg.patchView(p);
  }
  const setVisible = (on: boolean): Promise<void> => patchView({ schedulerVisible: on });
  const setHeight = (rem: number): Promise<void> =>
    patchView({ schedulerHeight: Math.round(Math.max(rem, SCHEDULER_MIN_H) * 100) / 100 });

  async function setSort(field: SchedulerColumn): Promise<void> {
    const desc = sort.value.field === field ? !sort.value.desc : false;
    await patchView({ scheduleSort: { field, desc } });
  }

  async function setColumns(next: readonly ColumnSetting[], applyToAll = false): Promise<void> {
    const ids = applyToAll ? reg.accounts.map((a) => a.id) : [accountId.value];
    await budgetSettings.patch(({ register }) => {
      const accounts = { ...register.accounts };
      for (const id of [...ids, accountId.value])
        accounts[id] = { ...accounts[id], scheduleColumns: next.map((c) => ({ ...c })) };
      return { register: { ...register, accounts } };
    });
  }
  async function toggleColumn(field: SchedulerToggleable): Promise<void> {
    await setColumns(
      columns.value.map((c) => (c.field === field ? { ...c, visible: !c.visible } : c)),
    );
  }
  async function resizeColumn(field: SchedulerColumn, width: number): Promise<void> {
    await setColumns(columns.value.map((c) => (c.field === field ? { ...c, width } : c)));
  }

  const visible = computed(() => {
    const v = (field: string): boolean =>
      columns.value.find((c) => c.field === field)?.visible ?? true;
    const set = new Set<SchedulerColumn>([
      'select',
      'date',
      'frequency',
      'payee',
      'outflow',
      'inflow',
    ]);
    if (reg.isAll) set.add('account');
    for (const f of SCHEDULER_TOGGLEABLE) if (v(f)) set.add(f);
    if (reg.isAll || reg.account?.onBudget !== false) set.add('category');
    return set;
  });

  // ----------------------------------------------------------------------------------- rows

  const transferText = (accountIdOf: Id | null): string => {
    const a = accountIdOf ? reg.accountMap.get(accountIdOf) : undefined;
    return a ? t('app.transferPayee', { account: a.name }) : '';
  };
  const rows = computed<ScheduleRow[]>(() =>
    (listQ.data.value ?? []).map((s) => {
      const payee = s.payeeId ? reg.payees.find((p) => p.id === s.payeeId) : undefined;
      const payeeText = s.transferAccountId
        ? transferText(s.transferAccountId)
        : (payee?.name ?? '');
      const categoryText =
        s.subtransactions.length > 0
          ? t('register.splitCategoryOption')
          : reg.categoryText(s.categoryId);
      const accountName = s.accountId ? (reg.accountMap.get(s.accountId)?.name ?? '') : '';
      const frequencyText =
        s.frequency === 'custom'
          ? customDescription(s.raw.date, reg.format.dateFormat)
          : frequencyLabel(s.frequency);
      return {
        s,
        accountName,
        payeeText,
        categoryText,
        frequencyText,
        sort: {
          id: s.id,
          date: s.nextDate,
          amount: s.amount,
          checkNumber: null,
          payeeText,
          categoryText,
          notes: s.notes,
          accountName,
          cleared: 'U',
          errorLevel: 'none',
          frequencyRank:
            s.frequency === 'custom' ? FREQUENCIES.length : FREQUENCIES.indexOf(s.frequency),
        },
      };
    }),
  );
  const byId = computed(() => new Map(rows.value.map((r) => [r.s.id, r])));
  const ordered = computed(() => {
    const cmp = comparator(sort.value);
    return [...rows.value].sort((a, b) => cmp(a.sort, b.sort));
  });
  const loaded = computed(() => listQ.data.value !== undefined);
  const count = computed(() => rows.value.length);

  // ----------------------------------------------------------------------------------- selection

  const selection = ref(new Set<Id>());
  const anchor = ref<Id | null>(null);
  const selectedRows = computed(() => ordered.value.filter((r) => selection.value.has(r.s.id)));

  function select(id: Id, mods: { toggle?: boolean; range?: boolean } = {}): void {
    const ids = ordered.value.map((r) => r.s.id);
    if (mods.range && anchor.value) {
      const a = ids.indexOf(anchor.value);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selection.value = new Set(ids.slice(lo, hi + 1));
        return;
      }
    }
    if (mods.toggle) {
      const next = new Set(selection.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selection.value = next;
    } else selection.value = new Set([id]);
    anchor.value = id;
  }
  const clearSelection = (): void => {
    selection.value = new Set();
  };
  const selectAll = (on: boolean): void => {
    selection.value = on ? new Set(ordered.value.map((r) => r.s.id)) : new Set();
  };
  function moveSelection(delta: 1 | -1, extend: boolean): Id | null {
    const ids = ordered.value.map((r) => r.s.id);
    if (ids.length === 0) return null;
    const current = [...selection.value].map((id) => ids.indexOf(id)).filter((i) => i !== -1);
    const from =
      delta > 0 ? Math.max(-1, ...current) : current.length ? Math.min(...current) : ids.length;
    const id = ids[Math.min(Math.max(from + delta, 0), ids.length - 1)] ?? null;
    if (id) select(id, extend ? { range: true } : {});
    return id;
  }

  // ----------------------------------------------------------------------------------- dialog

  /** The row to scroll to and focus after a save. */
  const focusRow = ref<Id | null>(null);

  /** The account a new schedule goes to: this one, or in All Accounts the first open on-budget one. */
  const newAccount = (): Id | undefined =>
    reg.isAll
      ? (reg.accounts.find((a) => !a.closed && a.onBudget) ?? reg.accounts.find((a) => !a.closed))
          ?.id
      : accountId.value;
  /** Transfer is offered only when another open account can be its other side (12 §3). */
  const canTransfer = computed(() => {
    const from = newAccount();
    return reg.accounts.some((a) => !a.closed && a.id !== from);
  });

  /**
   * Opens the Schedule dialog (12 §3.1) on a schedule, or on a new one (12 §1 defaults). The register's
   * open edit is settled first. After a save the pane refreshes and selects the schedule.
   */
  async function openEditor(target: { id: Id } | { transfer?: boolean } = {}): Promise<void> {
    if (!connection.canEdit) return;
    if (!(await reg.settleOpenEdit())) return;
    let saved: Id | null;
    if ('id' in target) {
      const row = byId.value.get(target.id);
      if (!row) return;
      select(target.id);
      saved = await openScheduleDialog({
        kind: 'edit',
        schedule: row.s,
        fallbackAccountId: newAccount() ?? '',
      });
      focusRow.value = target.id;
    } else {
      const account = newAccount();
      if (!account) return;
      saved = await openScheduleDialog({
        kind: 'new',
        accountId: account,
        transfer: target.transfer === true,
      });
    }
    if (!saved) return;
    await queryClient.invalidateQueries({ queryKey: ['schedules'] });
    select(saved);
    focusRow.value = saved;
  }

  // ----------------------------------------------------------------------------------- actions

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['schedules'] });
  }

  /** Enter in register now (12 §3). Resolves with the new transactions' ids. */
  async function enterNow(ids: readonly Id[]): Promise<Id[]> {
    if (ids.length === 0) return [];
    const r = await attempt(() => host.call('schedules.enterNow', { ids: [...ids] }));
    if (!r.ok) return [];
    clearSelection();
    await refresh();
    return r.value.ids;
  }

  async function skip(ids: readonly Id[]): Promise<void> {
    if (ids.length === 0) return;
    if ((await attempt(() => host.call('schedules.skip', { ids: [...ids] }))).ok) await refresh();
  }

  /** Delete (12 §3): no confirmation, no undo. */
  async function remove(ids: readonly Id[]): Promise<void> {
    if (ids.length === 0) return;
    if ((await attempt(() => host.call('schedules.delete', { ids: [...ids] }))).ok) {
      clearSelection();
      await refresh();
    }
  }

  async function moveTo(ids: readonly Id[], target: Id): Promise<void> {
    if (ids.length === 0) return;
    const r = await attempt(() =>
      host.call('schedules.moveToAccount', { ids: [...ids], accountId: target }),
    );
    if (r.ok) {
      clearSelection();
      await refresh();
    }
  }

  return reactive({
    loaded,
    count,
    rows: ordered,
    byId,
    columns,
    visible,
    sort,
    shownPref,
    height,
    canSkip,
    skipUnavailable,
    canTransfer,
    selection,
    selectedRows,
    focusRow,
    setVisible,
    setHeight,
    setSort,
    setColumns,
    toggleColumn,
    resizeColumn,
    select,
    selectAll,
    clearSelection,
    moveSelection,
    openEditor,
    enterNow,
    skip,
    remove,
    moveTo,
    refresh,
  });
}

export type Scheduler = ReturnType<typeof createScheduler>;

const KEY: InjectionKey<Scheduler> = Symbol('scheduler');

export function provideScheduler(s: Scheduler): void {
  provide(KEY, s);
}

export function useScheduler(): Scheduler {
  const s = inject(KEY);
  if (!s) throw new Error('useScheduler() outside a register');
  return s;
}
