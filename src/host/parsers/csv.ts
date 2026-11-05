// CSV (16 §1.3): RFC 4180 quoting, a required header row, and columns matched by exact, case-sensitive
// name: Date, Payee, Category, Notes, Outflow, Inflow, and optionally a signed Amount (used instead of
// Outflow/Inflow) and Check. Rows without a date or an amount are skipped. Anything else is a format error:
// the import then offers the sample file (16 §1.3).
import type { ParsedFile, ParsedTransaction } from '@shared/import/import-rules';
import { parseBankAmount } from '@shared/money';
import { decodeText } from './qif';

export class CsvFormatError extends Error {}

/** RFC 4180 records. `sep` is the field separator. Throws on an unterminated quote. */
export function csvRecords(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
    } else field += c;
    i++;
  }
  if (quoted) throw new CsvFormatError('A quoted field is not closed.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
}

/** The separator: whichever of `,` `;` and tab splits the header into a Date column. */
function separatorOf(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  for (const sep of [',', ';', '\t']) {
    const fields = header.split(sep).map((f) => f.trim().replace(/^"|"$/g, ''));
    if (fields.includes('Date')) return sep;
  }
  return ',';
}

export function parseCsv(bytes: Uint8Array): ParsedFile {
  const text = decodeText(bytes);
  const records = csvRecords(text, separatorOf(text));
  const [header, ...rows] = records;
  if (!header) throw new CsvFormatError('The file is empty.');
  const col = (name: string): number => header.findIndex((h) => h.trim() === name);
  const at = {
    date: col('Date'),
    payee: col('Payee'),
    category: col('Category'),
    notes: col('Notes'),
    outflow: col('Outflow'),
    inflow: col('Inflow'),
    amount: col('Amount'),
    check: col('Check'),
  };
  if (at.date === -1) throw new CsvFormatError('There is no Date column.');
  if (at.amount === -1 && at.outflow === -1 && at.inflow === -1)
    throw new CsvFormatError('There is no Amount, Outflow or Inflow column.');
  const cell = (r: string[], i: number): string => (i === -1 ? '' : (r[i] ?? '').trim());
  const transactions: ParsedTransaction[] = [];
  for (const r of rows) {
    const rawDate = cell(r, at.date);
    let amount: number | null;
    if (at.amount !== -1) amount = parseBankAmount(cell(r, at.amount));
    else {
      const out = cell(r, at.outflow);
      const inn = cell(r, at.inflow);
      const o = out === '' ? 0 : parseBankAmount(out);
      const n = inn === '' ? 0 : parseBankAmount(inn);
      amount = out === '' && inn === '' ? null : o === null || n === null ? null : n - Math.abs(o);
    }
    if (rawDate === '' || amount === null) continue;
    transactions.push({
      rawDate,
      date: null,
      amount,
      payee: cell(r, at.payee),
      notes: cell(r, at.notes),
      checkNumber: cell(r, at.check) || null,
      fitId: null,
      category: cell(r, at.category) || null,
      splits: [],
    });
  }
  return {
    format: 'csv',
    accounts:
      transactions.length > 0 ? [{ key: null, type: null, number: null, transactions }] : [],
    emptyAccounts: transactions.length > 0 ? 0 : 1,
  };
}
