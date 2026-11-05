// Frequency ↔ Actual `date` and the rule-action template (12 §1).
import { describe, expect, it } from 'vitest';
import type { Frequency, ISODate, RecurConfig } from '../domain/types';
import {
  describeConfig,
  FREQUENCIES,
  frequencyOf,
  presetOf,
  secondTwiceDay,
  toScheduleDate,
  twiceAMonthStartDay,
  withPreset,
} from './frequency';
import { isTemplateAction, readTemplate, writeTemplate, type RuleAction } from './template';

const START = '2026-11-05' as ISODate;

describe('frequency mapping (12 §1)', () => {
  it('writes the table', () => {
    const recurring = (frequency: RecurConfig['frequency'], interval: number): RecurConfig => ({
      frequency,
      interval,
      start: START,
      endMode: 'never',
    });
    const expected: Record<Frequency, ISODate | RecurConfig> = {
      Once: START,
      Daily: recurring('daily', 1),
      Weekly: recurring('weekly', 1),
      EveryOtherWeek: recurring('weekly', 2),
      TwiceAMonth: {
        ...recurring('monthly', 1),
        patterns: [
          { type: 'day', value: 5 },
          { type: 'day', value: 20 },
        ],
      },
      Every4Weeks: recurring('weekly', 4),
      Monthly: recurring('monthly', 1),
      EveryOtherMonth: recurring('monthly', 2),
      Every3Months: recurring('monthly', 3),
      Every4Months: recurring('monthly', 4),
      TwiceAYear: recurring('monthly', 6),
      Yearly: recurring('yearly', 1),
      EveryOtherYear: recurring('yearly', 2),
    };
    for (const frequency of FREQUENCIES)
      expect(toScheduleDate(frequency, START), frequency).toEqual(expected[frequency]);
  });

  it('round-trips each of the 13 frequencies (12 §6 criterion 1)', () => {
    expect(FREQUENCIES).toHaveLength(13);
    for (const f of FREQUENCIES) {
      const back = frequencyOf(JSON.parse(JSON.stringify(toScheduleDate(f, START))));
      expect(back.frequency, f).toBe(f);
    }
    expect(frequencyOf(toScheduleDate('TwiceAMonth', START)).twiceAMonthStartDay).toBe(5);
  });

  it('pairs Twice a month days, using the last day past the 28th', () => {
    expect(secondTwiceDay(1)).toBe(16);
    expect(secondTwiceDay(13)).toBe(28);
    expect(secondTwiceDay(14)).toBe(-1);
    expect(twiceAMonthStartDay('2026-11-20')).toBe(5);
    expect(twiceAMonthStartDay('2026-11-30')).toBe(15);
    expect(toScheduleDate('TwiceAMonth', '2026-11-15')).toMatchObject({
      patterns: [
        { type: 'day', value: 15 },
        { type: 'day', value: -1 },
      ],
    });
  });

  it('reads anything else as custom', () => {
    const base = { frequency: 'weekly', interval: 3, start: START, endMode: 'never' };
    expect(frequencyOf(base).frequency).toBe('custom');
    expect(frequencyOf({ ...base, interval: 1, skipWeekend: true }).frequency).toBe('custom');
    expect(frequencyOf({ ...base, interval: 1, endMode: 'after_n_occurrences' }).frequency).toBe(
      'custom',
    );
    expect(
      frequencyOf({
        ...base,
        frequency: 'monthly',
        interval: 1,
        patterns: [{ type: 'FR', value: -1 }],
      }).frequency,
    ).toBe('custom');
    expect(frequencyOf(null).frequency).toBe('custom');
  });

  it('keeps fields of the old config it does not manage, except those that make it custom', () => {
    const old = {
      frequency: 'weekly',
      interval: 3,
      start: '2026-01-01',
      endMode: 'never',
      weekendSolveMode: 'after',
      skipWeekend: true,
      patterns: [{ type: 'MO', value: 1 }],
    };
    expect(toScheduleDate('Monthly', START, old)).toEqual({
      frequency: 'monthly',
      interval: 1,
      start: START,
      endMode: 'never',
      weekendSolveMode: 'after',
    });
  });

  it('describes custom patterns', () => {
    expect(
      describeConfig({
        frequency: 'monthly',
        interval: 1,
        start: START,
        endMode: 'after_n_occurrences',
        endOccurrences: 4,
        patterns: [
          { type: 'FR', value: -1 },
          { type: 'day', value: -1 },
        ],
        skipWeekend: true,
      }),
    ).toEqual([
      { kind: 'every', unit: 'monthly', interval: 1 },
      { kind: 'onWeekday', weekday: 'FR', nth: -1 },
      { kind: 'onLastDay' },
      { kind: 'skipWeekend' },
      { kind: 'times', n: 4 },
    ]);
  });
});

describe('rule-action template (12 §1, S-7)', () => {
  const link: RuleAction = { op: 'link-schedule', value: 's1' };
  const other: RuleAction = { op: 'set', field: 'cleared', value: true };

  it('writes notes with the review tag and keeps the actions it does not write', () => {
    const actions = writeTemplate([link, other, { op: 'set', field: 'category', value: 'old' }], {
      categoryId: 'c1',
      notes: 'rent #monthly',
      lines: [],
    });
    expect(actions).toEqual([
      link,
      other,
      { op: 'set', field: 'notes', value: 'rent #monthly #needs-review', type: 'string' },
      { op: 'set', field: 'category', value: 'c1', type: 'id' },
    ]);
    expect(readTemplate(actions, -100)).toEqual({
      categoryId: 'c1',
      notes: 'rent #monthly',
      lines: [],
    });
  });

  it('writes splits as fixed lines plus a remainder, and reads them back', () => {
    const lines = [
      {
        amount: -1000,
        method: 'fixed-amount' as const,
        payeeId: null,
        categoryId: 'c1',
        notes: 'a',
      },
      {
        amount: -2000,
        method: 'fixed-amount' as const,
        payeeId: 'p-x',
        categoryId: null,
        notes: '',
      },
    ];
    const actions = writeTemplate([link], { categoryId: null, notes: '', lines });
    expect(actions.filter((a) => a.op === 'set-split-amount')).toEqual([
      { op: 'set-split-amount', value: -1000, options: { splitIndex: 1, method: 'fixed-amount' } },
      { op: 'set-split-amount', value: null, options: { splitIndex: 2, method: 'remainder' } },
    ]);
    expect(actions.every((a) => a === link || isTemplateAction(a))).toBe(true);
    const back = readTemplate(actions, -3000);
    expect(back.lines).toEqual([lines[0], { ...lines[1], method: 'remainder' }]);
    // A remainder line follows the schedule's amount.
    expect(readTemplate(actions, -3500).lines[1]?.amount).toBe(-2500);
  });
});

describe('every Frequency has a mapping', () => {
  it.each(FREQUENCIES.map((f): [Frequency] => [f]))('%s', (f) => {
    expect(() => toScheduleDate(f, START)).not.toThrow();
  });
});

describe('the Schedule dialog presets (12 §1)', () => {
  const config: RecurConfig = {
    frequency: 'weekly',
    interval: 3,
    start: START,
    endMode: 'after_n_occurrences',
    endOccurrences: 6,
    skipWeekend: true,
    weekendSolveMode: 'before',
    fromWeb: 1,
  };

  it('reads the preset ignoring the end and the weekend move', () => {
    expect(presetOf({ ...config, interval: 2 })).toBe('EveryOtherWeek');
    expect(presetOf(config)).toBe('custom');
    expect(
      presetOf({
        ...config,
        frequency: 'monthly',
        interval: 1,
        patterns: [{ type: 'FR', value: -1 }],
      }),
    ).toBe('custom');
  });

  it('changes only the frequency, interval and patterns', () => {
    const twice = withPreset('TwiceAMonth', config);
    expect(twice).toEqual({
      ...config,
      frequency: 'monthly',
      interval: 1,
      patterns: [
        { type: 'day', value: 5 },
        { type: 'day', value: 20 },
      ],
    });
    expect(presetOf(twice)).toBe('TwiceAMonth');
    expect(withPreset('Yearly', twice)).toEqual({ ...config, frequency: 'yearly', interval: 1 });
  });
});
