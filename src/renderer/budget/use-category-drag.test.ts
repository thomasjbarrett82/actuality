// Category and group drag-and-drop on the Budget screen (09 §4.3): the 11 px threshold, the drop target
// and indicator under the pointer, Esc, the click that ends a drag, and auto-scroll near the edges.
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { GROUPS } from '../testing/fixtures';
import { budgetRows } from './budget-model';
import { useCategoryDrag, type Drop } from './use-category-drag';

const ROWS = budgetRows(GROUPS, { collapsed: new Set(), uncategorized: false });
const ROW_TOP = 500;
const ROW_HEIGHT = 20;
/** The y in the middle of a row's upper or lower half. */
const yOf = (index: number, lower = false): number =>
  ROW_TOP + index * ROW_HEIGHT + (lower ? 15 : 5);
const indexOf = (key: string): number => ROWS.findIndex((r) => r.key === key);

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 400, height: bottom - top, width: 400 } as DOMRect;
}

let frames: FrameRequestCallback[];
let drops: Drop[];
let canDrag: boolean;
let reduced: boolean;

/** The composable in a component, over a scroller with one element per budget row. */
function setup() {
  const scroller = document.createElement('div');
  scroller.getBoundingClientRect = () => rect(0, 1000);
  ROWS.forEach((_, i) => {
    const el = document.createElement('div');
    el.dataset['rowIndex'] = String(i);
    el.getBoundingClientRect = () => rect(ROW_TOP + i * ROW_HEIGHT, ROW_TOP + (i + 1) * ROW_HEIGHT);
    scroller.appendChild(el);
  });
  document.body.appendChild(scroller);
  let api!: ReturnType<typeof useCategoryDrag>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useCategoryDrag({
          scroller: ref(scroller),
          rows: () => ROWS,
          canDrag: () => canDrag,
          onDrop: (d) => drops.push(d),
        });
        return () => h('div');
      },
    }),
  );
  return { api, scroller, wrapper };
}

const press = (y: number, button = 0) =>
  ({ button, clientX: 10, clientY: y }) as unknown as PointerEvent;
const move = (y: number, x = 10) =>
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
const up = () => window.dispatchEvent(new PointerEvent('pointerup'));

beforeEach(() => {
  frames = [];
  drops = [];
  canDrag = true;
  reduced = false;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: reduced, media: query }) as MediaQueryList,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCategoryDrag (09 §4.3)', () => {
  it("doesn't drag until the pointer moves past 11 px, and a plain click still opens", () => {
    const { api } = setup();
    const fuel = indexOf('c:c-fuel');
    api.start(press(yOf(fuel)), 'category', 'c-fuel');
    move(yOf(fuel) + 11);
    expect(api.dragging.value).toBeNull();
    up();
    expect(drops).toEqual([]);
    expect(api.takeClick()).toBe(false);
  });

  it('drops a category before the one under the upper half, and swallows the ending click once', () => {
    const { api } = setup();
    const groceries = indexOf('c:c-groceries');
    const rent = indexOf('c:c-rent');
    api.start(press(yOf(groceries)), 'category', 'c-groceries');
    move(yOf(rent));
    expect(api.dragging.value).toEqual({ kind: 'category', id: 'c-groceries' });
    expect(api.indicator.value).toEqual({ row: rent, below: false, group: false });
    up();
    expect(drops).toEqual([
      { kind: 'category', id: 'c-groceries', groupId: 'g-bills', beforeId: 'c-rent' },
    ]);
    expect(api.dragging.value).toBeNull();
    expect(api.indicator.value).toBeNull();
    expect(api.takeClick()).toBe(true);
    expect(api.takeClick()).toBe(false);
  });

  it('drops a category at the end of its group from the lower half of the last one', () => {
    const { api } = setup();
    const fuel = indexOf('c:c-fuel');
    api.start(press(yOf(indexOf('c:c-rent'))), 'category', 'c-rent');
    move(yOf(fuel, true));
    up();
    expect(drops).toEqual([
      { kind: 'category', id: 'c-rent', groupId: 'g-everyday', beforeId: null },
    ]);
  });

  it('drops a group before another group, shown on the group header', () => {
    const { api } = setup();
    const everyday = indexOf('g:g-everyday');
    api.start(press(yOf(indexOf('g:g-bills'))), 'group', 'g-bills');
    move(yOf(everyday));
    expect(api.indicator.value).toEqual({ row: everyday, below: false, group: true });
    up();
    expect(drops).toEqual([{ kind: 'group', id: 'g-bills', beforeId: 'g-everyday' }]);
  });

  it('drops nothing over a row that takes no drop, or outside every row', () => {
    const { api } = setup();
    // A group over a category row has no target.
    api.start(press(yOf(indexOf('g:g-bills'))), 'group', 'g-bills');
    move(yOf(indexOf('c:c-groceries')));
    expect(api.dragging.value).not.toBeNull();
    expect(api.indicator.value).toBeNull();
    up();
    api.start(press(yOf(indexOf('c:c-rent'))), 'category', 'c-rent');
    move(ROW_TOP + ROWS.length * ROW_HEIGHT + 300);
    up();
    expect(drops).toEqual([]);
  });

  it('cancels with Esc, which goes no further', () => {
    const { api } = setup();
    api.start(press(yOf(indexOf('c:c-groceries'))), 'category', 'c-groceries');
    move(yOf(indexOf('c:c-rent')));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    const bubbled = vi.fn();
    window.addEventListener('keydown', bubbled);
    window.dispatchEvent(esc);
    window.removeEventListener('keydown', bubbled);
    expect(esc.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(api.dragging.value).toBeNull();
    up();
    expect(drops).toEqual([]);
  });

  it('ignores a press with another button, or when dragging is off', () => {
    const { api } = setup();
    api.start(press(yOf(1), 2), 'category', 'c-groceries');
    move(yOf(4));
    expect(api.dragging.value).toBeNull();
    canDrag = false;
    api.start(press(yOf(1)), 'category', 'c-groceries');
    move(yOf(4));
    expect(api.dragging.value).toBeNull();
  });

  it('auto-scrolls near the top edge, faster nearer the edge, but not with reduced motion', () => {
    const { api, scroller } = setup();
    api.start(press(yOf(indexOf('c:c-rent'))), 'category', 'c-rent');
    scroller.scrollTop = 500;
    move(150);
    frames.shift()?.(0);
    const slow = 500 - scroller.scrollTop;
    expect(slow).toBeGreaterThan(0);
    move(10);
    frames.shift()?.(0);
    expect(500 - slow - scroller.scrollTop).toBeGreaterThan(slow);
    up();
    reduced = true;
    api.start(press(yOf(indexOf('c:c-rent'))), 'category', 'c-rent');
    const before = scroller.scrollTop;
    move(10);
    frames.forEach((f) => {
      f(0);
    });
    expect(scroller.scrollTop).toBe(before);
  });

  it('ends a drag when the component goes away', () => {
    const { api, wrapper } = setup();
    api.start(press(yOf(indexOf('c:c-groceries'))), 'category', 'c-groceries');
    move(yOf(indexOf('c:c-rent')));
    wrapper.unmount();
    expect(api.dragging.value).toBeNull();
    up();
    expect(drops).toEqual([]);
  });
});
