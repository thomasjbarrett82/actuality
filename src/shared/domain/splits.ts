// Split commit rules (11 §7.3): empty lines are discarded, no lines leaves an uncategorized transaction,
// one line collapses into a normal transaction when nothing conflicts, and an unbalanced split offers
// three ways out. Pure, so the editor and its tests share it.
import { allocate, sum } from '../money';
import type { Id, Money } from './types';

/** A split line as the editor holds it. */
export interface SplitLineDraft {
  id: Id | null;
  /** A transfer line's target account; null for a categorized line. */
  transferAccountId: Id | null;
  categoryId: Id | null;
  notes: string;
  amount: Money;
}

/** What the parent contributes to a collapse: its own fields, each empty or not. */
export interface SplitParentDraft {
  /** The parent has a payee (not a transfer: a split parent can't be one). */
  hasPayee: boolean;
  notes: string;
  amount: Money;
}

export const isEmptyLine = (l: SplitLineDraft): boolean =>
  l.transferAccountId === null && l.categoryId === null && l.amount === 0 && l.notes.trim() === '';

/** `parent.amount − Σ lines`, shown live under the editor (11 §7.1). */
export const remainingOf = (amount: Money, lines: readonly SplitLineDraft[]): Money =>
  amount - sum(lines.map((l) => l.amount));

export type SplitOutcome =
  /** No lines left: the transaction becomes uncategorized, not a split. */
  | { kind: 'none' }
  /** One line folded into the parent. Each field is filled only where the parent's was empty. */
  | {
      kind: 'collapse';
      transferAccountId: Id | null;
      categoryId: Id | null;
      notes: string;
      amount: Money;
    }
  | { kind: 'split'; lines: SplitLineDraft[] };

/** Applies the §7.3 rules to the lines being committed (before the balance check). */
export function finalizeSplit(
  parent: SplitParentDraft,
  lines: readonly SplitLineDraft[],
): SplitOutcome {
  const kept = lines.filter((l) => !isEmptyLine(l));
  if (kept.length === 0) return { kind: 'none' };
  const [only] = kept;
  if (kept.length === 1 && only) {
    const notes = parent.notes.trim();
    const conflict =
      (parent.hasPayee && only.transferAccountId !== null) ||
      (notes !== '' && only.notes.trim() !== '' && notes !== only.notes.trim()) ||
      (parent.amount !== 0 && only.amount !== 0 && parent.amount !== only.amount);
    if (!conflict) {
      return {
        kind: 'collapse',
        transferAccountId: only.transferAccountId,
        categoryId: only.categoryId,
        notes: notes === '' ? only.notes.trim() : notes,
        amount: parent.amount === 0 ? only.amount : parent.amount,
      };
    }
  }
  return { kind: 'split', lines: kept };
}

/**
 * "Auto-distribute amongst splits" (11 §7.3): the remaining amount spread over the lines in proportion to
 * their amounts, in minor units (04 §1 `allocate`). Returns the new line amounts.
 */
export function distribute(remaining: Money, lines: readonly SplitLineDraft[]): Money[] {
  const shares = allocate(
    remaining,
    lines.map((l) => l.amount),
  );
  return lines.map((l, i) => l.amount + (shares[i] ?? 0));
}
