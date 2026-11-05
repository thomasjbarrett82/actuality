// The theme-token test (21 §1, 05 §1.10). It reads the spec (05, theme-palettes.md) for what must
// exist and which pairs to check, and computes every check from tokens.css itself, with no allowed failures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, cvdDistance } from './color';

const root = join(import.meta.dirname, '../..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
// Attribute selectors read as double-quoted whichever quotes the file uses (Prettier writes single ones).
const css = read('src/renderer/styles/tokens.css').replace(/\[([a-z-]+)='([^']*)'\]/g, '[$1="$2"]');
const ch05 = read('docs/app-spec/05-visual-design-system.md');
const palettesDoc = read('docs/app-spec/theme-palettes.md');

type Palette = 'light' | 'dark' | 'lightCvd' | 'darkCvd';
const PALETTES: Palette[] = ['light', 'dark', 'lightCvd', 'darkCvd'];

/** Declarations of every top-level rule with exactly this selector, merged in order. */
function block(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = `\n${selector} {`;
  for (let start = css.indexOf(head); start !== -1; start = css.indexOf(head, start + 1)) {
    const body = css.slice(start, css.indexOf('\n}', start));
    for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
      out.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return out;
}

const light = block(':root');
const dark = new Map([...light, ...block(':root[data-theme="dark"]')]);
const effective: Record<Palette, Map<string, string>> = {
  light,
  dark,
  lightCvd: new Map([...light, ...block(':root[data-cvd="on"]')]),
  darkCvd: new Map([...dark, ...block(':root[data-theme="dark"][data-cvd="on"]')]),
};
/** A token's value in a palette, following `var(--x)` aliases (05 §1.11). */
const value = (p: Palette, token: string): string => {
  const v = effective[p].get(token);
  if (!v) throw new Error(`${token} is not defined for ${p}`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  return alias ? value(p, alias[1] ?? '') : v;
};

/** Color rows of 05 §1.1–1.8: token → the four palette values ("=" resolved). */
function specColors(): Map<string, Record<Palette, string>> {
  const out = new Map<string, Record<Palette, string>>();
  const section = ch05.slice(ch05.indexOf('## 1. Color tokens'), ch05.indexOf('### 1.9 Themes'));
  for (const m of section.matchAll(
    /^\| `(--[a-z0-9-]+)` \| `(#\w+)` \| `(#\w+)` \| (=|`#\w+`) \| (=|`#\w+`) \|/gm,
  )) {
    const [, token = '', l = '', d = '', lc = '', dc = ''] = m;
    out.set(token, {
      light: l,
      dark: d,
      lightCvd: lc === '=' ? l : lc.replaceAll('`', ''),
      darkCvd: dc === '=' ? d : dc.replaceAll('`', ''),
    });
  }
  return out;
}

describe('tokens.css (05 §1–3)', () => {
  const colors = specColors();

  it('defines every color token of 05 with its value, in all four palettes', () => {
    expect(colors.size).toBeGreaterThan(100);
    for (const [token, values] of colors) {
      for (const p of PALETTES)
        expect(value(p, token).toUpperCase(), `${token} (${p})`).toBe(values[p].toUpperCase());
    }
  });

  it('defines every size token of 05 §2–3', () => {
    const sizes = [
      ...ch05.matchAll(
        /^\| `(--(?:font|space|row-h|control-h|bar-h|badge-h)[a-z0-9-]*)` \| ([\d.]+) \|/gm,
      ),
    ];
    expect(sizes.length).toBeGreaterThan(20);
    for (const [, token = '', rem = ''] of sizes) expect(light.get(token), token).toBe(`${rem}rem`);
    for (const token of [
      '--sidebar-w',
      '--popover-w',
      '--dialog-w',
      '--radius',
      '--radius-pill',
      '--icon',
      '--hit-min',
    ]) {
      expect(light.has(token), token).toBe(true);
    }
    expect(css).toMatch(/font-size:\s*81\.25%/);
  });

  describe('contrast (05 §1.10)', () => {
    const rows = [
      ...palettesDoc.matchAll(
        /^\| `(--[a-z0-9-]+)`(?: as the focus ring)? on `(--[a-z0-9-]+)` \| ([\d.]+):1 \|/gm,
      ),
    ];
    it('checks the pairs listed in theme-palettes.md §1', () => {
      expect(rows.length).toBeGreaterThan(40);
    });
    for (const [, fg = '', bg = '', target = ''] of rows) {
      it(`${fg} on ${bg} ≥ ${target}:1 in every palette`, () => {
        for (const p of PALETTES) {
          expect(contrast(value(p, fg), value(p, bg)), p).toBeGreaterThanOrEqual(Number(target));
        }
      });
    }
  });

  describe('report and chart tokens (05 §1.11)', () => {
    const section = ch05.slice(
      ch05.indexOf('### 1.11 Reports and chart tokens'),
      ch05.indexOf('## 2. Typography'),
    );
    const rows = [
      ...section.matchAll(
        /^\| `(--report-[a-z0-9-]+)` \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \|/gm,
      ),
    ];

    it('defines every report token with its value, in all four palettes', () => {
      expect(rows.length).toBe(14);
      for (const [, token = '', l = '', d = '', lc = '', dc = ''] of rows) {
        const want: Record<Palette, string> = { light: l, dark: d, lightCvd: lc, darkCvd: dc };
        for (const p of PALETTES)
          expect(value(p, token).toUpperCase(), `${token} (${p})`).toBe(want[p].toUpperCase());
      }
    });

    it('draws meaningful chart marks at 3:1 or more on the panel', () => {
      const marks = rows
        .map(([, token = '']) => token)
        .filter((t) => t !== '--report-grid' && t !== '--report-tooltip-bg');
      for (const token of marks)
        for (const p of PALETTES)
          expect(
            contrast(value(p, token), value(p, '--panel-bg')),
            `${token} (${p})`,
          ).toBeGreaterThanOrEqual(3);
      for (const p of PALETTES)
        expect(
          contrast(value(p, '--text'), value(p, '--report-tooltip-bg')),
        ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('color-vision separation in the CVD palettes (05 §1.10)', () => {
    const semantic: [string, string][] = [
      ['--money-positive', '--money-negative-strong'],
      ['--atb-positive', '--atb-negative'],
      ['--status-online', '--status-error'],
      ['--status-online', '--status-unsynced'],
      ['--status-unsynced', '--status-error'],
      ['--cleared-on', '--cleared-off'],
      ['--error-badge', '--needscat-badge'],
      ['--error-badge', '--review-badge'],
      ['--needscat-badge', '--review-badge'],
      ['--error-row-border', '--needscat-row-border'],
      ['--button-save-bg', '--button-cancel-bg'],
    ];
    for (const [a, b] of semantic) {
      it(`${a} vs ${b} ≥ 15`, () => {
        for (const p of ['lightCvd', 'darkCvd'] as const) {
          expect(cvdDistance(value(p, a), value(p, b)), p).toBeGreaterThanOrEqual(15);
        }
      });
    }
  });
});
