// Read services (03 §8; 04 §2, §6–8): accounts with balances and attention, the category tree, payees
// with usage and rules, and the register's transactions with derived states. Each call is one read job.
import { today } from '@shared/dates';
import { balancesOf } from '@shared/domain/balances';
import { autoCategoryOf, renameRuleOf } from '@shared/domain/payee-rules';
import type { Account, CategoryGroup, ISODate, Payee, Transaction } from '@shared/domain/types';
import { decode } from '@shared/metadata/notes-codec';
import type { CalloutTransaction } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawRow, RawTransaction } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import { attentionOf, contextOf, counterpartIds, toTransaction } from './convert';
import type { MetadataRepository } from './metadata';

/** Actual web's note id for an account. */
export const accountNoteId = (accountId: string): string => `account-${accountId}`;

const textOrNull = (note: string | null | undefined): string | null =>
  note === null || note === undefined || note === '' ? null : note;

/**
 * Actual's `last_reconciled` (ms since the epoch, as a string) as the local calendar date (04 §3). Empty
 * or unparsable: never reconciled.
 */
export function reconciledDate(raw: string | null | undefined): ISODate | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : today(date);
}

export class ReadService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
  ) {}

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(label, fn, { kind: 'read' });
  }

  private async loadTransactions(accountId: string | null): Promise<Transaction[]> {
    return this.convert(await this.actual.getTransactions(accountId));
  }

  /** Register rows → domain transactions, with the transfer sides they point to. */
  private async convert(raws: readonly RawTransaction[]): Promise<Transaction[]> {
    const [accounts, payees, sides] = await Promise.all([
      this.actual.getAccounts(),
      this.actual.getPayees(),
      this.actual.getTransactionRows({ ids: counterpartIds(raws) }),
    ]);
    const ctx = contextOf(accounts, payees, sides);
    return raws.map((r) => toTransaction(ctx, r));
  }

  /**
   * `transactions.get`: one transaction (a split line's id gives its split), or null. Only that
   * transaction is read: conversion is per transaction, so it equals its `transactions.list` entry.
   */
  transaction(id: string): Promise<Transaction | null> {
    return this.read('transactions.get', async () => {
      const [row] = await this.actual.getTransactionRows({ ids: [id] });
      if (!row) return null;
      const raw = await this.actual.getTransaction(row.parentId ?? row.id);
      if (!raw) return null;
      const [transaction] = await this.convert([raw]);
      return transaction ?? null;
    });
  }

  /** `transactions.list` (04 §6): one account or all, splits grouped under their parents. */
  /** `accountId` is an account id, or 'all'. */
  transactions(accountId: string): Promise<Transaction[]> {
    return this.read('transactions.list', () =>
      this.loadTransactions(accountId === 'all' ? null : accountId),
    );
  }

  /**
   * `transactions.forCategoryMonth` (09 §6.6): a category's or a group's on-budget rows in a month (split
   * lines, not parents), 'uncategorized', or 'all' expense categories. Newest first.
   */
  forCategoryMonth(target: string, month: string): Promise<CalloutTransaction[]> {
    return this.read('transactions.forCategoryMonth', async () => {
      if (target === 'uncategorized')
        return this.calloutRows(await this.actual.monthRows(month, 'uncategorized'));
      const groups = await this.actual.getCategoryGroups();
      const group = groups.find((g) => g.id === target);
      const categoryIds =
        target === 'all'
          ? groups.filter((g) => !g.isIncome).flatMap((g) => g.categories.map((c) => c.id))
          : group
            ? group.categories.map((c) => c.id)
            : [target];
      return this.calloutRows(await this.actual.monthRows(month, { categoryIds }));
    });
  }

  /** `transactions.incomeForMonth` (09 §5.1): the month's income-category rows. */
  incomeForMonth(month: string): Promise<CalloutTransaction[]> {
    return this.read('transactions.incomeForMonth', async () => {
      const groups = await this.actual.getCategoryGroups();
      const categoryIds = groups
        .filter((g) => g.isIncome)
        .flatMap((g) => g.categories.map((c) => c.id));
      return this.calloutRows(await this.actual.monthRows(month, { categoryIds }));
    });
  }

  /**
   * Rows → callout rows: account and payee names, a split line's parent payee and notes. Inside a job.
   */
  async calloutRows(rows: readonly RawRow[]): Promise<CalloutTransaction[]> {
    const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))];
    const [accounts, payees, parents] = await Promise.all([
      this.actual.getAccounts(),
      this.actual.getPayees(),
      this.actual.getTransactionRows({ ids: parentIds }),
    ]);
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const payeeById = new Map(payees.map((p) => [p.id, p]));
    const parentById = new Map(parents.map((p) => [p.id, p]));
    const transferName = (payeeId: string | null): string | null => {
      const target = payeeId ? payeeById.get(payeeId)?.transferAcct : null;
      return target ? (accountName.get(target) ?? null) : null;
    };
    const payeeName = (payeeId: string | null): string =>
      transferName(payeeId) ?? (payeeId ? (payeeById.get(payeeId)?.name ?? '') : '');
    return rows
      .map((r): CalloutTransaction => {
        const parent = r.parentId ? parentById.get(r.parentId) : undefined;
        return {
          id: r.id,
          transactionId: r.parentId ?? r.id,
          accountId: r.account,
          accountName: accountName.get(r.account) ?? '',
          date: r.date as ISODate,
          payeeName: payeeName(parent ? parent.payee : r.payee),
          transferAccountName: transferName(r.payee),
          isSplitLine: r.parentId !== null,
          notes: decode(r.notes).notes,
          parentNotes: parent ? decode(parent.notes).notes : '',
          amount: r.amount,
        };
      })
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  }

  /** `accounts.list` (04 §2, §7–8): with notes, balances, attention and the last reconciliation. */
  accounts(): Promise<Account[]> {
    return this.read('accounts.list', async () => {
      const [raws, transactions, schedules] = await Promise.all([
        this.actual.getAccounts(),
        this.loadTransactions(null),
        this.actual.getSchedules(),
      ]);
      const notes = new Map(
        (await this.actual.getNotes(raws.map((a) => accountNoteId(a.id)))).map((n) => [
          n.id,
          n.note,
        ]),
      );
      const byAccount = Map.groupBy(transactions, (t) => t.accountId);
      return raws.map((a): Account => {
        const own = byAccount.get(a.id) ?? [];
        return {
          id: a.id,
          name: a.name,
          onBudget: !a.offbudget,
          closed: a.closed,
          sortIndex: a.sortOrder,
          note: textOrNull(notes.get(accountNoteId(a.id))),
          lastReconciledDate: reconciledDate(a.lastReconciled),
          accountGroupId: a.accountGroupId,
          balances: balancesOf(own),
          attention: attentionOf(own),
          hasTransactions: own.length > 0,
          scheduledCount: schedules.filter((s) => s.account === a.id && !s.completed).length,
        };
      });
    });
  }

  /** `categories.tree` (04 §2): groups and categories in sort order, hidden ones included. */
  categories(): Promise<CategoryGroup[]> {
    return this.read('categories.tree', async () => {
      const groups = await this.actual.getCategoryGroups();
      const ids = groups.flatMap((g) => [g.id, ...g.categories.map((c) => c.id)]);
      const notes = new Map((await this.actual.getNotes(ids)).map((n) => [n.id, n.note]));
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        isIncome: g.isIncome,
        hidden: g.hidden,
        sortIndex: g.sortOrder,
        note: textOrNull(notes.get(g.id)),
        categories: g.categories.map((c) => ({
          id: c.id,
          groupId: g.id,
          name: c.name,
          isIncome: c.isIncome,
          hidden: c.hidden,
          sortIndex: c.sortOrder,
          note: textOrNull(notes.get(c.id)),
        })),
      }));
    });
  }

  /** `payees.list` (14 §1): usage counts, enabled state and the app's rules. */
  payees(): Promise<Payee[]> {
    return this.read('payees.list', async () => {
      const [payees, accounts, rules, usage, schedules, meta] = await Promise.all([
        this.actual.getPayees(),
        this.actual.getAccounts(),
        this.actual.getRules(),
        this.actual.getPayeeUsage(),
        this.actual.getSchedules(),
        this.metadata.loadAll(),
      ]);
      const closed = new Map(accounts.map((a) => [a.id, a.closed]));
      const disabled = new Set(meta.payees.disabled);
      const scheduleUse = new Map<string, number>();
      for (const s of schedules)
        if (s.payee) scheduleUse.set(s.payee, (scheduleUse.get(s.payee) ?? 0) + 1);
      return payees.map((p): Payee => {
        // When a payee has several rules of a kind, the first is the app's (14 §1).
        let autoCategoryRuleId: string | null = null;
        let autoCategoryId: string | null = null;
        let renameRuleId: string | null = null;
        let renameRules: Payee['renameRules'] = [];
        for (const r of rules) {
          const auto = autoCategoryOf(r);
          if (auto?.payeeId === p.id && autoCategoryRuleId === null) {
            autoCategoryRuleId = r.id;
            autoCategoryId = auto.categoryId;
          }
          const rename = renameRuleOf(r);
          if (rename?.payeeId === p.id && renameRuleId === null) {
            renameRuleId = r.id;
            renameRules = rename.conditions;
          }
        }
        return {
          id: p.id,
          name: p.name,
          transferAccountId: p.transferAcct,
          enabled: p.transferAcct ? closed.get(p.transferAcct) === false : !disabled.has(p.id),
          usageCount: (usage.get(p.id) ?? 0) + (scheduleUse.get(p.id) ?? 0),
          autoCategoryRuleId,
          autoCategoryId,
          renameRules,
          renameRuleId,
        };
      });
    });
  }
}
