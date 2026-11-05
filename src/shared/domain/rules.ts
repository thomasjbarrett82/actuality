// Actual's rules (23 §1): the fields and operators its rule engine accepts, the run order it ranks rules
// in, and which rules are associated with a payee. The tables follow Actual's `TYPE_INFO` / `FIELD_INFO`
// (26.10.0), so the editor offers exactly what Actual will validate.
import type { Id, ISODate, Money } from './types';

export type RuleStage = 'pre' | null | 'post';

/** A condition, kept whole: keys the app doesn't know survive an update. */
export interface RuleCondition {
  field: string;
  op: string;
  value: unknown;
  type?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

/** An action, kept whole like conditions. */
export interface RuleAction {
  op: string;
  field?: string;
  value: unknown;
  type?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Rule {
  id: Id;
  stage: RuleStage;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Set for a schedule's rule (23 §1). */
  schedule: { id: Id; name: string | null } | null;
}

/** A transaction a rule's conditions match (23 §3.4). */
export interface RuleMatch {
  id: Id;
  accountId: Id;
  date: ISODate;
  payeeId: Id | null;
  categoryId: Id | null;
  /** Without the app's tokens and review tag */
  notes: string;
  amount: Money;
}

export type FieldType = 'id' | 'string' | 'date' | 'number' | 'boolean';

const TYPE_OPS: Record<FieldType, readonly string[]> = {
  date: ['is', 'isapprox', 'gt', 'gte', 'lt', 'lte'],
  id: [
    'is',
    'contains',
    'matches',
    'oneOf',
    'isNot',
    'doesNotContain',
    'notOneOf',
    'onBudget',
    'offBudget',
  ],
  string: [
    'is',
    'contains',
    'matches',
    'oneOf',
    'isNot',
    'doesNotContain',
    'notOneOf',
    'hasTags',
    'hasAnyTag',
  ],
  number: ['is', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte'],
  boolean: ['is'],
};

/** The fields the editor shows, with Actual's type and the operators it refuses for each. */
const FIELDS: Record<string, { type: FieldType; disallowed?: readonly string[] }> = {
  imported_payee: { type: 'string', disallowed: ['hasTags', 'hasAnyTag'] },
  payee: { type: 'id', disallowed: ['onBudget', 'offBudget'] },
  account: { type: 'id' },
  category: { type: 'id', disallowed: ['onBudget', 'offBudget'] },
  category_group: { type: 'id', disallowed: ['onBudget', 'offBudget'] },
  date: { type: 'date' },
  notes: { type: 'string', disallowed: ['oneOf', 'notOneOf'] },
  amount: { type: 'number' },
  cleared: { type: 'boolean' },
  reconciled: { type: 'boolean' },
};

/** Actual's type for a field the editor shows, or undefined. */
export const fieldType = (field: string): FieldType | undefined => FIELDS[field]?.type;

/** The operators Actual accepts on a field, in the order the editor lists them (23 §1.2). */
export function conditionOps(field: string): string[] {
  const info = FIELDS[field];
  if (!info) return [];
  const order = [
    'is',
    'isNot',
    'contains',
    'doesNotContain',
    'matches',
    'oneOf',
    'notOneOf',
    'onBudget',
    'offBudget',
    'hasTags',
    'hasAnyTag',
    'isapprox',
    'isbetween',
    'gt',
    'gte',
    'lt',
    'lte',
  ];
  const allowed = TYPE_OPS[info.type];
  return order.filter((op) => allowed.includes(op) && !info.disallowed?.includes(op));
}

/** The fields a `set` action may change (23 §1.3), and those a split line may. */
export const SET_FIELDS = [
  'account',
  'category',
  'date',
  'payee',
  'notes',
  'cleared',
  'amount',
] as const;
export const SPLIT_SET_FIELDS = ['category', 'payee', 'notes'] as const;
export type SetField = (typeof SET_FIELDS)[number];

/** Actual's type for a field a `set` action writes. */
export const setFieldType = (field: SetField): FieldType =>
  field === 'notes' ? 'string' : (fieldType(field) ?? 'id');

/** Actual stores the default stage as null; 'default' is read as null too (23 §1). */
export const stageOf = (stage: string | null | undefined): RuleStage =>
  stage === 'pre' || stage === 'post' ? stage : null;

const OP_SCORES: Record<string, number> = {
  is: 10,
  isNot: 10,
  oneOf: 9,
  notOneOf: 9,
  isapprox: 5,
  isbetween: 5,
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
};
const EXACT = new Set(['is', 'isNot', 'isapprox', 'oneOf', 'notOneOf']);

/** Actual's specificity score (rankRules, 26.10.0): exact-only rules count double. */
export function ruleScore(rule: Pick<Rule, 'conditions'>): number {
  const score = rule.conditions.reduce((n, c) => n + (OP_SCORES[c.op] ?? 0), 0);
  return rule.conditions.every((c) => EXACT.has(c.op)) ? score * 2 : score;
}

const STAGE_ORDER = (s: RuleStage): number => (s === 'pre' ? 0 : s === 'post' ? 2 : 1);

/** The run order (23 §1.1): by stage, then least specific first, then by id. */
export function rankRules<R extends Pick<Rule, 'id' | 'stage' | 'conditions'>>(
  rules: readonly R[],
): R[] {
  const scores = new Map(rules.map((r) => [r, ruleScore(r)]));
  return [...rules].sort(
    (a, b) =>
      STAGE_ORDER(a.stage) - STAGE_ORDER(b.stage) ||
      (scores.get(a) ?? 0) - (scores.get(b) ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A schedule's rule: it links transactions to a schedule (12 §1). */
export const scheduleIdOf = (rule: Pick<Rule, 'actions'>): Id | null => {
  const link = rule.actions.find((a) => a.op === 'link-schedule');
  return link && typeof link.value === 'string' ? link.value : null;
};

/** A condition or action on `payee` names the payee (23 §1.4), as Actual's `getPayeeRules` does. */
export function isAssociated(rule: Pick<Rule, 'conditions' | 'actions'>, payeeId: Id): boolean {
  const names = (x: { field?: string; value: unknown }): boolean =>
    x.field === 'payee' &&
    (x.value === payeeId || (Array.isArray(x.value) && x.value.includes(payeeId)));
  return rule.conditions.some(names) || rule.actions.some(names);
}
