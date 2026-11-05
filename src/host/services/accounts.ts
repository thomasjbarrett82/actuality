// Account writes (03 §8 `accounts.*`; 13 §2–5, 08 §4): create, rename and the account note, close/reopen,
// force close (delete), and the sidebar reorder within a group. They follow Actual's own account
// operations (13 §2). Each operation is one gated write job (03 §5), so its API calls never interleave
// with another job's.
import {
  accountNameError,
  bySortOrder,
  groupOf,
  placeAccount,
  type AccountGroup,
} from '@shared/domain/accounts';
import type { Id } from '@shared/domain/types';
import { mappingField, RESERVED, reservedIds } from '@shared/metadata/reserved';
import type { AccountUpdate, CreateAccountInput } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawAccount } from '../actual';
import type { Connection } from '../connection';
import type { MetadataRepository } from './metadata';
import { accountNoteId } from './read';

/** The tables an account write can touch (03 §4.1); the API's `applied` events add the rest. */
const TABLES = ['accounts', 'transactions', 'payees', 'notes'];

const view = (
  a: RawAccount,
): { id: Id; name: string; onBudget: boolean; closed: boolean; sortIndex: number } => ({
  id: a.id,
  name: a.name,
  onBudget: !a.offbudget,
  closed: a.closed,
  sortIndex: a.sortOrder,
});

export class AccountsService {
  constructor(
    private readonly actual: ActualApi,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
  ) {}

  private write<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.connection.write(label, TABLES, fn);
  }

  private async account(id: Id): Promise<RawAccount> {
    const found = (await this.actual.getAccounts()).find((a) => a.id === id);
    if (!found) throw new RpcError('not-found', 'That account no longer exists.');
    return found;
  }

  private checkName(name: string, accounts: readonly RawAccount[], selfId: Id | null): void {
    const error = accountNameError(name, accounts, selfId);
    if (error)
      throw new RpcError('validation', 'The account name is not allowed.', {
        code: `name-${error}`,
      });
  }

  /**
   * `accounts.create` (13 §2): Actual creates the starting-balance transaction itself (dated today,
   * Cleared, payee "Starting Balance", its "Starting Balances" category on-budget), and the app keeps it.
   */
  create(input: CreateAccountInput): Promise<{ id: Id }> {
    return this.write('accounts.create', async () => {
      const name = input.name.trim();
      this.checkName(name, await this.actual.getAccounts(), null);
      const id = await this.actual.createAccount(name, !input.onBudget, input.balance);
      return { id };
    });
  }

  /** `accounts.update` (13 §3): the account header's Rename and Notes. */
  update(id: Id, patch: AccountUpdate): Promise<null> {
    return this.write('accounts.update', async () => {
      const accounts = await this.actual.getAccounts();
      const account = accounts.find((a) => a.id === id);
      if (!account) throw new RpcError('not-found', 'That account no longer exists.');
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name !== account.name) {
          // Only a change other than in letter case is validated (13 §3).
          if (name.toLocaleLowerCase() !== account.name.toLocaleLowerCase())
            this.checkName(name, accounts, id);
          await this.actual.updateAccount(id, { name });
        }
      }
      if (patch.note !== undefined) await this.actual.updateNote(accountNoteId(id), patch.note);
      return null;
    });
  }

  /**
   * `accounts.close` (13 §4), as Actual's close: a non-zero balance needs an account to transfer it to.
   * Actual's `closeAccount` deletes an account that has no transactions; the app then clears what a delete
   * clears (13 §5).
   */
  close(id: Id, transferAccountId?: Id, transferCategoryId?: Id): Promise<null> {
    return this.write('accounts.close', async () => {
      const account = await this.account(id);
      if (account.closed) return null;
      const rows = await this.actual.getTransactions(id);
      const balance = rows.reduce((sum, t) => sum + t.amount, 0);
      if (balance !== 0 && transferAccountId === undefined)
        throw new RpcError('validation', 'The account still has a balance.', {
          code: 'balance-not-zero',
        });
      await this.actual.closeAccount(
        id,
        balance === 0 ? undefined : transferAccountId,
        balance === 0 ? undefined : transferCategoryId,
      );
      if (rows.length === 0) await this.clearDeleted(id);
      return null;
    });
  }

  /** `accounts.reopen` (13 §4 Re-open Account). */
  reopen(id: Id): Promise<null> {
    return this.write('accounts.reopen', async () => {
      await this.account(id);
      await this.actual.reopenAccount(id);
      return null;
    });
  }

  /**
   * `accounts.delete` (13 §5): Actual's force close, which deletes the account and all of its
   * transactions. Only an open account: Actual's forced close does nothing to a closed one (26.10.0).
   */
  delete(id: Id): Promise<null> {
    return this.write('accounts.delete', async () => {
      const account = await this.account(id);
      if (account.closed)
        throw new RpcError('validation', 'Only an open account can be deleted.', {
          code: 'account-closed',
        });
      await this.actual.deleteAccount(id);
      await this.clearDeleted(id);
      return null;
    });
  }

  /**
   * After a delete (13 §5): notes can't be deleted, only emptied (04 §5.3), so its native note is set to
   * `""`; the import mappings that point to it are removed.
   */
  private async clearDeleted(id: Id): Promise<void> {
    if (await this.actual.getNote(accountNoteId(id)))
      await this.actual.updateNote(accountNoteId(id), '');
    const mappings = await this.metadata.read(reservedIds.importMappings, RESERVED.importMappings);
    if (mappings.mappings.some((m) => mappingField(m, 'accountId') === id)) {
      await this.metadata.modifyInJob(reservedIds.importMappings, RESERVED.importMappings, (m) => ({
        ...m,
        mappings: m.mappings.filter((x) => mappingField(x, 'accountId') !== id),
      }));
    }
  }

  /**
   * `accounts.reorder` (08 §4): place it before `beforeId` (null: last) within its own group; a move to
   * another group is refused. Only the moved account's `sort_order` changes, unless its new neighbors are
   * too close and the group is renumbered (04 §3).
   */
  reorder(id: Id, beforeId: Id | null, group: AccountGroup): Promise<null> {
    return this.write('accounts.reorder', async () => {
      const accounts = await this.actual.getAccounts();
      const account = accounts.find((a) => a.id === id);
      if (!account) throw new RpcError('not-found', 'That account no longer exists.');
      if (groupOf(view(account)) !== group)
        throw new RpcError('validation', 'An account only moves within its own group.', {
          code: 'other-group',
        });
      const ordered = accounts
        .map(view)
        .filter((a) => groupOf(a) === group)
        .sort(bySortOrder);
      const at = ordered.findIndex((a) => a.id === id);
      // Dropped where it already is: nothing to write.
      if (at !== -1 && (ordered[at + 1]?.id ?? null) === beforeId) return null;
      const placement = placeAccount(
        ordered.filter((a) => a.id !== id),
        id,
        beforeId,
      );
      const orders =
        placement.kind === 'single' ? [{ id, sortOrder: placement.sortOrder }] : placement.orders;
      const current = new Map(accounts.map((a) => [a.id, a.sortOrder]));
      for (const o of orders)
        if (current.get(o.id) !== o.sortOrder)
          await this.actual.updateAccount(o.id, { sortOrder: o.sortOrder });
      return null;
    });
  }

  /**
   * A slate wipe's Starting Balance (18 §2 step 6), inside its write job, categorized per 13 §2.1: on
   * budget, the "Starting Balances" income category whatever the sign; off budget, none.
   */
  async startingBalanceInJob(
    account: RawAccount,
    amount: number,
    date: string,
    payee: string,
  ): Promise<void> {
    await this.actual.addTransaction(account.id, {
      id: crypto.randomUUID(),
      date,
      amount,
      payeeName: payee,
      category: account.offbudget ? null : await this.incomeCategoryId(),
      notes: '',
      cleared: true,
      reconciled: false,
      startingBalance: true,
    });
  }

  /**
   * The income category of a starting balance (13 §2.1): Actual's "Starting Balances", else the first
   * income category. This is the lookup Actual itself makes for the starting balance it creates, so both
   * agree.
   */
  private async incomeCategoryId(): Promise<Id | null> {
    const income = (await this.actual.getCategoryGroups())
      .filter((g) => g.isIncome)
      .flatMap((g) => g.categories);
    return (
      (income.find((c) => c.name.toLowerCase() === 'starting balances') ?? income[0])?.id ?? null
    );
  }
}
