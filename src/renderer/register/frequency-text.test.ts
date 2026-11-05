import { describe, expect, it } from 'vitest';
import { customDescription, frequencyLabel, weekdayName } from './frequency-text';

const config = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  frequency: 'monthly',
  interval: 1,
  start: '2026-11-05',
  endMode: 'never',
  ...over,
});

describe('frequency text (12 §1)', () => {
  it('names each frequency', () => {
    expect(frequencyLabel('Once')).toBe('Once');
    expect(frequencyLabel('Monthly')).toBe('Monthly');
    expect(frequencyLabel('custom')).toBe('Custom');
  });

  it('names weekdays in the UI language', () => {
    expect(weekdayName('SU')).toBe('Sunday');
    expect(weekdayName('FR')).toBe('Friday');
  });

  it('describes the interval of each unit', () => {
    expect(customDescription(config({ frequency: 'daily' }), 'MM/dd/yyyy')).toBe('Daily');
    expect(customDescription(config({ frequency: 'weekly', interval: 3 }), 'MM/dd/yyyy')).toBe(
      'Every 3 weeks',
    );
    expect(customDescription(config(), 'MM/dd/yyyy')).toBe('Monthly');
    expect(customDescription(config({ frequency: 'yearly', interval: 2 }), 'MM/dd/yyyy')).toBe(
      'Every 2 years',
    );
  });

  it('lists the days a monthly pattern falls on', () => {
    expect(
      customDescription(
        config({
          patterns: [
            { type: 'day', value: 15 },
            { type: 'day', value: -1 },
          ],
        }),
        'MM/dd/yyyy',
      ),
    ).toBe('Monthly on day 15, the last day');
    const nth = [1, 2, 3, 4, 5, -1].map((value) => ({ type: 'FR', value }));
    expect(customDescription(config({ patterns: nth }), 'MM/dd/yyyy')).toBe(
      'Monthly on the first Friday, the second Friday, the third Friday, the fourth Friday, ' +
        'the fifth Friday, the last Friday',
    );
  });

  it('adds skipped weekends and the end', () => {
    expect(
      customDescription(
        config({ skipWeekend: true, endMode: 'after_n_occurrences', endOccurrences: 4 }),
        'MM/dd/yyyy',
      ),
    ).toBe('Monthly, skipping weekends, 4 times');
    expect(
      customDescription(
        config({ endMode: 'after_n_occurrences', endOccurrences: 1 }),
        'MM/dd/yyyy',
      ),
    ).toBe('Monthly, 1 time');
    expect(
      customDescription(config({ endMode: 'on_date', endDate: '2027-03-31' }), 'dd.MM.yyyy'),
    ).toBe('Monthly, until 31.03.2027');
  });

  it('reads a config it does not understand as Custom', () => {
    expect(customDescription(null, 'MM/dd/yyyy')).toBe('Custom');
    expect(customDescription({ frequency: 'monthly' }, 'MM/dd/yyyy')).toBe('Custom');
  });
});
