import { describe, expect, it } from 'vitest';
import { budgetFormatOf, DEFAULT_BUDGET_FORMAT } from './budget-format';

describe('budget formats from synced prefs (04 §3)', () => {
  it('falls back to the defaults for unset or unknown values (S-2)', () => {
    expect(budgetFormatOf({})).toEqual(DEFAULT_BUDGET_FORMAT);
    expect(
      budgetFormatOf({ numberFormat: 'nonsense', dateFormat: 'yyyy', firstDayOfWeekIdx: '7' }),
    ).toEqual(DEFAULT_BUDGET_FORMAT);
  });

  it('reads every pref as Actual stores it: strings', () => {
    expect(
      budgetFormatOf({
        numberFormat: 'dot-comma',
        hideFraction: 'true',
        defaultCurrencyCode: 'EUR',
        currencySymbolPosition: 'after',
        currencySpaceBetweenAmountAndSymbol: 'true',
        dateFormat: 'dd.MM.yyyy',
        firstDayOfWeekIdx: '1',
      }),
    ).toEqual({
      money: {
        numberFormat: 'dot-comma',
        hideFraction: true,
        currencyCode: 'EUR',
        symbolPosition: 'after',
        spaceBetweenAmountAndSymbol: true,
      },
      dateFormat: 'dd.MM.yyyy',
      firstDayOfWeek: 1,
    });
  });
});
