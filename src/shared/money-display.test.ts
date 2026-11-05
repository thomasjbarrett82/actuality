import { describe, expect, it } from 'vitest';
import { DEFAULT_MONEY_SETTINGS } from './money';
import { formatMoneyDisplay, HIDDEN_AMOUNT_TEXT } from './money-display';

const usd = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'USD' };

describe('formatMoneyDisplay (06 §7)', () => {
  it('formats the value while privacy mode is off', () => {
    expect(formatMoneyDisplay(-123456, usd, { hidden: false })).toBe('-1,234.56');
    expect(formatMoneyDisplay(-123456, usd, { hidden: false, symbol: true })).toBe('-$1,234.56');
    expect(formatMoneyDisplay(500, usd, { hidden: false, plus: true })).toBe('+5.00');
  });

  it('masks every value with the same text, whatever its size or sign', () => {
    for (const m of [0, 1, -50, 123456789]) {
      const text = formatMoneyDisplay(m, usd, { hidden: true, symbol: true });
      expect(text).toBe(HIDDEN_AMOUNT_TEXT);
      expect(text).not.toMatch(/\d/);
    }
  });

  it('leaves a blank zero blank in both modes', () => {
    expect(formatMoneyDisplay(0, usd, { hidden: false, blankZero: true })).toBe('');
    expect(formatMoneyDisplay(0, usd, { hidden: true, blankZero: true })).toBe('');
    expect(formatMoneyDisplay(1, usd, { hidden: true, blankZero: true })).toBe(HIDDEN_AMOUNT_TEXT);
  });
});
