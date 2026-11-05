// Color maths for the theme-token test (05 §1.10): WCAG contrast, and color-vision separation by
// Machado 2009 (severity 1.0) simulation in linear RGB, CIE Lab, ΔE (CIE76).

function linear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
}

export function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const MACHADO: Record<'p' | 'd' | 't', number[][]> = {
  p: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  d: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  t: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function lab([r0, g0, b0]: number[]): [number, number, number] {
  const [r, g, b] = [r0, g0, b0].map((v) => Math.min(1, Math.max(0, v ?? 0))) as [
    number,
    number,
    number,
  ];
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function simulate(hex: string, kind: 'p' | 'd' | 't'): number[] {
  const c = linear(hex);
  return MACHADO[kind].map((row) => row.reduce((s, m, i) => s + m * (c[i] ?? 0), 0));
}

/** The smallest ΔE between two colors across protanopia, deuteranopia and tritanopia. */
export function cvdDistance(a: string, b: string): number {
  return Math.min(
    ...(['p', 'd', 't'] as const).map((k) => {
      const la = lab(simulate(a, k));
      const lb = lab(simulate(b, k));
      return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
    }),
  );
}
