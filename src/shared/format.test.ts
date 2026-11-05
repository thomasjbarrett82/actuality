import { de } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';
import type { ISODate, Month } from './domain/types';
import {
  currencyPlain,
  dateLongYear,
  dateShort,
  monthHeader,
  monthName,
  monthShortYear,
  recentDate,
} from './format';
import { DEFAULT_MONEY_SETTINGS, type MoneySettings } from './money';

const usd: MoneySettings = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'USD' };
const de2: MoneySettings = { ...usd, numberFormat: 'dot-comma' };

describe('format (07 §4.2)', () => {
  it('formats money for each use', () => {
    expect(currencyPlain(123456, usd)).toBe('1234.56');
    expect(currencyPlain(123456, de2)).toBe('1234,56');
    expect(currencyPlain(123456, de2, '.')).toBe('1234.56');
  });

  it('formats dates by the budget date format', () => {
    const d = '2026-01-31' as ISODate;
    expect(dateShort(d, 'MM/dd/yyyy')).toBe('01/31/2026');
    expect(dateShort(d, 'MM/dd/yyyy', true)).toBe('01/31/26');
    expect(dateShort(d, 'dd.MM.yyyy', true)).toBe('31.01.26');
    expect(dateLongYear(d, 'yyyy-MM-dd')).toBe('2026-01-31');
  });

  it('formats months in the UI language', () => {
    const m = '2026-01' as Month;
    expect(monthHeader(m)).toBe('January 2026');
    expect(monthHeader(m, de)).toBe('Januar 2026');
    expect(monthShortYear(m)).toBe("Jan '26");
    expect(monthShortYear(m, de)).toBe("Jan. '26");
    expect(monthName(1)).toBe('January');
    expect(monthName(12, de)).toBe('Dezember');
  });

  it('describes recent dates', () => {
    const now = new Date(2026, 9, 18, 16, 0);
    expect(recentDate(new Date(2026, 9, 18, 15, 15), now, 'MM/dd/yyyy')).toEqual({
      kind: 'today',
      time: '3:15 PM',
    });
    expect(recentDate(new Date(2026, 9, 17, 15, 15), now, 'MM/dd/yyyy')).toEqual({
      kind: 'yesterday',
      time: '3:15 PM',
    });
    expect(recentDate(new Date(2026, 9, 1, 9, 0), now, 'MM/dd/yyyy')).toEqual({
      kind: 'date',
      date: '10/01/26',
    });
    expect(recentDate(new Date(2026, 9, 18, 15, 15), now, 'MM/dd/yyyy', de)).toEqual({
      kind: 'today',
      time: '15:15',
    });
  });
});
