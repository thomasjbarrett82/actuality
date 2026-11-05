// The width a grid's vertical scrollbar takes (10 §2, 12 §3): 0 while the rows fit, so the columns reach
// the grid's right edge, and the scrollbar's width while it shows. The header sits outside the scroller
// and pads by this, so its columns stay over the rows'.
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function useScrollbarGutter(scroller: Ref<HTMLElement | null>): Ref<number> {
  const gutter = ref(0);
  let observer: ResizeObserver | null = null;
  const update = (): void => {
    const el = scroller.value;
    if (el) gutter.value = el.offsetWidth - el.clientWidth;
  };
  onMounted(() => {
    const el = scroller.value;
    if (!el) return;
    update();
    // The content box narrows when the scrollbar appears and widens when it goes.
    observer = new ResizeObserver(update);
    observer.observe(el);
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
  });
  return gutter;
}
