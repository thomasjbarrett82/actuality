// Putting back what Actual's rules changed (12 §2). `addTransactions` runs the
// rules, and a schedule's rule links a matching row and applies its template (category, notes with
// `#needs-review`, splits). The same job reads the row back and restores in one update what the app wrote;
// the schedule link stays, so the occurrence still counts as paid. Import adds through
// `importTransactions` instead and restores each added row with `importedRowPatch` (16 §1.5).
import type { Id } from '@shared/domain/types';
import { decode, encode, restoredNotes } from '@shared/metadata/notes-codec';
import type { ActualApi, NewTransaction, RawRow, TransactionPatch } from '../actual';

/** What the add did: the schedule a rule linked the row to, if any. */
export interface AddResult {
  /** Set when Actual's rules (not the app) linked the new row to a schedule. */
  linkedSchedule: Id | null;
}

/** A line multiset key, to see whether the rules replaced the lines the app wrote. */
const linesKey = (ls: readonly { amount: number; category: Id | null; notes: string }[]): string =>
  ls
    .map((l) => `${String(l.amount)}|${l.category ?? ''}|${l.notes}`)
    .sort()
    .join('\n');

/**
 * Adds an entered transaction (the commit pipeline, Enter in register now): the user's payee, notes and
 * category or splits win; only an empty category (not a split) keeps a linked schedule's category and
 * splits.
 */
export async function addRestoring(
  actual: ActualApi,
  accountId: Id,
  t: NewTransaction,
): Promise<AddResult> {
  await actual.addTransactions(accountId, [t]);
  const [row] = await actual.getTransactionRows({ ids: [t.id] });
  if (!row) return { linkedSchedule: null };
  const linked = row.schedule !== null && (t.schedule ?? null) === null ? row.schedule : null;
  const patch = await enteredPatch(actual, t, row, linked);
  if (Object.keys(patch).length > 0) await actual.updateTransaction(t.id, patch);
  return { linkedSchedule: linked };
}

async function enteredPatch(
  actual: ActualApi,
  t: NewTransaction,
  row: RawRow,
  linked: Id | null,
): Promise<TransactionPatch> {
  const patch: TransactionPatch = {};
  if (t.payee !== undefined && row.payee !== t.payee) patch.payee = t.payee;
  if ((row.notes ?? '') !== t.notes) patch.notes = t.notes;
  const keepSchedule = linked !== null && t.category === null && !t.subtransactions;
  if (keepSchedule) return patch;
  if (t.subtransactions) {
    const lines = await actual.getTransactionRows({ parentIds: [t.id] });
    const have = lines.map((l) => ({
      amount: l.amount,
      category: l.category,
      notes: l.notes ?? '',
    }));
    if (linesKey(t.subtransactions) !== linesKey(have))
      patch.subtransactions = t.subtransactions.map((l) => {
        const copy = { ...l };
        delete copy.id;
        return copy;
      });
    return patch;
  }
  // The rules made it a split the user didn't enter: back to one category.
  if (row.isParent) patch.subtransactions = [];
  if (row.category !== t.category || row.isParent) patch.category = t.category;
  return patch;
}

/**
 * An imported row as Actual's rules left it, put back (16 §1.5): a rule's notes action can drop the check
 * number and review tag (23 §5), so they come back. On a row a schedule's rule linked, the imported notes
 * and check number come back with the review tag, and the schedule's category is kept only if the row had
 * none. Empty when nothing needs restoring.
 */
export function importedRowPatch(
  wrote: { notes: string; category: Id | null },
  row: RawRow,
): TransactionPatch {
  if (!row.schedule) {
    const notes = restoredNotes(wrote.notes, row.notes);
    return notes === null ? {} : { notes };
  }
  const notes = encode({ ...decode(wrote.notes), needsReview: true });
  const patch: TransactionPatch = {};
  if ((row.notes ?? '') !== notes) patch.notes = notes;
  if (wrote.category !== null && row.category !== wrote.category && !row.isParent)
    patch.category = wrote.category;
  return patch;
}
