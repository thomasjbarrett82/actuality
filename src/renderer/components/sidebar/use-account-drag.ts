// Sidebar drag-and-drop (08 §4) with pointer events, for the exact 11 px threshold. An account moves only
// within its own group: the dragged account's slot becomes the drop hint, which follows the pointer over
// that group's accounts (their bounds inset 5 px top and bottom) and goes to the top of the group under
// its header. Anywhere else the hint hides, and a drop there cancels. The scroll area auto-scrolls near
// its edges. Esc cancels.
import type { AccountGroup } from '@shared/domain/accounts';
import { onBeforeUnmount, ref, type Ref } from 'vue';

/** Movement before a press becomes a drag (08 §4). */
const DRAG_THRESHOLD_PX = 11;
/** Account bounds are inset this much for hit-testing (08 §4). */
const DROP_INSET_PX = 5;
/** Auto-scroll zone at the top and bottom of the scroll area (08 §4). */
const SCROLL_ZONE_PX = 25;

export interface DropHint {
  group: AccountGroup;
  /** The position in the group's list without the dragged account. */
  index: number;
}

export interface DragState {
  id: string;
  from: DropHint;
  hint: DropHint | null;
  /** The proxy's top-left corner, in viewport px. */
  x: number;
  y: number;
  width: number;
}

interface Press {
  id: string;
  from: DropHint;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

export function useAccountDrag(options: {
  /** The scroll container: auto-scrolled, and searched for drop targets. */
  scroller: Ref<HTMLElement | null>;
  /** The element around the groups: outside it the hint hides. */
  groupsArea: Ref<HTMLElement | null>;
  canDrag: () => boolean;
  onDrop: (id: string, from: DropHint, to: DropHint) => void;
}) {
  const drag = ref<DragState | null>(null);
  let press: Press | null = null;
  let pointerY = 0;
  let frame: number | null = null;
  /** A drag ends with a click on the pressed button; it must not navigate. */
  let swallowClick = false;

  const reducedMotion = (): boolean =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hintAt(
    x: number,
    y: number,
    current: DropHint | null,
    own: AccountGroup,
  ): DropHint | null {
    const area = options.groupsArea.value?.getBoundingClientRect();
    if (!area || x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
    const root = options.scroller.value;
    if (!root) return null;
    for (const el of root.querySelectorAll<HTMLElement>('[data-drop-group]')) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const group = el.dataset['dropGroup'] as AccountGroup;
      if (group !== own) return null;
      const index = el.dataset['dropIndex'];
      // A group header: the top of that group.
      if (index === undefined) return { group, index: 0 };
      if (y >= r.top + DROP_INSET_PX && y <= r.bottom - DROP_INSET_PX)
        return { group, index: Number(index) };
      return current;
    }
    // Between targets (the hint itself, a gap): keep the hint where it is.
    return current;
  }

  function autoScroll(): void {
    frame = null;
    const root = options.scroller.value;
    if (!drag.value || !root) return;
    const r = root.getBoundingClientRect();
    let delta = 0;
    if (pointerY < r.top + SCROLL_ZONE_PX) delta = -(r.top + SCROLL_ZONE_PX - pointerY);
    else if (pointerY > r.bottom - SCROLL_ZONE_PX) delta = pointerY - (r.bottom - SCROLL_ZONE_PX);
    if (delta === 0) return;
    // Faster the deeper into the zone (08 §4).
    root.scrollTop +=
      Math.sign(delta) * Math.ceil(Math.min(Math.abs(delta), SCROLL_ZONE_PX * 2) / 3);
    frame = requestAnimationFrame(autoScroll);
  }

  function onMove(e: PointerEvent): void {
    if (!press) return;
    pointerY = e.clientY;
    if (!drag.value) {
      const moved =
        Math.abs(e.clientX - press.startX) > DRAG_THRESHOLD_PX ||
        Math.abs(e.clientY - press.startY) > DRAG_THRESHOLD_PX;
      if (!moved) return;
      drag.value = {
        id: press.id,
        from: press.from,
        hint: press.from,
        x: e.clientX - press.offsetX,
        y: e.clientY - press.offsetY,
        width: press.width,
      };
      swallowClick = true;
      return;
    }
    drag.value.x = e.clientX - press.offsetX;
    drag.value.y = e.clientY - press.offsetY;
    drag.value.hint = hintAt(e.clientX, e.clientY, drag.value.hint, drag.value.from.group);
    if (frame === null && !reducedMotion()) frame = requestAnimationFrame(autoScroll);
  }

  function end(drop: boolean): void {
    const state = drag.value;
    press = null;
    drag.value = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    // The dragged button left the DOM, so its click may never come: stop waiting for it.
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    if (drop && state?.hint) options.onDrop(state.id, state.from, state.hint);
  }

  function onUp(): void {
    end(true);
  }

  function onCancel(): void {
    end(false);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !drag.value) return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
  }

  /** Pointer down on an account button (not All Accounts). */
  function start(e: PointerEvent, id: string, from: DropHint): void {
    if (e.button !== 0 || !options.canDrag()) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    press = {
      id,
      from,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - r.left,
      offsetY: e.clientY - r.top,
      width: r.width,
    };
    swallowClick = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  /** True once for the click that ends a drag. */
  function consumeClick(): boolean {
    const swallow = swallowClick;
    swallowClick = false;
    return swallow;
  }

  onBeforeUnmount(() => {
    end(false);
  });

  return { drag, start, consumeClick };
}
