// The global v-scroll-focus directive (main.ts, 22 §7): an element whose content scrolls inside it is a tab
// stop while it overflows, so the arrow keys and Page Up/Down can scroll it (WCAG 2.1.1, axe's
// scrollable-region-focusable). While everything fits it stays out of the tab order.
import type { Directive } from 'vue';

const observers = new WeakMap<HTMLElement, ResizeObserver>();

function update(el: HTMLElement): void {
  const overflows = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
  if (overflows) el.tabIndex = 0;
  else el.removeAttribute('tabindex');
}

/** Watches the element and its children: the content's size changes when data loads or the zoom does. */
function observe(el: HTMLElement): void {
  const observer = observers.get(el);
  if (!observer) return;
  observer.disconnect();
  observer.observe(el);
  for (const child of el.children) observer.observe(child);
}

export const vScrollFocus: Directive<HTMLElement> = {
  mounted(el) {
    if (typeof ResizeObserver !== 'undefined') {
      observers.set(
        el,
        new ResizeObserver(() => {
          update(el);
        }),
      );
      observe(el);
    }
    update(el);
  },
  updated(el) {
    observe(el);
    update(el);
  },
  beforeUnmount(el) {
    observers.get(el)?.disconnect();
    observers.delete(el);
  },
};
