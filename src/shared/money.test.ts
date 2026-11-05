import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  currencySymbol,
  decimals,
  DEFAULT_MONEY_SETTINGS,
  displayDecimals,
  format,
  MINOR_UNITS_PER_MAJOR,
  NUMBER_FORMATS,
  parse,
  parseBankAmount,
  separators,
  sum,
  type MoneySettings,
} from './money';

const usd: MoneySettings = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'USD' };
const jpy: MoneySettings = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'JPY' };
const eurDe: MoneySettings = {
  ...DEFAULT_MONEY_SETTINGS,
  currencyCode: 'EUR',
  numberFormat: 'dot-comma',
  symbolPosition: 'after',
  spaceBetweenAmountAndSymbol: true,
};

describe('money: currency data', () => {
  it('stores ×100 for every currency (S-2)', () => {
    expect(MINOR_UNITS_PER_MAJOR).toBe(100);
  });

  it('display decimals follow the currency', () => {
    expect(decimals('USD')).toBe(2);
    expect(decimals('JPY')).toBe(0);
    expect(decimals('KRW')).toBe(0);
    expect(decimals('')).toBe(2);
    expect(decimals('NOT-A-CODE')).toBe(2);
    expect(displayDecimals({ ...usd, hideFraction: true })).toBe(0);
  });

  it('finds currency symbols', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('')).toBe('');
    expect(currencySymbol('NOPE')).toBe('NOPE');
  });

  it('knows every Actual number format', () => {
    expect(NUMBER_FORMATS.map((f) => separators(f).decimal)).toEqual(['.', ',', ',', '.', '.']);
    expect(separators('space-comma').thousands).toBe(' ');
  });
});

describe('money: format', () => {
  it('formats with and without the symbol', () => {
    expect(format(123456, usd, { symbol: true })).toBe('$1,234.56');
    expect(format(-123456, usd, { symbol: true })).toBe('-$1,234.56');
    expect(format(123456, usd)).toBe('1,234.56');
    expect(format(123456, usd, { thousands: false })).toBe('1234.56');
    expect(format(5, usd)).toBe('0.05');
    expect(format(0, usd)).toBe('0.00');
    expect(format(-0, usd)).toBe('0.00');
  });

  it('formats the other number formats', () => {
    expect(format(123456789, eurDe, { symbol: true })).toBe('1.234.567,89 €');
    expect(format(123456789, { ...usd, numberFormat: 'space-comma' })).toBe('1 234 567,89');
    expect(format(123456789, { ...usd, numberFormat: 'apostrophe-dot' })).toBe("1'234'567.89");
    expect(format(12345678, { ...usd, numberFormat: 'comma-dot-in' })).toBe('1,23,456.78');
    expect(format(100, { ...usd, numberFormat: 'comma-dot-in' })).toBe('1.00');
  });

  it('shows 0-decimal currencies from a ×100 value, rounding half away from zero for display only (04 §1)', () => {
    expect(format(10000000, jpy, { symbol: true })).toBe('¥100,000');
    expect(format(10000050, jpy, { symbol: true })).toBe('¥100,001');
    expect(format(-10000050, jpy, { symbol: true })).toBe('-¥100,001');
    expect(format(10000049, jpy)).toBe('100,000');
  });

  it('hides the fraction with hideFraction', () => {
    expect(format(123456, { ...usd, hideFraction: true })).toBe('1,235');
  });

  it('pads 3-decimal currencies', () => {
    expect(format(1234, { ...usd, currencyCode: 'KWD' })).toBe('12.340');
  });

  it('uses no symbol for "no currency"', () => {
    expect(format(123, DEFAULT_MONEY_SETTINGS, { symbol: true })).toBe('1.23');
  });

  it('prefixes + only when asked', () => {
    expect(format(1200, usd, { plus: true })).toBe('+12.00');
    expect(format(0, usd, { plus: true })).toBe('0.00');
    expect(format(-1200, usd, { plus: true })).toBe('-12.00');
  });

  it('handles 1e15 minor units exactly', () => {
    expect(format(1e15, usd)).toBe('10,000,000,000,000.00');
  });
});

describe('money: parse', () => {
  const p = (s: string, f: MoneySettings = usd): number | null => parse(s, f);

  it('parses plain amounts', () => {
    expect(p('12.34')).toBe(1234);
    expect(p('12')).toBe(1200);
    expect(p('.5')).toBe(50);
    expect(p('0')).toBe(0);
    expect(p('+7')).toBe(700);
  });

  it('parses thousands separators and symbols', () => {
    expect(p('$1,234.56')).toBe(123456);
    expect(p('1,234,567')).toBe(123456700);
    expect(p('1.234,56', eurDe)).toBe(123456);
    expect(p("1'234.50")).toBe(123450);
    expect(p('1 234,50', eurDe)).toBe(123450);
    expect(p('€ 12,50', eurDe)).toBe(1250);
  });

  it('uses the budget decimal separator to break ties', () => {
    expect(p('1,234')).toBe(123400);
    expect(p('1,234', eurDe)).toBe(123);
    expect(p('1.234', eurDe)).toBe(123400);
    expect(p('1,5')).toBe(150);
  });

  it('parses negatives: leading -, parentheses, trailing -', () => {
    expect(p('-12.34')).toBe(-1234);
    expect(p('(12.34)')).toBe(-1234);
    expect(p('12.34-')).toBe(-1234);
    expect(p('−12')).toBe(-1200);
  });

  it('rounds half away from zero to minor units', () => {
    expect(p('0.005')).toBe(1);
    expect(p('-0.005')).toBe(-1);
    expect(p('0.0049')).toBe(0);
    expect(p('12,345.678')).toBe(1234568);
  });

  it('avoids floating-point error (0.1 + 0.2)', () => {
    const a = p('0.1') ?? 0;
    const b = p('0.2') ?? 0;
    expect(sum([a, b])).toBe(p('0.3'));
  });

  it('rejects text that is not a number', () => {
    expect(p('')).toBeNull();
    expect(p('abc')).toBeNull();
    expect(p('1.2.3,4')).toBeNull();
    expect(p('-')).toBeNull();
    expect(p('1'.repeat(30))).toBeNull();
  });

  it('round-trips format → parse for every number format', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e13, max: 1e13 }),
        fc.constantFrom(...NUMBER_FORMATS),
        (m, nf) => {
          const s: MoneySettings = { ...usd, numberFormat: nf };
          expect(parse(format(m, s, { symbol: true }), s)).toBe(m);
        },
      ),
    );
  });
});

describe('money: parseBankAmount (16 §1.3)', () => {
  it('guesses the decimal separator', () => {
    expect(parseBankAmount('1,234.50')).toBe(123_450);
    expect(parseBankAmount('1.234,5')).toBe(123_450);
    expect(parseBankAmount('-12,345')).toBe(-1_234_500);
    expect(parseBankAmount('(4.00)')).toBe(-400);
    expect(parseBankAmount('12.3456')).toBe(1_235);
  });
  it('reads OFX amounts with the last separator as the decimal', () => {
    expect(parseBankAmount('-12.345', true)).toBe(-1_235);
    expect(parseBankAmount('1,234', true)).toBe(123);
    expect(parseBankAmount('-12,30', true)).toBe(-1_230);
    expect(parseBankAmount('250', true)).toBe(25_000);
  });
});

describe('money: allocate (04 §1, 11 §7.3)', () => {
  it('distributes proportionally and gives the remainder to the largest line', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [300, 700])).toEqual([300, 700]);
    expect(allocate(-100, [1, 2])).toEqual([-33, -67]);
    expect(allocate(10, [-3, -7])).toEqual([3, 7]);
  });

  it('splits equally when every weight is zero, remainder to the first line', () => {
    expect(allocate(100, [0, 0, 0])).toEqual([34, 33, 33]);
  });

  it('returns nothing for no lines', () => {
    expect(allocate(100, [])).toEqual([]);
  });

  it('always sums to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: -1e7, max: 1e7 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const shares = allocate(total, weights);
          expect(sum(shares)).toBe(total);
          expect(shares.every((s) => Number.isInteger(s))).toBe(true);
        },
      ),
    );
  });
});
