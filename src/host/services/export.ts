// Export (03 §8 `export.*`; 16 §2, §2.4): the host reads the budget, builds the files with the shared
// formats and writes them into the chosen folder. Existing files are refused with `conflict` until the
// user agrees to overwrite them. Export works offline: it only reads.
import type { BudgetFormat } from '@shared/budget-format';
import { budgetFormatOf } from '@shared/budget-format';
import type { Account, Transaction } from '@shared/domain/types';
import {
  budgetCsv,
  monthsWithData,
  qifFile,
  registerCsv,
  safeFileName,
  type ExportContext,
} from '@shared/export/export-format';
import type { ExportRequest, ExportResult } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BudgetService } from './budget';
import type { BudgetFileService } from './budget-file';
import type { ReadService } from './read';

const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES']);

export class ExportService {
  constructor(
    private readonly read: ReadService,
    private readonly budget: BudgetService,
    private readonly budgetFile: BudgetFileService,
    /** Writes a file (tests). */
    private readonly write: (path: string, content: string) => Promise<void> = (p, c) =>
      writeFile(p, c, 'utf8'),
    private readonly exists: (path: string) => boolean = existsSync,
  ) {}

  private async context(): Promise<ExportContext> {
    const [accounts, groups, prefs] = await Promise.all([
      this.read.accounts(),
      this.read.categories(),
      this.budgetFile.synced(),
    ]);
    const format: BudgetFormat = budgetFormatOf(prefs);
    return { format, accounts, groups };
  }

  /** The transactions of the view, or of every account, as account blocks in sidebar order. */
  private async blocks(
    ctx: ExportContext,
    view: ExportRequest['view'],
  ): Promise<{ account: Account; transactions: Transaction[] }[]> {
    const all = await this.read.transactions(view?.accountId ?? 'all');
    const wanted = view?.ids ? new Set(view.ids) : null;
    const shown = wanted ? all.filter((t) => wanted.has(t.id)) : all;
    const ordered = [...ctx.accounts].sort((a, b) => a.sortIndex - b.sortIndex);
    return ordered.flatMap((account) => {
      const transactions = shown.filter((t) => t.accountId === account.id);
      return transactions.length > 0 ? [{ account, transactions }] : [];
    });
  }

  /** `export.data` (16 §2.1): the files of one Export choice. */
  async data(req: ExportRequest): Promise<ExportResult> {
    const ctx = await this.context();
    const base = safeFileName(req.budgetName);
    const files: { name: string; content: () => Promise<string> }[] = [];
    if (req.kind === 'csv')
      files.push({
        name: `${base} as of ${req.timestamp}-Register.csv`,
        content: async () => registerCsv(ctx, await this.blocks(ctx, req.view)),
      });
    if (req.kind === 'csv' || req.kind === 'budgetCsv')
      files.push({
        name: `${base} as of ${req.timestamp}-Budget.csv`,
        content: async () => budgetCsv(ctx, await this.budgetMonths()),
      });
    if (req.kind === 'qif') {
      const blocks = await this.blocks(ctx, req.view);
      if (req.view) {
        const name = safeFileName(req.view.name);
        const transactions = blocks.flatMap((b) => b.transactions);
        files.push({
          name: `${base}-${name} as of ${req.timestamp}.qif`,
          content: () => Promise.resolve(qifFile(ctx, transactions)),
        });
      } else
        for (const b of blocks)
          files.push({
            name: `${base}-${safeFileName(b.account.name)} as of ${req.timestamp}.qif`,
            content: () => Promise.resolve(qifFile(ctx, b.transactions)),
          });
    }
    const existing = files.filter((f) => this.exists(join(req.folder, f.name))).map((f) => f.name);
    if (existing.length > 0 && !req.overwrite)
      throw new RpcError('conflict', 'The export files exist already.', {
        code: 'files-exist',
        names: existing,
      });
    for (const f of files) await this.save(join(req.folder, f.name), await f.content());
    return { folder: req.folder, files: files.map((f) => f.name) };
  }

  /** Every budget month from the first to the last with data (16 §2.2). */
  private async budgetMonths() {
    const months = await this.budget.months();
    const views = [];
    for (const m of months) views.push(await this.budget.month(m));
    return monthsWithData(views);
  }

  /** `export.reportCsv` (16 §2.4): a report CSV the renderer built, written where the user chose. */
  async reportCsv(path: string, content: string): Promise<null> {
    if (!/\.csv$/i.test(path)) throw new RpcError('validation', 'A report exports as a .csv file.');
    await this.save(path, content);
    return null;
  }

  private async save(path: string, content: string): Promise<void> {
    try {
      await this.write(path, content);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      throw new RpcError('internal', e instanceof Error ? e.message : String(e), {
        code: typeof code === 'string' && LOCKED.has(code) ? 'file-locked' : 'write-failed',
      });
    }
  }
}
