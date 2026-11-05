// The text of a derived transaction state (04 §7): the host sends a message key; the renderer shows it in
// the UI language, as the error icon's tooltip. A split's message lists its problem lines' messages.
import type { ErrorMessage, ErrorMessageKey } from '@shared/domain/types';
import { tr } from './dialogs';

const KEYS: Readonly<Record<ErrorMessageKey, string>> = {
  onBudgetTransferCategorized: 'app.stateOnBudgetTransferCategorized',
  splitProblems: 'app.stateSplitProblems',
  reviewScheduled: 'app.stateReviewScheduled',
  reviewImported: 'app.stateReviewImported',
  needsCategory: 'app.stateNeedsCategory',
  offBudgetTransferNeedsCategory: 'app.stateOffBudgetTransferNeedsCategory',
};

export function errorText(m: ErrorMessage | null): string {
  if (!m) return '';
  const head = tr(KEYS[m.key]);
  if (m.key !== 'splitProblems') return head;
  return (
    head +
    (m.children ?? [])
      .map((c) => tr('app.stateSplitProblemLine', { message: errorText(c) }))
      .join('')
  );
}
