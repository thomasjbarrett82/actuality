// Money: integer minor units, always ×100 whatever the currency (04 §1). All conversions go through here.
// Arithmetic is integer-only; parsing and rounding use BigInt, never floats.
import type { Money } from './domain/types';

/** Storage scale. A constant, not a per-budget value. */
export const MINOR_UNITS_PER_MAJOR = 100;
const STORAGE_DECIMALS = 2;

/** Actual's synced `numberFormat` values (07 §4: the complete list in Actual 26.x). */
export type NumberFormat =
  'comma-dot' | 'dot-comma' | 'space-comma' | 'apostrophe-dot' | 'comma-dot-in';

export const NUMBER_FORMATS: readonly NumberFormat[] = [
  'comma-dot',
  'dot-comma',
  'space-comma',
  'apostrophe-dot',
  'comma-dot-in',
];

/** The budget's money display settings, from Actual synced prefs (04 §3). */
export interface MoneySettings {
  numberFormat: NumberFormat;
  hideFraction: boolean;
  /** ISO 4217 code, or '' for "no currency" (no symbol, 2 decimals). */
  currencyCode: string;
  symbolPosition: 'before' | 'after';
  spaceBetweenAmountAndSymbol: boolean;
}

export const DEFAULT_MONEY_SETTINGS: MoneySettings = {
  numberFormat: 'comma-dot',
  hideFraction: false,
  currencyCode: '',
  symbolPosition: 'before',
  spaceBetweenAmountAndSymbol: false,
};

const NARROW_NBSP = ' ';

interface Separators {
  thousands: string;
  decimal: string;
  /** Indian grouping: 3 digits, then groups of 2. */
  indian: boolean;
}

export function separators(format: NumberFormat): Separators {
  switch (format) {
    case 'comma-dot':
      return { thousands: ',', decimal: '.', indian: false };
    case 'dot-comma':
      return { thousands: '.', decimal: ',', indian: false };
    case 'space-comma':
      return { thousands: NARROW_NBSP, decimal: ',', indian: false };
    case 'apostrophe-dot':
      return { thousands: "'", decimal: '.', indian: false };
    case 'comma-dot-in':
      return { thousands: ',', decimal: '.', indian: true };
  }
}

/** Display decimals of a currency: 0 for JPY/KRW, 2 for USD, 2 for "no currency" (''). */
export function decimals(currencyCode: string): number {
  if (!currencyCode) return STORAGE_DECIMALS;
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits ?? STORAGE_DECIMALS
    );
  } catch {
    return STORAGE_DECIMALS;
  }
}

/** The currency's symbol ("$", "€", "¥"), or '' for no currency. */
export function currencySymbol(currencyCode: string): string {
  if (!currencyCode) return '';
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

/** Display decimals for these settings: the currency's, or 0 with `hideFraction` (store unchanged). */
export function displayDecimals(settings: MoneySettings): number {
  return settings.hideFraction ? 0 : decimals(settings.currencyCode);
}

/** Divides by 10^places, rounding half away from zero. */
function roundDiv(value: bigint, places: number): bigint {
  if (places <= 0) return value;
  const d = 10n ** BigInt(places);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const q = (abs * 2n + d) / (2n * d);
  return neg ? -q : q;
}

function group(digits: string, sep: Separators): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const size = sep.indian ? 2 : 3;
  const groups: string[] = [];
  while (rest.length > size) {
    groups.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  if (rest) groups.unshift(rest);
  return [...groups, last3].join(sep.thousands);
}

export interface FormatOptions {
  /** Add the currency symbol. Default false. */
  symbol?: boolean;
  /** Use thousands separators. Default true. */
  thousands?: boolean;
  /** Prefix "+" on positive values ("-" is always shown on negatives). Default false. */
  plus?: boolean;
  /** Decimal separator override, for exports (`currencyPlain`). */
  decimal?: string;
}

/**
 * Formats minor units for display. Negatives use a leading "-" (07 §4.2). A sub-unit remainder in a
 * 0-decimal currency is rounded half away from zero for display only (04 §1).
 */
export function format(m: Money, settings: MoneySettings, opts: FormatOptions = {}): string {
  const sep = separators(settings.numberFormat);
  const places = displayDecimals(settings);
  let scaled = BigInt(m);
  if (places < STORAGE_DECIMALS) scaled = roundDiv(scaled, STORAGE_DECIMALS - places);
  else if (places > STORAGE_DECIMALS) scaled *= 10n ** BigInt(places - STORAGE_DECIMALS);
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
  const intPart = places > 0 ? abs.slice(0, -places) : abs;
  const fracPart = places > 0 ? abs.slice(-places) : '';
  const intText = opts.thousands === false ? intPart : group(intPart, sep);
  let num = fracPart ? `${intText}${opts.decimal ?? sep.decimal}${fracPart}` : intText;
  if (opts.symbol) {
    const sym = currencySymbol(settings.currencyCode);
    if (sym) {
      const space = settings.spaceBetweenAmountAndSymbol ? ' ' : '';
      num = settings.symbolPosition === 'after' ? `${num}${space}${sym}` : `${sym}${space}${num}`;
    }
  }
  if (neg) return `-${num}`;
  return opts.plus && scaled > 0n ? `+${num}` : num;
}

/**
 * Lenient parse of user input into minor units (04 §1). Accepts "." or "," as the decimal separator when
 * unambiguous (the budget's own decimal separator breaks ties), thousands separators (",", ".", "'",
 * spaces), a currency symbol, a leading "-" and parentheses as negative. Rounds half away from zero to
 * minor units. Returns null for anything that isn't a number.
 */
export function parse(text: string, settings: Pick<MoneySettings, 'numberFormat'>): Money | null {
  let s = text.trim();
  if (!s) return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = !neg;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  // Strip currency symbols/letters and grouping spaces/apostrophes.
  s = s.replace(/[\s\u00A0\u202F'’]/g, '').replace(/[^\d.,-]/g, '');
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]*\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;

  const decimalPos = findDecimal(s, separators(settings.numberFormat).decimal);
  const intText = decimalPos === -1 ? s : s.slice(0, decimalPos);
  // Thousands groups after the first have 3 digits (2 in Indian grouping): "1.2.3" isn't a number.
  const groups = intText.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).some((g) => g.length < 2 || g.length > 3)) return null;
  const intDigits = groups.join('');
  const fracDigits = decimalPos === -1 ? '' : s.slice(decimalPos + 1);
  if (/[.,]/.test(fracDigits)) return null;
  const all = BigInt((intDigits || '0') + fracDigits.padEnd(STORAGE_DECIMALS, '0'));
  const minor = roundDiv(all, Math.max(0, fracDigits.length - STORAGE_DECIMALS));
  const value = Number(neg ? -minor : minor);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A bank file's amount, with an unknown decimal separator (16 §1.3): the last `.` or `,` followed by 1–2
 * digits is the decimal, every other separator groups thousands. A leading or trailing `-` (QIF) or
 * parentheses make it negative. More than 2 decimals are rounded half away from zero. With
 * `lastIsDecimal` (OFX, which has no thousands separators) the last separator is always the decimal.
 */
export function parseBankAmount(text: string, lastIsDecimal = false): Money | null {
  let s = text.trim().replace(/[\s\u00A0\u202F'’]/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[^\d.,]+/, '').replace(/[^\d.,]+$/, '');
  if (!/^[\d.,]*\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const tail = last === -1 ? '' : s.slice(last + 1);
  const decimal = last !== -1 && (lastIsDecimal || /^\d{1,2}$/.test(tail)) ? last : -1;
  // A long fraction with a single separator ("12.3456") is a decimal too.
  const single =
    decimal === -1 && last !== -1 && s.indexOf(s.charAt(last)) === last && tail.length > 3
      ? last
      : decimal;
  const intDigits = (single === -1 ? s : s.slice(0, single)).replace(/[.,]/g, '');
  const fracDigits = single === -1 ? '' : s.slice(single + 1);
  if (/[.,]/.test(fracDigits)) return null;
  const all = BigInt((intDigits || '0') + fracDigits.padEnd(STORAGE_DECIMALS, '0'));
  const minor = roundDiv(all, Math.max(0, fracDigits.length - STORAGE_DECIMALS));
  const value = Number(neg ? -minor : minor);
  return Number.isSafeInteger(value) ? value : null;
}

/** Index of the decimal separator in a digits-and-separators string, or -1 if it has none. */
function findDecimal(s: string, preferred: string): number {
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) return Math.max(lastDot, lastComma);
  const pos = Math.max(lastDot, lastComma);
  if (pos === -1) return -1;
  const ch = s.charAt(pos);
  if (s.indexOf(ch) !== pos) return -1; // the same separator twice: thousands
  const after = s.length - pos - 1;
  if (after !== 3) return pos; // "1.5", "1,50", "12.3456": a decimal
  return ch === preferred ? pos : -1; // "1,234": decimal only in a format where "," is the decimal
}

/**
 * Splits `total` across lines in proportion to `weights` (04 §1, 11 §7.3): shares on absolute values,
 * truncated toward zero, with the sign of `total`; the whole remainder goes to the line with the largest
 * absolute weight (the first on ties). With all-zero weights the shares are equal and the remainder goes
 * to the first line.
 */
export function allocate(total: Money, weights: readonly Money[]): Money[] {
  if (weights.length === 0) return [];
  const sign = total < 0 ? -1n : 1n;
  const t = BigInt(Math.abs(total));
  const abs = weights.map((w) => BigInt(Math.abs(w)));
  const sum = abs.reduce((a, b) => a + b, 0n);
  let shares: bigint[];
  let target: number;
  if (sum === 0n) {
    shares = abs.map(() => t / BigInt(abs.length));
    target = 0;
  } else {
    shares = abs.map((w) => (t * w) / sum);
    target = abs.reduce((best, w, i) => (w > (abs[best] ?? 0n) ? i : best), 0);
  }
  const rest = t - shares.reduce((a, b) => a + b, 0n);
  shares[target] = (shares[target] ?? 0n) + rest;
  return shares.map((s) => Number(s * sign));
}

/** `total / by`, rounded half away from zero to minor units (04 §1): averages of amounts. */
export function divideRound(total: Money, by: number): Money {
  if (by <= 1) return total;
  const d = BigInt(by);
  const q = (BigInt(Math.abs(total)) * 2n + d) / (2n * d);
  return Number(total < 0 ? -q : q);
}

/**
 * `10000 × numerator / abs(denominator)` in basis points (hundredths of a percent), rounded half away from
 * zero with integer maths (15 §4.3, §5): report shares, coverage and percentage changes. The denominator
 * must not be zero.
 */
export function basisPoints(numerator: Money, denominator: Money): number {
  const d = BigInt(Math.abs(denominator));
  if (d === 0n) throw new RangeError('basisPoints: zero denominator');
  const n = BigInt(Math.abs(numerator)) * 10_000n;
  const q = (n * 2n + d) / (2n * d);
  return Number(numerator < 0 ? -q : q);
}

/** Sums money values. */
export function sum(values: readonly Money[]): Money {
  return values.reduce<number>((a, b) => a + b, 0);
}
