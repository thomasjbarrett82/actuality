// Category and group drag-and-drop on the Budget screen (09 §4.3), with pointer events for the exact 11 px
// threshold. Rows are hit-tested through their `data-row-index`; the drop target and its indicator come
// from budget-model. The scroll area auto-scrolls within 200 px of its top and 100 px of its bottom,
// faster the nearer the edge. Esc cancels; a drop outside any target does nothing.
import type { Id } from '@shared/domain/types';
import { onBeforeUnmount, ref, type Ref } from 'vue';
import { categoryDropTarget, groupDropTarget, type BudgetRow } from './budget-model';

const DRAG_THRESHOLD_PX = 11;
const SCROLL_ZONE_TOP_PX = 200;
const SCROLL_ZONE_BOTTOM_PX = 100;

export interface DragIndicator {
  row: number;
  below: boolean;
  /** A group drop is shown as a border on the group header. */
  group: boolean;
}

export type Drop =
  | { kind: 'category'; id: Id; groupId: Id; beforeId: Id | null }
  | { kind: 'group'; id: Id; beforeId: Id | null };

interface Press {
  kind: 'category' | 'group';
  id: Id;
  startX: number;
  startY: number;
}

export function useCategoryDrag(options: {
  scroller: Ref<HTMLElement | null>;
  rows: () => readonly BudgetRow[];
  canDrag: (kind: 'category' | 'group') => boolean;
  onDrop: (drop: Drop) => void;
}) {
  const dragging = ref<{ kind: 'category' | 'group'; id: Id } | null>(null);
  const indicator = ref<DragIndicator | null>(null);
  let press: Press | null = null;
  let target: Drop | null = null;
  let pointerY = 0;
  let frame: number | null = null;
  let swallowClick = false;

  const reducedMotion = (): boolean =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hit(y: number): { index: number; lower: boolean } | null {
    const root = options.scroller.value;
    if (!root) return null;
    for (const el of root.querySelectorAll<HTMLElement>('[data-row-index]')) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      return { index: Number(el.dataset['rowIndex']), lower: y > r.top + r.height / 2 };
    }
    return null;
  }

  function update(y: number): void {
    const d = dragging.value;
    const h = hit(y);
    target = null;
    indicator.value = null;
    if (!d || !h) return;
    const rows = options.rows();
    if (d.kind === 'category') {
      const t = categoryDropTarget(rows, h.index, h.lower);
      // Not into Uncategorized or Hidden.
      if (!t) return;
      target = { kind: 'category', id: d.id, groupId: t.groupId, beforeId: t.beforeId };
      indicator.value = { ...t.indicator, group: false };
    } else {
      const t = groupDropTarget(rows, h.index, h.lower);
      if (!t) return;
      target = { kind: 'group', id: d.id, beforeId: t.beforeId };
      indicator.value = { ...t.indicator, group: true };
    }
  }

  function autoScroll(): void {
    frame = null;
    const root = options.scroller.value;
    if (!dragging.value || !root) return;
    const r = root.getBoundingClientRect();
    let delta = 0;
    if (pointerY < r.top + SCROLL_ZONE_TOP_PX) delta = -(r.top + SCROLL_ZONE_TOP_PX - pointerY);
    else if (pointerY > r.bottom - SCROLL_ZONE_BOTTOM_PX)
      delta = pointerY - (r.bottom - SCROLL_ZONE_BOTTOM_PX);
    if (delta === 0 || reducedMotion()) return;
    root.scrollTop += Math.sign(delta) * Math.ceil(Math.abs(delta) / 10);
    update(pointerY);
    frame = requestAnimationFrame(autoScroll);
  }

  function onMove(e: PointerEvent): void {
    if (!press) return;
    pointerY = e.clientY;
    if (!dragging.value) {
      const moved =
        Math.abs(e.clientX - press.startX) > DRAG_THRESHOLD_PX ||
        Math.abs(e.clientY - press.startY) > DRAG_THRESHOLD_PX;
      if (!moved) return;
      dragging.value = { kind: press.kind, id: press.id };
    }
    update(e.clientY);
    frame ??= requestAnimationFrame(autoScroll);
  }

  function end(drop: boolean): void {
    const was = dragging.value;
    const t = target;
    press = null;
    target = null;
    dragging.value = null;
    indicator.value = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    if (was) swallowClick = true;
    if (drop && was && t) options.onDrop(t);
  }

  function onUp(): void {
    end(true);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !dragging.value) return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  }

  /** Pointer-down on a category's or group's name. */
  function start(e: PointerEvent, kind: 'category' | 'group', id: Id): void {
    if (e.button !== 0 || !options.canDrag(kind)) return;
    press = { kind, id, startX: e.clientX, startY: e.clientY };
    swallowClick = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  /** A drag ends with a click on the pressed name: it must not open its popover. */
  function takeClick(): boolean {
    const s = swallowClick;
    swallowClick = false;
    return s;
  }

  onBeforeUnmount(() => {
    end(false);
  });

  return { dragging, indicator, start, takeClick };
}
