// Budget Setup defaults from the OS locale (07 §4), when no format was picked before (19 §1 lastPicked*),
// and the examples that label Actual's number and date formats.
import type { DateFormat } from './dates';
import type { NumberFormat } from './money';

/** A currency per region, for the regions the setup screen is most likely to meet; others get none. */
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',
  BR: 'BRL',
  AR: 'ARS',
  GB: 'GBP',
  IE: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  HR: 'EUR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  TR: 'TRY',
  RU: 'RUB',
  UA: 'UAH',
  IL: 'ILS',
  ZA: 'ZAR',
  IN: 'INR',
  JP: 'JPY',
  KR: 'KRW',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  SG: 'SGD',
  AU: 'AUD',
  NZ: 'NZD',
};

/** The locale's region, filled in from the language when missing ('de' → 'DE'). */
function region(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
}

/** The OS locale's currency, or '' (no currency) when the region isn't known. */
export function defaultCurrency(locale: string): string {
  const r = region(locale);
  return (r && REGION_CURRENCY[r]) ?? '';
}

/** The Actual number format closest to the locale's separators (04 §3). */
export function defaultNumberFormat(locale: string): NumberFormat {
  if (region(locale) === 'IN') return 'comma-dot-in';
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  } catch {
    return 'comma-dot';
  }
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  if (decimal === ',') return /\s/.test(group) ? 'space-comma' : 'dot-comma';
  if (group === "'" || group === '’') return 'apostrophe-dot';
  return 'comma-dot';
}

/** The Actual date format closest to the locale's short dates (07 §4). */
export function defaultDateFormat(locale: string): DateFormat {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2026, 11, 31));
  } catch {
    return 'MM/dd/yyyy';
  }
  const order = parts
    .filter((p) => p.type === 'year' || p.type === 'month' || p.type === 'day')
    .map((p) => p.type[0])
    .join('');
  const dot = parts.some((p) => p.type === 'literal' && p.value.includes('.'));
  if (order === 'ymd') return 'yyyy-MM-dd';
  if (order === 'dmy') return dot ? 'dd.MM.yyyy' : 'dd/MM/yyyy';
  return dot ? 'MM.dd.yyyy' : 'MM/dd/yyyy';
}

/** The example that labels each number format in Budget Setup (07 §4). U+202F in `space-comma`. */
export const NUMBER_FORMAT_EXAMPLES: Record<NumberFormat, string> = {
  'comma-dot': '1,234.56',
  'dot-comma': '1.234,56',
  'space-comma': '1 234,56',
  'apostrophe-dot': "1'234.56",
  'comma-dot-in': '1,23,456.78',
};

/** "12/31/2026" and "MM/DD/YYYY" for a date format, to label it in Budget Setup (07 §4). */
export function dateFormatExample(format: DateFormat): { example: string; pattern: string } {
  const example = format.replace('yyyy', '2026').replace('MM', '12').replace('dd', '31');
  return { example, pattern: format.toUpperCase() };
}
