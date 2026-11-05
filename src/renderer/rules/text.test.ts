import type { Rule } from '@shared/domain/rules';
import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import {
  actionLabel,
  actionText,
  conditionText,
  opLabel,
  ruleText,
  type TextContext,
} from './text';

const ctx: TextContext = {
  t: (key, params) => i18n.global.t(key, params ?? {}),
  payee: (id) => ({ p1: 'Kroger' })[id],
  account: (id) => ({ a1: 'Checking' })[id],
  category: (id) => ({ c1: 'Food: Groceries' })[id],
  group: () => undefined,
  money: (m) => (m / 100).toFixed(2),
  date: (d) => d,
};

const rule = (r: Partial<Rule>): Rule => ({
  id: 'r',
  stage: null,
  conditionsOp: 'and',
  conditions: [],
  actions: [],
  schedule: null,
  ...r,
});

describe('rule text (23 §2)', () => {
  it('reads conditions and actions as one line', () => {
    expect(
      ruleText(
        ctx,
        rule({
          conditions: [
            { field: 'imported_payee', op: 'contains', value: 'KROGER' },
            { field: 'account', op: 'is', value: 'a1' },
          ],
          actions: [
            { op: 'set', field: 'payee', value: 'p1' },
            { op: 'set', field: 'category', value: 'gone' },
          ],
        }),
      ),
    ).toBe(
      'If imported payee contains "KROGER" and account is Checking then set payee to Kroger, set category to (deleted)',
    );
  });

  it('words amounts, dates, lists and splits', () => {
    expect(
      ruleText(
        ctx,
        rule({
          conditionsOp: 'or',
          conditions: [
            { field: 'amount', op: 'isbetween', value: { num1: -5000, num2: -1000 } },
            { field: 'date', op: 'lt', value: '2026-10-01' },
            { field: 'payee', op: 'oneOf', value: ['p1', 'x'] },
            { field: 'amount', op: 'gt', value: 100, options: { outflow: true } },
          ],
          actions: [
            { op: 'append-notes', value: '!' },
            {
              op: 'set-split-amount',
              value: 2000,
              options: { splitIndex: 1, method: 'fixed-amount' },
            },
            { op: 'set', field: 'category', value: 'c1', options: { splitIndex: 1 } },
            {
              op: 'set-split-amount',
              value: null,
              options: { splitIndex: 2, method: 'remainder' },
            },
          ],
        }),
      ),
    ).toBe(
      'If amount is between -50.00 and -10.00 or date is before 2026-10-01 or payee is one of Kroger, (deleted) or amount (outflow) is greater than 1.00 then append "!" to notes, split 1: amount 20.00, set category to Food: Groceries, split 2: an even share of the remainder',
    );
  });

  it('names templates and the schedule link', () => {
    expect(
      ruleText(
        ctx,
        rule({
          conditions: [{ field: 'cleared', op: 'is', value: true }],
          actions: [
            { op: 'set', field: 'notes', value: '', options: { template: '{{x}}' } },
            { op: 'link-schedule', value: 's1' },
          ],
        }),
      ),
    ).toBe('If cleared is Yes then set notes with a template, link to the schedule');
  });

  it('words each operator, comparisons by field type', () => {
    const t = ctx.t;
    expect(
      ['onBudget', 'offBudget', 'hasTags', 'hasAnyTag', 'isapprox', 'isbetween', 'isNot'].map(
        (op) => opLabel(t, op, 'notes'),
      ),
    ).toEqual([
      'is on budget',
      'is off budget',
      'has all tags',
      'has any of tags',
      'is approximately',
      'is between',
      'is not',
    ]);
    expect(['gt', 'gte', 'lt', 'lte'].map((op) => opLabel(t, op, 'date'))).toEqual([
      'is after',
      'is on or after',
      'is before',
      'is on or before',
    ]);
    expect(['gt', 'gte', 'lt', 'lte'].map((op) => opLabel(t, op, 'amount'))).toEqual([
      'is greater than',
      'is greater than or equal to',
      'is less than',
      'is less than or equal to',
    ]);
    // An operator the app doesn't know reads as itself (data it doesn't understand is kept).
    expect(opLabel(t, 'someNewOp', 'notes')).toBe('someNewOp');
    expect(actionLabel(t, 'set', 'notes')).toBe('set notes');
    expect(actionLabel(t, 'prepend-notes')).toBe('prepend to notes');
    expect(actionLabel(t, 'append-notes')).toBe('append to notes');
    expect(actionLabel(t, 'delete-transaction')).toBe('delete transaction');
    expect(actionLabel(t, 'some-new-op')).toBe('some-new-op');
  });

  it('words conditions without a value, and values that are empty or not text', () => {
    expect(conditionText(ctx, { field: 'account', op: 'onBudget', value: null })).toBe(
      'account is on budget',
    );
    expect(conditionText(ctx, { field: 'account', op: 'is', value: '' })).toBe(
      'account is (empty)',
    );
    expect(conditionText(ctx, { field: 'account', op: 'is', value: 7 })).toBe('account is 7');
    expect(conditionText(ctx, { field: 'category_group', op: 'is', value: 'g1' })).toBe(
      'category group is (deleted)',
    );
    expect(conditionText(ctx, { field: 'notes', op: 'is', value: null })).toBe('notes is (empty)');
    expect(conditionText(ctx, { field: 'notes', op: 'is', value: { a: 1 } })).toBe(
      'notes is {"a":1}',
    );
    expect(conditionText(ctx, { field: 'date', op: 'is', value: '2026-10' })).toBe(
      'date is 2026-10',
    );
    expect(conditionText(ctx, { field: 'amount', op: 'isbetween', value: null })).toBe(
      'amount is between (empty) and (empty)',
    );
  });

  it('words each action', () => {
    const text = (a: Parameters<typeof actionText>[1]): string => actionText(ctx, a);
    expect(text({ op: 'set', field: 'amount', value: 0, options: { formula: '=1' } })).toBe(
      'set amount with a formula',
    );
    expect(text({ op: 'prepend-notes', value: 'Note: ' })).toBe('prepend "Note: " to notes');
    expect(text({ op: 'append-notes', value: 5 })).toBe('append "" to notes');
    expect(text({ op: 'delete-transaction', value: null })).toBe('delete transaction');
    expect(text({ op: 'set-split-amount', value: 25, options: { method: 'fixed-percent' } })).toBe(
      '25% of the remainder',
    );
    expect(text({ op: 'set-split-amount', value: 'x', options: { method: 'formula' } })).toBe(
      'amount from a formula',
    );
    expect(text({ op: 'some-new-op', field: 'notes', value: null })).toBe('some-new-op notes');
    expect(text({ op: 'some-new-op', value: null })).toBe('some-new-op');
  });
});
