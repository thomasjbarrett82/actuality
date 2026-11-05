// Chart behavior shared by the report SVGs (15 §8, 22 §4.1): the frame's measured width, and one focused
// x position that the arrow keys, Home/End and the pointer move, so the tooltip works on keyboard focus as
// well as hover. Series colors are report tokens (05 §1.11); shapes are the non-color cue.
import type { SeriesColor } from '@shared/reporting/result';
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring', 'bar'] as const;
export type Shape = (typeof SHAPES)[number];

/** A series color as a CSS value. */
export const seriesColor = (c: SeriesColor): string =>
  c === 'other' ? 'var(--report-series-other)' : `var(--report-series-${String(c)})`;

/** The shape of a series color: the same series keeps the same cue wherever it's drawn. */
export const seriesShape = (c: SeriesColor): Shape =>
  c === 'other' ? 'bar' : (SHAPES[c - 1] ?? 'circle');

/** A plotted series. Values are plot numbers (minor units); null is unobserved. */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  shape: Shape;
  values: (number | null)[];
  dashed?: boolean;
}

/** The width of an element, kept current. */
export function useWidth(el: Ref<HTMLElement | null>, fallback = 600): Ref<number> {
  const width = ref(fallback);
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    const measure = (): void => {
      const w = el.value?.clientWidth ?? 0;
      if (w > 0) width.value = w;
    };
    measure();
    observer = new ResizeObserver(measure);
    if (el.value) observer.observe(el.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}

/** The focused x position: null when neither the keyboard nor the pointer is on the chart. */
export function useChartFocus(count: () => number): {
  index: Ref<number | null>;
  onKeydown: (e: KeyboardEvent) => void;
  onFocus: () => void;
  onLeave: () => void;
} {
  const index = ref<number | null>(null);
  const clamp = (i: number): number => Math.min(Math.max(0, i), Math.max(0, count() - 1));
  return {
    index,
    onKeydown: (e) => {
      const n = count();
      if (n === 0) return;
      const now = index.value ?? 0;
      const next =
        e.key === 'ArrowRight'
          ? now + 1
          : e.key === 'ArrowLeft'
            ? now - 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? n - 1
                : null;
      if (next === null) {
        if (e.key === 'Escape') index.value = null;
        return;
      }
      e.preventDefault();
      index.value = clamp(next);
    },
    onFocus: () => {
      if (index.value === null && count() > 0) index.value = 0;
    },
    onLeave: () => {
      index.value = null;
    },
  };
}
