// A schedule's transaction template, stored as actions on the schedule's rule (12 §1): `set category`,
// `set notes` (notes, tags and always the review tag), and splits as `set-split-amount` with per-split
// `set category`, `set notes` and, for transfer lines, `set payee`. Actions the app doesn't write
// (`link-schedule` and anything else) are kept as they are.
import type { Id, Money } from '../domain/types';
import { decode, encode } from '../metadata/notes-codec';

/** A rule action as Actual stores it; unknown fields are kept. */
export interface RuleAction {
  field?: string;
  op: string;
  value: unknown;
  type?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TemplateLine {
  /** A fixed line's amount; a remainder line gets what the fixed lines leave. */
  amount: Money;
  method: 'fixed-amount' | 'remainder';
  /** A transfer line's transfer payee. */
  payeeId: Id | null;
  categoryId: Id | null;
  notes: string;
}

export interface Template {
  categoryId: Id | null;
  notes: string;
  lines: TemplateLine[];
}

const splitIndexOf = (a: RuleAction): number | null => {
  const idx = a.options?.['splitIndex'];
  return typeof idx === 'number' && idx > 0 ? idx : null;
};

/** The actions this codec writes: they're replaced on save, every other action is kept. */
export function isTemplateAction(a: RuleAction): boolean {
  if (a.op === 'set-split-amount') return true;
  if (a.op !== 'set') return false;
  if (a.field === 'category' || a.field === 'notes') return true;
  return a.field === 'payee' && splitIndexOf(a) !== null;
}

/** Reads the template from a rule's actions. `amount` is the schedule's, for remainder lines. */
export function readTemplate(actions: readonly RuleAction[], amount: Money): Template {
  let categoryId: Id | null = null;
  let notes = '';
  const lines = new Map<
    number,
    { amount: Money | null; payeeId: Id | null; categoryId: Id | null; notes: string }
  >();
  const line = (i: number) => {
    const found = lines.get(i);
    if (found) return found;
    const created = { amount: null, payeeId: null, categoryId: null, notes: '' };
    lines.set(i, created);
    return created;
  };
  for (const a of actions) {
    const idx = splitIndexOf(a);
    const text = typeof a.value === 'string' ? a.value : null;
    if (a.op === 'set-split-amount' && idx !== null) {
      line(idx).amount =
        a.options?.['method'] === 'fixed-amount' && typeof a.value === 'number' ? a.value : null;
    } else if (a.op === 'set' && a.field === 'category') {
      if (idx === null) categoryId = text;
      else line(idx).categoryId = text;
    } else if (a.op === 'set' && a.field === 'notes') {
      if (idx === null) notes = text ?? '';
      else line(idx).notes = text ?? '';
    } else if (a.op === 'set' && a.field === 'payee' && idx !== null) {
      line(idx).payeeId = text;
    }
  }
  const meta = decode(notes);
  const ordered = [...lines.entries()].sort(([a], [b]) => a - b).map(([, l]) => l);
  const fixed = ordered.reduce((s, l) => s + (l.amount ?? 0), 0);
  const remainders = ordered.filter((l) => l.amount === null).length;
  const share = remainders > 0 ? Math.trunc((amount - fixed) / remainders) : 0;
  let left = amount - fixed - share * remainders;
  return {
    categoryId: ordered.length > 0 ? null : categoryId,
    notes: meta.notes,
    lines: ordered.map((l) => {
      let lineAmount = l.amount;
      if (lineAmount === null) {
        lineAmount = share + left;
        left = 0;
      }
      return {
        amount: lineAmount,
        method: l.amount === null ? 'remainder' : 'fixed-amount',
        payeeId: l.payeeId,
        categoryId: l.categoryId,
        notes: decode(l.notes).notes,
      };
    }),
  };
}

/**
 * The rule's actions with this template (12 §1): the template actions replace the old ones, after the
 * kept actions. Every line is fixed except the last, which takes the remainder.
 */
export function writeTemplate(actions: readonly RuleAction[], t: Template): RuleAction[] {
  const kept = actions.filter((a) => !isTemplateAction(a));
  const out: RuleAction[] = [
    ...kept,
    {
      op: 'set',
      field: 'notes',
      value: encode({ notes: t.notes, checkNumber: null, needsReview: true }),
      type: 'string',
    },
  ];
  if (t.lines.length === 0) {
    if (t.categoryId !== null)
      out.push({ op: 'set', field: 'category', value: t.categoryId, type: 'id' });
    return out;
  }
  t.lines.forEach((l, i) => {
    const splitIndex = i + 1;
    const last = i === t.lines.length - 1;
    out.push({
      op: 'set-split-amount',
      value: last ? null : l.amount,
      options: { splitIndex, method: last ? 'remainder' : 'fixed-amount' },
    });
    if (l.categoryId !== null)
      out.push({
        op: 'set',
        field: 'category',
        value: l.categoryId,
        options: { splitIndex },
        type: 'id',
      });
    if (l.payeeId !== null)
      out.push({
        op: 'set',
        field: 'payee',
        value: l.payeeId,
        options: { splitIndex },
        type: 'id',
      });
    if (l.notes.trim() !== '')
      out.push({
        op: 'set',
        field: 'notes',
        value: l.notes.trim(),
        options: { splitIndex },
        type: 'string',
      });
  });
  return out;
}
