// Frequency ↔ Actual's schedule `date` (12 §1). Once is a plain date; every other frequency is a
// RecurConfig with `endMode: 'never'`. Anything the table can't express reads as 'custom', and editing a
// schedule keeps fields of its config the app doesn't know about.
import { parts } from '../dates';
import type { Frequency, ISODate, RecurConfig } from '../domain/types';

/** The Frequency combo's order (12 §1). */
export const FREQUENCIES: readonly Frequency[] = [
  'Once',
  'Daily',
  'Weekly',
  'EveryOtherWeek',
  'TwiceAMonth',
  'Every4Weeks',
  'Monthly',
  'EveryOtherMonth',
  'Every3Months',
  'Every4Months',
  'TwiceAYear',
  'Yearly',
  'EveryOtherYear',
];

type Recurring = Exclude<Frequency, 'Once' | 'TwiceAMonth'>;

const RECUR: Readonly<Record<Recurring, Pick<RecurConfig, 'frequency' | 'interval'>>> = {
  Daily: { frequency: 'daily', interval: 1 },
  Weekly: { frequency: 'weekly', interval: 1 },
  EveryOtherWeek: { frequency: 'weekly', interval: 2 },
  Every4Weeks: { frequency: 'weekly', interval: 4 },
  Monthly: { frequency: 'monthly', interval: 1 },
  EveryOtherMonth: { frequency: 'monthly', interval: 2 },
  Every3Months: { frequency: 'monthly', interval: 3 },
  Every4Months: { frequency: 'monthly', interval: 4 },
  TwiceAYear: { frequency: 'monthly', interval: 6 },
  Yearly: { frequency: 'yearly', interval: 1 },
  EveryOtherYear: { frequency: 'yearly', interval: 2 },
};

/** The second day of Twice a month: 15 days on, or the month's last day (`-1`) past the 28th. */
export const secondTwiceDay = (d1: number): number => (d1 + 15 <= 28 ? d1 + 15 : -1);

/**
 * The first day (1–15) of a Twice a month schedule starting on `date`: the date's own day up to the
 * 15th, else the day 15 earlier, and the 15th for dates from the 29th on (paired with the last day).
 */
export function twiceAMonthStartDay(date: ISODate): number {
  const { d } = parts(date);
  if (d <= 15) return d;
  if (d <= 28) return d - 15;
  return 15;
}

/** The fields of an Actual config this mapping writes; the rest of an existing config is kept. */
const MANAGED = ['frequency', 'interval', 'start', 'endMode', 'patterns'] as const;

/**
 * The `date` to save for a frequency (12 §1). `previous` is the schedule's current config: fields the
 * mapping doesn't write (such as `weekendSolveMode`) are kept, except those that make it custom.
 */
export function toScheduleDate(
  frequency: Frequency,
  start: ISODate,
  previous?: unknown,
): ISODate | RecurConfig {
  if (frequency === 'Once') return start;
  const kept: Record<string, unknown> = {};
  if (isRecurConfig(previous)) {
    for (const [k, v] of Object.entries(previous))
      if (!(MANAGED as readonly string[]).includes(k)) kept[k] = v;
    // These would make the schedule custom again.
    delete kept['skipWeekend'];
    delete kept['endOccurrences'];
    delete kept['endDate'];
  }
  if (frequency === 'TwiceAMonth') {
    const d1 = twiceAMonthStartDay(start);
    return {
      ...kept,
      frequency: 'monthly',
      interval: 1,
      start,
      endMode: 'never',
      patterns: [
        { type: 'day', value: d1 },
        { type: 'day', value: secondTwiceDay(d1) },
      ],
    };
  }
  return { ...kept, ...RECUR[frequency], start, endMode: 'never' };
}

export function isRecurConfig(v: unknown): v is RecurConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { frequency?: unknown }).frequency === 'string' &&
    typeof (v as { start?: unknown }).start === 'string'
  );
}

export interface FrequencyOf {
  frequency: Frequency | 'custom';
  /** Twice a month only. */
  twiceAMonthStartDay: number | null;
}

/** Reverse mapping (12 §1): what a schedule's `date` reads as. */
export function frequencyOf(date: unknown): FrequencyOf {
  const custom: FrequencyOf = { frequency: 'custom', twiceAMonthStartDay: null };
  if (typeof date === 'string') return { frequency: 'Once', twiceAMonthStartDay: null };
  if (!isRecurConfig(date)) return custom;
  if ((date.endMode ?? 'never') !== 'never' || date.skipWeekend === true) return custom;
  const interval = date.interval ?? 1;
  const patterns = date.patterns ?? [];
  if (patterns.length > 0) {
    const [a, b] = patterns;
    if (
      patterns.length === 2 &&
      date.frequency === 'monthly' &&
      interval === 1 &&
      a?.type === 'day' &&
      b?.type === 'day' &&
      a.value >= 1 &&
      a.value <= 15 &&
      b.value === secondTwiceDay(a.value)
    )
      return { frequency: 'TwiceAMonth', twiceAMonthStartDay: a.value };
    return custom;
  }
  const found = (Object.keys(RECUR) as Recurring[]).find(
    (f) => RECUR[f].frequency === date.frequency && RECUR[f].interval === interval,
  );
  return found ? { frequency: found, twiceAMonthStartDay: null } : custom;
}

/** The recurring presets (12 §1): the Schedule dialog's Frequency select. */
export type Preset = Exclude<Frequency, 'Once'>;

/**
 * The preset a config's `frequency`, `interval` and `patterns` match, ignoring its end and weekend move
 * (12 §1), or 'custom'.
 */
export function presetOf(config: RecurConfig): Preset | 'custom' {
  const { frequency } = frequencyOf({
    frequency: config.frequency,
    interval: config.interval ?? 1,
    start: config.start,
    ...(config.patterns ? { patterns: config.patterns } : {}),
  });
  return frequency === 'Once' ? 'custom' : frequency;
}

/** A preset applied to a config: only `frequency`, `interval` and `patterns` change (12 §1). */
export function withPreset(preset: Preset, config: RecurConfig): RecurConfig {
  const base = toScheduleDate(preset, config.start) as RecurConfig;
  const next: RecurConfig = {
    ...config,
    frequency: base.frequency,
    interval: base.interval ?? 1,
  };
  if (base.patterns) next.patterns = base.patterns;
  else delete next.patterns;
  return next;
}

/** One part of a custom schedule's generated description (12 §1), turned into text by the renderer. */
export type DescriptionPart =
  | { kind: 'every'; unit: RecurConfig['frequency']; interval: number }
  | { kind: 'onDay'; day: number }
  | { kind: 'onLastDay' }
  | { kind: 'onWeekday'; weekday: Weekday; nth: number }
  | { kind: 'skipWeekend' }
  | { kind: 'times'; n: number }
  | { kind: 'until'; date: ISODate };

export type Weekday = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';
const WEEKDAYS: readonly string[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The parts of a custom schedule's description: "Every 3 weeks", "Monthly on the last Friday"… */
export function describeConfig(config: RecurConfig): DescriptionPart[] {
  const out: DescriptionPart[] = [
    { kind: 'every', unit: config.frequency, interval: config.interval ?? 1 },
  ];
  for (const p of config.patterns ?? []) {
    if (p.type === 'day')
      out.push(p.value === -1 ? { kind: 'onLastDay' } : { kind: 'onDay', day: p.value });
    else if (WEEKDAYS.includes(p.type))
      out.push({ kind: 'onWeekday', weekday: p.type as Weekday, nth: p.value });
  }
  if (config.skipWeekend === true) out.push({ kind: 'skipWeekend' });
  if (config.endMode === 'after_n_occurrences' && typeof config['endOccurrences'] === 'number')
    out.push({ kind: 'times', n: config['endOccurrences'] });
  if (config.endMode === 'on_date' && config.endDate !== undefined)
    out.push({ kind: 'until', date: config.endDate });
  return out;
}
