// A rule as one line of text (23 §2): "If {conditions} then {actions}". Names come from the budget's
// payees, accounts and categories; amounts and dates come through the caller, in the budget's formats
// and privacy mode.
import { fieldType, type Rule, type RuleAction, type RuleCondition } from '@shared/domain/rules';
import type { Id, ISODate, Money } from '@shared/domain/types';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface TextContext {
  t: Translate;
  payee: (id: Id) => string | undefined;
  account: (id: Id) => string | undefined;
  category: (id: Id) => string | undefined;
  group: (id: Id) => string | undefined;
  money: (m: Money) => string;
  date: (d: ISODate) => string;
}

/** The label of an editor field (23 §1.2), `amount` read with its options. */
export function fieldLabel(t: Translate, field: string, options?: Record<string, unknown>): string {
  switch (field) {
    case 'imported_payee':
      return t('app.rulesFieldImportedPayee');
    case 'payee':
      return t('app.rulesFieldPayee');
    case 'account':
      return t('app.rulesFieldAccount');
    case 'category':
      return t('app.rulesFieldCategory');
    case 'category_group':
      return t('app.rulesFieldCategoryGroup');
    case 'date':
      return t('app.rulesFieldDate');
    case 'notes':
      return t('app.rulesFieldNotes');
    case 'amount':
      return options?.['inflow']
        ? t('app.rulesFieldAmountInflow')
        : options?.['outflow']
          ? t('app.rulesFieldAmountOutflow')
          : t('app.rulesFieldAmount');
    case 'cleared':
      return t('app.rulesFieldCleared');
    case 'reconciled':
      return t('app.rulesFieldReconciled');
    default:
      return field;
  }
}

/** The label of an operator; dates and numbers word the comparisons differently (23 §1.2). */
export function opLabel(t: Translate, op: string, field: string): string {
  const type = fieldType(field);
  switch (op) {
    case 'is':
      return t('app.rulesOpIs');
    case 'isNot':
      return t('app.rulesOpIsNot');
    case 'contains':
      return t('app.rulesOpContains');
    case 'doesNotContain':
      return t('app.rulesOpDoesNotContain');
    case 'matches':
      return t('app.rulesOpMatches');
    case 'oneOf':
      return t('app.rulesOpOneOf');
    case 'notOneOf':
      return t('app.rulesOpNotOneOf');
    case 'onBudget':
      return t('app.rulesOpOnBudget');
    case 'offBudget':
      return t('app.rulesOpOffBudget');
    case 'hasTags':
      return t('app.rulesOpHasTags');
    case 'hasAnyTag':
      return t('app.rulesOpHasAnyTag');
    case 'isapprox':
      return t('app.rulesOpIsApprox');
    case 'isbetween':
      return t('app.rulesOpIsBetween');
    case 'gt':
      return type === 'date' ? t('app.rulesOpAfter') : t('app.rulesOpGt');
    case 'gte':
      return type === 'date' ? t('app.rulesOpOnOrAfter') : t('app.rulesOpGte');
    case 'lt':
      return type === 'date' ? t('app.rulesOpBefore') : t('app.rulesOpLt');
    case 'lte':
      return type === 'date' ? t('app.rulesOpOnOrBefore') : t('app.rulesOpLte');
    default:
      return op;
  }
}

/** The label of a `set` action or another action op (23 §1.3). */
export function actionLabel(t: Translate, op: string, field?: string): string {
  switch (op) {
    case 'set':
      return t('app.rulesActionSet', { field: fieldLabel(t, field ?? '') });
    case 'prepend-notes':
      return t('app.rulesActionPrepend');
    case 'append-notes':
      return t('app.rulesActionAppend');
    case 'delete-transaction':
      return t('app.rulesActionDelete');
    default:
      return op;
  }
}

const quote = (s: string): string => `"${s}"`;
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

function idName(ctx: TextContext, field: string | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return ctx.t('app.rulesEmpty');
  if (typeof v !== 'string') return JSON.stringify(v);
  const name =
    field === 'payee'
      ? ctx.payee(v)
      : field === 'account'
        ? ctx.account(v)
        : field === 'category'
          ? ctx.category(v)
          : field === 'category_group'
            ? ctx.group(v)
            : undefined;
  return name ?? ctx.t('app.rulesDeleted');
}

/** A value as it reads in the rule's text. */
function valueText(ctx: TextContext, field: string | undefined, v: unknown): string {
  const type = field ? fieldType(field) : undefined;
  if (Array.isArray(v)) return v.map((x) => valueText(ctx, field, x)).join(', ');
  if (type === 'id') return idName(ctx, field, v);
  if (type === 'boolean' || typeof v === 'boolean')
    return v ? ctx.t('app.rulesYes') : ctx.t('app.rulesNo');
  if (type === 'number' && typeof v === 'number') return ctx.money(v);
  if (type === 'date' && typeof v === 'string') return v.length === 10 ? ctx.date(v as ISODate) : v;
  if (typeof v === 'string') return quote(v);
  if (v === null || v === undefined) return ctx.t('app.rulesEmpty');
  return JSON.stringify(v);
}

export function conditionText(ctx: TextContext, c: RuleCondition): string {
  const field = fieldLabel(ctx.t, c.field, c.options);
  const op = opLabel(ctx.t, c.op, c.field);
  if (c.op === 'onBudget' || c.op === 'offBudget') return `${field} ${op}`;
  if (c.op === 'isbetween') {
    const b = (c.value ?? {}) as { num1?: unknown; num2?: unknown };
    return ctx.t('app.rulesTextBetween', {
      field,
      from: valueText(ctx, c.field, b.num1),
      to: valueText(ctx, c.field, b.num2),
    });
  }
  return `${field} ${op} ${valueText(ctx, c.field, c.value)}`;
}

export function actionText(ctx: TextContext, a: RuleAction): string {
  const options = (a.options ?? {}) as { template?: unknown; formula?: unknown; method?: unknown };
  const field = fieldLabel(ctx.t, a.field ?? '');
  switch (a.op) {
    case 'set':
      if (options.template) return ctx.t('app.rulesTextTemplate', { field });
      if (options.formula) return ctx.t('app.rulesTextFormula', { field });
      return ctx.t('app.rulesTextSet', { field, value: valueText(ctx, a.field, a.value) });
    case 'prepend-notes':
      return ctx.t('app.rulesTextPrepend', { value: quote(textOf(a.value)) });
    case 'append-notes':
      return ctx.t('app.rulesTextAppend', { value: quote(textOf(a.value)) });
    case 'delete-transaction':
      return ctx.t('app.rulesActionDelete');
    case 'link-schedule':
      return ctx.t('app.rulesTextLinkSchedule');
    case 'set-split-amount':
      if (options.method === 'fixed-amount' && typeof a.value === 'number')
        return ctx.t('app.rulesTextSplitFixed', { amount: ctx.money(a.value) });
      if (options.method === 'fixed-percent')
        return ctx.t('app.rulesTextSplitPercent', { percent: String(a.value) });
      if (options.method === 'remainder') return ctx.t('app.rulesTextSplitRemainder');
      return ctx.t('app.rulesTextSplitFormula');
    default:
      return a.field ? `${a.op} ${field}` : a.op;
  }
}

const splitIndexOf = (a: RuleAction): number => {
  const i = (a.options as { splitIndex?: unknown } | undefined)?.splitIndex;
  return typeof i === 'number' && i > 0 ? i : 0;
};

/** "If {conditions} then {actions}" (23 §2). */
export function ruleText(
  ctx: TextContext,
  rule: Pick<Rule, 'conditionsOp' | 'conditions' | 'actions'>,
): string {
  const join = ` ${ctx.t(rule.conditionsOp === 'or' ? 'app.rulesTextOr' : 'app.rulesTextAnd')} `;
  const conditions = rule.conditions.map((c) => conditionText(ctx, c)).join(join);
  const whole = rule.actions.filter((a) => splitIndexOf(a) === 0).map((a) => actionText(ctx, a));
  const splits = [...new Set(rule.actions.map(splitIndexOf).filter((i) => i > 0))].sort(
    (a, b) => a - b,
  );
  const parts = [
    ...whole,
    ...splits.map((i) =>
      ctx.t('app.rulesTextSplit', {
        index: i,
        actions: rule.actions
          .filter((a) => splitIndexOf(a) === i)
          .map((a) => actionText(ctx, a))
          .join(', '),
      }),
    ),
  ];
  return ctx.t('app.rulesTextRule', { conditions, actions: parts.join(', ') });
}
