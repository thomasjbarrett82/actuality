<script setup lang="ts">
// The register grid (10 §1–2, §6, §9; 22 §4.2): a header with sorting, resizing and the column chooser,
// and a virtualized body (@tanstack/vue-virtual) of fixed --row-h rows, where split lines are extra rows
// and the editor row is measured. A new transaction's editor is the first row. One Tab stop: the body takes focus and
// points at the focused row with aria-activedescendant.
import { SORTABLE_COLUMNS, TOGGLEABLE_COLUMNS, type RegisterColumn } from '@shared/domain/register';
import type { Id, Transaction } from '@shared/domain/types';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ArrowDown, ArrowUp } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { approve, deleteTransactions, setCategory, toggleCleared } from '../../register/actions';
import { attempt } from '../../register/dialogs';
import { fromTransaction, toCommit } from '../../register/editable';
import { useJump } from '../../register/jump';
import { gridTemplate, layoutOf, minWidth } from '../../register/layout';
import { actionsMenu, runAction, type MenuContext } from '../../register/menu';
import { programmatic } from '../../register/search';
import { useRegister, type EditField, type GridItem } from '../../register/use-register';
import { useScrollbarGutter } from '../../register/use-scrollbar-gutter';
import { host } from '../../rpc/host-client';
import { queryClient } from '../../rpc/query-client';
import { useCallouts } from '../../stores/callouts';
import ErrorPopover from './ErrorPopover.vue';
import IncomeOutflowCallout from './IncomeOutflowCallout.vue';
import RegisterRow from './RegisterRow.vue';
import SplitLineRow from './SplitLineRow.vue';
import TransactionEditor from './TransactionEditor.vue';

const { t } = useI18n();
const reg = useRegister();
const callouts = useCallouts();
const jump = useJump();

const layout = computed(() => layoutOf(reg.visible, reg.columns, reg.reconciling));
const cols = computed(() => gridTemplate(layout.value));
const gridMin = computed(() => `${String(minWidth(layout.value))}rem`);

const scroller = ref<HTMLElement | null>(null);
const gutter = useScrollbarGutter(scroller);
const probe = ref<HTMLElement | null>(null);
const rowPx = ref(24);

const items = computed(() => reg.items);
const virtualizer = useVirtualizer(
  computed(() => ({
    count: items.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: (i: number) => {
      const item = items.value[i];
      if (item?.kind === 'row' && reg.editor?.id === item.row.t.id) return rowPx.value * 3;
      if (item?.kind === 'new') return rowPx.value * 3;
      return rowPx.value;
    },
    getItemKey: (i: number) => items.value[i]?.key ?? i,
    overscan: 12,
    // Until the scroller is measured (and in tests, where nothing is laid out).
    initialRect: { width: 0, height: 800 },
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

/** Only editor rows have a measured height; every other row is --row-h. */
function measure(el: unknown): void {
  if (el instanceof HTMLElement && el.dataset['measure'] === 'true')
    virtualizer.value.measureElement(el);
}
const isEditorItem = (item: GridItem | undefined): boolean =>
  (item?.kind === 'row' && reg.editor?.id === item.row.t.id) || item?.kind === 'new';

let resize: ResizeObserver | null = null;
const gridRoot = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const onHeadMenu = (e: MouseEvent): void => {
  e.preventDefault();
  void openChooser();
};
onMounted(() => {
  // A changed edit blocks clicks anywhere outside it (10 §9); right-click on a header opens the chooser.
  gridRoot.value?.addEventListener('pointerdown', onPointerDownCapture, true);
  scroller.value?.addEventListener('scroll', onScroll, { passive: true });
  // The body holds focus for the grid (aria-activedescendant), so it takes the rows' keys and clicks.
  body.value?.addEventListener('keydown', onBodyKey);
  body.value?.addEventListener('mousedown', onBodyMouseDown);
  body.value?.addEventListener('click', onBodyClick);
  body.value?.addEventListener('contextmenu', onBodyMenu);
  head.value?.addEventListener('contextmenu', onHeadMenu);
  const el = probe.value;
  if (el) {
    const update = (): void => {
      const h = el.getBoundingClientRect().height;
      if (h > 0 && h !== rowPx.value) {
        rowPx.value = h;
        virtualizer.value.measure();
      }
    };
    update();
    resize = new ResizeObserver(update);
    resize.observe(el);
  }
  void nextTick(restoreScroll);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  gridRoot.value?.removeEventListener('pointerdown', onPointerDownCapture, true);
  scroller.value?.removeEventListener('scroll', onScroll);
  body.value?.removeEventListener('keydown', onBodyKey);
  body.value?.removeEventListener('mousedown', onBodyMouseDown);
  body.value?.removeEventListener('click', onBodyClick);
  body.value?.removeEventListener('contextmenu', onBodyMenu);
  head.value?.removeEventListener('contextmenu', onHeadMenu);
});

// ----------------------------------------------------------------------------------- scroll

/** The session's scroll position (10 §10): −1 is the bottom. */
function restoreScroll(): void {
  const el = scroller.value;
  if (!el) return;
  const saved = reg.scroll;
  if (saved !== -1) el.scrollTop = saved;
  else if (items.value.length > 0)
    virtualizer.value.scrollToIndex(items.value.length - 1, { align: 'end' });
}
function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  reg.scroll = atBottom ? -1 : el.scrollTop;
}
watch(
  () => reg.loaded,
  (loaded) => {
    // Twice: once the rows are laid out, and again after the row height has been measured.
    if (loaded)
      void nextTick(() => {
        restoreScroll();
        requestAnimationFrame(restoreScroll);
      });
  },
);

function scrollToId(id: Id): void {
  const index = items.value.findIndex((i) => i.kind === 'row' && i.row.t.id === id);
  if (index !== -1) virtualizer.value.scrollToIndex(index, { align: 'auto' });
}

// An editor that opens, or grows (a split), is scrolled into view once it has been measured.
watch(
  () =>
    reg.editor
      ? `${reg.editor.id ?? 'new'}:${String(reg.editor.draft.split)}:${String(reg.editor.draft.lines.length)}`
      : null,
  (state) => {
    if (state === null) return;
    const key = reg.editor?.id ?? 'new';
    const scroll = (): void => {
      const index = items.value.findIndex((i) => i.key === key);
      if (index === -1) return;
      virtualizer.value.scrollToIndex(index, { align: 'auto' });
    };
    void nextTick(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
  },
);

// After a commit or a jump: scroll to the row, select it, glow 1 s (11 §6).
const glowing = ref<Id | null>(null);
watch(
  () => [reg.focusRow, items.value] as const,
  ([id]) => {
    if (!id || !reg.byId.has(id)) return;
    reg.focusRow = null;
    focusId.value = id;
    void nextTick(() => {
      scrollToId(id);
      body.value?.focus({ preventScroll: true });
    });
    if (reg.glowRow === id) {
      glowing.value = id;
      reg.glowRow = null;
      setTimeout(() => {
        if (glowing.value === id) glowing.value = null;
      }, 1000);
    }
  },
);

// ----------------------------------------------------------------------------------- focus & selection

const body = ref<HTMLElement | null>(null);
const focusId = ref<Id | null>(null);
const activeDescendant = computed(() =>
  focusId.value && items.value.some((i) => i.kind === 'row' && i.row.t.id === focusId.value)
    ? `reg-row-${focusId.value}`
    : undefined,
);

const FIELD: Partial<Record<RegisterColumn, EditField>> = {
  account: 'account',
  date: 'date',
  check: 'check',
  payee: 'payee',
  category: 'category',
  notes: 'notes',
  outflow: 'outflow',
  inflow: 'inflow',
};

function onCell(
  item: Extract<GridItem, { kind: 'row' }>,
  field: RegisterColumn,
  e: MouseEvent,
): void {
  const id = item.row.t.id;
  focusId.value = id;
  if (e.ctrlKey || e.metaKey) {
    reg.select(id, { toggle: true });
    return;
  }
  if (e.shiftKey) {
    reg.select(id, { range: true });
    return;
  }
  // A click on the only selected row starts editing the clicked cell (10 §9).
  if (reg.selection.size === 1 && reg.selection.has(id)) {
    void reg.beginEdit(id, FIELD[field] ?? 'date');
    return;
  }
  reg.select(id);
}

/** Clicks reach the body by delegation: the row and column come from the element clicked. */
function rowAt(e: Event): Extract<GridItem, { kind: 'row' }> | null {
  const el = e.target instanceof HTMLElement ? e.target : null;
  const id =
    el?.closest<HTMLElement>('[data-row-id]')?.dataset['rowId'] ??
    el?.closest<HTMLElement>('[data-line-parent]')?.dataset['lineParent'];
  const item = id ? items.value.find((i) => i.kind === 'row' && i.row.t.id === id) : undefined;
  return item?.kind === 'row' ? item : null;
}

/** Shift+click range-selects rows (10 §9); stop the browser also extending a text selection. */
function onBodyMouseDown(e: MouseEvent): void {
  if (!e.shiftKey || e.button !== 0) return;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el || el.closest('[data-editor]')) return;
  e.preventDefault();
  // Cancelling mousedown also cancels the focus move, so give the body focus as a click would.
  body.value?.focus({ preventScroll: true });
}

function onBodyClick(e: MouseEvent): void {
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el || el.closest('[data-editor]') || el.closest('button')) return;
  const item = rowAt(e);
  if (!item) return;
  const col = el.closest<HTMLElement>('[data-col]')?.dataset['col'] as RegisterColumn | undefined;
  if (col === 'select') {
    // Shift+click on the box selects the range from the anchor, like a row click (10 §9).
    reg.select(item.row.t.id, { toggle: true, range: e.shiftKey });
    focusId.value = item.row.t.id;
    return;
  }
  // A split line selects its parent.
  if (el.closest('[data-line-parent]')) {
    reg.select(item.row.t.id);
    focusId.value = item.row.t.id;
    return;
  }
  onCell(item, col ?? 'date', e);
}

function onBodyMenu(e: MouseEvent): void {
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (el?.closest('[data-editor]')) return;
  const item = rowAt(e);
  if (item) void onContextMenu(item, e);
}

/** The selection's rows, or just this row when it isn't selected. */
function targetRows(t: Transaction): Transaction[] {
  return reg.selection.has(t.id) ? [...reg.selectedRows] : [t];
}

/** A tag pill filters the register to that exact tag (10 §6.2). */
function onTag(tag: string): void {
  reg.searchText = programmatic.tag(reg.words, tag);
}

async function onError(tx: Transaction, anchor: HTMLElement, lineId?: Id): Promise<void> {
  const level = lineId
    ? (tx.subtransactions.find((l) => l.id === lineId)?.errorLevel ?? 'none')
    : tx.errorLevel;
  const rows = targetRows(tx).filter((r) => (lineId ? r.id === tx.id : r.errorLevel === level));
  const widths = { needsCategory: '27rem', forReview: '24.5rem', error: '22rem', none: '22rem' };
  const result = await callouts.show(
    ErrorPopover,
    { level, count: rows.length, groups: reg.groups, canEdit: reg.canEdit },
    { anchor, width: widths[level] },
  );
  if (result === 'approve') await approve(rows);
  else if (result === 'delete') await deleteTransactions(rows);
  else if (result === 'remove') {
    // Clears the category on the offending transactions or their lines (10 §6.3).
    const ids = lineId
      ? [lineId]
      : rows.flatMap((r) =>
          r.subtransactions.length > 0
            ? r.subtransactions.filter((l) => l.errorLevel === 'error').map((l) => l.id)
            : [r.id],
        );
    await setCategory(ids, null);
  } else if (result.startsWith('category:')) {
    const ids = lineId
      ? [lineId]
      : rows.flatMap((r) =>
          r.subtransactions.length > 0
            ? r.subtransactions.filter((l) => l.errorLevel === 'needsCategory').map((l) => l.id)
            : [r.id],
        );
    await setCategory(ids, result.slice('category:'.length));
  }
}

async function onCleared(item: Extract<GridItem, { kind: 'row' }>): Promise<void> {
  if (!reg.canEdit) return;
  // The click selects the row first, unless an edit has unsaved changes (10 §6.4).
  if (reg.blockIfDirty()) return;
  if (!reg.selection.has(item.row.t.id)) reg.select(item.row.t.id);
  await toggleCleared(targetRows(item.row.t));
}

function onTransfer(item: Extract<GridItem, { kind: 'row' }>): void {
  const side = item.row.t.transferSide;
  if (!side) return;
  jump.jump({ accountId: side.accountId, transactionId: side.id });
}

async function onContextMenu(
  item: Extract<GridItem, { kind: 'row' }>,
  e: MouseEvent,
): Promise<void> {
  e.preventDefault();
  if (reg.editor?.id === item.row.t.id) return;
  if (!reg.selection.has(item.row.t.id)) reg.select(item.row.t.id);
  await openMenu(true);
}

function menuContext(title: boolean): MenuContext {
  return {
    rows: reg.selectedRows,
    account: reg.isAll ? null : (reg.account ?? null),
    accounts: reg.accounts,
    groups: reg.groups,
    canEdit: reg.canEdit,
    title,
    today: reg.today,
    dateFormat: reg.format.dateFormat,
    reconciling: reg.reconciling,
  };
}

/** The actions menu (10 §6.1), from a right-click or Edit Transactions ▾. */
async function openMenu(title: boolean): Promise<void> {
  const ctx = menuContext(title);
  const chosen = await window.app.shell.showContextMenu(actionsMenu(ctx));
  if (chosen) await runChosen(chosen, ctx);
}

/**
 * One item of the actions menu, from its single-letter key (10 §9): nothing happens when the menu would
 * show it disabled or leave it out. An item with a submenu (Categorize As, Move to account) shows just
 * that submenu.
 */
async function runMenuItem(id: string): Promise<void> {
  const ctx = menuContext(false);
  const item = actionsMenu(ctx).find((i) => i.id === id);
  if (!item || item.enabled === false) return;
  const chosen = item.submenu ? await window.app.shell.showContextMenu(item.submenu) : id;
  if (chosen) await runChosen(chosen, ctx);
}

async function runChosen(chosen: string, ctx: MenuContext): Promise<void> {
  const outcome = await runAction(chosen, ctx);
  if (outcome && 'select' in outcome) {
    reg.select(outcome.select);
    reg.focusRow = outcome.select;
  } else if (outcome) await reveal(outcome.reveal);
}

/** After Change Date… the rows re-sort; the first changed one is scrolled to if it left the view (10 §6.1). */
async function reveal(ids: readonly Id[]): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['register'] });
  await nextTick();
  const changed = new Set(ids);
  const first = items.value.find((i) => i.kind === 'row' && changed.has(i.row.t.id));
  if (first?.kind === 'row') scrollToId(first.row.t.id);
}

// "Just Checking..." after an income category with an outflow (11 §6 step 8).
watch(
  () => reg.incomeOutflowRow,
  (id) => {
    if (!id) return;
    reg.incomeOutflowRow = null;
    setTimeout(() => void askIncomeOutflow(id), 50);
  },
);
async function askIncomeOutflow(id: Id): Promise<void> {
  scrollToId(id);
  await nextTick();
  const anchor = scroller.value?.querySelector<HTMLElement>(
    `[data-row-id="${id}"] [data-col="outflow"]`,
  );
  if (!anchor) return;
  const result = await callouts.show(
    IncomeOutflowCallout,
    {},
    { anchor, title: t('app.incomeOutflowTitle') },
  );
  const row = reg.byId.get(id)?.t;
  if (result !== 'inflow' || !row) return;
  const edit = fromTransaction(row, reg.editTexts, reg.accountMap);
  edit.amount = -edit.amount;
  await attempt(() => host.call('transactions.commit', toCommit(edit, reg.payees, false)));
}

// ----------------------------------------------------------------------------------- header

const HEADER_KEYS: Partial<Record<RegisterColumn, string>> = {
  account: 'app.regAccountHeader',
  date: 'register.columnDate',
  check: 'register.columnCheckNumber',
  payee: 'register.columnPayee',
  error: 'app.regErrorHeader',
  category: 'register.columnCategory',
  notes: 'register.columnNotes',
  outflow: 'register.columnOutflow',
  inflow: 'register.columnInflow',
  balance: 'register.columnBalance',
  cleared: 'register.columnCleared',
};

/** Headers line up with their cells: money right-aligned, the cleared toggle centred. */
const MONEY_COLUMNS: ReadonlySet<RegisterColumn> = new Set(['outflow', 'inflow', 'balance']);

const allSelected = computed(() => reg.shown.length > 0 && reg.selection.size === reg.shown.length);
const someSelected = computed(() => reg.selection.size > 0 && !allSelected.value);

/** Header checkbox (10 §3, §9): selects all when nothing is selected, otherwise clears. */
function onSelectAllClick(e: MouseEvent): void {
  reg.selectAll(reg.selection.size === 0);
  // The native toggle has already flipped the box; when the bound values don't change (a partial
  // selection cleared stays unchecked), Vue won't re-patch, so sync the DOM by hand.
  const box = e.target as HTMLInputElement;
  box.checked = allSelected.value;
  box.indeterminate = someSelected.value;
}
/** A column's place among the sort keys (10 §2): its key and 1-based level, or null when not a key. */
function sortKeyOf(field: RegisterColumn): { desc: boolean; level: number } | null {
  const i = reg.sort.findIndex((k) => k.field === field);
  const key = reg.sort[i];
  return key ? { desc: key.desc, level: i + 1 } : null;
}

/** `aria-sort` on the primary key's header only; the other keys get a level description (22 §4.2). */
function ariaSort(field: RegisterColumn): 'ascending' | 'descending' | undefined {
  const k = sortKeyOf(field);
  return k?.level === 1 ? (k.desc ? 'descending' : 'ascending') : undefined;
}

function ariaSortLevel(field: RegisterColumn): string | undefined {
  const k = sortKeyOf(field);
  if (!k || k.level === 1) return undefined;
  return t(k.desc ? 'a11y.sortLevelDescending' : 'a11y.sortLevelAscending', { n: k.level });
}

function sortTooltip(field: RegisterColumn): string {
  const k = sortKeyOf(field);
  if (!k) return t('register.sortTooltipUnsorted');
  return t(k.desc ? 'register.sortTooltipDescending' : 'register.sortTooltipAscending', {
    n: k.level,
  });
}

/** Click sorts by the column alone; Shift+click (or Shift+Enter) adds or changes a sort level (10 §2). */
function onHeaderClick(field: RegisterColumn, add: boolean): void {
  if (SORTABLE_COLUMNS.has(field)) void reg.setSort(field, add);
}

const CHOOSER_KEYS: Record<(typeof TOGGLEABLE_COLUMNS)[number], string> = {
  check: 'app.regColumnCheck',
  cleared: 'app.regColumnCleared',
  notes: 'app.regColumnNotes',
  balance: 'app.regColumnRunningBalance',
};

/** The column chooser (10 §2): right-click a header, or Shift+F10 on a focused one. */
async function openChooser(): Promise<void> {
  const fields = TOGGLEABLE_COLUMNS.filter((f) => !(f === 'balance' && reg.isAll));
  const chosen = await window.app.shell.showContextMenu([
    ...fields.map((f) => ({
      id: f,
      label: t(CHOOSER_KEYS[f]),
      checked: reg.columns.find((c) => c.field === f)?.visible ?? false,
    })),
    { id: 'sep' },
    { id: 'all', label: t('app.regApplyColumnsToAll') },
  ]);
  if (!chosen) return;
  if (chosen === 'all') await reg.setColumns(reg.columns, true);
  else await reg.toggleColumn(chosen as (typeof TOGGLEABLE_COLUMNS)[number]);
}

// Column resizing: drag a header's right edge; widths saved in rem (10 §2).
function startResize(field: RegisterColumn, e: PointerEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  const cell = handle.parentElement;
  if (!cell) return;
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
  const startX = e.clientX;
  const startWidth = cell.getBoundingClientRect().width / rem;
  handle.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent): void => {
    const width = Math.max(2, startWidth + (ev.clientX - startX) / rem);
    cell.style.width = `${String(width)}rem`;
  };
  const up = (ev: PointerEvent): void => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    const width = Math.round(Math.max(2, startWidth + (ev.clientX - startX) / rem) * 100) / 100;
    cell.style.width = '';
    void reg.resizeColumn(field, width);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
}

// ----------------------------------------------------------------------------------- keys & blocking

/** A changed edit blocks clicks outside the editor; its button row glows (10 §9). */
function onPointerDownCapture(e: PointerEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target || !reg.editor || !reg.dirty) return;
  if (target.closest('[data-editor]')) return;
  if (reg.blockIfDirty()) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onBodyKey(e: KeyboardEvent): void {
  const item = items.value.find((i) => i.kind === 'row' && i.row.t.id === focusId.value);
  if (item?.kind !== 'row') return;
  if (e.key === 'ArrowRight' && item.row.lines.length > 0) {
    e.preventDefault();
    reg.toggleExpanded(item.row.t.id, true);
  } else if (e.key === 'ArrowLeft' && item.row.lines.length > 0) {
    e.preventDefault();
    reg.toggleExpanded(item.row.t.id, false);
  }
}

defineExpose({
  openMenu,
  runMenuItem,
  focusBody: () => body.value?.focus(),
  setFocus: (id: Id | null) => {
    focusId.value = id;
    if (id) scrollToId(id);
  },
  focusId,
  scrollToId,
});
</script>

<template>
  <div
    ref="gridRoot"
    class="reg-grid"
    data-register-grid
    role="treegrid"
    aria-multiselectable="true"
    :aria-label="t('a11y.registerGrid')"
    :aria-rowcount="items.length + 1"
    :style="{ '--reg-cols': cols, '--reg-min': gridMin, '--reg-gutter': `${String(gutter)}px` }"
  >
    <div ref="probe" class="reg-grid__probe" aria-hidden="true" />
    <div ref="head" class="reg-grid__head" role="rowgroup">
      <div class="reg-grid__header-row" role="row" aria-rowindex="1">
        <div
          v-for="c in layout"
          :key="c.field"
          class="reg-grid__header"
          :class="{
            'is-sorted': sortKeyOf(c.field) !== null,
            'is-sortable': SORTABLE_COLUMNS.has(c.field),
            'reg-grid__header--money': MONEY_COLUMNS.has(c.field),
            'reg-grid__header--center': c.field === 'cleared' || c.field === 'select',
          }"
          role="columnheader"
          :aria-sort="ariaSort(c.field)"
          :aria-description="ariaSortLevel(c.field)"
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
            v-else-if="SORTABLE_COLUMNS.has(c.field)"
            v-tooltip="sortTooltip(c.field)"
            type="button"
            class="reg-grid__sort"
            @click="onHeaderClick(c.field, $event.shiftKey)"
            @keydown.enter.shift.exact.prevent="onHeaderClick(c.field, true)"
          >
            <span class="reg-grid__label">{{
              t(HEADER_KEYS[c.field] ?? 'app.regErrorHeader')
            }}</span>
            <template v-if="sortKeyOf(c.field)">
              <ArrowDown
                v-if="sortKeyOf(c.field)?.desc"
                class="reg-grid__icon"
                aria-hidden="true"
              />
              <ArrowUp v-else class="reg-grid__icon" aria-hidden="true" />
              <span v-if="reg.sort.length > 1" class="reg-grid__level" aria-hidden="true">{{
                sortKeyOf(c.field)?.level
              }}</span>
            </template>
          </button>
          <span v-else class="reg-grid__label">{{
            t(HEADER_KEYS[c.field] ?? 'app.regErrorHeader')
          }}</span>
          <span
            v-if="c.resizable"
            class="reg-grid__resize"
            role="separator"
            aria-orientation="vertical"
            @pointerdown="startResize(c.field, $event)"
            @click.stop
          />
        </div>
      </div>
    </div>
    <div ref="scroller" class="reg-grid__scroller">
      <div
        ref="body"
        class="reg-grid__body"
        role="rowgroup"
        tabindex="0"
        :aria-activedescendant="activeDescendant"
        :style="{ height: `${String(totalSize)}px` }"
      >
        <div
          v-for="v in virtualRows"
          :key="String(v.key)"
          :ref="measure"
          class="reg-grid__item"
          :data-index="v.index"
          :data-measure="isEditorItem(items[v.index]) ? 'true' : 'false'"
          :style="{ transform: `translateY(${String(v.start)}px)` }"
        >
          <template v-for="item in [items[v.index]]" :key="item?.key">
            <template v-if="item?.kind === 'row'">
              <TransactionEditor
                v-if="reg.editor && reg.editor.id === item.row.t.id"
                :editor="reg.editor"
                :layout="layout"
                :row-index="v.index + 2"
              />
              <RegisterRow
                v-else
                :row="item.row"
                :layout="layout"
                :index="item.index"
                :row-index="v.index + 2"
                :selected="reg.selection.has(item.row.t.id)"
                :focused="focusId === item.row.t.id"
                :expanded="item.expanded"
                :balance="item.balance"
                :glow="glowing === item.row.t.id"
                @tag="onTag"
                @error="(a) => onError(item.row.t, a)"
                @cleared="onCleared(item)"
                @transfer="onTransfer(item)"
                @toggle="reg.toggleExpanded(item.row.t.id)"
              />
            </template>
            <SplitLineRow
              v-else-if="item?.kind === 'line'"
              :row="item.row"
              :line="item.line"
              :layout="layout"
              :line-index="item.lineIndex"
              :row-index="v.index + 2"
              :matched="item.matched"
              @error="(a) => onError(item.row.t, a, item.line.line.id)"
            />
            <TransactionEditor
              v-else-if="item?.kind === 'new' && reg.editor"
              :editor="reg.editor"
              :layout="layout"
              :row-index="v.index + 2"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reg-grid {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--register-border);
  overflow-x: auto;
}

.reg-grid__probe {
  position: absolute;
  visibility: hidden;
  height: var(--row-h);
  width: 0;
}

.reg-grid__head {
  position: relative;
  box-sizing: border-box;
  min-width: calc(var(--reg-min) + var(--scrollbar-w));
  padding-right: var(--reg-gutter);
  background: var(--grid-header-bg);
}

.reg-grid__header-row {
  display: grid;
  grid-template-columns: var(--reg-cols);
  min-height: var(--row-h);
}

.reg-grid__header {
  position: relative;
  display: flex;
  gap: var(--space-1);
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

.reg-grid__header.is-sortable {
  cursor: pointer;
}

.reg-grid__header.is-sorted {
  background: color-mix(in srgb, var(--text-on-blue) 18%, transparent);
}

.reg-grid__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.reg-grid__sort {
  display: inline-flex;
  flex: 1;
  gap: var(--space-1);
  align-items: center;
  min-width: var(--hit-min);
  min-height: var(--row-h);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.reg-grid__header--money,
.reg-grid__header--money .reg-grid__sort {
  justify-content: flex-end;
}

.reg-grid__header--center,
.reg-grid__header--center .reg-grid__sort {
  justify-content: center;
}

.reg-grid__level {
  flex: none;
  margin-left: calc(-1 * var(--space-1));
  font-size: var(--font-xs);
  font-weight: 400;
}

.reg-grid__icon {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.reg-grid__resize {
  position: absolute;
  top: 0;
  right: calc(-1 * var(--space-1));
  bottom: 0;
  width: var(--space-2);
  cursor: col-resize;
  z-index: 1;
}

.reg-grid__scroller {
  flex: 1;
  box-sizing: border-box;
  min-width: calc(var(--reg-min) + var(--scrollbar-w));
  min-height: 0;
  overflow-y: auto;
}

.reg-grid__body {
  position: relative;
  width: 100%;
  outline: none;
}

.reg-grid__body:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.reg-grid__item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
</style>
