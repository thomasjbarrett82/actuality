<script setup lang="ts">
// The budget grid (09 §1, §4–5, §7; 22 §2.3, §4.2): ONE scroll container with the month headers and totals
// sticky at the top and the category column sticky at the left. Rows are a tree grid: Uncategorized,
// groups and their categories, Hidden Categories. Each visible month adds Budgeted / Outflows / Balance
// cells. Keyboard: a roving tab stop moved with the arrows; Enter acts like a click; ←/→ on a group name
// collapse/expand; Alt+↑/↓ move the row; Shift+F10 opens the row menu; Ctrl+←/→ collapse/expand all. The
// category column is resizable (a focusable separator).
import type {
  BudgetCategoryMonth,
  BudgetMonthView,
  Category,
  CategoryGroup,
  Id,
  Money,
  Month,
} from '@shared/domain/types';
import type { ContextMenuItem } from '@shared/shell-api';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ListCollapse,
  ListTree,
  Plus,
  StickyNote,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  addCategory,
  addGroup,
  editCategory,
  editGroup,
  editNote,
  longMonth,
  monthYear,
  moveCategory,
  moveGroup,
  moveToGroup,
  overspending,
  quickBudgetMenu,
  saveEntityNote,
  showHidden,
  showIncome,
  showOutflows,
  type OutflowTarget,
} from '../../budget/actions';
import {
  categoryMonth,
  hiddenTotals,
  stepMove,
  visibleMonthCount,
  type BudgetRow,
} from '../../budget/budget-model';
import { CATEGORY_COL_MAX, CATEGORY_COL_MIN, useBudget } from '../../budget/use-budget';
import { useCategoryDrag, type Drop } from '../../budget/use-category-drag';
import { moneyLabel } from '../../money-display';
import { attempt } from '../../register/dialogs';
import { host } from '../../rpc/host-client';
import MoneyAmount from '../common/MoneyAmount.vue';
import BudgetedCell from './BudgetedCell.vue';
import MonthHeader from './MonthHeader.vue';

const { t } = useI18n();
const b = useBudget();

const wrap = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const headHeight = ref(0);

/** The category column's width while the grabber is dragged; saved on drag end (09 §1). */
const liveWidth = ref<number | null>(null);
const catWidth = computed(() => liveWidth.value ?? b.categoryColumnWidth);
const columns = computed(
  () =>
    `${String(catWidth.value)}rem repeat(${String(Math.max(1, b.visible.length))}, minmax(var(--month-col-w), 1fr))`,
);

const rem = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;

// ------------------------------------------------------------------------------ sizes

function measure(): void {
  const el = scroller.value;
  if (!el) return;
  const r = rem();
  const style = getComputedStyle(el);
  const monthW = Number.parseFloat(style.getPropertyValue('--month-col-w')) * r || 19 * r;
  const gap = Number.parseFloat(style.getPropertyValue('--space-3')) * r || 0.5 * r;
  const available = el.clientWidth - catWidth.value * r - gap;
  b.setCount(visibleMonthCount(available, monthW, gap));
  headHeight.value = head.value?.offsetHeight ?? 0;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (scroller.value) observer.observe(scroller.value);
  if (head.value) observer.observe(head.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(catWidth, () => {
  measure();
});

// ------------------------------------------------------------------------------ cells

const past = (m: Month | null): boolean => m !== null && m < b.current;
const money = computed(() => b.format.money);
const view = (m: Month | null): BudgetMonthView | null => (m ? (b.views.get(m) ?? null) : null);
/** Outflows: blank when 0 with no transactions, "0.00" when they net to zero (09 §5.4). */
const activityValue = (c: BudgetCategoryMonth | null): Money | null =>
  c && (c.activity !== 0 || c.hasTransactions) ? c.activity : null;
const uncategorizedValue = (v: BudgetMonthView | null): Money | null =>
  v?.uncategorized.hasTransactions ? v.uncategorized.activity : null;
const hiddenValue = (
  v: BudgetMonthView | null,
  key: 'budgeted' | 'activity' | 'balance',
): Money | null => (v && b.hiddenIds.size > 0 ? hiddenTotals(v, b.hiddenIds)[key] : null);
const cellOf = (m: Month | null, id: Id): BudgetCategoryMonth | null => {
  const v = view(m);
  return v ? categoryMonth(v, id) : null;
};
const groupOf = (m: Month | null, id: Id) => view(m)?.groups.find((g) => g.id === id) ?? null;
const columnName = (m: Month, key: string): string =>
  t('a11y.budgetColumn', { month: longMonth(m), column: t(key) });
const titles = {
  budgeted: 'budget.budgeted',
  activity: 'budget.outflows',
  balance: 'budget.balance',
} as const;
/** The full amount for screen readers (22 §4.3). */
const spoken = (m: Money, overspent = false): string =>
  overspent
    ? t('a11y.budgetOverspent', { amount: moneyLabel(m, money.value, { symbol: true }) })
    : moneyLabel(m, money.value, { symbol: true });

// ------------------------------------------------------------------------------ roving focus (22 §2.3)

const active = ref<{ r: number; c: number }>({ r: 0, c: 0 });
const colCount = computed(() => 1 + 3 * b.visible.length);

function cellEl(r: number, c: number): HTMLElement | null {
  return (
    scroller.value?.querySelector<HTMLElement>(`[data-r="${String(r)}"][data-c="${String(c)}"]`) ??
    null
  );
}

function focusCell(r: number, c: number): void {
  const rows = b.rows.length;
  const rr = Math.max(0, Math.min(rows - 1, r));
  const cc = Math.max(0, Math.min(colCount.value - 1, c));
  active.value = { r: rr, c: cc };
  void nextTick(() => cellEl(rr, cc)?.focus());
}

const isStop = (r: number, c: number): boolean => active.value.r === r && active.value.c === c;
const stop = (r: number, c: number): number => (isStop(r, c) ? 0 : -1);

// The editor moves between Budgeted cells by itself: follow it with the roving stop.
watch(
  () => b.focus,
  (f) => {
    if (!f) return;
    const r = b.rows.findIndex((x) => x.kind === 'category' && x.category.id === f.categoryId);
    const mi = b.visible.indexOf(f.month);
    if (r !== -1 && mi !== -1) active.value = { r, c: 1 + 3 * mi };
  },
);

function rowMoveTarget(row: BudgetRow) {
  if (row.kind === 'category') return { kind: 'category' as const, id: row.category.id };
  if (row.kind === 'group') return { kind: 'group' as const, id: row.group.id };
  return null;
}

async function stepRow(row: BudgetRow, step: 1 | -1): Promise<void> {
  if (!b.canEdit) return;
  const target = rowMoveTarget(row);
  if (!target) return;
  const move = stepMove(b.tree, target, step);
  if (!move) return;
  if (target.kind === 'group') {
    if (!b.moveSupport.group) return;
    await moveGroup(target.id, move.beforeId);
  } else await moveCategory(b, target.id, move.groupId, move.beforeId);
  await nextTick();
  const r = b.rows.findIndex((x) => rowMoveTarget(x)?.id === target.id);
  if (r !== -1) focusCell(r, 0);
}

function onKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  const cell = target?.closest<HTMLElement>('[data-r]');
  if (!target || !cell || target.closest('input, textarea')) return;
  const r = Number(cell.dataset['r']);
  const c = Number(cell.dataset['c']);
  active.value = { r, c };
  const row = b.rows[r];
  const ctrl = e.ctrlKey || e.metaKey;
  let handled = true;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    if (row) void stepRow(row, e.key === 'ArrowUp' ? -1 : 1);
  } else if (ctrl && e.key === 'ArrowLeft') b.setAllCollapsed(true);
  else if (ctrl && e.key === 'ArrowRight') b.setAllCollapsed(false);
  else if (e.key === 'ArrowDown') focusCell(r + 1, c);
  else if (e.key === 'ArrowUp') focusCell(r - 1, c);
  else if (e.key === 'ArrowLeft' && c === 0 && row?.kind === 'group' && !row.collapsed)
    b.toggleGroup(row.group.id, false);
  else if (e.key === 'ArrowRight' && c === 0 && row?.kind === 'group' && row.collapsed)
    b.toggleGroup(row.group.id, true);
  else if (e.key === 'ArrowLeft') focusCell(r, c - 1);
  else if (e.key === 'ArrowRight') focusCell(r, c + 1);
  else if (e.key === 'Home') focusCell(r, 0);
  else if (e.key === 'End') focusCell(r, colCount.value - 1);
  else if (e.key === 'PageDown') scrollRows(4);
  else if (e.key === 'PageUp') scrollRows(-4);
  else if (e.key === 'Enter' || e.key === ' ') target.click();
  else if (e.key === 'F2' && target.dataset['budgetCell'] === 'budgeted') target.click();
  else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
    if (row) void rowMenu(row, target);
  } else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

// ------------------------------------------------------------------------------ scrolling (09 §1)

const rowPx = (): number => {
  const el = scroller.value;
  if (!el) return 24;
  return (Number.parseFloat(getComputedStyle(el).getPropertyValue('--row-h')) || 1.85) * rem();
};

function scrollRows(n: number): void {
  const el = scroller.value;
  if (el) el.scrollTop += n * rowPx();
}

/** One --row-h per wheel notch. Horizontal and pinch gestures pass through. */
function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
  e.preventDefault();
  const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
  scrollRows(Math.sign(notches) * Math.max(1, Math.round(Math.abs(notches))));
}

defineExpose({
  scrollTop: () => {
    if (scroller.value) scroller.value.scrollTop = 0;
  },
  focusGrid: () => {
    focusCell(active.value.r, active.value.c);
  },
});

// ------------------------------------------------------------------------------ actions

const groupHasNote = (g: CategoryGroup): boolean => g.note !== null;

function categoryTooltip(c: Category): string {
  return c.note
    ? t('app.budCategoryTooltipNote', { name: c.name, note: c.note })
    : t('app.budCategoryTooltip', { name: c.name });
}

function clickName(row: BudgetRow, e: MouseEvent): void {
  if (drag.takeClick()) return;
  const anchor = e.currentTarget as HTMLElement;
  if (row.kind === 'group') void editGroup(b, row.group, anchor);
  else if (row.kind === 'category') void editCategory(b, row.category, anchor);
}

function noteFor(row: BudgetRow, anchor: HTMLElement): void {
  if (row.kind === 'group')
    void editNote(anchor, row.group.name, row.group.note, saveEntityNote(row.group.id), b.canEdit);
  else if (row.kind === 'category')
    void editNote(
      anchor,
      row.category.name,
      row.category.note,
      saveEntityNote(row.category.id),
      b.canEdit,
    );
}

function cellNote(m: Month, c: Category, anchor: HTMLElement): void {
  void editNote(
    anchor,
    t('app.budCellNoteTitle', { category: c.name, month: monthYear(m) }),
    b.cellNotes.get(m)?.[c.id] ?? null,
    (text) => host.call('notes.setCellNote', { month: m, categoryId: c.id, text }),
    b.canEdit,
  );
}

function monthNote(m: Month, anchor: HTMLElement): void {
  void editNote(
    anchor,
    monthYear(m),
    b.monthNotes.get(m) ?? null,
    (text) => host.call('notes.setMonthNote', { month: m, text }),
    b.canEdit,
  );
}

function outflows(m: Month, target: OutflowTarget, anchor: HTMLElement): void {
  void showOutflows(b, anchor, target, m);
}

function balanceClick(m: Month, row: BudgetRow, balance: Money, anchor: HTMLElement): void {
  if (balance >= 0 || row.kind !== 'category') return;
  void overspending(b, anchor, m, row.category.id);
}

async function rowMenu(row: BudgetRow, anchor: HTMLElement): Promise<void> {
  if (row.kind !== 'category' && row.kind !== 'group') return;
  const on = b.canEdit;
  const target = rowMoveTarget(row);
  const canUp = target !== null && stepMove(b.tree, target, -1) !== null;
  const canDown = target !== null && stepMove(b.tree, target, 1) !== null;
  const groupMoves = row.kind === 'category' || b.moveSupport.group;
  const items: ContextMenuItem[] = [
    { id: 'edit', label: t('app.budMenuEdit') },
    { id: 'note', label: t('app.budMenuNote') },
    { id: 'hide', label: t('app.budMenuHide'), enabled: on },
    { id: 'sep' },
    { id: 'up', label: t('app.accountMenuMoveUp'), enabled: on && canUp && groupMoves },
    { id: 'down', label: t('app.accountMenuMoveDown'), enabled: on && canDown && groupMoves },
    ...(row.kind === 'category'
      ? [{ id: 'toGroup', label: t('app.budMenuMoveToGroup'), enabled: on }]
      : []),
  ];
  const choice = await window.app.shell.showContextMenu(items);
  const nameEl =
    scroller.value?.querySelector<HTMLElement>(
      `[data-budget-name="${row.kind === 'group' ? 'g' : 'c'}:${CSS.escape(row.kind === 'group' ? row.group.id : row.category.id)}"]`,
    ) ?? anchor;
  if (choice === 'edit') {
    if (row.kind === 'group') await editGroup(b, row.group, nameEl);
    else await editCategory(b, row.category, nameEl);
  } else if (choice === 'note') noteFor(row, nameEl);
  else if (choice === 'hide') {
    if (row.kind === 'group')
      await attempt(() => host.call('categories.updateGroup', { id: row.group.id, hidden: true }));
    else await attempt(() => host.call('categories.update', { id: row.category.id, hidden: true }));
  } else if (choice === 'up') await stepRow(row, -1);
  else if (choice === 'down') await stepRow(row, 1);
  else if (choice === 'toGroup' && row.kind === 'category') await moveToGroup(b, row.category);
}

// ------------------------------------------------------------------------------ drag and drop (09 §4.3)

const drag = useCategoryDrag({
  scroller,
  rows: () => b.rows,
  canDrag: (kind) => b.canEdit && (kind === 'category' || b.moveSupport.group),
  onDrop: (d: Drop) => {
    if (d.kind === 'group') void moveGroup(d.id, d.beforeId);
    else void moveCategory(b, d.id, d.groupId, d.beforeId);
  },
});

// ------------------------------------------------------------------------------ column resize (09 §1)

let resizeStart: { x: number; width: number } | null = null;

function onGrabberDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  resizeStart = { x: e.clientX, width: catWidth.value };
  window.addEventListener('pointermove', onGrabberMove);
  window.addEventListener('pointerup', onGrabberUp);
}

function onGrabberMove(e: PointerEvent): void {
  if (!resizeStart) return;
  const next = resizeStart.width + (e.clientX - resizeStart.x) / rem();
  liveWidth.value = Math.min(CATEGORY_COL_MAX, Math.max(CATEGORY_COL_MIN, next));
}

function onGrabberUp(): void {
  window.removeEventListener('pointermove', onGrabberMove);
  window.removeEventListener('pointerup', onGrabberUp);
  if (liveWidth.value !== null) b.setColumnWidth(liveWidth.value);
  resizeStart = null;
  liveWidth.value = null;
}

function onGrabberKey(e: KeyboardEvent): void {
  let w: number | null = null;
  if (e.key === 'ArrowLeft') w = catWidth.value - 1;
  else if (e.key === 'ArrowRight') w = catWidth.value + 1;
  else if (e.key === 'Home') w = CATEGORY_COL_MIN;
  else if (e.key === 'End') w = CATEGORY_COL_MAX;
  if (w === null) return;
  e.preventDefault();
  b.setColumnWidth(w);
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onGrabberMove);
  window.removeEventListener('pointerup', onGrabberUp);
});

const hasHidden = computed(() => b.hiddenIds.size > 0 || b.tree.some((g) => g.hidden));
const levelOf = (row: BudgetRow): number | undefined =>
  row.kind === 'group' ? 1 : row.kind === 'category' ? 2 : undefined;
</script>

<template>
  <div ref="wrap" class="budget-grid">
    <div
      ref="scroller"
      class="budget-grid__scroll"
      data-budget-scroll
      tabindex="-1"
      role="treegrid"
      :aria-label="t('a11y.budgetGrid')"
      :aria-colcount="colCount"
      :aria-rowcount="b.rows.length + 2"
      :style="{
        '--cat-w': `${String(catWidth)}rem`,
        scrollPaddingTop: `${String(headHeight)}px`,
        scrollPaddingLeft: `${String(catWidth)}rem`,
      }"
      @keydown="onKeydown"
      @wheel="onWheel"
    >
      <!-- Header and totals: sticky at the top. -->
      <div ref="head" class="budget-grid__head" role="rowgroup">
        <div class="budget-grid__row" role="row" :style="{ gridTemplateColumns: columns }">
          <div class="budget-grid__cat budget-grid__cat-head" role="columnheader">
            <span class="budget-grid__cat-title">{{ t('budget.categories') }}</span>
            <button
              v-tooltip="
                b.canEdit ? t('app.budAddGroupTooltip') : t('app.editingUnavailableOffline')
              "
              type="button"
              class="budget-grid__icon"
              :aria-label="t('app.budAddGroupTooltip')"
              :disabled="!b.canEdit"
              @click="addGroup(b, () => scroller && (scroller.scrollTop = 0))"
            >
              <Plus aria-hidden="true" />
            </button>
            <button
              v-tooltip="t('app.budExpandAll')"
              type="button"
              class="budget-grid__icon"
              :aria-label="t('app.budExpandAll')"
              @click="b.setAllCollapsed(false)"
            >
              <ListTree aria-hidden="true" />
            </button>
            <button
              v-tooltip="t('app.budCollapseAll')"
              type="button"
              class="budget-grid__icon"
              :aria-label="t('app.budCollapseAll')"
              @click="b.setAllCollapsed(true)"
            >
              <ListCollapse aria-hidden="true" />
            </button>
          </div>
          <div v-for="(m, i) in b.visible" :key="m ?? `empty-${String(i)}`" role="columnheader">
            <MonthHeader
              :month="m"
              :view="view(m)"
              :note="m ? (b.monthNotes.get(m) ?? null) : null"
              @income="
                (a) => {
                  const v = view(m);
                  if (v) void showIncome(b, a, v);
                }
              "
              @note="(a) => m && monthNote(m, a)"
              @quick="
                (a) => {
                  const v = view(m);
                  if (v) void quickBudgetMenu(b, v, a);
                }
              "
            />
          </div>
        </div>
        <div class="budget-grid__spacer" aria-hidden="true" />
        <div
          class="budget-grid__row budget-grid__totals"
          role="row"
          :style="{ gridTemplateColumns: columns }"
        >
          <div class="budget-grid__cat" role="gridcell" />
          <div
            v-for="(m, i) in b.visible"
            :key="m ?? `t-${String(i)}`"
            class="budget-grid__totals-cell"
            :class="{ 'budget-grid__totals-cell--past': past(m) }"
          >
            <template v-if="view(m)">
              <div class="budget-grid__stack" role="gridcell">
                <span class="budget-grid__stack-title">{{ t(titles.budgeted) }}</span>
                <span class="budget-grid__stack-value"
                  ><MoneyAmount :value="view(m)?.totals.budgeted ?? 0" :settings="money" symbol
                /></span>
              </div>
              <div class="budget-grid__stack" role="gridcell">
                <span class="budget-grid__stack-title">{{ t(titles.activity) }}</span>
                <button
                  v-tooltip="t('app.budSeeTransactions')"
                  type="button"
                  class="budget-grid__stack-value budget-grid__link"
                  @click="m && outflows(m, { kind: 'all' }, $event.currentTarget as HTMLElement)"
                >
                  <MoneyAmount :value="view(m)?.totals.activity ?? 0" :settings="money" symbol />
                </button>
              </div>
              <div class="budget-grid__stack" role="gridcell">
                <span class="budget-grid__stack-title">{{ t(titles.balance) }}</span>
                <span class="budget-grid__stack-value"
                  ><MoneyAmount :value="view(m)?.totals.balance ?? 0" :settings="money" symbol
                /></span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Rows. -->
      <div class="budget-grid__body" role="rowgroup">
        <div
          v-for="(row, r) in b.rows"
          :key="row.key"
          class="budget-grid__row"
          :class="[
            `budget-grid__row--${row.kind}`,
            {
              'budget-grid__row--drop-above':
                drag.indicator.value?.row === r &&
                !drag.indicator.value.below &&
                !drag.indicator.value.group,
              'budget-grid__row--drop-below':
                drag.indicator.value?.row === r &&
                drag.indicator.value.below &&
                !drag.indicator.value.group,
              'budget-grid__row--drop-group':
                drag.indicator.value?.row === r && drag.indicator.value.group,
              'budget-grid__row--dragging':
                drag.dragging.value !== null &&
                ((row.kind === 'category' && row.category.id === drag.dragging.value.id) ||
                  (row.kind === 'group' && row.group.id === drag.dragging.value.id)),
            },
          ]"
          role="row"
          :aria-level="levelOf(row)"
          :aria-expanded="row.kind === 'group' ? !row.collapsed : undefined"
          :aria-rowindex="r + 3"
          :data-row-index="r"
          :style="{ gridTemplateColumns: columns }"
        >
          <!-- The category column. -->
          <div class="budget-grid__cat budget-grid__name" role="rowheader">
            <template v-if="row.kind === 'uncategorized'">
              <span
                class="budget-grid__name-text budget-grid__uncategorized"
                :tabindex="stop(r, 0)"
                :data-r="r"
                data-c="0"
                @focus="active = { r, c: 0 }"
              >
                <CircleAlert class="budget-grid__needs" aria-hidden="true" />
                {{ t('budget.uncategorizedTransactionsCategory') }}
              </span>
            </template>
            <template v-else-if="row.kind === 'group'">
              <button
                type="button"
                class="budget-grid__disclosure"
                tabindex="-1"
                :aria-label="
                  t(row.collapsed ? 'a11y.budgetExpand' : 'a11y.budgetCollapse', {
                    name: row.group.name,
                  })
                "
                @click="b.toggleGroup(row.group.id)"
              >
                <ChevronRight v-if="row.collapsed" aria-hidden="true" />
                <ChevronDown v-else aria-hidden="true" />
              </button>
              <button
                v-tooltip.truncated
                type="button"
                class="budget-grid__name-text budget-grid__name-button budget-grid__group-name"
                :tabindex="stop(r, 0)"
                :data-r="r"
                data-c="0"
                :data-budget-name="`g:${row.group.id}`"
                @focus="active = { r, c: 0 }"
                @pointerdown="drag.start($event, 'group', row.group.id)"
                @click="clickName(row, $event)"
                @contextmenu.prevent="rowMenu(row, $event.currentTarget as HTMLElement)"
              >
                {{ row.group.name }}
              </button>
              <button
                v-tooltip="row.group.note ?? t('app.budAddNoteTooltip')"
                type="button"
                class="budget-grid__note"
                :class="{ 'budget-grid__note--set': groupHasNote(row.group) }"
                tabindex="-1"
                :aria-label="t(row.group.note ? 'a11y.budgetNote' : 'a11y.budgetAddNote')"
                @click="noteFor(row, $event.currentTarget as HTMLElement)"
              >
                <StickyNote aria-hidden="true" />
              </button>
              <button
                v-if="b.canEdit"
                v-tooltip="t('app.budAddSubcategory')"
                type="button"
                class="budget-grid__add"
                tabindex="-1"
                :aria-label="t('app.budAddSubcategory')"
                @click="addCategory(b, row.group.id)"
              >
                <Plus aria-hidden="true" />
              </button>
            </template>
            <template v-else-if="row.kind === 'category'">
              <button
                v-tooltip="categoryTooltip(row.category)"
                type="button"
                class="budget-grid__name-text budget-grid__name-button budget-grid__category-name"
                :tabindex="stop(r, 0)"
                :data-r="r"
                data-c="0"
                :data-budget-name="`c:${row.category.id}`"
                :aria-label="row.category.name"
                @focus="active = { r, c: 0 }"
                @pointerdown="drag.start($event, 'category', row.category.id)"
                @click="clickName(row, $event)"
                @contextmenu.prevent="rowMenu(row, $event.currentTarget as HTMLElement)"
              >
                {{ row.category.name }}
              </button>
              <button
                v-tooltip="row.category.note ?? t('app.budAddNoteTooltip')"
                type="button"
                class="budget-grid__note"
                :class="{ 'budget-grid__note--set': row.category.note !== null }"
                tabindex="-1"
                :aria-label="t(row.category.note ? 'a11y.budgetNote' : 'a11y.budgetAddNote')"
                @click="noteFor(row, $event.currentTarget as HTMLElement)"
              >
                <StickyNote aria-hidden="true" />
              </button>
            </template>
            <template v-else>
              <span
                class="budget-grid__name-text budget-grid__hidden-name"
                :tabindex="stop(r, 0)"
                :data-r="r"
                data-c="0"
                @focus="active = { r, c: 0 }"
                >{{ t('budget.hiddenCategoriesGroup') }}</span
              >
              <button
                v-if="hasHidden"
                type="button"
                class="budget-grid__unhide"
                tabindex="-1"
                @click="showHidden(b, $event.currentTarget as HTMLElement)"
              >
                {{ t('app.budUnhide') }}
              </button>
            </template>
          </div>

          <!-- Month cells. -->
          <div
            v-for="(m, mi) in b.visible"
            :key="m ?? `e-${String(mi)}`"
            class="budget-grid__month"
            :class="{ 'budget-grid__month--past': past(m) }"
          >
            <template v-if="m && view(m)">
              <!-- A category. -->
              <template v-if="row.kind === 'category'">
                <BudgetedCell
                  :cell="{ month: m, categoryId: row.category.id }"
                  :budgeted="cellOf(m, row.category.id)?.budgeted ?? 0"
                  :past="past(m)"
                  :first="row.first"
                  :note="b.cellNotes.get(m)?.[row.category.id] ?? null"
                  :label="columnName(m, titles.budgeted)"
                  :tab-stop="isStop(r, 1 + 3 * mi)"
                  :row="r"
                  :col="1 + 3 * mi"
                  @note="(a) => cellNote(m, row.category, a)"
                />
                <button
                  v-tooltip="
                    cellOf(m, row.category.id)?.hasTransactions ? t('app.budSeeTransactions') : null
                  "
                  type="button"
                  class="budget-grid__cell budget-grid__activity"
                  :class="{
                    'budget-grid__activity--link': cellOf(m, row.category.id)?.hasTransactions,
                  }"
                  role="gridcell"
                  :tabindex="stop(r, 2 + 3 * mi)"
                  :data-r="r"
                  :data-c="2 + 3 * mi"
                  :aria-label="`${columnName(m, titles.activity)}: ${spoken(cellOf(m, row.category.id)?.activity ?? 0)}`"
                  @focus="active = { r, c: 2 + 3 * mi }"
                  @click="
                    outflows(
                      m,
                      { kind: 'category', category: row.category, group: row.group },
                      $event.currentTarget as HTMLElement,
                    )
                  "
                >
                  <MoneyAmount
                    :value="activityValue(cellOf(m, row.category.id))"
                    :settings="money"
                    plus
                  />
                </button>
                <button
                  v-tooltip="
                    (cellOf(m, row.category.id)?.balance ?? 0) < 0
                      ? t('budget.overspendingSettingsTooltip')
                      : null
                  "
                  type="button"
                  class="budget-grid__cell budget-grid__balance"
                  role="gridcell"
                  :tabindex="stop(r, 3 + 3 * mi)"
                  :data-r="r"
                  :data-c="3 + 3 * mi"
                  :aria-label="`${columnName(m, titles.balance)}: ${spoken(cellOf(m, row.category.id)?.balance ?? 0, (cellOf(m, row.category.id)?.balance ?? 0) < 0)}`"
                  @focus="active = { r, c: 3 + 3 * mi }"
                  @click="
                    balanceClick(
                      m,
                      row,
                      cellOf(m, row.category.id)?.balance ?? 0,
                      $event.currentTarget as HTMLElement,
                    )
                  "
                >
                  <template
                    v-if="
                      (cellOf(m, row.category.id)?.balance ?? 0) !== 0 ||
                      cellOf(m, row.category.id)?.hasTransactions
                    "
                  >
                    <span
                      class="budget-grid__amount"
                      :class="{
                        'budget-grid__amount--negative':
                          (cellOf(m, row.category.id)?.balance ?? 0) < 0,
                        'budget-grid__amount--zero':
                          (cellOf(m, row.category.id)?.balance ?? 0) === 0,
                      }"
                      ><MoneyAmount
                        :value="cellOf(m, row.category.id)?.balance ?? 0"
                        :settings="money"
                    /></span>
                    <ArrowRight
                      v-if="
                        (cellOf(m, row.category.id)?.balance ?? 0) < 0 &&
                        cellOf(m, row.category.id)?.carryover
                      "
                      class="budget-grid__carry"
                      aria-hidden="true"
                    />
                  </template>
                </button>
              </template>

              <!-- A group. -->
              <template v-else-if="row.kind === 'group'">
                <span
                  class="budget-grid__cell budget-grid__group-cell"
                  role="gridcell"
                  :tabindex="stop(r, 1 + 3 * mi)"
                  :data-r="r"
                  :data-c="1 + 3 * mi"
                  @focus="active = { r, c: 1 + 3 * mi }"
                  ><MoneyAmount :value="groupOf(m, row.group.id)?.budgeted ?? 0" :settings="money"
                /></span>
                <button
                  type="button"
                  class="budget-grid__cell budget-grid__activity budget-grid__activity--link budget-grid__group-cell"
                  role="gridcell"
                  :tabindex="stop(r, 2 + 3 * mi)"
                  :data-r="r"
                  :data-c="2 + 3 * mi"
                  @focus="active = { r, c: 2 + 3 * mi }"
                  @click="
                    outflows(
                      m,
                      { kind: 'group', group: row.group },
                      $event.currentTarget as HTMLElement,
                    )
                  "
                >
                  <MoneyAmount
                    :value="groupOf(m, row.group.id)?.activity ?? 0"
                    :settings="money"
                    plus
                  />
                </button>
                <span
                  class="budget-grid__cell budget-grid__balance budget-grid__group-cell"
                  role="gridcell"
                  :tabindex="stop(r, 3 + 3 * mi)"
                  :data-r="r"
                  :data-c="3 + 3 * mi"
                  @focus="active = { r, c: 3 + 3 * mi }"
                  ><span
                    :class="{
                      'budget-grid__group-negative': (groupOf(m, row.group.id)?.balance ?? 0) < 0,
                      'budget-grid__amount--zero': (groupOf(m, row.group.id)?.balance ?? 0) === 0,
                    }"
                    ><MoneyAmount
                      :value="groupOf(m, row.group.id)?.balance ?? 0"
                      :settings="money" /></span
                ></span>
              </template>

              <!-- Uncategorized: its balance is its activity (09 §2). -->
              <template v-else-if="row.kind === 'uncategorized'">
                <span
                  class="budget-grid__cell"
                  role="gridcell"
                  :tabindex="stop(r, 1 + 3 * mi)"
                  :data-r="r"
                  :data-c="1 + 3 * mi"
                  @focus="active = { r, c: 1 + 3 * mi }"
                />
                <button
                  type="button"
                  class="budget-grid__cell budget-grid__activity"
                  :class="{ 'budget-grid__activity--link': view(m)?.uncategorized.hasTransactions }"
                  role="gridcell"
                  :tabindex="stop(r, 2 + 3 * mi)"
                  :data-r="r"
                  :data-c="2 + 3 * mi"
                  :aria-label="`${columnName(m, titles.activity)}: ${spoken(view(m)?.uncategorized.activity ?? 0)}`"
                  @focus="active = { r, c: 2 + 3 * mi }"
                  @click="
                    view(m)?.uncategorized.hasTransactions &&
                    outflows(m, { kind: 'uncategorized' }, $event.currentTarget as HTMLElement)
                  "
                >
                  <MoneyAmount :value="uncategorizedValue(view(m))" :settings="money" plus />
                </button>
                <span
                  class="budget-grid__cell budget-grid__balance"
                  role="gridcell"
                  :tabindex="stop(r, 3 + 3 * mi)"
                  :data-r="r"
                  :data-c="3 + 3 * mi"
                  @focus="active = { r, c: 3 + 3 * mi }"
                  ><MoneyAmount :value="uncategorizedValue(view(m))" :settings="money"
                /></span>
              </template>

              <!-- Hidden Categories: totals over the hidden categories (09 §4.2). -->
              <template v-else>
                <span
                  v-for="(key, k) in ['budgeted', 'activity', 'balance'] as const"
                  :key="key"
                  class="budget-grid__cell budget-grid__hidden-cell"
                  role="gridcell"
                  :tabindex="stop(r, 1 + k + 3 * mi)"
                  :data-r="r"
                  :data-c="1 + k + 3 * mi"
                  @focus="active = { r, c: 1 + k + 3 * mi }"
                  ><MoneyAmount :value="hiddenValue(view(m), key)" :settings="money"
                /></span>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- a focusable separator (22 §2.4): ←/→ and Home/End resize it -->
    <div
      class="budget-grid__grabber"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="t('a11y.splitterCategoryColumn')"
      :aria-valuenow="catWidth"
      :aria-valuemin="CATEGORY_COL_MIN"
      :aria-valuemax="CATEGORY_COL_MAX"
      :style="{
        left: `calc(${String(catWidth)}rem - var(--space-1))`,
        top: `${String(headHeight)}px`,
      }"
      @pointerdown="onGrabberDown"
      @keydown="onGrabberKey"
    />
  </div>
</template>

<style scoped>
.budget-grid {
  position: relative;
  flex: 1;
  min-height: 0;
}

.budget-grid__scroll {
  position: absolute;
  inset: 0;
  overflow: auto;
}

.budget-grid__scroll:focus {
  outline: none;
}

.budget-grid__head {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--panel-bg);
}

.budget-grid__row {
  display: grid;
  column-gap: var(--space-3);
  min-height: var(--row-h);
}

.budget-grid__cat {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--panel-bg);
}

.budget-grid__cat-head {
  display: flex;
  gap: var(--space-1);
  align-items: flex-end;
  padding: var(--space-2);
}

.budget-grid__cat-title {
  flex: 1;
  color: var(--text);
  font-size: var(--font-md);
  font-weight: 600;
}

.budget-grid__icon,
.budget-grid__add,
.budget-grid__note,
.budget-grid__disclosure {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.budget-grid__icon:disabled {
  cursor: default;
  opacity: 0.4;
}

.budget-grid__icon svg,
.budget-grid__add svg,
.budget-grid__note svg,
.budget-grid__disclosure svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.budget-grid__spacer {
  height: var(--space-3);
}

.budget-grid__totals-cell {
  display: grid;
  grid-template-columns: 34fr 33fr 33fr;
  padding-bottom: var(--space-2);
}

.budget-grid__stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-right: var(--space-2);
}

.budget-grid__stack-title {
  color: var(--text-muted);
  font-weight: 600;
}

.budget-grid__stack-value {
  color: var(--text-strong);
  font-weight: 600;
}

.budget-grid__totals-cell--past .budget-grid__stack-value {
  color: var(--text-muted);
}

.budget-grid__link {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.budget-grid__link:hover {
  text-decoration: underline;
}

/* Rows */

.budget-grid__month {
  display: grid;
  grid-template-columns: 34fr 33fr 33fr;
  height: var(--row-h);
}

.budget-grid__name {
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--row-h);
  border-bottom: 1px dashed var(--budget-cell-border);
}

.budget-grid__name-text {
  overflow: hidden;
  min-width: 0;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.budget-grid__name-button {
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.budget-grid__name-button:hover {
  text-decoration: underline;
}

.budget-grid__row--group .budget-grid__name {
  padding-left: var(--space-1);
  background: var(--budget-master-bg);
}

.budget-grid__group-name {
  font-weight: 600;
}

.budget-grid__row--category .budget-grid__name {
  padding-left: var(--space-6);
}

.budget-grid__note,
.budget-grid__add {
  visibility: hidden;
  opacity: 0.5;
}

.budget-grid__note:hover,
.budget-grid__add:hover {
  opacity: 1;
}

.budget-grid__note--set,
.budget-grid__row:hover .budget-grid__note,
.budget-grid__row:hover .budget-grid__add {
  visibility: visible;
}

.budget-grid__row--uncategorized .budget-grid__name,
.budget-grid__row--uncategorized .budget-grid__month {
  background: var(--uncategorized-bg);
}

.budget-grid__row--uncategorized .budget-grid__month--past {
  background: var(--uncategorized-bg-past);
}

.budget-grid__uncategorized {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  color: var(--uncategorized-text);
  font-style: italic;
  font-weight: 700;
}

.budget-grid__needs {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.budget-grid__hidden-name {
  flex: 1;
  color: var(--hidden-row-text);
}

.budget-grid__unhide {
  visibility: hidden;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--link);
  cursor: pointer;
  text-decoration: underline;
}

.budget-grid__unhide:focus-visible {
  visibility: visible;
}

.budget-grid__row:hover .budget-grid__unhide {
  visibility: visible;
}

.budget-grid__row--group .budget-grid__month {
  background: var(--budget-master-bg);
}

.budget-grid__row--group .budget-grid__month--past {
  background: var(--budget-master-bg-past);
}

.budget-grid__cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  min-width: 0;
  padding: 0 var(--space-2);
  border: 0;
  border-bottom: 1px dashed var(--budget-cell-border);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.budget-grid__month--past .budget-grid__cell {
  border-bottom-color: var(--budget-dots-past);
}

.budget-grid__balance {
  gap: var(--space-1);
  border-left: 1px dashed var(--budget-cell-border);
}

.budget-grid__month--past .budget-grid__balance {
  border-left-color: var(--budget-dots-past);
}

.budget-grid__activity--link {
  cursor: pointer;
}

.budget-grid__activity--link:hover {
  text-decoration: underline;
}

.budget-grid__group-cell {
  font-weight: 600;
}

.budget-grid__group-negative {
  color: var(--money-negative);
}

.budget-grid__amount--negative {
  padding: 0 var(--space-2);
  border-radius: var(--radius);
  background: var(--money-negative-pill);
  color: var(--money-negative);
}

.budget-grid__amount--zero {
  color: var(--text-muted);
}

/* --text-muted misses 4.5:1 on the hover background (theme-palettes.md §1). */
.budget-grid__row--category:focus-within .budget-grid__amount--zero,
.budget-grid__row--category:hover .budget-grid__amount--zero {
  color: var(--text-subtle);
}

.budget-grid__carry {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--overspend-arrow);
}

.budget-grid__hidden-cell {
  color: var(--hidden-row-text);
}

.budget-grid__row--drop-group .budget-grid__name {
  outline: 2px solid var(--drag-indicator);
  outline-offset: -2px;
}

.budget-grid__row--category:focus-within .budget-grid__name,
.budget-grid__row--category:focus-within .budget-grid__month {
  background: var(--budget-row-hover);
}

.budget-grid__row--category:hover .budget-grid__name,
.budget-grid__row--category:hover .budget-grid__month {
  background: var(--budget-row-hover);
}

.budget-grid__row--dragging {
  opacity: 0.5;
}

.budget-grid__row--drop-above {
  box-shadow: inset 0 2px 0 var(--drag-indicator);
}

.budget-grid__row--drop-below {
  box-shadow: inset 0 -2px 0 var(--drag-indicator);
}

.budget-grid__cell:focus-visible,
.budget-grid__name-text:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.budget-grid__grabber {
  position: absolute;
  bottom: 0;
  z-index: 4;
  width: var(--space-3);
  cursor: col-resize;
}

.budget-grid__grabber:hover,
.budget-grid__grabber:focus-visible {
  background: color-mix(in srgb, var(--budget-cell-border) 40%, transparent);
  outline: none;
}
</style>
