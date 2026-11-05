// Rule reads and writes (23 §4): the list in Actual's run order with schedule names, create/update/delete,
// the transactions a rule's conditions match, and applying actions to chosen transactions. Each write is
// one gated job (03 §5); applying actions is a bulk job timed by the transactions it touches (03 §3).
import { rankRules, scheduleIdOf, stageOf, type Rule, type RuleMatch } from '@shared/domain/rules';
import type { Id, ISODate } from '@shared/domain/types';
import { decode, restoredNotes } from '@shared/metadata/notes-codec';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawRow, RawRuleAction, RawRuleCondition } from '../actual';
import { UNAVAILABLE_HANDLER } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';

/** The matching transactions the editor lists (23 §3.4). */
export const MATCHES_MAX = 100;

export interface RuleEdit {
  id?: Id | undefined;
  stage: 'pre' | 'post' | null;
  conditionsOp: 'and' | 'or';
  conditions: RawRuleCondition[];
  actions: RawRuleAction[];
}

const toMatch = (r: RawRow): RuleMatch => ({
  id: r.id,
  accountId: r.account,
  date: r.date as ISODate,
  payeeId: r.payee,
  categoryId: r.category,
  notes: decode(r.notes).notes,
  amount: r.amount,
});

const isUnavailable = (e: unknown): boolean =>
  e instanceof RpcError &&
  (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER;

export class RulesService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
  ) {}

  private open(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.open();
    return this.queue.run(label, fn, { kind: 'read' });
  }

  /** `rules.list` (23 §4): every rule, in run order, with its schedule when it has one. */
  list(): Promise<Rule[]> {
    return this.read('rules.list', async () => {
      const [rules, schedules] = await Promise.all([
        this.actual.getRules(),
        this.actual.getSchedules(),
      ]);
      const byId = new Map(schedules.map((s) => [s.id, s]));
      const byRule = new Map(schedules.flatMap((s) => (s.ruleId ? [[s.ruleId, s] as const] : [])));
      return rankRules(
        rules.map((r): Rule => {
          const linked = scheduleIdOf(r);
          const schedule = byRule.get(r.id) ?? (linked ? byId.get(linked) : undefined);
          return {
            id: r.id,
            stage: stageOf(r.stage),
            conditionsOp: r.conditionsOp === 'or' ? 'or' : 'and',
            conditions: r.conditions,
            actions: r.actions,
            schedule:
              schedule || linked
                ? { id: schedule?.id ?? linked ?? '', name: schedule?.name ?? null }
                : null,
          };
        }),
      );
    });
  }

  /** `rules.save` (23 §4): `createRule`, or `updateRule` with the full rule. */
  save(edit: RuleEdit): Promise<{ id: Id }> {
    this.open();
    return this.connection.write('rules.save', ['rules'], async () => {
      const rule = {
        stage: edit.stage,
        conditionsOp: edit.conditionsOp,
        conditions: edit.conditions,
        actions: edit.actions,
      };
      if (edit.id === undefined) return { id: await this.actual.createRule(rule) };
      const existing = (await this.actual.getRules()).find((r) => r.id === edit.id);
      if (!existing) throw new RpcError('not-found', 'That rule no longer exists.');
      if (scheduleIdOf(existing) !== null || edit.actions.some((a) => a.op === 'link-schedule'))
        throw new RpcError('validation', "A schedule's rule is edited with its schedule.", {
          code: 'schedule-rule',
        });
      await this.actual.updateRule({ ...existing, ...rule, id: existing.id });
      return { id: existing.id };
    });
  }

  /** `rules.delete` (23 §4): schedule rules are skipped; they go with their schedule. */
  delete(ids: readonly Id[]): Promise<null> {
    this.open();
    return this.connection.write('rules.delete', ['rules'], async () => {
      const rules = await this.actual.getRules();
      for (const id of ids) {
        const rule = rules.find((r) => r.id === id);
        if (rule && scheduleIdOf(rule) === null) await this.actual.deleteRule(id);
      }
      return null;
    });
  }

  /**
   * `rules.matches` (23 §3.4): Actual's own matching for unsaved conditions. No conditions match nothing;
   * null when Actual lacks the handler.
   */
  matches(q: {
    conditionsOp: 'and' | 'or';
    conditions: RawRuleCondition[];
  }): Promise<{ rows: RuleMatch[]; more: boolean } | null> {
    return this.read('rules.matches', async () => {
      if (q.conditions.length === 0) return { rows: [], more: false };
      try {
        const rows = await this.actual.ruleMatches(q.conditions, q.conditionsOp, MATCHES_MAX + 1);
        return { rows: rows.slice(0, MATCHES_MAX).map(toMatch), more: rows.length > MATCHES_MAX };
      } catch (e) {
        if (isUnavailable(e)) return null;
        throw e;
      }
    });
  }

  /**
   * `rules.applyActions` (23 §3.4): Actual applies the actions to the rows, then each row that had a
   * check number or the review tag gets them back if an action removed them (23 §5).
   */
  applyActions(ids: readonly Id[], actions: RawRuleAction[]): Promise<{ count: number }> {
    this.open();
    return this.connection.write(
      'rules.applyActions',
      ['transactions', 'payees', 'schedules'],
      async () => {
        const before = await this.actual.getTransactionRows({ ids });
        await this.actual.applyRuleActions(ids, actions);
        const after = new Map(
          (await this.actual.getTransactionRows({ ids })).map((r) => [r.id, r]),
        );
        for (const row of before) {
          const now = after.get(row.id);
          if (!now) continue;
          const notes = restoredNotes(row.notes, now.notes);
          if (notes !== null) await this.actual.updateTransaction(row.id, { notes });
        }
        return { count: before.length };
      },
      { transactions: ids.length },
    );
  }
}
