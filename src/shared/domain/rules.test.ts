import { describe, expect, it } from 'vitest';
import {
  conditionOps,
  isAssociated,
  rankRules,
  ruleScore,
  scheduleIdOf,
  stageOf,
  type RuleCondition,
} from './rules';

const cond = (op: string, field = 'payee'): RuleCondition => ({ field, op, value: 'x' });

describe('rule operators follow Actual (23 §1.2)', () => {
  it('offers each field the operators its type allows, less the ones Actual refuses', () => {
    expect(conditionOps('imported_payee')).toEqual([
      'is',
      'isNot',
      'contains',
      'doesNotContain',
      'matches',
      'oneOf',
      'notOneOf',
    ]);
    expect(conditionOps('payee')).not.toContain('onBudget');
    expect(conditionOps('account')).toEqual(expect.arrayContaining(['onBudget', 'offBudget']));
    expect(conditionOps('notes')).toEqual(expect.arrayContaining(['hasTags', 'hasAnyTag']));
    expect(conditionOps('notes')).not.toContain('oneOf');
    expect(conditionOps('date')).toEqual(['is', 'isapprox', 'gt', 'gte', 'lt', 'lte']);
    expect(conditionOps('amount')).toEqual([
      'is',
      'isapprox',
      'isbetween',
      'gt',
      'gte',
      'lt',
      'lte',
    ]);
    expect(conditionOps('cleared')).toEqual(['is']);
    expect(conditionOps('payee_name')).toEqual([]);
  });

  it('reads the default stage as null', () => {
    expect([stageOf('pre'), stageOf('post'), stageOf('default'), stageOf(null)]).toEqual([
      'pre',
      'post',
      null,
      null,
    ]);
  });
});

describe('run order (23 §1.1)', () => {
  it('scores like Actual: exact-only rules count double', () => {
    expect(ruleScore({ conditions: [cond('is')] })).toBe(20);
    expect(ruleScore({ conditions: [cond('is'), cond('contains')] })).toBe(10);
    expect(ruleScore({ conditions: [cond('oneOf'), cond('isapprox')] })).toBe(28);
    expect(ruleScore({ conditions: [cond('gt', 'amount')] })).toBe(1);
  });

  it('sorts by stage, then score, then id', () => {
    const r = (id: string, stage: 'pre' | null | 'post', ops: string[]) => ({
      id,
      stage,
      conditions: ops.map((op) => cond(op)),
    });
    const ranked = rankRules([
      r('e', 'post', ['contains']),
      r('d', null, ['is']),
      r('c', null, ['contains']),
      r('b', 'pre', ['is']),
      r('a', null, ['is']),
    ]);
    expect(ranked.map((x) => x.id)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });
});

describe('rules for a payee (23 §1.4)', () => {
  it('counts conditions and actions on the payee field that name it', () => {
    const base = { conditions: [], actions: [] };
    expect(isAssociated({ ...base, conditions: [cond('is')] }, 'x')).toBe(true);
    expect(
      isAssociated(
        { ...base, conditions: [{ field: 'payee', op: 'oneOf', value: ['y', 'x'] }] },
        'x',
      ),
    ).toBe(true);
    expect(
      isAssociated({ ...base, actions: [{ op: 'set', field: 'payee', value: 'x' }] }, 'x'),
    ).toBe(true);
    expect(isAssociated({ ...base, conditions: [cond('is', 'account')] }, 'x')).toBe(false);
  });

  it("finds a schedule's rule by its link-schedule action", () => {
    expect(scheduleIdOf({ actions: [{ op: 'link-schedule', value: 's1' }] })).toBe('s1');
    expect(scheduleIdOf({ actions: [{ op: 'set', field: 'notes', value: 's1' }] })).toBeNull();
  });
});
