import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  autoCategoryOf,
  escapeRegex,
  fromActualCondition,
  renameRuleOf,
  toActualCondition,
  type RuleShape,
} from './payee-rules';
import type { RenameCondition } from './types';

const rule = (patch: Partial<RuleShape>): RuleShape => ({
  id: 'r1',
  stage: 'pre',
  conditionsOp: 'or',
  conditions: [],
  actions: [{ field: 'payee', op: 'set', value: 'p1' }],
  ...patch,
});

describe('payee rules (14 §1)', () => {
  it('maps the four conditions to Actual and back', () => {
    const conditions: RenameCondition[] = [
      { op: 'contains', value: 'AMZN' },
      { op: 'is', value: 'Kroger #123' },
      { op: 'startsWith', value: 'SQ *' },
      { op: 'endsWith', value: '(US)' },
    ];
    expect(conditions.map(toActualCondition).map((c) => c.value)).toEqual([
      'AMZN',
      'Kroger #123',
      '^SQ \\*',
      '\\(US\\)$',
    ]);
    for (const c of conditions) expect(fromActualCondition(toActualCondition(c))).toEqual(c);
  });

  it('round-trips any Starts with / Ends with text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom<'startsWith' | 'endsWith'>('startsWith', 'endsWith'),
        (value, op) => {
          expect(fromActualCondition(toActualCondition({ op, value }))).toEqual({ op, value });
        },
      ),
    );
  });

  it('never escapes into class escapes', () => {
    expect(escapeRegex('a.b*c\\d')).toBe('a\\.b\\*c\\\\d');
    expect(escapeRegex('S D W')).toBe('S D W');
  });

  it('leaves other patterns as Other rules', () => {
    expect(
      fromActualCondition({ field: 'imported_payee', op: 'matches', value: '^a.*b$' }),
    ).toBeNull();
    expect(
      fromActualCondition({ field: 'imported_payee', op: 'matches', value: '^\\d+' }),
    ).toBeNull();
    expect(fromActualCondition({ field: 'payee', op: 'is', value: 'x' })).toBeNull();
    expect(fromActualCondition({ field: 'imported_payee', op: 'oneOf', value: 'x' })).toBeNull();
  });

  it('recognizes the app’s rename and auto-category rules', () => {
    expect(
      renameRuleOf(
        rule({ conditions: [{ field: 'imported_payee', op: 'contains', value: 'AMZN' }] }),
      ),
    ).toEqual({ payeeId: 'p1', conditions: [{ op: 'contains', value: 'AMZN' }] });
    expect(
      renameRuleOf(
        rule({
          conditionsOp: 'and',
          conditions: [
            { field: 'imported_payee', op: 'is', value: 'a' },
            { field: 'imported_payee', op: 'is', value: 'b' },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      autoCategoryOf(
        rule({
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'payee', op: 'is', value: 'p1' }],
          actions: [{ field: 'category', op: 'set', value: 'c1' }],
        }),
      ),
    ).toEqual({ payeeId: 'p1', categoryId: 'c1' });
    expect(autoCategoryOf(rule({ stage: null }))).toBeNull();
    expect(
      autoCategoryOf(
        rule({
          stage: 'pre',
          conditions: [{ field: 'payee', op: 'is', value: 'p1' }],
          actions: [{ field: 'category', op: 'set', value: 'c1' }],
        }),
      ),
    ).toBeNull();
  });
});
