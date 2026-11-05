// Print views (16 §3): whole HTML documents for the preview window, styled for A4/Letter portrait
// with 15 mm margins, alternating row shading and page numbers. They always use the Light palette, or
// Light CVD when color vision is set to CVD (05 §1.9), whatever the screen shows. Every text is escaped.
import type { MoneySettings } from '@shared/money';
import { moneyText } from '../money-display';
import { tr } from '../register/dialogs';

export interface PrintPalette {
  text: string;
  strong: string;
  muted: string;
  negative: string;
  good: string;
  bad: string;
  shade: string;
  line: string;
  head: string;
  headText: string;
}

/** The Light palette's print colors, and Light CVD's (tokens.css). */
export const PRINT_PALETTES: Readonly<Record<'standard' | 'cvd', PrintPalette>> = {
  standard: {
    text: '#333333',
    strong: '#4b4c4b',
    muted: '#666666',
    negative: '#d14238',
    good: '#62a000',
    bad: '#d14238',
    shade: '#f3f4f4',
    line: '#c6c9c9',
    head: '#3a4a52',
    headText: '#ffffff',
  },
  cvd: {
    text: '#333333',
    strong: '#4b4c4b',
    muted: '#666666',
    negative: '#b84f00',
    good: '#0072b2',
    bad: '#b84f00',
    shade: '#f3f4f4',
    line: '#c6c9c9',
    head: '#3a4a52',
    headText: '#ffffff',
  },
};

/** HTML text and attribute escaping. */
export const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A CSS string literal. */
const cssString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The page footer "Page N of M" as CSS content, with the counters in place of {page} and {pages}. */
function pageFooter(): string {
  const text = tr('app.prnPage', { page: '%%PAGE%%', pages: '%%PAGES%%' });
  return text
    .split(/(%%PAGES?%%)/)
    .filter((p) => p !== '')
    .map((p) =>
      p === '%%PAGE%%' ? 'counter(page)' : p === '%%PAGES%%' ? 'counter(pages)' : cssString(p),
    )
    .join(' ');
}

/** A print document: the title, the body, and the paper styles. */
export function printDocument(title: string, body: string, palette: PrintPalette): string {
  const p = palette;
  const css = `
@page { size: auto; margin: 15mm; @bottom-center { content: ${pageFooter()}; font: 9pt sans-serif; color: ${p.muted}; } }
* { box-sizing: border-box; }
body { margin: 0; color: ${p.text}; font: 10pt 'Source Sans 3', system-ui, sans-serif; background: #ffffff; }
h1 { margin: 0 0 4mm; color: ${p.strong}; font-size: 16pt; font-weight: 400; }
h2 { margin: 6mm 0 2mm; font-size: 12pt; font-weight: 600; }
.meta { margin: 0 0 4mm; display: grid; grid-template-columns: max-content max-content; gap: 1mm 6mm; }
.meta dt { color: ${p.muted}; }
.meta dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
th { padding: 1.5mm 1.5mm; background: ${p.head}; color: ${p.headText}; text-align: left; font-weight: 600; }
td { padding: 1mm 1.5mm; border-bottom: 1px solid ${p.line}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tbody tr:nth-child(even) td { background: ${p.shade}; }
tr { break-inside: avoid; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.neg { color: ${p.negative}; }
.group td { font-weight: 600; }
.total td { font-weight: 700; border-top: 2px solid ${p.strong}; }
.line td:first-child { padding-left: 6mm; }
.indent { padding-left: 5mm !important; }
.good { color: ${p.good}; }
.bad { color: ${p.bad}; }
.chart { display: block; width: 100%; margin: 2mm 0 4mm; }
.block { break-inside: avoid; margin-bottom: 4mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

/** An amount for a printed table: masked in privacy mode, like the screen (06 §7). */
export const printAmount = (m: number, money: MoneySettings): string =>
  moneyText(m, money, { symbol: true });

/** A `<td>` with an amount, flagged negative when below zero. */
export const amountCell = (m: number, money: MoneySettings): string =>
  `<td class="num${m < 0 ? ' neg' : ''}">${esc(printAmount(m, money))}</td>`;
