// v-scroll-focus (22 §7): a tab stop only while its content overflows.
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, withDirectives } from 'vue';
import { mountApp } from '../../testing/mount';
import { vScrollFocus } from './scroll-focus';

/** Fakes the layout happy-dom doesn't compute: the content's height against the box's. */
function sized(el: HTMLElement, content: () => number): void {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: content });
}

describe('v-scroll-focus', () => {
  it('adds the element to the tab order while it overflows, and removes it once it fits', async () => {
    const height = ref(50);
    const rows = ref(1);
    const Card = defineComponent(
      () => () =>
        withDirectives(
          h(
            'section',
            Array.from({ length: rows.value }, (_, i) => h('p', { key: i }, String(i))),
          ),
          [[vScrollFocus]],
        ),
    );
    const w = mountApp(Card);
    const el = w.find('section').element as HTMLElement;
    sized(el, () => height.value);
    rows.value = 2;
    await nextTick();
    expect(el.hasAttribute('tabindex')).toBe(false);

    height.value = 300;
    rows.value = 3;
    await nextTick();
    expect(el.getAttribute('tabindex')).toBe('0');

    height.value = 80;
    rows.value = 1;
    await nextTick();
    expect(el.hasAttribute('tabindex')).toBe(false);
  });
});
