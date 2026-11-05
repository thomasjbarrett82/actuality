// Reconciliation (03 §8 `reconcile.*`; 13 §6). The hint's cleared balance through a date is a read job;
// Finish is one write job: the optional adjustment (Actual's: no payee, no category, Cleared), then every
// cleared, unreconciled transaction on or before the statement date becomes Reconciled, which also approves
// it, and the account's `last_reconciled` is set to now, as Actual web does.
import type { Id, ISODate, Money } from '@shared/domain/types';
import { decode, encode } from '@shared/metadata/notes-codec';
import type { ReconcileTexts } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';

const TABLES = ['accounts', 'transactions', 'notes', 'payees'];

export interface FinishInput {
  accountId: Id;
  statementDate: ISODate;
  /** The statement balance, signed as stored. */
  target: Money;
  createAdjustment: boolean;
  texts: ReconcileTexts;
}

export interface FinishResult {
  /** How many transactions became Reconciled. */
  reconciled: number;
  /** The adjustment transaction, when one was made. */
  adjustmentId: Id | null;
}

export class ReconcileService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    /** The current time, for `last_reconciled` (a seam for tests). */
    private readonly now: () => number = Date.now,
  ) {}

  private requireBudget(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  /**
   * `reconcile.clearedThrough` (13 §6.1): every reconciled transaction, whatever its date, and the cleared
   * ones dated on or before. The footer and Finish count the same, so "Use this amount" leaves no difference.
   */
  clearedThrough(accountId: Id, date: ISODate): Promise<Money> {
    this.requireBudget();
    return this.queue.run(
      'reconcile.clearedThrough',
      async () =>
        (await this.actual.getTransactions(accountId))
          .filter((t) => t.reconciled || (t.cleared && t.date <= date))
          .reduce((s, t) => s + t.amount, 0),
      { kind: 'read' },
    );
  }

  /** `reconcile.finish` (13 §6.3). A bulk job: its timeout grows with the transactions it touches. */
  async finish(input: FinishInput): Promise<FinishResult> {
    this.requireBudget();
    const touched = await this.queue.run(
      'reconcile.count',
      async () =>
        (await this.actual.getTransactions(input.accountId)).filter(
          (t) => t.cleared && !t.reconciled && t.date <= input.statementDate,
        ).length,
      { kind: 'read' },
    );
    return this.connection.write(
      'reconcile.finish',
      TABLES,
      async () => {
        const { accountId, statementDate } = input;
        if (!(await this.actual.getAccounts()).some((a) => a.id === accountId))
          throw new RpcError('not-found', 'That account no longer exists.');
        const rows = await this.actual.getTransactions(accountId);
        const reconciledBefore = rows.filter((t) => t.reconciled).reduce((s, t) => s + t.amount, 0);
        const list = rows.filter((t) => t.cleared && !t.reconciled && t.date <= statementDate);
        const clearedAbove = list.reduce((s, t) => s + t.amount, 0);
        const difference = reconciledBefore + clearedAbove - input.target;

        const ids = list.map((t) => t.id);
        let adjustmentId: Id | null = null;
        if (input.createAdjustment && difference !== 0) {
          // As Actual adds it, but dated the statement date so it falls inside the list (13 §6.3).
          // Actual's rules run on it, and nothing is restored afterwards (23 §5).
          adjustmentId = crypto.randomUUID();
          await this.actual.addTransaction(accountId, {
            id: adjustmentId,
            date: statementDate,
            amount: -difference,
            payee: null,
            category: null,
            notes: input.texts.adjustmentNotes,
            cleared: true,
            reconciled: false,
          });
          ids.push(adjustmentId);
        }

        let reconciled = 0;
        for (const id of ids) {
          // Read fresh: approving one side of a transfer rewrites the shared notes (X22).
          const [row] = await this.actual.getTransactionRows({ ids: [id] });
          if (!row) continue;
          if (!row.reconciled) {
            const meta = decode(row.notes);
            await this.actual.updateTransaction(id, {
              cleared: true,
              reconciled: true,
              ...(meta.needsReview ? { notes: encode({ ...meta, needsReview: false }) } : {}),
            });
          }
          reconciled++;
        }
        await this.actual.updateAccount(accountId, { lastReconciled: String(this.now()) });
        return { reconciled, adjustmentId };
      },
      { transactions: touched + 1 },
    );
  }
}
