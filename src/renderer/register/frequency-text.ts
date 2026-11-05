// Frequency names (12 §1, in the combo's order) and the generated description of a custom repeat pattern
// ("Every 3 weeks", "Monthly on the last Friday").
import type { Frequency } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { describeConfig, isRecurConfig, type Weekday } from '@shared/schedule/frequency';
import { format } from 'date-fns';
import { dateLocale } from '../i18n';
import { tr, trn } from './dialogs';

export function frequencyLabel(f: Frequency | 'custom'): string {
  switch (f) {
    case 'Once':
      return tr('app.freqOnce');
    case 'Daily':
      return tr('app.freqDaily');
    case 'Weekly':
      return tr('app.freqWeekly');
    case 'EveryOtherWeek':
      return tr('app.freqEveryOtherWeek');
    case 'TwiceAMonth':
      return tr('app.freqTwiceAMonth');
    case 'Every4Weeks':
      return tr('app.freqEvery4Weeks');
    case 'Monthly':
      return tr('app.freqMonthly');
    case 'EveryOtherMonth':
      return tr('app.freqEveryOtherMonth');
    case 'Every3Months':
      return tr('app.freqEvery3Months');
    case 'Every4Months':
      return tr('app.freqEvery4Months');
    case 'TwiceAYear':
      return tr('app.freqTwiceAYear');
    case 'Yearly':
      return tr('app.freqYearly');
    case 'EveryOtherYear':
      return tr('app.freqEveryOtherYear');
    case 'custom':
      return tr('app.freqCustom');
  }
}

const WEEKDAY_INDEX: Readonly<Record<Weekday, number>> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** A weekday's name in the UI language. */
export function weekdayName(w: Weekday): string {
  // 2026-01-04 is a Sunday.
  return format(new Date(2026, 0, 4 + WEEKDAY_INDEX[w]), 'EEEE', { locale: dateLocale.value });
}

function nthWord(n: number): string {
  if (n === -1) return tr('app.freqNthLast');
  if (n === 1) return tr('app.freqNth1');
  if (n === 2) return tr('app.freqNth2');
  if (n === 3) return tr('app.freqNth3');
  if (n === 4) return tr('app.freqNth4');
  return tr('app.freqNth5');
}

/** A custom schedule's generated description (12 §1), or "Custom" for a config it can't read. */
export function customDescription(config: unknown, dateFormat: string): string {
  if (!isRecurConfig(config)) return tr('app.freqCustom');
  const parts = describeConfig(config);
  let base = '';
  const days: string[] = [];
  const rest: string[] = [];
  for (const p of parts) {
    switch (p.kind) {
      case 'every': {
        const key = {
          daily: 'app.freqDescDaily',
          weekly: 'app.freqDescWeekly',
          monthly: 'app.freqDescMonthly',
          yearly: 'app.freqDescYearly',
        }[p.unit];
        base = trn(key, p.interval);
        break;
      }
      case 'onDay':
        days.push(tr('app.freqDescDay', { day: p.day }));
        break;
      case 'onLastDay':
        days.push(tr('app.freqDescLastDay'));
        break;
      case 'onWeekday':
        days.push(
          tr('app.freqDescWeekday', { nth: nthWord(p.nth), weekday: weekdayName(p.weekday) }),
        );
        break;
      case 'skipWeekend':
        rest.push(tr('app.freqDescSkipWeekend'));
        break;
      case 'times':
        rest.push(trn('app.freqDescTimes', p.n));
        break;
      case 'until':
        rest.push(tr('app.freqDescUntil', { date: dateShort(p.date, dateFormat) }));
        break;
    }
  }
  const head = days.length > 0 ? tr('app.freqDescOn', { base, days: days.join(', ') }) : base;
  return [head, ...rest].join(', ');
}
