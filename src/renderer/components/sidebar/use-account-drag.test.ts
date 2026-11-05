// Sidebar drag-and-drop (08 §4): the 11 px threshold, the drop hint that stays within the dragged
// account's group (inset bounds, the group header, gaps), Esc and pointercancel, the click that ends a
// drag, and auto-scroll near the edges.
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useAccountDrag, type DropHint } from './use-account-drag';

function rect(top: number, bottom: number, left = 0, right = 200): DOMRect {
  return { top, bottom, left, right, height: bottom - top, width: right - left } as DOMRect;
}

/** Targets by y: On Budget's header 0–20, its accounts 20–50 and 50–80; Off Budget's header 80–100 and
 * account 100–130. */
const TARGETS: { group: string; index?: number; top: number; bottom: number }[] = [
  { group: 'onBudget', top: 0, bottom: 20 },
  { group: 'onBudget', index: 0, top: 20, bottom: 50 },
  { group: 'onBudget', index: 1, top: 50, bottom: 80 },
  { group: 'offBudget', top: 80, bottom: 100 },
  { group: 'offBudget', index: 0, top: 100, bottom: 130 },
];

let frames: FrameRequestCallback[];
let drops: [string, DropHint, DropHint][];
let canDrag: boolean;

function setup() {
  const scroller = document.createElement('div');
  scroller.getBoundingClientRect = () => rect(0, 400);
  const area = document.createElement('div');
  area.getBoundingClientRect = () => rect(0, 140);
  for (const t of TARGETS) {
    const el = document.createElement('div');
    el.dataset['dropGroup'] = t.group;
    if (t.index !== undefined) el.dataset['dropIndex'] = String(t.index);
    el.getBoundingClientRect = () => rect(t.top, t.bottom);
    area.appendChild(el);
  }
  scroller.appendChild(area);
  document.body.appendChild(scroller);
  let api!: ReturnType<typeof useAccountDrag>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAccountDrag({
          scroller: ref(scroller),
          groupsArea: ref(area),
          canDrag: () => canDrag,
          onDrop: (id, from, to) => drops.push([id, from, to]),
        });
        return () => h('div');
      },
    }),
  );
  return { api, scroller, wrapper };
}

const FROM: DropHint = { group: 'onBudget', index: 1 };
/** A press on the second On Budget account's button, 10 px in from its left and top. */
function press(api: ReturnType<typeof useAccountDrag>, button = 0): void {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => rect(50, 80, 10, 190);
  api.start(
    { button, clientX: 20, clientY: 60, currentTarget: el } as unknown as PointerEvent,
    'a2',
    FROM,
  );
}
const move = (y: number, x = 20) =>
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
const up = () => window.dispatchEvent(new PointerEvent('pointerup'));

beforeEach(() => {
  frames = [];
  drops = [];
  canDrag = true;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: false, media: query }) as MediaQueryList,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAccountDrag (08 §4)', () => {
  it("doesn't drag until the pointer moves past 11 px, and the click still navigates", () => {
    const { api } = setup();
    press(api);
    move(71);
    expect(api.drag.value).toBeNull();
    up();
    expect(drops).toEqual([]);
    expect(api.consumeClick()).toBe(false);
  });

  it('starts with the hint in its own slot and a proxy under the pointer', () => {
    const { api } = setup();
    press(api);
    move(72, 25);
    expect(api.drag.value).toEqual({ id: 'a2', from: FROM, hint: FROM, x: 15, y: 62, width: 180 });
  });

  it('moves the hint over its own group: accounts by their inset bounds, the header to the top', () => {
    const { api } = setup();
    press(api);
    move(72);
    move(35);
    expect(api.drag.value?.hint).toEqual({ group: 'onBudget', index: 0 });
    // Within 5 px of the next account's edge: the hint stays.
    move(52);
    expect(api.drag.value?.hint).toEqual({ group: 'onBudget', index: 0 });
    move(65);
    expect(api.drag.value?.hint).toEqual({ group: 'onBudget', index: 1 });
    move(10);
    expect(api.drag.value?.hint).toEqual({ group: 'onBudget', index: 0 });
    up();
    expect(drops).toEqual([['a2', FROM, { group: 'onBudget', index: 0 }]]);
    expect(api.consumeClick()).toBe(true);
    expect(api.consumeClick()).toBe(false);
  });

  it('hides the hint over another group or outside the groups, and a drop there does nothing', () => {
    const { api } = setup();
    press(api);
    move(72);
    move(110);
    expect(api.drag.value?.hint).toBeNull();
    move(35);
    expect(api.drag.value?.hint).toEqual({ group: 'onBudget', index: 0 });
    move(35, 500);
    expect(api.drag.value?.hint).toBeNull();
    up();
    expect(drops).toEqual([]);
  });

  it('cancels with Esc or pointercancel', () => {
    const { api } = setup();
    press(api);
    move(72);
    move(35);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(api.drag.value).toBeNull();
    press(api);
    move(72);
    window.dispatchEvent(new PointerEvent('pointercancel'));
    expect(api.drag.value).toBeNull();
    up();
    expect(drops).toEqual([]);
  });

  it("stops waiting for the click a drag swallows when it doesn't come", async () => {
    const { api } = setup();
    press(api);
    move(72);
    up();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.consumeClick()).toBe(false);
  });

  it('ignores a press with another button, or when dragging is off', () => {
    const { api } = setup();
    press(api, 2);
    move(30);
    expect(api.drag.value).toBeNull();
    canDrag = false;
    press(api);
    move(30);
    expect(api.drag.value).toBeNull();
  });

  it('auto-scrolls near the bottom edge, and stops outside the zone', () => {
    const { api, scroller } = setup();
    press(api);
    move(72);
    move(390);
    frames.shift()?.(0);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    const at = scroller.scrollTop;
    move(200);
    frames.shift()?.(0);
    expect(scroller.scrollTop).toBe(at);
    expect(frames).toEqual([]);
  });

  it('ends a drag when the component goes away', () => {
    const { api, wrapper } = setup();
    press(api);
    move(72);
    wrapper.unmount();
    expect(api.drag.value).toBeNull();
    up();
    expect(drops).toEqual([]);
  });
});
