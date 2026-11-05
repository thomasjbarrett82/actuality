// The open budget's display formats from its synced prefs (04 §3, 07 §4.2). Every pref is a string and
// most are unset in a new budget, so each one falls back to its default.
import { DATE_FORMATS, type DateFormat } from './dates';
import { DEFAULT_MONEY_SETTINGS, NUMBER_FORMATS, type MoneySettings } from './money';

/** A weekday index as Actual stores it in `firstDayOfWeekIdx`: 0 = Sunday … 6 = Saturday (04 §3). */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BudgetFormat {
  money: MoneySettings;
  dateFormat: DateFormat;
  /** The calendar's first weekday, or null when unset: the UI locale's week start applies (07 §4). */
  firstDayOfWeek: WeekDay | null;
}

export const DEFAULT_BUDGET_FORMAT: BudgetFormat = {
  money: DEFAULT_MONEY_SETTINGS,
  dateFormat: 'MM/dd/yyyy',
  firstDayOfWeek: null,
};

/** `firstDayOfWeekIdx` as a weekday, or null when it's unset or not "0"–"6". */
export function weekDayOf(value: string | undefined): WeekDay | null {
  return value !== undefined && /^[0-6]$/.test(value) ? (Number(value) as WeekDay) : null;
}

export function budgetFormatOf(prefs: Readonly<Record<string, string | undefined>>): BudgetFormat {
  return {
    money: {
      numberFormat:
        NUMBER_FORMATS.find((f) => f === prefs['numberFormat']) ??
        DEFAULT_MONEY_SETTINGS.numberFormat,
      hideFraction: prefs['hideFraction'] === 'true',
      currencyCode: prefs['defaultCurrencyCode'] ?? '',
      symbolPosition: prefs['currencySymbolPosition'] === 'after' ? 'after' : 'before',
      spaceBetweenAmountAndSymbol: prefs['currencySpaceBetweenAmountAndSymbol'] === 'true',
    },
    dateFormat:
      DATE_FORMATS.find((f) => f === prefs['dateFormat']) ?? DEFAULT_BUDGET_FORMAT.dateFormat,
    firstDayOfWeek: weekDayOf(prefs['firstDayOfWeekIdx']),
  };
}
