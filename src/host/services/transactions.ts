// Transaction writes (03 §8 `transactions.*`; 10 §6, §8; 11 §6–7). Each operation is one gated write job
// (03 §5): the commit pipeline's write, the bulk register actions, delete with an app-level undo, move to
// another account, Change Date, and merge. Reads for auto-fill and check numbers are read jobs.
//
// Actual keeps transfers in step itself except for dates, which the host copies to the other side,
// and for split lines: when a split, or one of its transfer lines, goes away, Actual only unlinks the
// line's mirror, so the host deletes it in the same job (04 §3).
import { autoCategoryOf } from '@shared/domain/payee-rules';
import { isBankGeneric } from '@shared/domain/payees';
import type { ClearedState, Id } from '@shared/domain/types';
import { decode, encode, type DecodedNotes } from '@shared/metadata/notes-codec';
import { RESERVED, reservedIds } from '@shared/metadata/reserved';
import type { CommitEdit, CommitResult, LastForPayee, UndoableResult } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type {
  ActualApi,
  RawAccount,
  RawPayee,
  RawRow,
  SubTransactionInput,
  TransactionPatch,
} from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';
import { addRestoring } from './restore';

const TABLES = ['transactions', 'payees', 'notes'];

/** How many undo records the host keeps; older tokens stop working. */
const UNDO_LIMIT = 20;

/** The written form of a cleared state (04 §3): R is always cleared and reconciled. */
export function clearedFields(state: ClearedState): { cleared: boolean; reconciled: boolean } {
  return { cleared: state !== 'U', reconciled: state === 'R' };
}

/** Everything needed to re-create a deleted transaction (10 §8). */
interface Snapshot {
  row: RawRow;
  lines: RawRow[];
  /** The other side of a transfer, or each transfer line's mirror (by line id). */
  counterpart: RawRow | null;
  mirrors: Map<Id, RawRow>;
}

/** A moved transaction as it was (10 §6.1). A move off-budget clears its and its lines' categories. */
interface MovedFrom {
  id: Id;
  account: Id;
  cleared: boolean;
  reconciled: boolean;
  category: Id | null;
  lines: { id: Id; category: Id | null }[];
}

/** A re-dated transaction as it was (10 §6.1, X25). Its lines follow it. */
interface DatedFrom {
  id: Id;
  date: string;
  cleared: boolean;
  reconciled: boolean;
}

type UndoRecord =
  | { kind: 'delete'; items: Snapshot[] }
  | { kind: 'move'; items: MovedFrom[] }
  | { kind: 'date'; items: DatedFrom[] };

function withoutId(line: SubTransactionInput): SubTransactionInput {
  const copy = { ...line };
  delete copy.id;
  return copy;
}

export class TransactionsService {
  private readonly undoRecords = new Map<string, UndoRecord>();

  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
  ) {}

  private write<T>(label: string, fn: () => Promise<T>, transactions = 0): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.connection.write(label, TABLES, fn, { transactions });
  }

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(label, fn, { kind: 'read' });
  }

  private remember(record: UndoRecord): string {
    const token = crypto.randomUUID();
    this.undoRecords.set(token, record);
    while (this.undoRecords.size > UNDO_LIMIT) {
      const oldest = this.undoRecords.keys().next().value;
      if (oldest === undefined) break;
      this.undoRecords.delete(oldest);
    }
    return token;
  }

  // ----------------------------------------------------------------------------------- commit

  /** `transactions.commit` (11 §6 step 6): validate, build Actual's payload, write, keep transfers in step. */
  commit(edit: CommitEdit): Promise<CommitResult> {
    return this.write('transactions.commit', async () => {
      const accounts = await this.actual.getAccounts();
      const payees = await this.actual.getPayees();
      const account = accounts.find((a) => a.id === edit.accountId);
      if (!account) throw new RpcError('not-found', 'That account no longer exists.');
      this.validate(edit, accounts);
      const payee = await this.resolvePayee(edit, payees, accounts);
      const isOnOn = (target: Id | null): boolean =>
        target !== null &&
        !account.offbudget &&
        accounts.find((a) => a.id === target)?.offbudget === false;
      const transferTarget = edit.payee.kind === 'transfer' ? edit.payee.accountId : null;
      const category =
        edit.lines !== undefined || isOnOn(transferTarget) || account.offbudget
          ? null
          : edit.categoryId;
      const notes = encode({
        notes: edit.notes.trim(),
        checkNumber: edit.checkNumber?.trim() ? edit.checkNumber.trim() : null,
        needsReview: edit.needsReview,
      });
      const lines = edit.lines?.map((l): SubTransactionInput => ({
        ...(l.id === undefined ? {} : { id: l.id }),
        amount: l.amount,
        payee: l.transferAccountId === null ? null : transferPayeeOf(payees, l.transferAccountId),
        category: isOnOn(l.transferAccountId) || account.offbudget ? null : l.categoryId,
        notes: encode({
          notes: l.notes.trim(),
          checkNumber: null,
          needsReview: false,
        }),
      }));
      const cleared = clearedFields(edit.cleared);
      let matched: CommitResult['matched'] = null;
      let id: Id;
      if (edit.id === undefined) {
        const created = await this.create(account, payee, category, notes, cleared, edit, lines);
        id = created.id;
        if (created.linkedSchedule) {
          const schedule = (await this.actual.getSchedules()).find(
            (s) => s.id === created.linkedSchedule,
          );
          matched = { scheduleId: created.linkedSchedule, payeeId: schedule?.payee ?? null };
        }
      } else {
        id = await this.update(edit.id, account, payee, category, notes, cleared, edit, lines);
      }
      if (payee.created && payee.id) await this.disableIfGeneric(payee.id, payees);
      return { id, matched };
    });
  }

  private validate(edit: CommitEdit, accounts: readonly RawAccount[]): void {
    const exists = (id: Id): boolean => accounts.some((a) => a.id === id);
    if (edit.payee.kind === 'transfer') {
      if (edit.lines)
        throw new RpcError('validation', 'A split transaction cannot be a transfer.', {
          code: 'split-transfer',
        });
      if (edit.payee.accountId === edit.accountId)
        throw new RpcError('validation', 'An account cannot transfer to itself.', {
          code: 'transfer-to-self',
        });
      if (!exists(edit.payee.accountId))
        throw new RpcError('validation', 'The transfer account does not exist.', {
          code: 'invalid-transfer',
        });
    }
    for (const l of edit.lines ?? []) {
      if (l.transferAccountId === edit.accountId)
        throw new RpcError('validation', 'An account cannot transfer to itself.', {
          code: 'transfer-to-self',
        });
      if (l.transferAccountId !== null && !exists(l.transferAccountId))
        throw new RpcError('validation', 'The transfer account does not exist.', {
          code: 'invalid-transfer',
        });
    }
    if (edit.lines && edit.lines.reduce((s, l) => s + l.amount, 0) !== edit.amount)
      throw new RpcError('validation', 'The split lines do not add up to the amount.', {
        code: 'split-unbalanced',
      });
  }

  /** The payee id to write: existing, a transfer payee, or a new one (created on update only). */
  private async resolvePayee(
    edit: CommitEdit,
    payees: readonly RawPayee[],
    accounts: readonly RawAccount[],
  ): Promise<{ id: Id | null; created: boolean }> {
    const p = edit.payee;
    switch (p.kind) {
      case 'none':
        return { id: null, created: false };
      case 'existing':
        if (!payees.some((x) => x.id === p.id))
          throw new RpcError('not-found', 'That payee no longer exists.');
        return { id: p.id, created: false };
      case 'transfer': {
        if (!accounts.some((a) => a.id === p.accountId))
          throw new RpcError('validation', 'The transfer account does not exist.');
        return { id: transferPayeeOf(payees, p.accountId), created: false };
      }
      case 'new': {
        const name = p.name.trim();
        // An existing name in any case is that payee (14 §1); its capitalization isn't changed.
        const found = payees.find(
          (x) => !x.transferAcct && x.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
        if (found) return { id: found.id, created: false };
        return { id: await this.actual.createPayee(name), created: true };
      }
    }
  }

  private async create(
    account: RawAccount,
    payee: { id: Id | null },
    category: Id | null,
    notes: string,
    cleared: { cleared: boolean; reconciled: boolean },
    edit: CommitEdit,
    lines: SubTransactionInput[] | undefined,
  ): Promise<{ id: Id; linkedSchedule: Id | null }> {
    const id = crypto.randomUUID();
    const { linkedSchedule } = await addRestoring(this.actual, account.id, {
      id,
      date: edit.date,
      amount: edit.amount,
      payee: payee.id,
      category,
      notes,
      ...cleared,
      ...(lines ? { subtransactions: lines } : {}),
    });
    return { id, linkedSchedule };
  }

  private async update(
    id: Id,
    account: RawAccount,
    payee: { id: Id | null },
    category: Id | null,
    notes: string,
    cleared: { cleared: boolean; reconciled: boolean },
    edit: CommitEdit,
    lines: SubTransactionInput[] | undefined,
  ): Promise<Id> {
    const [before] = await this.actual.getTransactionRows({ ids: [id] });
    if (!before) throw new RpcError('not-found', 'That transaction no longer exists.');
    if (before.isChild)
      throw new RpcError('validation', 'A split line is changed through its split.');
    const beforeLines = before.isParent
      ? await this.actual.getTransactionRows({ parentIds: [id] })
      : [];
    await this.checkSplitCreated(before, edit, payee.id, account.id);

    const kept = new Set(beforeLines.map((l) => l.id));
    const patch: TransactionPatch = {
      date: edit.date,
      amount: edit.amount,
      payee: payee.id,
      notes,
      ...cleared,
      ...(account.id === before.account ? {} : { account: account.id }),
      ...(lines
        ? {
            // A line id that isn't one of this split's lines is created afresh.
            subtransactions: lines.map((l) =>
              l.id === undefined || kept.has(l.id) ? l : withoutId(l),
            ),
          }
        : // A split that collapses into a normal transaction loses its lines (11 §7.3).
          { category, ...(before.isParent ? { subtransactions: [] } : {}) }),
    };
    await this.actual.updateTransaction(id, patch);

    // Mirrors of transfer lines that are gone were only unlinked (04 §3).
    const nowLines = lines ? new Set(lines.flatMap((l) => (l.id ? [l.id] : []))) : new Set<Id>();
    const orphaned = beforeLines.filter((l) => l.transferId && !nowLines.has(l.id));
    for (const l of orphaned) await this.deleteIfPresent(l.transferId);

    await this.copyDates(id, edit.date, before.date);
    if (edit.clearOtherSide) {
      const [row] = await this.actual.getTransactionRows({ ids: [id] });
      if (row?.transferId)
        await this.actual.updateTransaction(row.transferId, { cleared: true, reconciled: false });
    }
    return id;
  }

  /**
   * The transfer row a split elsewhere created can't change its amount, payee or account here (11 §2,
   * §4.1): Actual would rewrite the split's line to match.
   */
  private async checkSplitCreated(
    before: RawRow,
    edit: CommitEdit,
    payeeId: Id | null,
    accountId: Id,
  ): Promise<void> {
    if (!before.transferId) return;
    const [other] = await this.actual.getTransactionRows({ ids: [before.transferId] });
    if (!other?.isChild) return;
    if (
      edit.amount !== before.amount ||
      payeeId !== before.payee ||
      accountId !== before.account ||
      edit.lines
    )
      throw new RpcError('validation', 'This transfer is changed from its split.', {
        code: 'split-transfer-locked',
      });
  }

  /** Actual doesn't copy a transfer's date: write it to every other side. */
  private async copyDates(id: Id, date: string, beforeDate: string): Promise<void> {
    if (date === beforeDate) return;
    const [row] = await this.actual.getTransactionRows({ ids: [id] });
    if (!row) return;
    const lines = row.isParent ? await this.actual.getTransactionRows({ parentIds: [id] }) : [];
    const others = [row, ...lines].flatMap((r) => (r.transferId ? [r.transferId] : []));
    for (const other of await this.actual.getTransactionRows({ ids: others }))
      if (other.date !== date) await this.actual.updateTransaction(other.id, { date });
  }

  private async deleteIfPresent(id: Id | null): Promise<void> {
    if (!id) return;
    const [row] = await this.actual.getTransactionRows({ ids: [id] });
    if (row) await this.actual.deleteTransaction(id);
  }

  /** A new payee with a bank-generic name is created disabled (14 §1). */
  private async disableIfGeneric(payeeId: Id, before: readonly RawPayee[]): Promise<void> {
    if (before.some((p) => p.id === payeeId)) return;
    const payee = (await this.actual.getPayees()).find((p) => p.id === payeeId);
    if (!payee || !isBankGeneric(payee.name)) return;
    await this.metadata.modifyInJob(reservedIds.payees, RESERVED.payees, (m) => ({
      ...m,
      disabled: [...new Set([...m.disabled, payeeId])],
    }));
  }

  // ------------------------------------------------------------------------------ bulk actions

  /** Rewrites the notes metadata of each row; rows already in the wanted state are skipped. */
  private async rewriteNotes(
    ids: readonly Id[],
    change: (meta: DecodedNotes) => DecodedNotes,
    extra: (row: RawRow) => TransactionPatch | null = () => ({}),
  ): Promise<void> {
    for (const id of ids) {
      // Read each row fresh: a transfer's notes are shared, so an earlier write may have changed it.
      const [row] = await this.actual.getTransactionRows({ ids: [id] });
      if (!row || row.isChild) continue;
      const more = extra(row);
      if (more === null) continue;
      const meta = decode(row.notes);
      const next = encode(change(meta));
      const patch: TransactionPatch = { ...more };
      if (next !== encode(meta)) patch.notes = next;
      if (Object.keys(patch).length > 0) await this.actual.updateTransaction(id, patch);
    }
  }

  /** `transactions.setCleared` (10 §6.1, §6.4): Reconciled never changes; Cleared also approves. */
  setCleared(ids: readonly Id[], state: 'U' | 'C'): Promise<null> {
    return this.write(
      'transactions.setCleared',
      async () => {
        await this.rewriteNotes(
          ids,
          (m) => (state === 'C' ? { ...m, needsReview: false } : m),
          (row) => {
            if (row.reconciled) return null;
            return row.cleared === (state === 'C') ? {} : clearedFields(state);
          },
        );
        return null;
      },
      ids.length,
    );
  }

  /** `transactions.approve` (10 §6.1): removes the review tag (the other side of a transfer shares it). */
  approve(ids: readonly Id[]): Promise<null> {
    return this.write(
      'transactions.approve',
      async () => {
        await this.rewriteNotes(ids, (m) => ({ ...m, needsReview: false }));
        return null;
      },
      ids.length,
    );
  }

  /**
   * `transactions.categorize` (10 §6.1, §6.3). Splits are skipped (their lines can be given directly), and
   * so are off-budget rows and on↔on transfers, except to clear a category they shouldn't have.
   */
  categorize(ids: readonly Id[], categoryId: Id | null): Promise<null> {
    return this.write(
      'transactions.categorize',
      async () => {
        const accounts = new Map((await this.actual.getAccounts()).map((a) => [a.id, a]));
        const payees = await this.actual.getPayees();
        for (const row of await this.actual.getTransactionRows({ ids })) {
          if (row.isParent || row.category === categoryId) continue;
          const own = accounts.get(row.account);
          if (!own || (own.offbudget && categoryId !== null)) continue;
          const target = payees.find((p) => p.id === row.payee)?.transferAcct ?? null;
          const onOn =
            target !== null && !own.offbudget && accounts.get(target)?.offbudget === false;
          if (onOn && categoryId !== null) continue;
          await this.actual.updateTransaction(row.id, { category: categoryId });
        }
        return null;
      },
      ids.length,
    );
  }

  // ------------------------------------------------------------------------------ delete & undo

  /**
   * `transactions.delete` (10 §8). Transfer rows a split elsewhere created are skipped. Deleting a split
   * also deletes its transfer lines' mirrors. Returns an undo token.
   */
  delete(ids: readonly Id[]): Promise<UndoableResult> {
    return this.write(
      'transactions.delete',
      async () => {
        const rows = (await this.actual.getTransactionRows({ ids })).filter((r) => !r.isChild);
        const others = new Map(
          (
            await this.actual.getTransactionRows({
              ids: rows.flatMap((r) => (r.transferId ? [r.transferId] : [])),
            })
          ).map((r) => [r.id, r]),
        );
        const order = new Map(ids.map((id, i) => [id, i]));
        rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        const items: Snapshot[] = [];
        const covered = new Set<Id>();
        for (const row of rows) {
          if (covered.has(row.id)) continue;
          const counterpart = row.transferId ? (others.get(row.transferId) ?? null) : null;
          if (counterpart?.isChild) continue;
          const lines = row.isParent
            ? await this.actual.getTransactionRows({ parentIds: [row.id] })
            : [];
          const mirrors = new Map(
            (
              await this.actual.getTransactionRows({
                ids: lines.flatMap((l) => (l.transferId ? [l.transferId] : [])),
              })
            ).map((m) => [m.id, m]),
          );
          const byLine = new Map(
            lines.flatMap((l) => {
              const m = l.transferId ? mirrors.get(l.transferId) : undefined;
              return m ? [[l.id, m] as const] : [];
            }),
          );
          items.push({ row, lines, counterpart, mirrors: byLine });
          covered.add(row.id);
          if (counterpart) covered.add(counterpart.id);
        }
        for (const item of items) {
          await this.actual.deleteTransaction(item.row.id);
          // Actual unlinks a split line's mirror instead of deleting it (04 §3).
          for (const m of item.mirrors.values()) await this.deleteIfPresent(m.id);
        }
        return {
          token: items.length > 0 ? this.remember({ kind: 'delete', items }) : null,
          count: items.length,
        };
      },
      ids.length * 2,
    );
  }

  /** `transactions.undo` (10 §8): re-creates deleted transactions with new ids, or moves them back. */
  undo(token: string): Promise<{ ids: Record<Id, Id> }> {
    const known = this.undoRecords.get(token);
    const touched = !known
      ? 0
      : known.kind === 'delete'
        ? known.items.length * 3
        : known.kind === 'date'
          ? known.items.length
          : known.items.reduce((n, m) => n + 1 + m.lines.length, 0);
    return this.write(
      'transactions.undo',
      async () => {
        // Looked up behind the gate, so an offline undo is refused as offline and keeps its token.
        const record = this.undoRecords.get(token);
        if (!record) throw new RpcError('not-found', 'That change can no longer be undone.');
        this.undoRecords.delete(token);
        if (record.kind === 'move') {
          for (const m of record.items) await this.moveBack(m);
          return { ids: Object.fromEntries(record.items.map((m) => [m.id, m.id])) };
        }
        if (record.kind === 'date') {
          await this.redate(record.items);
          return { ids: Object.fromEntries(record.items.map((d) => [d.id, d.id])) };
        }
        const ids: Record<Id, Id> = {};
        for (const item of record.items) ids[item.row.id] = await this.recreate(item);
        return { ids };
      },
      touched,
    );
  }

  private async recreate(item: Snapshot): Promise<Id> {
    const { row, lines, counterpart, mirrors } = item;
    const id = crypto.randomUUID();
    await addRestoring(this.actual, row.account, {
      id,
      date: row.date,
      amount: row.amount,
      payee: row.payee,
      category: row.isParent ? null : row.category,
      notes: row.notes ?? '',
      cleared: row.cleared,
      reconciled: row.reconciled,
      importedId: row.importedId,
      importedPayee: row.importedPayee,
      ...(row.isParent
        ? {
            subtransactions: lines.map((l) => ({
              amount: l.amount,
              payee: l.payee,
              category: l.category,
              notes: l.notes ?? '',
            })),
          }
        : {}),
    });
    // Actual creates new mirrors; give them back their own date and cleared state.
    const [created] = await this.actual.getTransactionRows({ ids: [id] });
    if (counterpart && created?.transferId) await this.restoreSide(created.transferId, counterpart);
    if (mirrors.size > 0) {
      const newLines = await this.actual.getTransactionRows({ parentIds: [id] });
      const unused = [...newLines];
      for (const old of lines) {
        const snap = mirrors.get(old.id);
        const at = unused.findIndex(
          (l) =>
            l.amount === old.amount &&
            l.payee === old.payee &&
            (l.notes ?? '') === (old.notes ?? ''),
        );
        const [match] = at === -1 ? [] : unused.splice(at, 1);
        if (snap && match?.transferId) await this.restoreSide(match.transferId, snap);
      }
    }
    return id;
  }

  /** A new mirror takes the snapshot's date, cleared state and category, none of which Actual copies. */
  private async restoreSide(id: Id, snap: RawRow): Promise<void> {
    const [now] = await this.actual.getTransactionRows({ ids: [id] });
    if (!now) return;
    const patch: TransactionPatch = {};
    if (now.date !== snap.date) patch.date = snap.date;
    if (now.cleared !== snap.cleared) patch.cleared = snap.cleared;
    if (now.reconciled !== snap.reconciled) patch.reconciled = snap.reconciled;
    // The on-budget side of an on↔off transfer has a category of its own.
    if (now.category !== snap.category) patch.category = snap.category;
    if (Object.keys(patch).length > 0) await this.actual.updateTransaction(id, patch);
  }

  /** Undoes one move: its account and cleared state, and the categories a move off-budget cleared. */
  private async moveBack(m: MovedFrom): Promise<void> {
    await this.actual.updateTransaction(m.id, {
      account: m.account,
      cleared: m.cleared,
      reconciled: m.reconciled,
      ...(m.category === null ? {} : { category: m.category }),
    });
    if (m.lines.length === 0) return;
    const now = new Map(
      (await this.actual.getTransactionRows({ parentIds: [m.id] })).map((l) => [l.id, l]),
    );
    for (const l of m.lines) {
      const line = now.get(l.id);
      if (line && line.category !== l.category)
        await this.actual.updateTransaction(l.id, { category: l.category });
    }
  }

  // ------------------------------------------------------------------------------- move & merge

  /**
   * `transactions.moveToAccount` (10 §6.1). Refused when any is (or contains) a transfer into the target.
   * Reconciled ones become Cleared. Returns an undo token that restores account and cleared state.
   */
  moveToAccount(ids: readonly Id[], accountId: Id): Promise<UndoableResult> {
    return this.write(
      'transactions.moveToAccount',
      async () => {
        const target = (await this.actual.getAccounts()).find((a) => a.id === accountId);
        if (!target || target.closed)
          throw new RpcError('not-found', 'That account no longer exists.');
        const payees = await this.actual.getPayees();
        const targetPayee = transferPayeeOf(payees, accountId);
        const rows = (await this.actual.getTransactionRows({ ids })).filter(
          (r) => !r.isChild && r.account !== accountId,
        );
        const lines = await this.actual.getTransactionRows({
          parentIds: rows.filter((r) => r.isParent).map((r) => r.id),
        });
        if ([...rows, ...lines].some((r) => r.payee === targetPayee))
          throw new RpcError('validation', 'A transfer cannot be moved into its own account.', {
            code: 'transfer-into-target',
          });
        // A transfer a split elsewhere created moves from its split: Actual would retarget the split's
        // line to the new account (10 §6.1).
        const others = await this.actual.getTransactionRows({
          ids: rows.flatMap((r) => (r.transferId ? [r.transferId] : [])),
        });
        if (others.some((o) => o.isChild))
          throw new RpcError('validation', 'This transfer is changed from its split.', {
            code: 'split-transfer-locked',
          });
        const items = rows.map((r): MovedFrom => ({
          id: r.id,
          account: r.account,
          cleared: r.cleared,
          reconciled: r.reconciled,
          category: r.category,
          lines: lines
            .filter((l) => l.parentId === r.id)
            .map((l) => ({ id: l.id, category: l.category })),
        }));
        for (const r of rows)
          await this.actual.updateTransaction(r.id, {
            account: accountId,
            ...(r.reconciled ? { cleared: true, reconciled: false } : {}),
          });
        return {
          token: items.length > 0 ? this.remember({ kind: 'move', items }) : null,
          count: items.length,
        };
      },
      ids.length,
    );
  }

  /**
   * `transactions.setDate` (10 §6.1, X25): one date on every transaction, and nothing else. A split line
   * counts as its parent, whose lines take its date. As in the editor, the other side of a transfer (or of a
   * split's transfer line) takes the date too, since Actual doesn't copy it. The reconciled
   * transactions and other sides in `clearReconciled` become Cleared, as after the editor's question
   * (11 §6 step 2).
   * All or nothing: after a failure the ones already changed get their old date and state back.
   */
  setDate(
    ids: readonly Id[],
    date: string,
    clearReconciled: readonly Id[] = [],
  ): Promise<UndoableResult> {
    return this.write(
      'transactions.setDate',
      async () => {
        const found = await this.actual.getTransactionRows({ ids });
        const parentIds = new Set(
          found.map((r) => (r.isChild ? r.parentId : r.id)).filter((x): x is Id => x !== null),
        );
        const rows = await this.actual.getTransactionRows({ ids: [...parentIds] });
        const lines = await this.actual.getTransactionRows({
          parentIds: rows.filter((r) => r.isParent).map((r) => r.id),
        });
        const others = await this.actual.getTransactionRows({
          ids: [...rows, ...lines].flatMap((r) => (r.transferId ? [r.transferId] : [])),
        });
        const toClear = new Set(
          [...rows, ...others]
            .filter((r) => r.reconciled && clearReconciled.includes(r.id))
            .map((r) => r.id),
        );
        // Both sides selected: each is written once.
        const items = [
          ...new Map(
            [...rows, ...others].map((r): [Id, DatedFrom] => [
              r.id,
              { id: r.id, date: r.date, cleared: r.cleared, reconciled: r.reconciled },
            ]),
          ).values(),
        ];
        const done: DatedFrom[] = [];
        try {
          for (const item of items) {
            const patch: TransactionPatch = {
              ...(item.date === date ? {} : { date }),
              ...(toClear.has(item.id) ? { cleared: true, reconciled: false } : {}),
            };
            if (Object.keys(patch).length > 0) await this.actual.updateTransaction(item.id, patch);
            done.push(item);
          }
        } catch (e) {
          const restored = await this.redate(done).then(
            () => true,
            () => false,
          );
          if (restored) throw e;
          // The rollback failed too: the user must know some transactions kept the new date (10 §6.1).
          throw new RpcError('actual', e instanceof Error ? e.message : String(e), {
            code: 'partial-change',
          });
        }
        return {
          token: items.length > 0 ? this.remember({ kind: 'date', items }) : null,
          count: rows.length,
        };
      },
      ids.length * 2,
    );
  }

  /** Puts each transaction back on its own date and cleared state (Change Date's undo and rollback). */
  private async redate(items: readonly DatedFrom[]): Promise<void> {
    const now = new Map(
      (await this.actual.getTransactionRows({ ids: items.map((d) => d.id) })).map((r) => [r.id, r]),
    );
    for (const d of items) {
      const row = now.get(d.id);
      if (!row) continue;
      const patch: TransactionPatch = {
        ...(row.date === d.date ? {} : { date: d.date }),
        ...(row.cleared === d.cleared && row.reconciled === d.reconciled
          ? {}
          : { cleared: d.cleared, reconciled: d.reconciled }),
      };
      if (Object.keys(patch).length > 0) await this.actual.updateTransaction(d.id, patch);
    }
  }

  /** `transactions.merge` (10 §6.1, X4): Actual keeps one; it gets the review tag. */
  merge(a: Id, b: Id): Promise<{ id: Id }> {
    return this.write('transactions.merge', async () => {
      let kept: Id;
      try {
        kept = await this.actual.mergeTransactions(a, b);
      } catch (e) {
        throw new RpcError('actual', e instanceof Error ? e.message : String(e), {
          code: 'merge-failed',
        });
      }
      const [row] = await this.actual.getTransactionRows({ ids: [kept] });
      if (row) {
        const meta = decode(row.notes);
        if (!meta.needsReview)
          await this.actual.updateTransaction(kept, {
            notes: encode({ ...meta, needsReview: true }),
          });
      }
      return { id: kept };
    });
  }

  // ------------------------------------------------------------------------------------- reads

  /** `transactions.lastForPayee` (11 §4.3): the last non-split use of a payee, and its auto-category rule. */
  lastForPayee(payeeId: Id): Promise<LastForPayee> {
    return this.read('transactions.lastForPayee', async () => {
      const [row, rules] = await Promise.all([
        this.actual.lastTransactionForPayee(payeeId),
        this.actual.getRules(),
      ]);
      const rule = rules.map(autoCategoryOf).find((r) => r?.payeeId === payeeId);
      return {
        last: row
          ? { categoryId: row.category, notes: decode(row.notes).notes, amount: row.amount }
          : null,
        ruleCategoryId: rule?.categoryId ?? null,
      };
    });
  }

  /**
   * `transactions.nextCheckNumber` (11 §2): the most recent positive numeric check number in the account,
   * plus one; null when there's none.
   */
  nextCheckNumber(accountId: Id): Promise<string | null> {
    return this.read('transactions.nextCheckNumber', async () => {
      const rows = await this.actual.getTransactions(accountId);
      const dated = rows
        .map((r) => ({ date: r.date, order: r.sortOrder, check: decode(r.notes).checkNumber }))
        .filter((r) => r.check !== null && /^\d+$/.test(r.check) && Number(r.check) > 0)
        .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.order - x.order));
      const [last] = dated;
      return last?.check ? String(BigInt(last.check) + 1n) : null;
    });
  }
}

/** The transfer payee Actual keeps for an account (14 §1). */
export function transferPayeeOf(payees: readonly RawPayee[], accountId: Id): Id {
  const found = payees.find((p) => p.transferAcct === accountId);
  if (!found) throw new RpcError('not-found', 'That account has no transfer payee.');
  return found.id;
}
