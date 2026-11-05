// Report CSV (15 §7, 16 §2.4): the active report's normalized tables, every collapsed group and Other
// member included, after a block naming the report, its effective filters and options. Labels and headers
// are already in the UI language; amounts use the budget's decimal separator with no symbol or thousands
// separators. UTF-8 with BOM, the 16 §2.2 separator and quoting, `\n` line ends. With privacy mode on,
// every amount is masked as on screen.
import type { Money } from '../domain/types';
import { csvDocument, plainAmount, quoted } from '../export/export-format';
import type { MoneySettings } from '../money';
import { HIDDEN_AMOUNT_TEXT } from '../money-display';

/** A table cell: an amount, an unavailable future period (null), or text. */
export type ExportValue = Money | null | { text: string };

export interface ExportRow {
  label: string;
  /** 0 for a top-level row, 1 for a group's member. */
  level: number;
  values: ExportValue[];
  tone?: 'section' | 'total';
}

export interface ExportTable {
  title: string;
  /** The label column's header, then one per value. */
  head: string[];
  rows: ExportRow[];
}

export interface ExportDocument {
  /** Name/value pairs: the report, its range, filters and options. */
  meta: [string, string][];
  tables: ExportTable[];
}

/** A child row's label carries its parent's indent, so the hierarchy survives in one column. */
const INDENT = '  ';

export function reportCsv(doc: ExportDocument, money: MoneySettings, masked: boolean): string {
  const cell = (v: ExportValue): string => {
    if (v === null) return '';
    if (typeof v === 'object') return quoted(v.text);
    return masked ? quoted(HIDDEN_AMOUNT_TEXT) : plainAmount(v, money);
  };
  const lines: string[][] = doc.meta.map(([k, v]) => [quoted(k), quoted(v)]);
  for (const table of doc.tables) {
    lines.push([]);
    lines.push([quoted(table.title)]);
    lines.push(table.head.map(quoted));
    for (const row of table.rows)
      lines.push([quoted(INDENT.repeat(row.level) + row.label), ...row.values.map(cell)]);
  }
  return csvDocument(lines, money);
}
