// The rule editor's form (23 §1, §3): an Actual rule as editable rows, and back. A condition or action the
// editor can't show is a read-only row that keeps the original object; editable rows keep the keys of
// the object they came from, so an update writes back what the app doesn't know.
import {
  conditionOps,
  fieldType,
  SET_FIELDS,
  setFieldType,
  SPLIT_SET_FIELDS,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleStage,
  type SetField,
} from '@shared/domain/rules';
import type { Id, Money } from '@shared/domain/types';

/** The condition fields the editor offers (23 §1.2); the inflow/outflow amounts are `amount` + options. */
export const COND_FIELDS = [
  'imported_payee',
  'payee',
  'account',
  'category',
  'category_group',
  'date',
  'notes',
  'amount',
  'amountInflow',
  'amountOutflow',
  'cleared',
  'reconciled',
] as const;
export type CondField = (typeof COND_FIELDS)[number];

/** Actual's field for an editor field. */
export const actualField = (f: CondField): string =>
  f === 'amountInflow' || f === 'amountOutflow' ? 'amount' : f;

export const opsFor = (f: CondField): string[] => conditionOps(actualField(f));

export type IdEntity = 'payee' | 'account' | 'category' | 'category_group';
export type DateMode = 'date' | 'month' | 'year';
export type ValueKind =
  'text' | 'texts' | 'id' | 'ids' | 'date' | 'money' | 'magnitude' | 'between' | 'bool' | 'none';

/** The value editor a field and operator take (23 §3.1). */
export function valueKind(f: CondField, op: string): ValueKind {
  const type = fieldType(actualField(f));
  if (type === 'id') {
    if (op === 'is' || op === 'isNot') return 'id';
    if (op === 'oneOf' || op === 'notOneOf') return 'ids';
    if (op === 'onBudget' || op === 'offBudget') return 'none';
    return 'text';
  }
  if (type === 'string') return op === 'oneOf' || op === 'notOneOf' ? 'texts' : 'text';
  if (type === 'date') return 'date';
  if (type === 'boolean') return 'bool';
  if (op === 'isbetween') return 'between';
  return f === 'amount' ? 'money' : 'magnitude';
}

export interface CondRow {
  key: number;
  /** null: a read-only row (23 §1.2), kept as `source`. */
  field: CondField | null;
  op: string;
  text: string;
  texts: string[];
  id: Id | null;
  ids: Id[];
  date: string;
  dateMode: DateMode;
  amount: Money;
  amount2: Money;
  bool: boolean;
  /** The condition the row came from, or null for a new row. */
  source: RuleCondition | null;
}

export type ActKind = 'set' | 'prepend-notes' | 'append-notes' | 'delete-transaction';

export interface ActRow {
  key: number;
  /** null: a read-only row (23 §1.3), kept as `source`. */
  kind: ActKind | null;
  field: SetField;
  text: string;
  id: Id | null;
  date: string;
  amount: Money;
  bool: boolean;
  source: RuleAction | null;
}

export type SplitMethod = 'fixed-amount' | 'fixed-percent' | 'remainder';

export interface SplitForm {
  key: number;
  /** null: a method the editor can't show (a formula), kept as `source`. */
  method: SplitMethod | null;
  amount: Money;
  percent: number;
  source: RuleAction | null;
  actions: ActRow[];
}

export interface RuleForm {
  id: Id | null;
  stage: RuleStage;
  conditionsOp: 'and' | 'or';
  conditions: CondRow[];
  actions: ActRow[];
  splits: SplitForm[];
  schedule: Rule['schedule'];
}

let nextKey = 1;
const key = (): number => nextKey++;

export function newCondition(field: CondField = 'imported_payee', op?: string): CondRow {
  return {
    key: key(),
    field,
    // A new row starts as "imported payee contains" (23 §3.1).
    op: op ?? (opsFor(field).includes('contains') ? 'contains' : (opsFor(field)[0] ?? 'is')),
    text: '',
    texts: [],
    id: null,
    ids: [],
    date: '',
    dateMode: 'date',
    amount: 0,
    amount2: 0,
    bool: true,
    source: null,
  };
}

export function newAction(kind: ActKind = 'set', field: SetField = 'category'): ActRow {
  return {
    key: key(),
    kind,
    field,
    text: '',
    id: null,
    date: '',
    amount: 0,
    bool: true,
    source: null,
  };
}

export function newSplit(): SplitForm {
  return { key: key(), method: 'remainder', amount: 0, percent: 0, source: null, actions: [] };
}

export function emptyForm(): RuleForm {
  return {
    id: null,
    stage: null,
    conditionsOp: 'and',
    conditions: [newCondition()],
    actions: [newAction()],
    splits: [],
    schedule: null,
  };
}

/**
 * Changing the field keeps the operator when the new field allows it (23 §3.1). Another Actual field
 * starts with an empty value (a payee id means nothing as an account), keeping only typed text; within
 * the amounts, inflow and outflow take magnitudes.
 */
export function setField(row: CondRow, field: CondField): void {
  const before = row.field;
  row.field = field;
  if (!opsFor(field).includes(row.op)) row.op = opsFor(field)[0] ?? 'is';
  if (before === null || actualField(before) !== actualField(field)) {
    Object.assign(row, {
      texts: [],
      id: null,
      ids: [],
      date: '',
      dateMode: 'date',
      amount: 0,
      amount2: 0,
      bool: true,
    });
  } else if (field === 'amountInflow' || field === 'amountOutflow') {
    row.amount = Math.abs(row.amount);
    row.amount2 = Math.abs(row.amount2);
  }
}

// ------------------------------------------------------------------------------------- reading

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function readCondition(c: RuleCondition): CondRow {
  const row = newCondition();
  row.source = c;
  const readOnly = (): CondRow => ({ ...row, field: null, op: c.op });
  const options = (c.options ?? {}) as { inflow?: unknown; outflow?: unknown };
  let field: CondField | undefined;
  if (c.field === 'amount')
    field = options.inflow ? 'amountInflow' : options.outflow ? 'amountOutflow' : 'amount';
  else field = COND_FIELDS.find((f) => f === c.field);
  if (!field || !opsFor(field).includes(c.op)) return readOnly();
  row.field = field;
  row.op = c.op;
  const v = c.value;
  switch (valueKind(field, c.op)) {
    case 'text':
      if (!isStr(v)) return readOnly();
      row.text = v;
      break;
    case 'texts':
      if (!Array.isArray(v) || !v.every(isStr)) return readOnly();
      row.texts = [...v];
      break;
    case 'id':
      if (v !== null && v !== undefined && !isStr(v)) return readOnly();
      row.id = v ?? null;
      break;
    case 'ids':
      if (!Array.isArray(v) || !v.every(isStr)) return readOnly();
      row.ids = [...v];
      break;
    case 'date':
      // A recurring date (Actual's repeat config) isn't editable here (23 §1.2).
      if (!isStr(v)) return readOnly();
      row.date = v;
      row.dateMode = v.length === 4 ? 'year' : v.length === 7 ? 'month' : 'date';
      break;
    case 'money':
    case 'magnitude':
      if (!isNum(v)) return readOnly();
      row.amount = v;
      break;
    case 'between': {
      const b = v as { num1?: unknown; num2?: unknown } | null;
      if (!b || !isNum(b.num1) || !isNum(b.num2)) return readOnly();
      row.amount = b.num1;
      row.amount2 = b.num2;
      break;
    }
    case 'bool':
      if (typeof v !== 'boolean') return readOnly();
      row.bool = v;
      break;
    case 'none':
      break;
  }
  return row;
}

function readAction(a: RuleAction, fields: readonly SetField[]): ActRow {
  const row = newAction();
  row.source = a;
  const readOnly = (): ActRow => ({ ...row, kind: null });
  const options = (a.options ?? {}) as { template?: unknown; formula?: unknown };
  if (a.op === 'delete-transaction') return { ...row, kind: 'delete-transaction' };
  if (a.op === 'prepend-notes' || a.op === 'append-notes') {
    if (!isStr(a.value)) return readOnly();
    return { ...row, kind: a.op, field: 'notes', text: a.value };
  }
  const field = fields.find((f) => f === a.field);
  if (a.op !== 'set' || !field || options.template || options.formula) return readOnly();
  row.kind = 'set';
  row.field = field;
  const v = a.value;
  switch (setFieldType(field)) {
    case 'id':
      if (v !== null && v !== undefined && !isStr(v)) return readOnly();
      row.id = v ?? null;
      break;
    case 'string':
      row.text = isStr(v) ? v : '';
      break;
    case 'date':
      if (!isStr(v)) return readOnly();
      row.date = v;
      break;
    case 'number':
      if (!isNum(v)) return readOnly();
      row.amount = v;
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return readOnly();
      row.bool = v;
      break;
  }
  return row;
}

const splitIndexOf = (a: RuleAction): number => {
  const i = (a.options as { splitIndex?: unknown } | undefined)?.splitIndex;
  return typeof i === 'number' && i > 0 ? i : 0;
};

/** The form for an existing rule (23 §3). */
export function formOf(rule: Rule): RuleForm {
  const splits = new Map<number, SplitForm>();
  const split = (i: number): SplitForm => {
    let s = splits.get(i);
    if (!s) {
      s = { ...newSplit(), method: null };
      splits.set(i, s);
    }
    return s;
  };
  const actions: ActRow[] = [];
  for (const a of rule.actions) {
    const i = splitIndexOf(a);
    if (i === 0) {
      actions.push(readAction(a, SET_FIELDS));
      continue;
    }
    const s = split(i);
    if (a.op !== 'set-split-amount') {
      s.actions.push(readAction(a, SPLIT_SET_FIELDS));
      continue;
    }
    s.source = a;
    const method = (a.options as { method?: unknown } | undefined)?.method;
    if (method === 'fixed-amount' && isNum(a.value)) {
      s.method = method;
      s.amount = a.value;
    } else if (method === 'fixed-percent' && typeof a.value === 'number') {
      s.method = method;
      s.percent = a.value;
    } else if (method === 'remainder') s.method = method;
  }
  return {
    id: rule.id,
    stage: rule.stage,
    conditionsOp: rule.conditionsOp,
    conditions: rule.conditions.map(readCondition),
    actions,
    splits: [...splits.entries()].sort(([a], [b]) => a - b).map(([, s]) => s),
    schedule: rule.schedule,
  };
}

// ------------------------------------------------------------------------------------- checking

const dateOk = (mode: DateMode, v: string): boolean =>
  mode === 'year'
    ? /^\d{4}$/.test(v)
    : mode === 'month'
      ? /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
      : ISO.test(v) && !Number.isNaN(Date.parse(v));

function regexOk(pattern: string): boolean {
  try {
    new RegExp(pattern.toLocaleLowerCase());
    return true;
  } catch {
    return false;
  }
}

/** Actual's limits on a condition's value (23 §1.2). Read-only rows are always complete. */
export function conditionComplete(row: CondRow): boolean {
  if (row.field === null) return true;
  switch (valueKind(row.field, row.op)) {
    case 'text':
      if (row.op === 'is' || row.op === 'isNot') return true;
      return row.text !== '' && (row.op !== 'matches' || regexOk(row.text));
    case 'texts':
      return row.texts.length > 0;
    case 'ids':
      return row.ids.length > 0;
    case 'date':
      return dateOk(row.op === 'is' ? row.dateMode : 'date', row.date);
    default:
      return true;
  }
}

/** Actual's limits on an action's value (23 §1.3). */
export function actionComplete(row: ActRow): boolean {
  if (row.kind === 'prepend-notes' || row.kind === 'append-notes') return row.text !== '';
  if (row.kind !== 'set') return true;
  if (row.field === 'account' || row.field === 'payee') return row.id !== null;
  if (row.field === 'date') return dateOk('date', row.date);
  return true;
}

export const splitComplete = (s: SplitForm): boolean =>
  s.method !== 'fixed-percent' || (s.percent >= 0 && s.percent <= 100);

/** The keys of the rows that stop a save (23 §3.3). */
export function invalidKeys(form: RuleForm): Set<number> {
  const out = new Set<number>();
  for (const c of form.conditions) if (!conditionComplete(c)) out.add(c.key);
  for (const a of form.actions) if (!actionComplete(a)) out.add(a.key);
  for (const s of form.splits) {
    if (!splitComplete(s)) out.add(s.key);
    for (const a of s.actions) if (!actionComplete(a)) out.add(a.key);
  }
  return out;
}

/** A rule needs a condition and an action (23 §3.3). */
export const hasConditionAndAction = (form: RuleForm): boolean =>
  form.conditions.length > 0 && (form.actions.length > 0 || form.splits.length > 0);

// ------------------------------------------------------------------------------------- writing

/** The source's other keys, without the ones the row writes. */
function rest<T extends { options?: Record<string, unknown> }>(
  source: T | null,
  drop: readonly string[],
): { base: Partial<T>; options: Record<string, unknown> } {
  if (!source) return { base: {}, options: {} };
  const written = ['field', 'op', 'value', 'type', 'options'];
  const base = Object.fromEntries(Object.entries(source).filter(([k]) => !written.includes(k)));
  const options = Object.fromEntries(
    Object.entries(source.options ?? {}).filter(([k]) => !drop.includes(k)),
  );
  return { base: base as Partial<T>, options };
}

const withOptions = <T extends object>(
  obj: T,
  options: Record<string, unknown>,
): T & { options?: Record<string, unknown> } =>
  Object.keys(options).length > 0 ? { ...obj, options } : obj;

export function conditionOf(row: CondRow): RuleCondition {
  if (row.field === null && row.source) return row.source;
  const f = row.field ?? 'imported_payee';
  const { base, options } = rest(row.source, ['inflow', 'outflow']);
  if (f === 'amountInflow') options['inflow'] = true;
  if (f === 'amountOutflow') options['outflow'] = true;
  let value: unknown;
  switch (valueKind(f, row.op)) {
    case 'text':
      value = row.text;
      break;
    case 'texts':
      value = [...row.texts];
      break;
    case 'id':
      value = row.id;
      break;
    case 'ids':
      value = [...row.ids];
      break;
    case 'date':
      value = row.date;
      break;
    case 'money':
    case 'magnitude':
      value = row.amount;
      break;
    case 'between':
      value = { num1: row.amount, num2: row.amount2 };
      break;
    case 'bool':
      value = row.bool;
      break;
    case 'none':
      value = null;
      break;
  }
  const field = actualField(f);
  return withOptions(
    { ...base, field, op: row.op, value, type: fieldType(field) ?? 'string' },
    options,
  );
}

function actionOf(row: ActRow, splitIndex: number): RuleAction {
  if (row.kind === null && row.source) {
    if (splitIndex === 0) return row.source;
    return { ...row.source, options: { ...(row.source.options ?? {}), splitIndex } };
  }
  const { base, options } = rest(row.source, ['splitIndex']);
  if (splitIndex > 0) options['splitIndex'] = splitIndex;
  if (row.kind === 'delete-transaction')
    return withOptions({ ...base, op: 'delete-transaction', value: null }, options);
  if (row.kind === 'prepend-notes' || row.kind === 'append-notes')
    return withOptions({ ...base, op: row.kind, field: 'notes', value: row.text }, options);
  const type = setFieldType(row.field);
  const value =
    type === 'id'
      ? row.id
      : type === 'date'
        ? row.date
        : type === 'number'
          ? row.amount
          : type === 'boolean'
            ? row.bool
            : row.text;
  return withOptions({ ...base, op: 'set', field: row.field, value, type }, options);
}

function splitAmountOf(s: SplitForm, splitIndex: number): RuleAction {
  if (s.method === null && s.source)
    return { ...s.source, options: { ...(s.source.options ?? {}), splitIndex } };
  const { base, options } = rest(s.source, ['splitIndex', 'method']);
  const method = s.method ?? 'remainder';
  return {
    ...base,
    op: 'set-split-amount',
    value: method === 'fixed-amount' ? s.amount : method === 'fixed-percent' ? s.percent : null,
    options: { ...options, splitIndex, method },
  };
}

/** The actions in Actual's form: the whole transaction's first, then each split's, renumbered. */
export function actionsOf(form: RuleForm): RuleAction[] {
  return [
    ...form.actions.map((a) => actionOf(a, 0)),
    ...form.splits.flatMap((s, i) => [
      splitAmountOf(s, i + 1),
      ...s.actions.map((a) => actionOf(a, i + 1)),
    ]),
  ];
}

/** What `rules.save` takes. */
export function ruleOf(form: RuleForm): {
  id?: Id;
  stage: RuleStage;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
} {
  return {
    ...(form.id === null ? {} : { id: form.id }),
    stage: form.stage,
    conditionsOp: form.conditionsOp,
    conditions: form.conditions.map(conditionOf),
    actions: actionsOf(form),
  };
}

// ------------------------------------------------------------------------------------- drafts

/** A new rule for a payee (23 §2, §2.1): "payee is {payee}". */
export function formForPayee(payeeId: Id): RuleForm {
  const condition = newCondition('payee', 'is');
  condition.id = payeeId;
  return { ...emptyForm(), conditions: [condition] };
}

/**
 * A new rule from a register transaction (23 §2.2): its imported payee (or payee) and account as
 * conditions, its payee and category as actions.
 */
export function formFromTransaction(t: {
  accountId: Id;
  payeeId: Id | null;
  importedPayee: string | null;
  categoryId: Id | null;
  transferAccountId: Id | null;
  subtransactions: readonly unknown[];
}): RuleForm {
  const conditions: CondRow[] = [];
  if (t.importedPayee) {
    const c = newCondition('imported_payee', 'is');
    c.text = t.importedPayee;
    conditions.push(c);
  } else if (t.payeeId) {
    const c = newCondition('payee', 'is');
    c.id = t.payeeId;
    conditions.push(c);
  }
  const account = newCondition('account', 'is');
  account.id = t.accountId;
  conditions.push(account);
  const actions: ActRow[] = [];
  if (t.payeeId) {
    const a = newAction('set', 'payee');
    a.id = t.payeeId;
    actions.push(a);
  }
  if (t.categoryId && t.subtransactions.length === 0 && t.transferAccountId === null) {
    const a = newAction('set', 'category');
    a.id = t.categoryId;
    actions.push(a);
  }
  return { ...emptyForm(), conditions, actions: actions.length > 0 ? actions : [newAction()] };
}
