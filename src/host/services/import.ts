// Bank-file import (03 §8 `import.*`; 16 §1). `import.parse` reads and parses the file, and keeps it for
// the run under a token, with each account's remembered mapping (`ad:import-mappings`) and the target
// accounts' start dates. `import.run` imports each mapped account in its own write job (16 §1.5): build
// Actual's transactions, `importTransactions`, tag the rows Actual matched for review, restore what a
// schedule's rule changed on added rows, and adjust the starting balance when earlier rows were included.
import { step } from '@shared/aspects/steps';
import { transferAccountName } from '@shared/domain/payees';
import type { Id, ISODate } from '@shared/domain/types';
import {
  dateOf,
  findCategory,
  importIds,
  type ParsedFile,
  type ParsedTransaction,
} from '@shared/import/import-rules';
import { decode, encode } from '@shared/metadata/notes-codec';
import {
  mappingField,
  RESERVED,
  reservedIds,
  usableMappings,
  type ImportMappings,
  type PayeesMeta,
} from '@shared/metadata/reserved';
import type {
  ImportAccountResult,
  ImportParse,
  ImportRunAccount,
  ImportTexts,
} from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ActualApi, ImportInput, RawAccount, RawCategoryGroup, RawPayee } from '../actual';
import type { Connection } from '../connection';
import { CsvFormatError, formatOf, parseBankFile } from '../parsers';
import { IMPORT_JOB_TIMEOUT_MS, type JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';
import { importedRowPatch } from './restore';

const TABLES = ['transactions', 'payees', 'notes'];
/** Parsed files kept for their run; the oldest go first. */
const KEEP = 4;

export class ImportService {
  private readonly files = new Map<string, { name: string; file: ParsedFile }>();

  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
    /** Reads a file (tests). */
    private readonly read: (path: string) => Promise<Uint8Array> = async (p) =>
      new Uint8Array(await readFile(p)),
  ) {}

  private requireBudget(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  /** `import.parse` (16 §1.3): file errors come back with `details.code` for the dialogs. */
  async parse(path: string): Promise<ImportParse> {
    this.requireBudget();
    const name = basename(path);
    const format = formatOf(name);
    if (!format)
      throw new RpcError('validation', 'Not a bank file.', { code: 'unsupported-file', name });
    let bytes: Uint8Array;
    try {
      bytes = await this.read(path);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code === 'ENOENT')
        throw new RpcError('not-found', name, { code: 'file-not-found', name });
      throw new RpcError('internal', e instanceof Error ? e.message : String(e), {
        code: 'read-failed',
      });
    }
    let file: ParsedFile;
    try {
      file = parseBankFile(bytes, format);
    } catch (e) {
      if (e instanceof CsvFormatError)
        throw new RpcError('validation', e.message, { code: 'csv-format' });
      throw new RpcError('internal', e instanceof Error ? e.message : String(e), {
        code: 'parse-failed',
      });
    }
    const token = crypto.randomUUID();
    this.files.set(token, { name, file });
    while (this.files.size > KEEP) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) break;
      this.files.delete(oldest);
    }
    return this.queue.run(
      'import.parse',
      async () => {
        const mappings = await this.metadata.read<ImportMappings>(
          reservedIds.importMappings,
          RESERVED.importMappings,
        );
        const accounts = await this.actual.getAccounts();
        const startDates: Record<Id, ISODate | null> = {};
        for (const a of accounts.filter((x) => !x.closed))
          startDates[a.id] = await this.startDate(a.id);
        return {
          token,
          fileName: name,
          format: file.format,
          accounts: file.accounts,
          emptyAccounts: file.emptyAccounts,
          ...(file.unreadable ? { unreadable: file.unreadable } : {}),
          mappings: Object.fromEntries(
            usableMappings(mappings).map((m) => [
              m.key,
              {
                accountId: m.accountId,
                importNotes: m.importNotes,
                swapPayeeNotes: m.swapPayeeNotes,
                ...(m.dateOrder ? { dateOrder: m.dateOrder } : {}),
              },
            ]),
          ),
          startDates,
        };
      },
      { kind: 'read' },
    );
  }

  /** An account's start date (16 §1.4): its starting balance's date, or its earliest transaction's. */
  private async startDate(accountId: Id): Promise<ISODate | null> {
    const rows = await this.actual.getTransactions(accountId);
    const start = rows.find((r) => r.startingBalance);
    if (start) return start.date as ISODate;
    const dates = rows.map((r) => r.date).sort();
    return (dates[0] as ISODate | undefined) ?? null;
  }

  /** `import.run` (16 §1.4–1.5): the mappings are saved, then each mapped account is imported. */
  async run(
    token: string,
    runs: readonly ImportRunAccount[],
    texts: ImportTexts,
  ): Promise<ImportAccountResult[]> {
    this.requireBudget();
    // Looked up behind the gate, so an offline run is refused as offline.
    const file = await this.connection.write('import.mappings', ['notes'], async () => {
      const kept = this.files.get(token);
      if (!kept) throw new RpcError('not-found', 'The file must be read again.');
      await this.saveMappings(kept.file, runs);
      return kept.file;
    });
    const results: ImportAccountResult[] = [];
    for (const r of runs) {
      const account = file.accounts[r.index];
      if (!account) continue;
      if (r.accountId === null) {
        results.push({
          index: r.index,
          accountId: null,
          status: 'skipped',
          added: 0,
          updated: 0,
          ignored: 0,
          startAdjusted: false,
        });
        continue;
      }
      const accountId = r.accountId;
      try {
        results.push(
          await step('import an account', () =>
            this.connection.write(
              'import.run',
              TABLES,
              () => this.importAccount(account.transactions, { ...r, accountId }, texts),
              { timeoutMs: IMPORT_JOB_TIMEOUT_MS, transactions: account.transactions.length },
            ),
          ),
        );
      } catch (e) {
        if (e instanceof RpcError && e.code === 'offline') throw e;
        results.push({
          index: r.index,
          accountId,
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
          added: 0,
          updated: 0,
          ignored: 0,
          startAdjusted: false,
        });
      }
    }
    this.files.delete(token);
    return results;
  }

  /** Remembers each keyed account's choices (16 §1.4). Inside a write job. */
  private async saveMappings(file: ParsedFile, runs: readonly ImportRunAccount[]): Promise<void> {
    const keyed = runs.flatMap((r) => {
      const key = file.accounts[r.index]?.key;
      return key ? [{ key, r }] : [];
    });
    if (keyed.length === 0) return;
    await this.metadata.modifyInJob<ImportMappings>(
      reservedIds.importMappings,
      RESERVED.importMappings,
      (m) => {
        const others = m.mappings.filter(
          (x) => !keyed.some((k) => k.key === mappingField(x, 'key')),
        );
        const usable = usableMappings(m);
        return {
          ...m,
          mappings: [
            ...others,
            ...keyed.map(({ key, r }) => ({
              ...(usable.find((x) => x.key === key) ?? {}),
              key,
              accountId: r.accountId,
              importNotes: r.importNotes,
              swapPayeeNotes: r.swapPayeeNotes,
              ...(file.format === 'qif' && r.dateOrder ? { dateOrder: r.dateOrder } : {}),
            })),
          ],
        };
      },
    );
  }

  /** One target account, inside its write job (16 §1.5). */
  private async importAccount(
    txns: readonly ParsedTransaction[],
    r: ImportRunAccount & { accountId: Id },
    texts: ImportTexts,
  ): Promise<ImportAccountResult> {
    const [accounts, payees, groups, payeesMeta] = await Promise.all([
      this.actual.getAccounts(),
      this.actual.getPayees(),
      this.actual.getCategoryGroups(),
      this.metadata.read<PayeesMeta>(reservedIds.payees, RESERVED.payees),
    ]);
    const target = accounts.find((a) => a.id === r.accountId);
    if (!target || target.closed) throw new RpcError('not-found', 'That account no longer exists.');
    const start = await this.startDate(target.id);
    const dated = txns.flatMap((t) => {
      const date = dateOf(t, r.dateOrder);
      return date ? [{ t, date }] : [];
    });
    const included =
      r.includeBeforeStart || start === null ? dated : dated.filter((d) => d.date >= start);
    const ids = importIds(
      included.map(({ t, date }) => ({ fitId: t.fitId, amount: t.amount, date, payee: t.payee })),
    );
    const disabled = new Set(
      payees
        .filter((p) => payeesMeta.disabled.includes(p.id))
        .map((p) => p.name.toLocaleLowerCase()),
    );
    const inputs = included.map(({ t, date }, i) =>
      this.toInput(t, date, ids[i] ?? '', r, target, accounts, payees, groups, disabled, texts),
    );

    const result = await this.actual.importTransactions(target.id, inputs);
    if (result.errors.length > 0) throw new RpcError('actual', result.errors.join('\n'));

    // Rows Actual matched to existing transactions are reviewed, as in the classic workflow (16 §1.5 step 3).
    for (const id of result.updated) {
      const [row] = await this.actual.getTransactionRows({ ids: [id] });
      if (!row) continue;
      const meta = decode(row.notes);
      if (!meta.needsReview)
        await this.actual.updateTransaction(id, { notes: encode({ ...meta, needsReview: true }) });
    }
    // What the rules changed on added rows comes back: the check number and review tag, and on rows a
    // schedule's rule linked, the imported notes (12 §2).
    const byImportId = new Map(inputs.map((x) => [x.importedId, x]));
    // Actual lists a split's lines among the added ids: count transactions, not rows.
    const addedRows = (await this.actual.getTransactionRows({ ids: result.added })).filter(
      (row) => !row.isChild,
    );
    for (const row of addedRows) {
      const input = row.importedId ? byImportId.get(row.importedId) : undefined;
      if (!input) continue;
      const patch = importedRowPatch(input, row);
      if (Object.keys(patch).length > 0) await this.actual.updateTransaction(row.id, patch);
    }

    // The starting balance offsets earlier rows that were added (16 §1.4). Rows Actual matched to
    // existing transactions are already in the balance, so importing the file again changes nothing.
    let startAdjusted = false;
    const early = start === null ? [] : addedRows.filter((row) => row.date < start);
    if (r.includeBeforeStart && early.length > 0) {
      const starting = (await this.actual.getTransactions(target.id)).find(
        (x) => x.startingBalance,
      );
      if (starting) {
        const sum = early.reduce((s, row) => s + row.amount, 0);
        await this.actual.updateTransaction(starting.id, { amount: starting.amount - sum });
        startAdjusted = true;
      }
    }
    return {
      index: r.index,
      accountId: target.id,
      status: 'imported',
      added: addedRows.length,
      updated: result.updated.length,
      ignored: Math.max(0, inputs.length - addedRows.length - result.updated.length),
      startAdjusted,
    };
  }

  private toInput(
    t: ParsedTransaction,
    date: ISODate,
    importedId: string,
    r: ImportRunAccount,
    target: RawAccount,
    accounts: readonly RawAccount[],
    payees: readonly RawPayee[],
    groups: readonly RawCategoryGroup[],
    disabled: ReadonlySet<string>,
    texts: ImportTexts,
  ): ImportInput {
    let payeeText = r.swapPayeeNotes ? t.notes : t.payee;
    let notes = r.importNotes || r.swapPayeeNotes ? (r.swapPayeeNotes ? t.payee : t.notes) : '';
    let transferPayee: Id | undefined;
    // "Transfer : X": a transfer to another existing account, else the plain payee "Transfer (X)".
    const named = transferAccountName(payeeText, texts.transferPrefixes);
    if (named !== null) {
      const other = accounts.find(
        (a) => a.name.toLocaleLowerCase() === named.toLocaleLowerCase() && a.id !== target.id,
      );
      const payee = other ? payees.find((p) => p.transferAcct === other.id) : undefined;
      if (payee) transferPayee = payee.id;
      else payeeText = texts.plainTransfer.replace('{account}', named);
    }
    let category: Id | null = null;
    if (t.category && !target.offbudget) {
      category = findCategory(t.category, groups);
      if (category === null) notes = notes ? `${t.category} - ${notes}` : t.category;
    }
    const splitsTotal = t.splits.reduce((s, l) => s + l.amount, 0);
    const splits =
      t.splits.length > 0 && splitsTotal === t.amount
        ? t.splits.map((l) => ({
            amount: l.amount,
            category: l.category && !target.offbudget ? findCategory(l.category, groups) : null,
            notes: l.notes,
          }))
        : undefined;
    const imported = payeeText.trim();
    return {
      date,
      amount: t.amount,
      ...(transferPayee
        ? { payee: transferPayee }
        : disabled.has(imported.toLocaleLowerCase()) || imported === ''
          ? {}
          : { payeeName: imported }),
      importedPayee: imported,
      importedId,
      notes: encode({
        notes: notes.trim(),
        checkNumber: t.checkNumber,
        needsReview: true,
      }),
      category: splits ? null : category,
      ...(splits ? { subtransactions: splits } : {}),
    };
  }
}
