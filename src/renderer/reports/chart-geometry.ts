// Chart geometry for the report SVGs (15 §8): value scales with round ticks and the zero-line rule, in
// pixel space. Values here are plot coordinates (plain numbers); money stays integer in the report data
// and is only formatted for labels.

/** The value domain (15 §4.5): zero at the bottom for all-nonnegative values, at the top for
 * all-nonpositive ones, and centered on a symmetric scale when signs are mixed. */
export function domainOf(values: readonly number[]): { min: number; max: number } {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo < 0 && hi > 0) {
    const m = Math.max(-lo, hi);
    return { min: -m, max: m };
  }
  if (lo === 0 && hi === 0) return { min: 0, max: 1 };
  return { min: lo, max: hi };
}

/** A round step near `span / count`: 1, 2 or 5 × a power of ten. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
  /** A value's y in pixels: `top` at max, `bottom` at min. */
  y: (v: number) => number;
}

/** A y scale over `values`, extended to round ticks, mapped onto [top, bottom] pixels. */
export function yScale(values: readonly number[], top: number, bottom: number, count = 4): Scale {
  const d = domainOf(values);
  const symmetric = d.min < 0 && d.max > 0;
  const step = niceStep(symmetric ? d.max : d.max - d.min, count);
  const max = Math.ceil(d.max / step) * step;
  const min = symmetric ? -max : Math.floor(d.min / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  const span = max - min || 1;
  return { min, max, ticks, y: (v) => bottom - ((v - min) / span) * (bottom - top) };
}

/** Evenly spaced x band centers for `n` categories in [left, right]. */
export function bands(
  n: number,
  left: number,
  right: number,
): { center: (i: number) => number; width: number } {
  const width = (right - left) / Math.max(1, n);
  return { center: (i) => left + width * (i + 0.5), width };
}

/** Points along x for `n` samples in [left, right] (a single sample sits in the middle). */
export function xPoints(n: number, left: number, right: number): (i: number) => number {
  if (n <= 1) return () => (left + right) / 2;
  return (i) => left + ((right - left) * i) / (n - 1);
}

/**
 * An SVG path through the points that have a value; a null breaks the line, so unobserved points are
 * never drawn as zero (15 §2.2).
 */
export function linePath(
  values: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = '';
  let open = false;
  values.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}

/** The area under a line down to `base`, for the observed run of points from the first value. */
export function areaPath(
  values: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
  base: number,
): string {
  const shown = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  const first = shown[0];
  const last = shown.at(-1);
  if (!first || !last) return '';
  const line = shown
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join('');
  return `${line}L${x(last.i).toFixed(1)},${base.toFixed(1)}L${x(first.i).toFixed(1)},${base.toFixed(1)}Z`;
}

/** A pie slice from angle a0 to a1 (radians, 0 at 12 o'clock, clockwise). */
export function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const at = (a: number): string =>
    `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    return `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy}L${at(a0)}A${r},${r} 0 ${large} 1 ${at(a1)}Z`;
}

/** Which tick labels to show so they don't crowd: every k-th, k chosen for at most `max` labels. */
export function labelEvery(n: number, max: number): number {
  return Math.max(1, Math.ceil(n / Math.max(1, max)));
}
