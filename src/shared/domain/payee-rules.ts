// Payee rules in Actual (14 §1): one auto-category rule and one rename rule per payee, managed by the app.
// Rules this app didn't write (other ops or fields) are left alone and shown as "Other rule".
import type { Id, RenameCondition } from './types';

export interface RuleShape {
  id: Id;
  stage: string | null;
  conditionsOp: string;
  conditions: { field: string; op: string; value: unknown }[];
  actions: { field?: string; op: string; value: unknown }[];
}

/** Regex specials only: no class escapes, which Actual's lowercasing would change (14 §1). */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SPECIALS = '.*+?^${}()|[]\\';

/**
 * The literal text of a pattern made only of plain characters and escaped specials, scanning left to
 * right; null for anything else (an unescaped special, or a class escape such as `\d`).
 */
function unescapeLiteral(s: string): string | null {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '\\') {
      const next = s.charAt(i + 1);
      if (next === '' || !SPECIALS.includes(next)) return null;
      out += next;
      i++;
    } else if (SPECIALS.includes(ch)) {
      return null;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Contains → contains; Is → is; Starts with → matches ^…; Ends with → matches …$ (14 §1). */
export function toActualCondition(c: RenameCondition): {
  field: string;
  op: string;
  value: string;
} {
  switch (c.op) {
    case 'contains':
      return { field: 'imported_payee', op: 'contains', value: c.value };
    case 'is':
      return { field: 'imported_payee', op: 'is', value: c.value };
    case 'startsWith':
      return { field: 'imported_payee', op: 'matches', value: `^${escapeRegex(c.value)}` };
    case 'endsWith':
      return { field: 'imported_payee', op: 'matches', value: `${escapeRegex(c.value)}$` };
  }
}

/** Reads one Actual condition back, or null when it isn't one of the four the app writes. */
export function fromActualCondition(c: {
  field: string;
  op: string;
  value: unknown;
}): RenameCondition | null {
  if (c.field !== 'imported_payee' || typeof c.value !== 'string') return null;
  if (c.op === 'contains' || c.op === 'is') return { op: c.op, value: c.value };
  if (c.op !== 'matches') return null;
  // The scan rejects an unescaped `^` or `$` inside, so exactly one anchor survives.
  if (c.value.startsWith('^')) {
    const literal = unescapeLiteral(c.value.slice(1));
    return literal === null ? null : { op: 'startsWith', value: literal };
  }
  if (c.value.endsWith('$')) {
    const literal = unescapeLiteral(c.value.slice(0, -1));
    return literal === null ? null : { op: 'endsWith', value: literal };
  }
  return null;
}

const setsField = (rule: RuleShape, field: string): { value: unknown } | undefined =>
  rule.actions.length === 1 && rule.actions[0]?.op === 'set' && rule.actions[0].field === field
    ? rule.actions[0]
    : undefined;

/**
 * A default-stage rule "payee is P → set category" (14 §1). Actual stores the default stage as `null`
 * (its stages are 'pre', null and 'post'); 'default' is accepted too.
 */
export function autoCategoryOf(rule: RuleShape): { payeeId: Id; categoryId: Id } | null {
  if ((rule.stage !== null && rule.stage !== 'default') || rule.conditions.length !== 1)
    return null;
  const [c] = rule.conditions;
  const action = setsField(rule, 'category');
  if (!c || c.field !== 'payee' || c.op !== 'is' || typeof c.value !== 'string' || !action)
    return null;
  return typeof action.value === 'string' ? { payeeId: c.value, categoryId: action.value } : null;
}

/** A `pre`-stage rule "imported_payee … (or …) → set payee = P" whose conditions the app understands. */
export function renameRuleOf(
  rule: RuleShape,
): { payeeId: Id; conditions: RenameCondition[] } | null {
  if (rule.stage !== 'pre' || rule.conditions.length === 0) return null;
  if (rule.conditions.length > 1 && rule.conditionsOp !== 'or') return null;
  const action = setsField(rule, 'payee');
  if (!action || typeof action.value !== 'string') return null;
  const conditions = rule.conditions.map(fromActualCondition);
  if (conditions.some((c) => c === null)) return null;
  return { payeeId: action.value, conditions: conditions as RenameCondition[] };
}
