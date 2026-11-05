// Opening the rule editor (23 §3): for a form, or pre-filled from a register transaction. A schedule's
// rule hands over to the Schedule dialog.
import type { Id, Transaction } from '@shared/domain/types';
import RuleEditorDialog from '../components/rules/RuleEditorDialog.vue';
import { accountsQuery } from '../queries/budget-data';
import { openScheduleDialog } from '../register/schedule-dialog';
import { host } from '../rpc/host-client';
import { queryClient } from '../rpc/query-client';
import { useModals } from '../stores/modals';
import { formFromTransaction, type RuleForm } from './form';

/** The rule editor (23 §3). Resolves with the saved rule's id, or null. */
export async function openRuleEditor(form: RuleForm): Promise<Id | null> {
  const result = await useModals().open<{ id: Id } | { scheduleId: Id }>(RuleEditorDialog, {
    form,
  });
  if (result && 'scheduleId' in result) {
    await editSchedule(result.scheduleId);
    return null;
  }
  return result?.id ?? null;
}

/** Create a new rule... from the register (23 §2.2). */
export function openRuleFromTransaction(t: Transaction): Promise<Id | null> {
  return openRuleEditor(formFromTransaction(t));
}

/** Edit Schedule from a schedule's rule (23 §3.3). */
async function editSchedule(scheduleId: Id): Promise<void> {
  const [schedules, accounts] = await Promise.all([
    host.call('schedules.list', { accountId: 'all' }),
    queryClient.query(accountsQuery),
  ]);
  const schedule = schedules.find((s) => s.id === scheduleId);
  const fallback = schedule?.accountId ?? accounts.find((a) => !a.closed)?.id;
  if (!schedule || !fallback) return;
  await openScheduleDialog({ kind: 'edit', schedule, fallbackAccountId: fallback });
}
