// Callout tail positions (17 §3) ↔ Floating UI placements. A tail on the callout's top edge means the
// callout sits below its anchor, and so on.
import {
  arrow,
  flip,
  offset,
  shift,
  size,
  type Middleware,
  type Placement,
} from '@floating-ui/dom';

export const TAILS = [
  'top',
  'topLeft',
  'topRight',
  'bottom',
  'bottomLeft',
  'bottomRight',
  'left',
  'leftTop',
  'leftBottom',
  'right',
  'rightTop',
  'rightBottom',
] as const;

export type Tail = (typeof TAILS)[number];

/** The default preference order (17 §3). */
export const DEFAULT_TAILS: readonly Tail[] = [
  'bottom',
  'top',
  'left',
  'right',
  'bottomLeft',
  'bottomRight',
  'topLeft',
  'topRight',
  'leftTop',
  'leftBottom',
  'rightTop',
  'rightBottom',
];

/** Drop-down style from a left-aligned anchor: below first, above only as a fallback (17 §3 rule 1). */
export const BELOW_LEFT: readonly Tail[] = [
  'topLeft',
  'top',
  'topRight',
  'bottomLeft',
  'bottom',
  'bottomRight',
];

/** Drop-down style from an anchor toward the right edge (17 §3 rule 1). */
export const BELOW_RIGHT: readonly Tail[] = [
  'topRight',
  'top',
  'topLeft',
  'bottomRight',
  'bottom',
  'bottomLeft',
];

const MAP: Record<Tail, Placement> = {
  top: 'bottom',
  topLeft: 'bottom-start',
  topRight: 'bottom-end',
  bottom: 'top',
  bottomLeft: 'top-start',
  bottomRight: 'top-end',
  left: 'right',
  leftTop: 'right-start',
  leftBottom: 'right-end',
  right: 'left',
  rightTop: 'left-start',
  rightBottom: 'left-end',
};

export function placementFor(tail: Tail): Placement {
  return MAP[tail];
}

export function tailFor(placement: Placement): Tail {
  const found = TAILS.find((t) => MAP[t] === placement);
  return found ?? 'top';
}

/** The first tail is tried first; the rest are Floating UI's flip fallbacks, in order. */
export function placementsFor(tails: readonly Tail[]): {
  placement: Placement;
  fallbacks: Placement[];
} {
  const [first = 'bottom', ...rest] = tails;
  return { placement: placementFor(first), fallbacks: rest.map(placementFor) };
}

/**
 * The Floating UI middleware of 17 §3 rule 2, sized in rem so it follows zoom: the tail (1.4 rem, half
 * outside) plus --space-2, kept --space-4 from the callout's corners, and --space-2 from the window's
 * edges. `size` caps the panel to the room left on the chosen side, so it is never clipped.
 */
export function calloutMiddleware(
  fallbacks: Placement[],
  rem: number,
  tip: HTMLElement,
  fit: (maxWidth: number, maxHeight: number) => void,
): Middleware[] {
  const padding = rem * 0.5;
  return [
    offset(rem * 1),
    flip({ fallbackPlacements: fallbacks, fallbackStrategy: 'bestFit' }),
    // Main axis only: a cross-axis shift slides the panel over its anchor, and makes `size` offer the
    // whole window height instead of the room on the chosen side.
    shift({ padding }),
    size({
      padding,
      apply: ({ availableWidth, availableHeight }) => {
        fit(availableWidth, availableHeight);
      },
    }),
    arrow({ element: tip, padding: rem * 0.75 }),
  ];
}
