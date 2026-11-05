// The reports service (03 §8 `reports.get`; 15 §7). One request is one read job: it reads the accounts,
// the category tree, the payees and every transaction side, normalizes them (split lines, inherited
// payees, transfers, Starting Balances) and returns the shared calculation's aggregate DTO. It never
// writes, so it needs no write gate and works offline from the API's local data.
import type { ISODate } from '@shared/domain/types';
import type { ReportInput, ReportSide } from '@shared/reporting/input';
import type { ReportRequest } from '@shared/reporting/model';
import { buildReport } from '@shared/reporting/reports';
import type { ReportResult } from '@shared/reporting/result';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';

export class ReportsService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
  ) {}

  get(request: ReportRequest): Promise<ReportResult> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(
      `reports.get:${request.kind}`,
      async () => buildReport(await this.input(), request),
      {
        kind: 'read',
      },
    );
  }

  /** Everything a calculation reads, in one job. */
  private async input(): Promise<ReportInput> {
    const [accounts, groups, payees, raw] = await Promise.all([
      this.actual.getAccounts(),
      this.actual.getCategoryGroups(),
      this.actual.getPayees(),
      this.actual.reportSides(),
    ]);
    const transferOf = new Map(payees.map((p) => [p.id, p.transferAcct]));
    const sides: ReportSide[] = raw.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      line: r.line,
      accountId: r.account,
      date: r.date as ISODate,
      amount: r.amount,
      payeeId: r.payee,
      categoryId: r.category,
      transferAccountId: r.payee ? (transferOf.get(r.payee) ?? null) : null,
      startingBalance: r.startingBalance,
    }));
    sides.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        offBudget: a.offbudget,
        closed: a.closed,
        sortIndex: a.sortOrder,
      })),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        isIncome: g.isIncome,
        categories: g.categories.map((c) => ({
          id: c.id,
          name: c.name,
          groupId: g.id,
          isIncome: c.isIncome,
        })),
      })),
      payees: payees.map((p) => ({ id: p.id, name: p.name, transferAccountId: p.transferAcct })),
      sides,
    };
  }
}
