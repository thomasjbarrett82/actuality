import { describe, expect, it } from 'vitest';
import { attention, lineState, splitState, type StateInput } from './error-state';

const base: StateInput = {
  onBudget: true,
  transferTargetOnBudget: null,
  categoryId: 'c1',
  amount: -1000,
  needsReview: false,
  scheduleId: null,
};
const t = (patch: Partial<StateInput>): StateInput => ({ ...base, ...patch });

describe('derived transaction states (04 §7)', () => {
  it('is none for a categorized on-budget transaction', () => {
    expect(lineState(base)).toEqual({ level: 'none', message: null });
  });

  it('flags an on-budget transfer with a category as an error, above review', () => {
    const s = lineState(t({ transferTargetOnBudget: true, needsReview: true }));
    expect(s).toEqual({ level: 'error', message: { key: 'onBudgetTransferCategorized' } });
    expect(lineState(t({ transferTargetOnBudget: true, categoryId: null })).level).toBe('none');
  });

  it('needs a category for uncategorized spending, but not zero amounts or on-budget transfers', () => {
    expect(lineState(t({ categoryId: null }))).toEqual({
      level: 'needsCategory',
      message: { key: 'needsCategory' },
    });
    expect(lineState(t({ categoryId: null, amount: 0 })).level).toBe('none');
    expect(lineState(t({ categoryId: null, onBudget: false })).level).toBe('none');
  });

  it('needs a category on an on-budget → off-budget transfer', () => {
    expect(lineState(t({ categoryId: null, transferTargetOnBudget: false })).message).toEqual({
      key: 'offBudgetTransferNeedsCategory',
    });
  });

  it('marks review, replacing needsCategory, with the scheduler or import message', () => {
    expect(lineState(t({ categoryId: null, needsReview: true }))).toEqual({
      level: 'forReview',
      message: { key: 'reviewImported' },
    });
    expect(lineState(t({ needsReview: true, scheduleId: 's1' })).message).toEqual({
      key: 'reviewScheduled',
    });
  });

  it('takes a split parent from its lines, listing error lines', () => {
    const ok = lineState(base);
    const err = lineState(t({ transferTargetOnBudget: true }));
    const needs = lineState(t({ categoryId: null }));
    const parent = t({ categoryId: null });
    expect(splitState(parent, [ok, err, needs, err])).toEqual({
      level: 'error',
      message: {
        key: 'splitProblems',
        children: [{ key: 'onBudgetTransferCategorized' }, { key: 'onBudgetTransferCategorized' }],
      },
    });
    expect(splitState(parent, [ok, needs]).level).toBe('needsCategory');
    expect(splitState(parent, [ok, ok]).level).toBe('none');
    expect(splitState(t({ categoryId: null, needsReview: true }), [needs]).level).toBe('forReview');
  });

  it('counts attention once per transaction with the highest level', () => {
    expect(attention(['none', 'needsCategory', 'error', 'forReview'])).toEqual({
      count: 3,
      maxLevel: 'error',
    });
    expect(attention([])).toEqual({ count: 0, maxLevel: 'none' });
  });
});
