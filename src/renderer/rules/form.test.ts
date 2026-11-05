import type { Rule } from '@shared/domain/rules';
import { describe, expect, it } from 'vitest';
import {
  emptyForm,
  formForPayee,
  formFromTransaction,
  formOf,
  hasConditionAndAction,
  invalidKeys,
  newCondition,
  newSplit,
  ruleOf,
  setField,
  valueKind,
} from './form';

const rule = (r: Partial<Rule>): Rule => ({
  id: 'r1',
  stage: null,
  conditionsOp: 'and',
  conditions: [],
  actions: [],
  schedule: null,
  ...r,
});

describe('the rule form round trip (23 §1)', () => {
  it('writes back every condition and action it can edit unchanged', () => {
    const r = rule({
      stage: 'pre',
      conditionsOp: 'or',
      conditions: [
        { field: 'imported_payee', op: 'contains', value: 'AMZN', type: 'string' },
        { field: 'payee', op: 'oneOf', value: ['p1', 'p2'], type: 'id' },
        { field: 'account', op: 'onBudget', value: null, type: 'id' },
        { field: 'date', op: 'is', value: '2026-10', type: 'date' },
        { field: 'amount', op: 'isbetween', value: { num1: -5000, num2: -1000 }, type: 'number' },
        { field: 'amount', op: 'gt', value: 2500, type: 'number', options: { outflow: true } },
        { field: 'notes', op: 'hasTags', value: '#trip', type: 'string' },
        { field: 'cleared', op: 'is', value: false, type: 'boolean' },
      ],
      actions: [
        { op: 'set', field: 'payee', value: 'p1', type: 'id' },
        { op: 'set', field: 'category', value: null, type: 'id' },
        { op: 'prepend-notes', field: 'notes', value: 'A ' },
        { op: 'delete-transaction', value: null },
      ],
    });
    const form = formOf(r);
    expect(form.conditions.every((c) => c.field !== null)).toBe(true);
    expect(form.actions.every((a) => a.kind !== null)).toBe(true);
    const { id, ...written } = ruleOf(form);
    expect(id).toBe('r1');
    expect(written).toEqual({
      stage: 'pre',
      conditionsOp: 'or',
      conditions: r.conditions,
      actions: r.actions,
    });
  });

  it("keeps what it can't edit as read-only rows, and unknown keys on edited rows (23 §1.2–1.3)", () => {
    const recur = { frequency: 'monthly', start: '2026-01-01', interval: 1 };
    const r = rule({
      conditions: [
        { field: 'payee_name', op: 'is', value: 'X' },
        { field: 'date', op: 'isapprox', value: recur },
        { field: 'notes', op: 'is', value: 'n', type: 'string', mystery: 7 },
      ],
      actions: [
        { op: 'set', field: 'notes', value: '', options: { template: '{{payee}}' } },
        { op: 'set', field: 'category', value: 'c1', options: { formula: '=1' } },
      ],
    });
    const form = formOf(r);
    expect(form.conditions.map((c) => c.field)).toEqual([null, null, 'notes']);
    expect(form.actions.map((a) => a.kind)).toEqual([null, null]);
    const written = ruleOf(form);
    expect(written.conditions).toEqual(r.conditions);
    expect(written.actions).toEqual(r.actions);
  });

  it('reads splits by index and renumbers them when one is removed (23 §1.3)', () => {
    const r = rule({
      conditions: [{ field: 'payee', op: 'is', value: 'p1', type: 'id' }],
      actions: [
        { op: 'set', field: 'notes', value: 'all', type: 'string' },
        { op: 'set-split-amount', value: 2000, options: { splitIndex: 1, method: 'fixed-amount' } },
        { op: 'set', field: 'category', value: 'c1', type: 'id', options: { splitIndex: 1 } },
        { op: 'set-split-amount', value: 50, options: { splitIndex: 2, method: 'fixed-percent' } },
        { op: 'set-split-amount', value: null, options: { splitIndex: 3, method: 'remainder' } },
        { op: 'set', field: 'category', value: 'c3', type: 'id', options: { splitIndex: 3 } },
      ],
    });
    const form = formOf(r);
    expect(form.splits.map((s) => [s.method, s.amount, s.percent, s.actions.length])).toEqual([
      ['fixed-amount', 2000, 0, 1],
      ['fixed-percent', 0, 50, 0],
      ['remainder', 0, 0, 1],
    ]);
    expect(ruleOf(form).actions).toEqual(r.actions);
    form.splits.splice(1, 1);
    expect(ruleOf(form).actions.slice(3)).toEqual([
      { op: 'set-split-amount', value: null, options: { splitIndex: 2, method: 'remainder' } },
      { op: 'set', field: 'category', value: 'c3', type: 'id', options: { splitIndex: 2 } },
    ]);
  });
});

describe('editing and checking (23 §3)', () => {
  it('keeps the operator when the new field allows it, and picks the value editor', () => {
    const c = newCondition('imported_payee', 'contains');
    setField(c, 'notes');
    expect(c.op).toBe('contains');
    setField(c, 'date');
    expect(c.op).toBe('is');
    expect(valueKind('payee', 'oneOf')).toBe('ids');
    expect(valueKind('account', 'offBudget')).toBe('none');
    expect(valueKind('amountInflow', 'is')).toBe('magnitude');
    expect(valueKind('amount', 'isbetween')).toBe('between');
  });

  it('resets the value for another field, and turns amounts into magnitudes for inflow/outflow', () => {
    const c = newCondition('payee', 'is');
    c.id = 'p1';
    setField(c, 'account');
    expect([c.op, c.id]).toEqual(['is', null]);
    c.ids = ['a1'];
    c.op = 'oneOf';
    setField(c, 'category');
    expect(c.ids).toEqual([]);

    const text = newCondition('imported_payee', 'contains');
    text.text = 'AMZN';
    setField(text, 'notes');
    expect(text.text).toBe('AMZN');

    const amount = newCondition('amount', 'isbetween');
    amount.amount = -5000;
    amount.amount2 = -1000;
    setField(amount, 'amountOutflow');
    expect([amount.amount, amount.amount2]).toEqual([5000, 1000]);
    expect(ruleOf({ ...emptyForm(), conditions: [amount] }).conditions[0]).toMatchObject({
      field: 'amount',
      value: { num1: 5000, num2: 1000 },
      options: { outflow: true },
    });
    setField(amount, 'date');
    expect([amount.amount, amount.date]).toEqual([0, '']);
  });

  it("applies Actual's limits on values", () => {
    const form = emptyForm();
    const [c] = form.conditions;
    const [a] = form.actions;
    if (!c || !a) throw new Error('rows');
    expect(invalidKeys(form)).toEqual(new Set([c.key]));
    c.op = 'matches';
    c.text = '(';
    expect(invalidKeys(form).has(c.key)).toBe(true);
    c.text = '^amzn';
    expect(invalidKeys(form).size).toBe(0);
    a.field = 'account';
    expect(invalidKeys(form)).toEqual(new Set([a.key]));
    a.id = 'acct';
    const date = newCondition('date', 'is');
    date.dateMode = 'month';
    date.date = '2026-13';
    form.conditions.push(date);
    expect(invalidKeys(form)).toEqual(new Set([date.key]));
    date.date = '2026-10';
    const split = newSplit();
    split.method = 'fixed-percent';
    split.percent = 120;
    form.splits.push(split);
    expect(invalidKeys(form)).toEqual(new Set([split.key]));
    expect(hasConditionAndAction({ ...form, conditions: [] })).toBe(false);
  });
});

describe('drafts (23 §2.1–2.2)', () => {
  it('starts a payee rule with "payee is"', () => {
    const form = formForPayee('p1');
    expect(ruleOf(form).conditions).toEqual([
      { field: 'payee', op: 'is', value: 'p1', type: 'id' },
    ]);
  });

  it('pre-fills from a transaction', () => {
    const base = {
      accountId: 'a1',
      payeeId: 'p1',
      importedPayee: 'KROGER #1',
      categoryId: 'c1',
      transferAccountId: null,
      subtransactions: [],
    };
    const r = ruleOf(formFromTransaction(base));
    expect(r.conditions).toEqual([
      { field: 'imported_payee', op: 'is', value: 'KROGER #1', type: 'string' },
      { field: 'account', op: 'is', value: 'a1', type: 'id' },
    ]);
    expect(r.actions).toEqual([
      { op: 'set', field: 'payee', value: 'p1', type: 'id' },
      { op: 'set', field: 'category', value: 'c1', type: 'id' },
    ]);
    const split = ruleOf(
      formFromTransaction({ ...base, importedPayee: null, subtransactions: [{}] }),
    );
    expect(split.conditions[0]).toMatchObject({ field: 'payee', value: 'p1' });
    expect(split.actions).toHaveLength(1);
  });
});
