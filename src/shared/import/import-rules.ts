// Rules shared by the bank-file import's host side and its dialogs (16 §1.3–1.4): what a parsed file looks
// like, date orders for QIF/CSV, the stable import ids, "Group: Category" lookup and the account label.
import { expandYear, isISODate, toISODate, type DateOrder } from '../dates';
import type { Id, ISODate, Money } from '../domain/types';

export type BankFormat = 'ofx' | 'qif' | 'csv';

export interface ParsedSplit {
  category: string | null;
  notes: string;
  amount: Money;
}

export interface ParsedTransaction {
  /** The date as written (QIF/CSV); OFX's is already a date. */
  rawDate: string;
  /** OFX only: the date from `<DTPOSTED>`. */
  date: ISODate | null;
  amount: Money;
  payee: string;
  notes: string;
  checkNumber: string | null;
  /** OFX `<FITID>`. */
  fitId: string | null;
  /** QIF `L` / CSV Category text. */
  category: string | null;
  splits: ParsedSplit[];
}

export interface ParsedAccount {
  /** The import-mapping key (16 §1.4): `{FID}|{ACCTID}`, `qif|{number}`, or none. */
  key: string | null;
  /** OFX `<ACCTTYPE>` or the QIF section type. */
  type: string | null;
  /** OFX `<ACCTID>` or the QIF `!Account` number. */
  number: string | null;
  transactions: ParsedTransaction[];
  /** OFX: transactions left out because their date or amount couldn't be read (16 §1.6); absent for none. */
  unreadable?: number;
}

export interface ParsedFile {
  format: BankFormat;
  /** Accounts with transactions; the others are dropped (16 §1.3). */
  accounts: ParsedAccount[];
  /** How many accounts were dropped for having no transactions: "No transactions were found". */
  emptyAccounts: number;
  /** OFX: the unreadable transactions of those dropped accounts (16 §1.6); absent for none. */
  unreadable?: number;
}

export const DATE_ORDERS: readonly DateOrder[] = ['DMY', 'MDY', 'YMD'];

/** A QIF or CSV date in one order: `1/5'26`, `01/05/2026`, `2026-01-05`, `20260105`. Null if invalid. */
export function parseFileDate(raw: string, order: DateOrder): ISODate | null {
  const s = raw.trim();
  let fields: string[];
  if (/^\d{8}$/.test(s))
    fields =
      order === 'YMD'
        ? [s.slice(0, 4), s.slice(4, 6), s.slice(6)]
        : [s.slice(0, 2), s.slice(2, 4), s.slice(4)];
  else fields = s.split(/[^\d]+/).filter((f) => f !== '');
  if (fields.length !== 3 || !fields.every((f) => /^\d{1,4}$/.test(f))) return null;
  const [a = '', b = '', c = ''] = fields;
  const [ys, ms, ds] = order === 'YMD' ? [a, b, c] : order === 'DMY' ? [c, b, a] : [c, a, b];
  if (order === 'YMD' ? ys.length !== 4 : ys.length !== 2 && ys.length !== 4) return null;
  if (ms.length > 2 || ds.length > 2) return null;
  const y = ys.length === 2 ? expandYear(Number(ys)) : Number(ys);
  const date = toISODate(y, Number(ms), Number(ds));
  return isISODate(date) ? date : null;
}

/** The orders that parse every date in the file (16 §1.3), in the combo's order. */
export function validOrders(raws: readonly string[]): DateOrder[] {
  return DATE_ORDERS.filter((o) => raws.every((r) => parseFileDate(r, o) !== null));
}

/**
 * The default order: a remembered one if it still parses every date, else the budget's own if valid, else
 * the first valid one; null when none parses them all ("Could not parse the dates in this file").
 */
export function defaultOrder(
  valid: readonly DateOrder[],
  budget: DateOrder,
  remembered?: DateOrder,
): DateOrder | null {
  if (remembered && valid.includes(remembered)) return remembered;
  if (valid.includes(budget)) return budget;
  return valid[0] ?? null;
}

/** A transaction's date: OFX's own, or the raw text in the chosen order. */
export const dateOf = (t: ParsedTransaction, order: DateOrder | null): ISODate | null =>
  t.date ?? (order ? parseFileDate(t.rawDate, order) : null);

/**
 * Import ids (16 §1.3): FITID when present, else `AD:{amount}:{date}:{payee}:{n}`, where payee is the bank
 * text before any swap, trimmed and lower-cased, and n counts that amount + date + payee in the file.
 */
export function importIds(
  rows: readonly { fitId: string | null; amount: Money; date: ISODate; payee: string }[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.fitId) return r.fitId;
    const base = `AD:${String(r.amount)}:${r.date}:${r.payee.trim().toLocaleLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${String(n)}`;
  });
}

/**
 * A QIF/CSV category text (16 §1.3): "Group: Category" (extra colons become "-"), or a bare name matched by
 * name in any group. Income and hidden categories count. Null when nothing matches.
 */
export function findCategory(
  text: string,
  groups: readonly { name: string; categories: readonly { id: Id; name: string }[] }[],
): Id | null {
  const fold = (s: string): string => s.trim().toLocaleLowerCase();
  const t = text.trim();
  if (t === '') return null;
  const colon = t.indexOf(':');
  if (colon === -1) {
    for (const g of groups) {
      const c = g.categories.find((x) => fold(x.name) === fold(t));
      if (c) return c.id;
    }
    return null;
  }
  const groupName = t.slice(0, colon);
  const name = t.slice(colon + 1).replace(/:/g, '-');
  const group = groups.find((g) => fold(g.name) === fold(groupName));
  return group?.categories.find((c) => fold(c.name) === fold(name))?.id ?? null;
}

/** The last 4 characters of an account number, masked (16 §1.4). */
export const maskedNumber = (n: string): string => `********${n.slice(-4)}`;
