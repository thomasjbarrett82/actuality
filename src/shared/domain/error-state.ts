// Derived transaction states (04 §7): computed after load for each transaction and each split line.
// Rank: error 10 > forReview 5 > needsCategory 1 > none 0.
import { ERROR_RANK, type ErrorLevel, type ErrorMessage, type Id, type Money } from './types';

/** What the rules need to know about one transaction or split line. */
export interface StateInput {
  /** The transaction's account is on-budget. */
  onBudget: boolean;
  /** The transfer target's on-budget flag, or null when this isn't a transfer. */
  transferTargetOnBudget: boolean | null;
  categoryId: Id | null;
  amount: Money;
  needsReview: boolean;
  scheduleId: Id | null;
}

export interface DerivedState {
  level: ErrorLevel;
  message: ErrorMessage | null;
}

const NONE: DerivedState = { level: 'none', message: null };

export const rank = (level: ErrorLevel): number => ERROR_RANK[level];

/** The error that outranks review: an on-budget ↔ on-budget transfer with a category. */
function transferError(t: StateInput): DerivedState | null {
  if (t.onBudget && t.transferTargetOnBudget === true && t.categoryId !== null) {
    return { level: 'error', message: { key: 'onBudgetTransferCategorized' } };
  }
  return null;
}

function needsCategory(t: StateInput, isSplit: boolean): DerivedState | null {
  if (!t.onBudget || t.categoryId !== null) return null;
  if (t.transferTargetOnBudget === false) {
    return { level: 'needsCategory', message: { key: 'offBudgetTransferNeedsCategory' } };
  }
  if (t.transferTargetOnBudget === null && !isSplit && t.amount !== 0) {
    return { level: 'needsCategory', message: { key: 'needsCategory' } };
  }
  return null;
}

const review = (t: StateInput): DerivedState => ({
  level: 'forReview',
  message: { key: t.scheduleId ? 'reviewScheduled' : 'reviewImported' },
});

/** The state of a transaction that isn't split, or of one split line. */
export function lineState(t: StateInput): DerivedState {
  const error = transferError(t);
  if (error) return error;
  // Review replaces needsCategory (04 §7).
  if (t.needsReview) return review(t);
  return needsCategory(t, false) ?? NONE;
}

/**
 * A split parent: an error line makes it an error that lists every error line; otherwise the highest line
 * level, and its own review tag (on the parent's notes) outranks needsCategory.
 */
export function splitState(parent: StateInput, lines: readonly DerivedState[]): DerivedState {
  const errors = lines.filter((l) => l.level === 'error' && l.message !== null);
  if (errors.length > 0) {
    return {
      level: 'error',
      message: { key: 'splitProblems', children: errors.map((l) => l.message as ErrorMessage) },
    };
  }
  const own = transferError(parent);
  if (own) return own;
  const worst = lines.reduce<DerivedState>((a, b) => (rank(b.level) > rank(a.level) ? b : a), NONE);
  if (parent.needsReview && rank(worst.level) <= rank('forReview')) return review(parent);
  return worst;
}

/** Account attention (04 §7): a split counts once; maxLevel is the highest level. */
export function attention(levels: readonly ErrorLevel[]): { count: number; maxLevel: ErrorLevel } {
  let count = 0;
  let maxLevel: ErrorLevel = 'none';
  for (const l of levels) {
    if (l === 'none') continue;
    count++;
    if (rank(l) > rank(maxLevel)) maxLevel = l;
  }
  return { count, maxLevel };
}
