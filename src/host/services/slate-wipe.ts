// Wipe the Slate Clean (03 §8 `slateWipe.*`; 18 §2): the backup zip first, then one gated write job that
// deletes the transactions (all, or those before the cutoff month), zeroes the budgeted amounts and holds,
// and adds Starting Balance transactions. With a cutoff, balances carry forward into the kept months.
// Carryover flags are never touched: setBudgetCarryover propagates to later months.
import { addDays, monthOf, prevMonth, today } from '@shared/dates';
import type { Id, ISODate, Month } from '@shared/domain/types';
import type { SlateWipeImpact, SlateWipeResult } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawTransaction } from '../actual';
import type { Connection } from '../connection';
import { toRpcError } from '../connection';
import { SLATE_WIPE_TIMEOUT_MS, type JobQueue } from '../queue';
import type { AccountsService } from './accounts';
import { writeBackup } from './budget-file';

/** Every table a slate wipe can write (03 §4.1). */
const TABLES = [
  'transactions',
  'accounts',
  'payees',
  'categories',
  'category_groups',
  'zero_budgets',
  'reflect_budgets',
  'notes',
];

/** Rows deleted per batch, with progress after each (18 §2 step 4). */
export const PROGRESS_EVERY = 200;
/** The `job:progress` label of the deletion step. */
export const DELETE_PROGRESS = 'slateWipe.delete';

export interface SlateWipeInput {
  cutoffMonth: Month | null;
  backupPath: string;
  texts: { startingBalancePayee: string };
}

/** The rows a slate wipe deletes: top-level rows (a split's lines go with it), before the cutoff. */
function erased(rows: readonly RawTransaction[], cutoffMonth: Month | null): RawTransaction[] {
  const cutoff = cutoffMonth === null ? null : `${cutoffMonth}-01`;
  return rows.filter((t) => t.parentId === null && (cutoff === null || t.date < cutoff));
}

/** Rows a top-level transaction accounts for: itself and each of its split lines, once each. */
const size = (t: RawTransaction): number => 1 + t.subtransactions.length;

export class SlateWipeService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly accounts: AccountsService,
  ) {}

  /** `slateWipe.impact` (18 §2): the confirm step's count and the cutoff combo's first month. */
  async impact(cutoffMonth: Month | null): Promise<SlateWipeImpact> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return await this.queue.run(
      'slateWipe.impact',
      async () => {
        const rows = await this.actual.getTransactions(null);
        const first = rows.reduce<string | null>(
          (min, t) => (min === null || t.date < min ? t.date : min),
          null,
        );
        return {
          transactions: erased(rows, cutoffMonth).reduce((n, t) => n + size(t), 0),
          firstMonth: first === null ? null : monthOf(first as ISODate),
        };
      },
      { kind: 'read' },
    );
  }

  /**
   * `slateWipe.run` (18 §2), one write job: the gate is checked once, at its start (03 §5.1). Main hears
   * when it starts and ends, so a host that dies meanwhile is reported after the reopen (03 §6.5). An
   * error says whether data was already deleted (`details.slateWipe.partial`).
   */
  async run(input: SlateWipeInput): Promise<SlateWipeResult> {
    const { transactions } = await this.impact(input.cutoffMonth);
    return await this.connection.write(
      'slateWipe.run',
      TABLES,
      async () => {
        this.connection.slateWipePhase('started', input.backupPath);
        let partial = false;
        try {
          // 1. The backup; nothing is erased when it fails.
          await writeBackup(input.backupPath, await this.actual.exportBudget());
          partial = true;
          const deleted = await this.reset(input);
          return { backupPath: input.backupPath, deleted };
        } catch (e) {
          const error = toRpcError(e);
          const details =
            typeof error.details === 'object' && error.details !== null ? error.details : {};
          throw new RpcError(error.code, error.message, {
            ...details,
            slateWipe: { partial, backupPath: input.backupPath },
          });
        } finally {
          this.connection.slateWipePhase('ended');
        }
      },
      { timeoutMs: SLATE_WIPE_TIMEOUT_MS, transactions },
    );
  }

  /** Steps 2–7, inside the job. Returns the number of rows deleted. */
  private async reset({ cutoffMonth, texts }: SlateWipeInput): Promise<number> {
    const lastErasedMonth = cutoffMonth === null ? null : prevMonth(cutoffMonth);
    const lastErasedDay =
      cutoffMonth === null ? today(new Date()) : addDays(`${cutoffMonth}-01`, -1);
    const accounts = await this.actual.getAccounts();
    const all = await this.actual.getTransactions(null);
    const rows = erased(all, cutoffMonth);
    const budgetMonths = await this.actual.getBudgetMonths();

    // 2. Each account's working balance through the last erased day (0 when erasing everything).
    const balances = new Map<Id, number>();
    if (cutoffMonth !== null)
      for (const t of rows) balances.set(t.account, (balances.get(t.account) ?? 0) + t.amount);

    // 3. With a cutoff: each expense category's balance in the last erased month.
    const carried = new Map<Id, number>();
    if (lastErasedMonth !== null && budgetMonths.includes(lastErasedMonth)) {
      const month = await this.actual.getBudgetMonth(lastErasedMonth);
      for (const group of month.categoryGroups) {
        if (group.is_income) continue;
        for (const c of group.categories ?? [])
          if (!c.is_income && c.balance) carried.set(c.id, c.balance);
      }
    }

    // 4. A transfer whose other side is kept would lose that side when this one is deleted, so the kept
    // side becomes an ordinary transaction first (Actual deletes the erased side when its payee stops
    // being a transfer).
    const byId = new Map(rows.map((t) => [t.id, t]));
    for (const t of all)
      if (t.parentId === null && t.transferId !== null && !byId.has(t.id) && byId.has(t.transferId))
        await this.actual.updateTransaction(t.id, { payee: null });

    // Delete, in batches of 200 with progress after each. A transfer's other side goes with it, so
    // its id is left out (the batch skips ids already gone).
    // The counts are rows, as in the confirm step: a transfer whose two sides are erased counts twice.
    const total = rows.reduce((n, t) => n + size(t), 0);
    const gone = new Set<Id>();
    const work: { id: Id; rows: number }[] = [];
    for (const t of rows) {
      if (gone.has(t.id)) continue;
      gone.add(t.id);
      const other = t.transferId === null ? undefined : byId.get(t.transferId);
      if (other) gone.add(other.id);
      work.push({ id: t.id, rows: size(t) + (other ? size(other) : 0) });
    }
    let deleted = 0;
    for (let i = 0; i < work.length; i += PROGRESS_EVERY) {
      const batch = work.slice(i, i + PROGRESS_EVERY);
      await this.actual.deleteTransactions(batch.map((w) => w.id));
      deleted += batch.reduce((n, w) => n + w.rows, 0);
      if (deleted < total) this.connection.progress(DELETE_PROGRESS, deleted, total);
    }

    // 5. Zero the budgeted amounts and reset the holds in the erased months.
    for (const m of budgetMonths) {
      if (cutoffMonth !== null && m >= cutoffMonth) continue;
      const month = await this.actual.getBudgetMonth(m);
      const budgeted = month.categoryGroups
        .flatMap((g) => g.categories ?? [])
        .filter((c) => c.budgeted);
      if (budgeted.length > 0)
        await this.actual.batchBudgetUpdates(async () => {
          for (const c of budgeted) await this.actual.setBudgetAmount(m, c.id, 0);
        });
      if (month.forNextMonth) await this.actual.resetBudgetHold(m);
    }

    // 6. A Starting Balance for each open account, dated the last erased day. A closed account gets one
    // only when the kept rows don't net to zero, so it still has no balance.
    for (const account of accounts) {
      const amount = balances.get(account.id) ?? 0;
      if (amount === 0 && (cutoffMonth === null || account.closed)) continue;
      await this.accounts.startingBalanceInJob(
        account,
        amount,
        lastErasedDay,
        texts.startingBalancePayee,
      );
    }

    // 7. With a cutoff: the remembered balances budgeted in the last erased month, so they carry forward.
    if (lastErasedMonth !== null && carried.size > 0 && budgetMonths.includes(lastErasedMonth))
      await this.actual.batchBudgetUpdates(async () => {
        for (const [id, balance] of carried)
          await this.actual.setBudgetAmount(lastErasedMonth, id, balance);
      });
    return deleted;
  }
}
