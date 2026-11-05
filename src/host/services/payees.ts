// Payee writes (03 §8 `payees.*`; 14 §1, §3–4): rename and merge with rename-rule upkeep, combine,
// enable/disable (`ad:payees`), the app's rename rule and auto-category rule per payee, and applying the
// rename rules to existing transactions. Each write is one gated job (03 §5); bulk ones are timed by the
// number of transactions they touch (03 §3).
import {
  autoCategoryOf,
  fromActualCondition,
  renameRuleOf,
  toActualCondition,
} from '@shared/domain/payee-rules';
import type { Id, RenameCondition } from '@shared/domain/types';
import { RESERVED, reservedIds } from '@shared/metadata/reserved';
import type { ApplyRenameResult, PayeeRules, RenameImpact } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawAccount, RawPayee, RawRule, RawTransaction } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';
import { transferPayeeOf } from './transactions';

const TABLES = ['payees', 'rules', 'transactions', 'notes'];

const fold = (s: string): string => s.toLocaleLowerCase();

/** A condition in Actual's form, with the value type Actual's rules use. */
const conditionOf = (c: RenameCondition): RawRule['conditions'][number] => ({
  ...toActualCondition(c),
  type: 'string',
});

/** The parents and normal rows that use a payee (split lines follow their parent). */
function usesOf(rows: readonly RawTransaction[], payeeId: Id): RawTransaction[] {
  return rows.filter((r) => r.payee === payeeId);
}

/**
 * The uses "Rename and categorize" gives a category (11 §8): not split, no category, and on-budget.
 * Off-budget transactions never have one (04 §3), so they don't count as uncategorized.
 */
function uncategorizedOf(rows: readonly RawTransaction[], accounts: readonly RawAccount[]): Id[] {
  const offBudget = new Set(accounts.filter((a) => a.offbudget).map((a) => a.id));
  return rows
    .filter(
      (r) => r.subtransactions.length === 0 && r.category === null && !offBudget.has(r.account),
    )
    .map((r) => r.id);
}

/**
 * Does a rename rule's condition match a payee text: lowercased both sides, `matches` as a
 * lowercased JS regex.
 */
export function conditionMatches(c: RenameCondition, text: string): boolean {
  const t = fold(text.trim());
  const v = fold(c.value);
  switch (c.op) {
    case 'contains':
      return t.includes(v);
    case 'is':
      return t === v;
    case 'startsWith':
      return t.startsWith(v);
    case 'endsWith':
      return t.endsWith(v);
  }
}

export class PayeesService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
  ) {}

  private open(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.open();
    return this.queue.run(label, fn, { kind: 'read' });
  }

  private write<T>(label: string, fn: () => Promise<T>, transactions = 0): Promise<T> {
    this.open();
    return this.connection.write(label, TABLES, fn, { transactions });
  }

  /** A bulk write: counted first, so its timeout fits the transactions it touches (03 §3). */
  private async bulk<T>(
    label: string,
    count: () => Promise<number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    // A count that fails leaves the error to the write job, which reports it after the gate.
    const n = await this.read(`${label}: count`, count).catch(() => 0);
    return this.write(label, fn, n);
  }

  private async payee(id: Id): Promise<{ payee: RawPayee; payees: RawPayee[] }> {
    const payees = await this.actual.getPayees();
    const payee = payees.find((p) => p.id === id);
    if (!payee) throw new RpcError('not-found', 'That payee no longer exists.');
    return { payee, payees };
  }

  // ------------------------------------------------------------------------------- rename

  /** `payees.renameImpact` (14 §3.1, 11 §8). */
  renameImpact(id: Id, transferAccountId?: Id, excludeId?: Id): Promise<RenameImpact> {
    return this.read('payees.renameImpact', async () => {
      const rows = usesOf(await this.actual.getTransactions(null), id).filter(
        (r) => r.id !== excludeId,
      );
      const renameable =
        transferAccountId === undefined
          ? rows.length
          : rows.filter((r) => r.account !== transferAccountId && r.subtransactions.length === 0)
              .length;
      return {
        total: rows.length,
        renameable,
        uncategorized: uncategorizedOf(rows, await this.actual.getAccounts()).length,
      };
    });
  }

  /**
   * `payees.rename` (14 §3): a no-op when identical; a new name renames it; an existing name merges into
   * that payee; a transfer moves the eligible transactions to the account's transfer payee. Then the
   * result gets the rename condition `imported_payee is "{old name}"`, and no other payee keeps it.
   */
  rename(
    id: Id,
    name: string,
    opts: { transferAccountId?: Id | undefined; categoryId?: Id | undefined } = {},
  ): Promise<{ id: Id }> {
    return this.bulk(
      'payees.rename',
      async () => usesOf(await this.actual.getTransactions(null), id).length,
      async () => {
        const { payee, payees } = await this.payee(id);
        if (payee.transferAcct)
          throw new RpcError('validation', 'Transfer payees cannot be renamed.', {
            code: 'transfer-payee',
          });
        const rows = usesOf(await this.actual.getTransactions(null), id);
        const uncategorized = uncategorizedOf(rows, await this.actual.getAccounts());
        let result: Id;
        if (opts.transferAccountId !== undefined) {
          result = await this.renameToTransfer(payee, rows, payees, opts.transferAccountId);
        } else {
          const newName = name.trim();
          if (newName === '')
            throw new RpcError('validation', 'The new payee may not be blank.', { code: 'blank' });
          if (newName === payee.name) return { id };
          const existing = payees.find(
            (p) => !p.transferAcct && p.id !== id && fold(p.name) === fold(newName),
          );
          if (existing && fold(newName) !== fold(payee.name)) {
            await this.actual.mergePayees(existing.id, [id]);
            result = existing.id;
          } else {
            await this.actual.updatePayee(id, { name: newName });
            result = id;
          }
        }
        if (result !== id || fold(name.trim()) !== fold(payee.name))
          await this.addRenameConditions(result, [payee.name]);
        if (opts.categoryId !== undefined) {
          for (const tid of uncategorized)
            await this.actual.updateTransaction(tid, { category: opts.categoryId });
          await this.setAutoCategoryInJob(result, opts.categoryId);
        }
        return { id: result };
      },
    );
  }

  /** Payees can't merge into transfer payees: re-point each eligible transaction (14 §3). */
  private async renameToTransfer(
    payee: RawPayee,
    rows: readonly RawTransaction[],
    payees: readonly RawPayee[],
    accountId: Id,
  ): Promise<Id> {
    const target = transferPayeeOf(payees, accountId);
    let left = 0;
    for (const r of rows) {
      if (r.account === accountId || r.subtransactions.length > 0) {
        left++;
        continue;
      }
      await this.actual.updateTransaction(r.id, { payee: target });
    }
    if (left === 0) await this.actual.deletePayee(payee.id);
    return target;
  }

  /**
   * Adds `imported_payee is "{name}"` to `payeeId`'s rename rule (creating it), and removes those
   * conditions from every other payee's rename rule (14 §3).
   */
  private async addRenameConditions(payeeId: Id, names: readonly string[]): Promise<void> {
    const rules = await this.actual.getRules();
    const wanted = new Set(names.map(fold));
    for (const rule of rules) {
      const r = renameRuleOf(rule);
      if (!r || r.payeeId === payeeId) continue;
      const conditions = rule.conditions.filter((c) => {
        const read = fromActualCondition(c);
        return !(read?.op === 'is' && wanted.has(fold(read.value)));
      });
      if (conditions.length === rule.conditions.length) continue;
      if (conditions.length === 0) await this.actual.deleteRule(rule.id);
      else await this.actual.updateRule({ ...rule, conditions });
    }
    const own = rules.find((r) => renameRuleOf(r)?.payeeId === payeeId);
    const current = own ? (renameRuleOf(own)?.conditions ?? []) : [];
    const missing = names.filter(
      (n) => !current.some((c) => c.op === 'is' && fold(c.value) === fold(n)),
    );
    if (missing.length === 0) return;
    const added = missing.map((value) => conditionOf({ op: 'is', value }));
    if (own) await this.actual.updateRule({ ...own, conditions: [...own.conditions, ...added] });
    else
      await this.actual.createRule({
        stage: 'pre',
        conditionsOp: 'or',
        conditions: added,
        actions: [{ op: 'set', field: 'payee', value: payeeId, type: 'id' }],
      });
  }

  /**
   * `payees.combine` (14 §4): the selected payees (not transfer payees) become one, named `name`. A payee
   * that already has that name is the target; otherwise the first selected is renamed. Every merged name
   * becomes a rename condition of the result.
   */
  combine(ids: readonly Id[], name: string): Promise<{ id: Id }> {
    return this.bulk(
      'payees.combine',
      async () => {
        const rows = await this.actual.getTransactions(null);
        return ids.reduce((n, id) => n + usesOf(rows, id).length, 0);
      },
      async () => {
        const payees = await this.actual.getPayees();
        const chosen = ids.flatMap((id) => {
          const p = payees.find((x) => x.id === id);
          return p && !p.transferAcct ? [p] : [];
        });
        const [first] = chosen;
        if (!first) throw new RpcError('validation', 'No payees to combine.');
        const newName = name.trim();
        const named = payees.find((p) => !p.transferAcct && fold(p.name) === fold(newName));
        const target = named ?? first;
        if (target.name !== newName) await this.actual.updatePayee(target.id, { name: newName });
        const merged = chosen.filter((p) => p.id !== target.id);
        if (merged.length > 0)
          await this.actual.mergePayees(
            target.id,
            merged.map((p) => p.id),
          );
        const oldNames = chosen.map((p) => p.name).filter((n) => fold(n) !== fold(newName));
        if (oldNames.length > 0) await this.addRenameConditions(target.id, oldNames);
        return { id: target.id };
      },
    );
  }

  // ------------------------------------------------------------------------------- settings

  /** `payees.setEnabled` (14 §1 X12): `ad:payees.disabled`. Transfer payees are skipped. */
  setEnabled(ids: readonly Id[], enabled: boolean): Promise<null> {
    return this.write('payees.setEnabled', async () => {
      const transfer = new Set(
        (await this.actual.getPayees()).filter((p) => p.transferAcct).map((p) => p.id),
      );
      const change = ids.filter((id) => !transfer.has(id));
      if (change.length === 0) return null;
      await this.metadata.modifyInJob(reservedIds.payees, RESERVED.payees, (m) => {
        const set = new Set(m.disabled);
        for (const id of change) {
          if (enabled) set.delete(id);
          else set.add(id);
        }
        return { ...m, disabled: [...set] };
      });
      return null;
    });
  }

  /** `payees.rules` (14 §1): the app's rename and auto-category rules, and the others naming it. */
  rules(id: Id): Promise<PayeeRules> {
    return this.read('payees.rules', async () => {
      const rules = await this.actual.getRules();
      let renameRules: RenameCondition[] | null = null;
      let autoCategoryId: Id | null | undefined;
      const otherRuleIds: Id[] = [];
      for (const rule of rules) {
        const rename = renameRuleOf(rule);
        const auto = autoCategoryOf(rule);
        if (rename?.payeeId === id && renameRules === null) {
          renameRules = rename.conditions;
        } else if (auto?.payeeId === id && autoCategoryId === undefined) {
          autoCategoryId = auto.categoryId;
        } else if (mentions(rule, id)) {
          otherRuleIds.push(rule.id);
        }
      }
      return {
        renameRules: renameRules ?? [],
        autoCategoryId: autoCategoryId ?? null,
        otherRuleIds,
      };
    });
  }

  /** `payees.setRenameRules` (14 §4): the payee's `pre` rule; none left deletes it. */
  setRenameRules(id: Id, conditions: readonly RenameCondition[]): Promise<null> {
    return this.write('payees.setRenameRules', async () => {
      await this.payee(id);
      const own = (await this.actual.getRules()).find((r) => renameRuleOf(r)?.payeeId === id);
      const actual = conditions.map(conditionOf);
      if (actual.length === 0) {
        if (own) await this.actual.deleteRule(own.id);
      } else if (own) {
        await this.actual.updateRule({ ...own, conditionsOp: 'or', conditions: actual });
      } else {
        await this.actual.createRule({
          stage: 'pre',
          conditionsOp: 'or',
          conditions: actual,
          actions: [{ op: 'set', field: 'payee', value: id, type: 'id' }],
        });
      }
      return null;
    });
  }

  /** `payees.setAutoCategory` (14 §1): one default-stage rule per payee; null removes it. */
  setAutoCategory(id: Id, categoryId: Id | null): Promise<null> {
    return this.write('payees.setAutoCategory', async () => {
      await this.payee(id);
      await this.setAutoCategoryInJob(id, categoryId);
      return null;
    });
  }

  private async setAutoCategoryInJob(id: Id, categoryId: Id | null): Promise<void> {
    const own = (await this.actual.getRules()).find((r) => autoCategoryOf(r)?.payeeId === id);
    if (categoryId === null) {
      if (own) await this.actual.deleteRule(own.id);
      return;
    }
    const action = { op: 'set', field: 'category', value: categoryId, type: 'id' };
    if (own) {
      if (autoCategoryOf(own)?.categoryId !== categoryId)
        await this.actual.updateRule({ ...own, actions: [{ ...own.actions[0], ...action }] });
      return;
    }
    await this.actual.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: id, type: 'id' }],
      actions: [action],
    });
  }

  /**
   * `payees.applyRenameRules` (14 §4): the payee's rules matched against the payee name and imported
   * payee of every other transaction, with Actual's semantics. A dry run only counts.
   */
  applyRenameRules(id: Id, dryRun: boolean): Promise<ApplyRenameResult> {
    const find = async (): Promise<{ matches: RawTransaction[]; names: string[] }> => {
      const { payees } = await this.payee(id);
      const own = (await this.actual.getRules()).find((r) => renameRuleOf(r)?.payeeId === id);
      const conditions = own ? (renameRuleOf(own)?.conditions ?? []) : [];
      const names = new Map(payees.map((p) => [p.id, p.name]));
      const transfer = new Set(payees.filter((p) => p.transferAcct).map((p) => p.id));
      const matches = (await this.actual.getTransactions(null)).filter((r) => {
        if (r.payee === id || (r.payee && transfer.has(r.payee))) return false;
        const texts = [r.payee ? (names.get(r.payee) ?? '') : '', r.importedPayee ?? ''];
        return conditions.some((c) => texts.some((t) => t !== '' && conditionMatches(c, t)));
      });
      const from = [
        ...new Set(
          matches.map((r) => (r.payee ? (names.get(r.payee) ?? '') : (r.importedPayee ?? ''))),
        ),
      ];
      return { matches, names: from };
    };
    if (dryRun)
      return this.read('payees.applyRenameRules', async () => {
        const { matches, names } = await find();
        return { count: matches.length, payeeNames: names };
      });
    return this.bulk(
      'payees.applyRenameRules',
      async () => (await find()).matches.length,
      async () => {
        const { matches, names } = await find();
        for (const r of matches) await this.actual.updateTransaction(r.id, { payee: id });
        return { count: matches.length, payeeNames: names };
      },
    );
  }
}

/** A rule that names the payee in a condition or an action. */
function mentions(rule: RawRule, id: Id): boolean {
  const has = (v: unknown): boolean => v === id || (Array.isArray(v) && v.includes(id));
  return rule.conditions.some((c) => has(c.value)) || rule.actions.some((a) => has(a.value));
}
