<script setup lang="ts">
// The Scheduled Transactions pane (12 §3): the title bar with Edit Transactions ▾, Add and Transfer and the
// centered title pill, and a grid of the schedules (sort, column chooser, resizing). It is a list: a
// double-click, Add, Transfer and Edit Schedule… open the Schedule dialog (12 §3.1). The actions menu also
// runs Enter in register now, Skip, Delete and Move to account. A split schedule expands into its lines.
import { bySortOrder } from '@shared/domain/accounts';
import {
  SCHEDULER_SORTABLE,
  SCHEDULER_TOGGLEABLE,
  type SchedulerColumn,
} from '@shared/domain/scheduler';
import type { Id } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import type { ContextMenuItem } from '@shared/shell-api';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { gridTemplate, minWidth, schedulerLayoutOf } from '../../register/layout';
import { programmatic } from '../../register/search';
import { useRegister } from '../../register/use-register';
import { useScheduler, type ScheduleRow } from '../../register/use-scheduler';
import { useScrollbarGutter } from '../../register/use-scrollbar-gutter';
import MoneyAmount from '../common/MoneyAmount.vue';
import UiButton from '../common/UiButton.vue';
import UiMenuButton from '../common/UiMenuButton.vue';
import NoteText from './NoteText.vue';

const emit = defineEmits<{ entered: [ids: Id[]] }>();
const { t } = useI18n();
const reg = useRegister();
const sched = useScheduler();

const layout = computed(() => schedulerLayoutOf(sched.visible, sched.columns));
const cols = computed(() => gridTemplate(layout.value));
const gridMin = computed(() => `${String(minWidth(layout.value))}rem`);
const body = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const gutter = useScrollbarGutter(body);
const focusId = ref<Id | null>(null);

const n = computed(() => sched.selection.size);
const menuLabel = computed(() =>
  n.value === 0
    ? t('register.editTransactionsDisabled')
    : n.value === 1
      ? t('register.editTransactionSingular')
      : t('register.editTransactionsPlural', { count: n.value }),
);

const HEADER_KEYS: Record<Exclude<SchedulerColumn, 'select'>, string> = {
  account: 'app.regAccountHeader',
  date: 'register.columnDate',
  frequency: 'register.columnFrequency',
  payee: 'register.columnPayee',
  category: 'register.columnCategory',
  notes: 'register.columnNotes',
  outflow: 'register.columnOutflow',
  inflow: 'register.columnInflow',
};
const header = (f: SchedulerColumn): string => (f === 'select' ? '' : t(HEADER_KEYS[f]));
const ariaSort = (f: SchedulerColumn): 'ascending' | 'descending' | undefined =>
  sched.sort.field === f ? (sched.sort.desc ? 'descending' : 'ascending') : undefined;

const money = computed(() => reg.format.money);
const allSelected = computed(
  () => sched.rows.length > 0 && sched.selection.size === sched.rows.length,
);
const someSelected = computed(() => sched.selection.size > 0 && !allSelected.value);

/** Header checkbox (12 §3, 10 §9): selects all when nothing is selected, otherwise clears. */
function onSelectAllClick(e: MouseEvent): void {
  sched.selectAll(sched.selection.size === 0);
  // The native toggle has already flipped the box; when the bound values don't change (a partial
  // selection cleared stays unchecked), Vue won't re-patch, so sync the DOM by hand.
  const box = e.target as HTMLInputElement;
  box.checked = allSelected.value;
  box.indeterminate = someSelected.value;
}

/** A click selects (10 §9); there is no inline editing (12 §3). */
function onCell(row: ScheduleRow, field: SchedulerColumn, e: MouseEvent): void {
  const id = row.s.id;
  focusId.value = id;
  if (field === 'select' || e.ctrlKey || e.metaKey) {
    // Shift+click on the box selects the range from the anchor, like a row click (10 §9).
    sched.select(id, { toggle: true, range: field === 'select' && e.shiftKey });
    return;
  }
  if (e.shiftKey) {
    sched.select(id, { range: true });
    return;
  }
  sched.select(id);
}

// ----------------------------------------------------------------------------------- menus

/** The scheduled actions menu (12 §3); everything is disabled offline. */
function menuItems(title: boolean): ContextMenuItem[] {
  const rows = sched.selectedRows;
  const canEdit = reg.canEdit;
  const recurring = rows.some((r) => r.s.frequency !== 'Once');
  const current = new Set(rows.map((r) => r.s.accountId));
  const targets = reg.accounts
    .filter((a) => !a.closed && !(current.size === 1 && current.has(a.id)))
    .sort((a, b) => a.name.localeCompare(b.name) || bySortOrder(a, b));
  return [
    ...(title
      ? [
          {
            id: 'title',
            label: t('app.schedMenuTitle', { n: rows.length }, rows.length),
            enabled: false,
          },
          { id: 's0' },
        ]
      : []),
    { id: 'edit', label: t('app.schedEdit'), enabled: canEdit && rows.length === 1 },
    { id: 'se' },
    { id: 'enter', label: t('app.schedEnterNow'), enabled: canEdit && rows.length > 0 },
    {
      id: 'skip',
      label: t('app.schedSkip'),
      enabled: canEdit && recurring && sched.canSkip,
      ...(sched.skipUnavailable ? { toolTip: t('app.schedSkipUnavailable') } : {}),
    },
    { id: 's1' },
    { id: 'delete', label: t('app.schedDelete'), enabled: canEdit && rows.length > 0 },
    { id: 's2' },
    {
      id: 'move',
      label: t('app.regMoveToAccount'),
      enabled: canEdit && rows.length > 0 && targets.length > 0,
      submenu: targets.map((a) => ({ id: `move:${a.id}`, label: a.name })),
    },
  ];
}

async function openMenu(title: boolean): Promise<void> {
  const chosen = await window.app.shell.showContextMenu(menuItems(title));
  if (!chosen) return;
  const ids = sched.selectedRows.map((r) => r.s.id);
  if (chosen === 'edit' && ids[0]) await sched.openEditor({ id: ids[0] });
  else if (chosen === 'enter') {
    const created = await sched.enterNow(ids);
    if (created.length > 0) emit('entered', created);
  } else if (chosen === 'skip') await sched.skip(ids);
  else if (chosen === 'delete') await sched.remove(ids);
  else if (chosen.startsWith('move:')) await sched.moveTo(ids, chosen.slice(5));
}

/** A tag pill filters the register to that exact tag (10 §6.2). */
function onTag(tag: string): void {
  reg.searchText = programmatic.tag(reg.words, tag);
}

function onRowMenu(row: ScheduleRow, e: MouseEvent): void {
  e.preventDefault();
  if (!sched.selection.has(row.s.id)) sched.select(row.s.id);
  void openMenu(true);
}

const CHOOSER_KEYS: Record<(typeof SCHEDULER_TOGGLEABLE)[number], string> = {
  notes: 'app.regColumnNotes',
};
/** The column chooser (12 §3, 10 §2): right-click a header, or Shift+F10 on a focused one. */
async function openChooser(): Promise<void> {
  const chosen = await window.app.shell.showContextMenu([
    ...SCHEDULER_TOGGLEABLE.map((f) => ({
      id: f,
      label: t(CHOOSER_KEYS[f]),
      checked: sched.columns.find((c) => c.field === f)?.visible ?? true,
    })),
    { id: 'sep' },
    { id: 'all', label: t('app.regApplyColumnsToAll') },
  ]);
  if (!chosen) return;
  if (chosen === 'all') await sched.setColumns(sched.columns, true);
  else await sched.toggleColumn(chosen as (typeof SCHEDULER_TOGGLEABLE)[number]);
}

function startResize(field: SchedulerColumn, e: PointerEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  const cell = handle.parentElement;
  if (!cell) return;
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
  const startX = e.clientX;
  const startWidth = cell.getBoundingClientRect().width / rem;
  handle.setPointerCapture(e.pointerId);
  const up = (ev: PointerEvent): void => {
    handle.removeEventListener('pointerup', up);
    const width = Math.round(Math.max(2, startWidth + (ev.clientX - startX) / rem) * 100) / 100;
    void sched.resizeColumn(field, width);
  };
  handle.addEventListener('pointerup', up);
}

// ----------------------------------------------------------------------------------- keys & focus

/** Arrows only: Enter/F2 (open the Schedule dialog) and Delete are RegisterPanel's `onSchedulerKey`. */
function onBodyKey(e: KeyboardEvent): void {
  if (e.target !== body.value) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const id = sched.moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    focusId.value = id;
  }
}

watch(
  () => sched.focusRow,
  (id) => {
    if (!id) return;
    sched.focusRow = null;
    focusId.value = id;
    void nextTick(() => {
      body.value?.querySelector(`[data-schedule-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      body.value?.focus({ preventScroll: true });
    });
  },
);

/**
 * Clicks, right-clicks and keys reach the body by delegation: the row and column from the element. A split
 * line stands for its schedule.
 */
function rowAt(e: Event): ScheduleRow | null {
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return null;
  const id =
    el.closest<HTMLElement>('[data-schedule-id]')?.dataset['scheduleId'] ??
    el.closest<HTMLElement>('[data-line-parent]')?.dataset['lineParent'];
  return id ? (sched.byId.get(id) ?? null) : null;
}
const onLine = (e: Event): boolean =>
  e.target instanceof HTMLElement && e.target.closest('[data-line-parent]') !== null;
function onBodyClick(e: MouseEvent): void {
  const row = rowAt(e);
  if (!row) return;
  // A click on a split line selects its schedule, as in the register (10 §9).
  if (onLine(e)) {
    sched.select(row.s.id);
    focusId.value = row.s.id;
    return;
  }
  const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset['col'];
  onCell(row, (col ?? 'date') as SchedulerColumn, e);
}
/** A double-click opens the Schedule dialog on the row (12 §3); not on the split disclosure. */
function onBodyDblClick(e: MouseEvent): void {
  const row = rowAt(e);
  const el = e.target as HTMLElement;
  const col = el.closest<HTMLElement>('[data-col]')?.dataset['col'];
  if (row && col !== 'select' && !el.closest('.sched__disclosure'))
    void sched.openEditor({ id: row.s.id });
}
function onBodyMenu(e: MouseEvent): void {
  const row = rowAt(e);
  if (row) onRowMenu(row, e);
}
const onHeadMenu = (e: MouseEvent): void => {
  e.preventDefault();
  void openChooser();
};
/** Shift+click range-selects rows (10 §9); stop the browser also extending a text selection. */
function onBodyMouseDown(e: MouseEvent): void {
  if (!e.shiftKey || e.button !== 0) return;
  if (!(e.target instanceof HTMLElement)) return;
  e.preventDefault();
  // Cancelling mousedown also cancels the focus move, so give the body focus as a click would.
  body.value?.focus({ preventScroll: true });
}

onMounted(() => {
  body.value?.addEventListener('mousedown', onBodyMouseDown);
  body.value?.addEventListener('click', onBodyClick);
  body.value?.addEventListener('dblclick', onBodyDblClick);
  body.value?.addEventListener('contextmenu', onBodyMenu);
  body.value?.addEventListener('keydown', onBodyKey);
  head.value?.addEventListener('contextmenu', onHeadMenu);
});
onBeforeUnmount(() => {
  body.value?.removeEventListener('mousedown', onBodyMouseDown);
  body.value?.removeEventListener('click', onBodyClick);
  body.value?.removeEventListener('dblclick', onBodyDblClick);
  body.value?.removeEventListener('contextmenu', onBodyMenu);
  body.value?.removeEventListener('keydown', onBodyKey);
  head.value?.removeEventListener('contextmenu', onHeadMenu);
});

/** Offline, Add and Transfer stay focusable with aria-disabled so the tooltip can be read (22 §4.6). */
const offlineTooltip = computed(() => (reg.canEdit ? null : t('app.editingUnavailableOffline')));
/** Each row's and shown split line's aria-rowindex; the header row is 1. */
const rowIndex = computed(() => {
  const out = new Map<string, number>();
  let n = 2;
  for (const row of sched.rows) {
    out.set(row.s.id, n++);
    if (sched.expanded.has(row.s.id))
      row.lines.forEach((_, j) => out.set(`${row.s.id}:${String(j)}`, n++));
  }
  return out;
});
const activeDescendant = computed(() =>
  focusId.value && sched.byId.has(focusId.value) ? `sched-row-${focusId.value}` : undefined,
);
</script>

<template>
  <section
    class="sched"
    data-scheduler
    :aria-label="t('a11y.regionScheduled')"
    :style="{ '--reg-cols': cols, '--reg-min': gridMin, '--reg-gutter': `${String(gutter)}px` }"
  >
    <div class="sched__bar">
      <div class="sched__actions">
        <UiMenuButton :disabled="n === 0" @open="openMenu(false)">{{ menuLabel }}</UiMenuButton>
        <UiButton
          v-tooltip="offlineTooltip"
          class="sched__add"
          :unavailable="!reg.canEdit"
          @click="sched.openEditor()"
        >
          <Plus class="sched__icon" aria-hidden="true" />
          {{ t('app.regAdd') }}
        </UiButton>
        <UiButton
          v-if="sched.canTransfer"
          v-tooltip="offlineTooltip"
          class="sched__transfer"
          :unavailable="!reg.canEdit"
          @click="sched.openEditor({ transfer: true })"
        >
          <ArrowLeftRight class="sched__icon" aria-hidden="true" />
          {{ t('app.regTransfer') }}
        </UiButton>
      </div>
      <span class="sched__title" data-scheduler-title>{{ t('app.schedTitle') }}</span>
    </div>
    <div
      class="sched__grid"
      role="treegrid"
      aria-multiselectable="true"
      :aria-label="t('a11y.schedulerGrid')"
    >
      <div ref="head" class="sched__head" role="rowgroup">
        <div class="sched__row sched__row--head" role="row">
          <div
            v-for="c in layout"
            :key="c.field"
            class="sched__header"
            :class="{
              'is-sorted': sched.sort.field === c.field,
              'sched__header--money': c.field === 'outflow' || c.field === 'inflow',
              'sched__header--center': c.field === 'select',
            }"
            role="columnheader"
            :aria-sort="ariaSort(c.field)"
          >
            <input
              v-if="c.field === 'select'"
              type="checkbox"
              :checked="allSelected"
              :indeterminate="someSelected"
              :aria-label="t('a11y.selectAll')"
              @click.stop="onSelectAllClick"
            />
            <button
              v-else-if="SCHEDULER_SORTABLE.has(c.field)"
              type="button"
              class="sched__sort"
              @click="sched.setSort(c.field)"
            >
              <span class="sched__label">{{ header(c.field) }}</span>
              <template v-if="sched.sort.field === c.field">
                <ArrowDown v-if="sched.sort.desc" class="sched__icon" aria-hidden="true" />
                <ArrowUp v-else class="sched__icon" aria-hidden="true" />
              </template>
            </button>
            <span
              v-if="c.resizable"
              class="sched__resize"
              role="separator"
              aria-orientation="vertical"
              @pointerdown="startResize(c.field, $event)"
              @click.stop
            />
          </div>
        </div>
      </div>
      <div
        ref="body"
        class="sched__body"
        role="rowgroup"
        tabindex="0"
        :aria-activedescendant="activeDescendant"
      >
        <template v-for="(row, i) in sched.rows" :key="row.s.id">
          <div
            :id="`sched-row-${row.s.id}`"
            class="sched__row"
            :class="{
              'is-alt': i % 2 === 1,
              'is-selected': sched.selection.has(row.s.id),
              'is-focused': focusId === row.s.id,
            }"
            role="row"
            aria-level="1"
            :aria-rowindex="rowIndex.get(row.s.id)"
            :aria-selected="sched.selection.has(row.s.id)"
            :aria-expanded="row.lines.length > 0 ? sched.expanded.has(row.s.id) : undefined"
            :data-schedule-id="row.s.id"
          >
            <div
              v-for="c in layout"
              :key="c.field"
              class="sched__cell"
              :class="{
                'sched__cell--money': c.field === 'outflow' || c.field === 'inflow',
                'sched__cell--icon': c.field === 'select',
              }"
              role="gridcell"
              :data-col="c.field"
            >
              <input
                v-if="c.field === 'select'"
                type="checkbox"
                tabindex="-1"
                :checked="sched.selection.has(row.s.id)"
                :aria-label="t('a11y.selectSchedule')"
              />
              <span v-else-if="c.field === 'account'" class="sched__text">{{
                row.accountName
              }}</span>
              <span v-else-if="c.field === 'date'" class="sched__text">{{
                dateShort(row.s.nextDate, reg.format.dateFormat)
              }}</span>
              <span
                v-else-if="c.field === 'frequency'"
                v-tooltip="row.frequencyText"
                class="sched__text"
                >{{ row.frequencyText }}</span
              >
              <template v-else-if="c.field === 'payee'">
                <button
                  v-if="row.lines.length > 0"
                  type="button"
                  tabindex="-1"
                  class="sched__disclosure"
                  :aria-label="t('a11y.splitLines')"
                  :aria-expanded="sched.expanded.has(row.s.id)"
                  @click.stop="sched.toggleExpanded(row.s.id)"
                >
                  <ChevronDown
                    v-if="sched.expanded.has(row.s.id)"
                    class="sched__icon"
                    aria-hidden="true"
                  />
                  <ChevronRight v-else class="sched__icon" aria-hidden="true" />
                </button>
                <span v-tooltip="row.payeeText" class="sched__text">{{ row.payeeText }}</span>
                <span
                  v-if="!row.s.postsTransaction"
                  v-tooltip="t('app.schedNotEnteredTooltip')"
                  class="sched__badge"
                  >{{ t('app.schedNotEntered') }}</span
                >
              </template>
              <span
                v-else-if="c.field === 'category'"
                v-tooltip="row.categoryText"
                class="sched__text"
                >{{ row.categoryText }}</span
              >
              <NoteText
                v-else-if="c.field === 'notes'"
                v-tooltip="row.s.notes"
                class="sched__text"
                :notes="row.s.notes"
                @tag="onTag"
              />
              <span v-else-if="c.field === 'outflow'"
                ><MoneyAmount
                  :value="row.s.amount < 0 ? -row.s.amount : 0"
                  :settings="money"
                  blank-zero
              /></span>
              <span v-else-if="c.field === 'inflow'"
                ><MoneyAmount
                  :value="row.s.amount > 0 ? row.s.amount : 0"
                  :settings="money"
                  blank-zero
              /></span>
            </div>
          </div>
          <template v-if="sched.expanded.has(row.s.id)">
            <div
              v-for="(l, j) in row.lines"
              :key="j"
              class="sched__line"
              :class="{ 'is-alt': j % 2 === 1 }"
              role="row"
              aria-level="2"
              :aria-rowindex="rowIndex.get(`${row.s.id}:${String(j)}`)"
              :data-line-parent="row.s.id"
            >
              <div
                v-for="c in layout"
                :key="c.field"
                class="sched__line-cell"
                :class="{
                  'sched__cell--money': c.field === 'outflow' || c.field === 'inflow',
                  'sched__line-cell--indent': c.field === 'payee',
                }"
                role="gridcell"
                :data-col="c.field"
              >
                <span v-if="c.field === 'payee'" class="sched__text">{{ l.transferText }}</span>
                <span v-else-if="c.field === 'category'" class="sched__text">{{
                  l.categoryText
                }}</span>
                <NoteText
                  v-else-if="c.field === 'notes'"
                  v-tooltip.truncated="l.line.notes"
                  class="sched__text"
                  :notes="l.line.notes"
                  @tag="onTag"
                />
                <MoneyAmount
                  v-else-if="c.field === 'outflow'"
                  :value="l.line.amount < 0 ? -l.line.amount : 0"
                  :settings="money"
                  blank-zero
                />
                <MoneyAmount
                  v-else-if="c.field === 'inflow'"
                  :value="l.line.amount > 0 ? l.line.amount : 0"
                  :settings="money"
                  blank-zero
                />
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sched {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--register-border);
}

.sched__bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--bar-h);
  padding: 0 var(--space-2);
  background: var(--grid-header-bg);
}

/* The title stays centered; when the actions are wider than their third, it moves right instead of
   overlapping them. */
.sched__actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  white-space: nowrap;
}

.sched__title {
  padding: var(--space-1) var(--space-6);
  border-radius: var(--radius-pill);
  background: var(--panel-bg);
  color: var(--text-strong);
  font-size: var(--font-lg);
  font-style: italic;
  white-space: nowrap;
  pointer-events: none;
}

.sched__grid {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-x: auto;
}

.sched__head {
  box-sizing: border-box;
  min-width: calc(var(--reg-min) + var(--scrollbar-w));
  padding-right: var(--reg-gutter);
  background: var(--grid-header-bg);
}

.sched__row {
  display: grid;
  grid-template-columns: var(--reg-cols);
  height: var(--row-h);
  background: var(--row-alt-even);
  color: var(--text-grid);
  font-size: var(--font-body);
}

.sched__row.is-alt {
  background: var(--row-alt-odd);
}

.sched__row.is-selected {
  background: var(--row-selected);
}

.sched__row.is-focused {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.sched__row--head {
  background: transparent;
}

.sched__header {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-2);
  border-right: 1px solid var(--grid-line-v);
  color: var(--text-on-blue);
  font-size: var(--font-md);
  font-weight: 600;
  white-space: nowrap;
  user-select: none;
}

.sched__header.is-sorted {
  background: color-mix(in srgb, var(--panel-bg) 18%, transparent);
}

.sched__sort {
  display: inline-flex;
  flex: 1;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  min-height: var(--row-h);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.sched__header--money,
.sched__header--money .sched__sort {
  justify-content: flex-end;
}

.sched__header--center {
  justify-content: center;
}

.sched__label,
.sched__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sched__icon {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.sched__resize {
  position: absolute;
  top: 0;
  right: calc(-1 * var(--space-1));
  bottom: 0;
  width: var(--space-2);
  cursor: col-resize;
  z-index: 1;
}

.sched__body {
  flex: 1;
  box-sizing: border-box;
  min-width: calc(var(--reg-min) + var(--scrollbar-w));
  min-height: 0;
  overflow-y: auto;
  outline: none;
}

.sched__body:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.sched__cell {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-2);
  border-right: 1px solid var(--grid-line-v);
  border-bottom: 1px solid var(--grid-line-h);
  overflow: hidden;
  white-space: nowrap;
}

.sched__cell--icon {
  justify-content: center;
  padding: 0;
}

/* The box only mirrors the selection: clicks land on the cell, which toggles it. A click on the
   box itself would toggle it natively even when the click is blocked or does a range select. */
.sched__cell--icon input {
  pointer-events: none;
}

.sched__cell--money {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.sched__disclosure {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

/* A split schedule's lines under its expanded row, styled as the register's split lines (11 §7.2). */
.sched__line {
  display: grid;
  grid-template-columns: var(--reg-cols);
  height: var(--row-h);
  background: var(--budget-row-alt-even);
  color: var(--split-text);
  font-size: var(--font-body);
  font-weight: 600;
}

.sched__line.is-alt {
  background: var(--panel-bg);
}

.sched__line-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--split-border);
  overflow: hidden;
  white-space: nowrap;
}

.sched__line-cell--indent {
  padding-left: var(--space-6);
}

.sched__badge {
  flex: none;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--needscat-pill-bg);
  color: var(--needscat-pill-text);
  font-size: var(--font-sm);
}
</style>
