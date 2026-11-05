// Opening the Schedule dialog (12 §3.1, §4): a new schedule, an existing one, or a register transaction's
// draft (Make recurring… / Move to scheduler…). The form is built from the fetched payees, accounts and
// categories, so the dialog opens with every name in place. Resolves with the saved schedule's id, or
// null when it was cancelled.
import { categoryIndex, categoryLabel } from '@shared/domain/categories';
import type { Id, Schedule } from '@shared/domain/types';
import ScheduleDialog from '../components/register/ScheduleDialog.vue';
import { accountsQuery, categoriesQuery, payeesQuery } from '../queries/budget-data';
import { host } from '../rpc/host-client';
import { queryClient } from '../rpc/query-client';
import { useModals } from '../stores/modals';
import { attempt, tr } from './dialogs';
import { draftForm, newForm, scheduleForm, type FormContext } from './schedule-form';
import { todayDate } from './view-state';

export type ScheduleDialogTarget =
  /** A new schedule in `accountId`; `transfer` opens the payee list with `Transfer:` typed. */
  | { kind: 'new'; accountId: Id; transfer?: boolean }
  | { kind: 'edit'; schedule: Schedule; fallbackAccountId: Id }
  | { kind: 'fromTransaction'; transactionId: Id; mode: 'recurring' | 'move' };

async function formContext(): Promise<FormContext> {
  const [accounts, groups, payees] = await Promise.all([
    queryClient.query(accountsQuery),
    queryClient.query(categoriesQuery),
    queryClient.query(payeesQuery),
  ]);
  const categories = categoryIndex(groups);
  return {
    payees,
    accounts: new Map(accounts.map((a) => [a.id, a])),
    today: todayDate(),
    transfer: (account) => tr('app.transferPayee', { account }),
    categoryText: (id) => {
      const found = id ? categories.get(id) : undefined;
      return found ? categoryLabel(found.group, found.category) : '';
    },
  };
}

export async function openScheduleDialog(target: ScheduleDialogTarget): Promise<Id | null> {
  const ctx = await formContext();
  let form;
  let moveFrom: Id | null = null;
  if (target.kind === 'new') {
    form = newForm(target.accountId, ctx);
    if (target.transfer) form.tx.payeeText = tr('app.transferPrefix') + ' ';
  } else if (target.kind === 'edit') {
    form = scheduleForm(target.schedule, target.fallbackAccountId, ctx);
  } else {
    const r = await attempt(() =>
      host.call('schedules.draftFromTransaction', {
        id: target.transactionId,
        mode: target.mode,
      }),
    );
    if (!r.ok) return null;
    form = draftForm(r.value, ctx);
    if (target.mode === 'move') moveFrom = target.transactionId;
  }
  const result = await useModals().open<{ id: Id }>(ScheduleDialog, {
    form,
    transfer: target.kind === 'new' && target.transfer === true,
    moveFrom,
  });
  return result?.id ?? null;
}
