// The budget service (03 §8 `budget.*`; 09 §2, §5.5, §6.4). Reads build the normalized month view from
// `getBudgetMonth`; writes are gated jobs that refuse months outside `getBudgetMonths()`, which
// Actual itself doesn't check for `setBudgetAmount`. The carryover extension is a session start task.
import { addMonths, monthBounds, nextMonth, prevMonth, today } from '@shared/dates';
import { toBudgetMonthView, type RawBudgetMonth } from '@shared/domain/budget-month';
import type { BudgetMonthView, Id, ISODate, Money, Month } from '@shared/domain/types';
import { RESERVED, reservedIds, type BudgetMeta } from '@shared/metadata/reserved';
import {
  averageItems,
  averageOutflow,
  scheduledOutflows,
  validHistory,
  type CategoryQuickStats,
  type QuickBudgetStats,
  type ScheduleOutflowInput,
} from '@shared/quickbudget/quickbudget';
import { RpcError } from '@shared/rpc/protocol';
import { isRecurConfig } from '@shared/schedule/frequency';
import { occurrencesBefore } from '@shared/schedule/occurrences';
import { readTemplate } from '@shared/schedule/template';
import { UNAVAILABLE_HANDLER, type ActualApi, type RawSchedule } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';

/** The tables a budget write changes, for `data:changed` (03 §4.1). */
const BUDGET_TABLES = ['zero_budgets', 'reflect_budgets'];
/** `get-upcoming-dates` batch size (12 §1), and a cap for daily schedules far ahead. */
const DATES_BATCH = 12;
const DATES_MAX = 400;

const isUnavailable = (e: unknown): boolean =>
  e instanceof RpcError &&
  (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER;

export interface BudgetHooks {
  /** The budget header identity doesn't hold for a month: it shows "Other adjustments" (09 §2). */
  onOtherAdjustments?: (facts: { month: string; difference: number }) => void;
}

export class BudgetService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
    /** "Today", for the current month (tests). */
    private readonly now: () => Date = () => new Date(),
    private readonly hooks: BudgetHooks = {},
  ) {}

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(label, fn, { kind: 'read' });
  }

  private write<T>(label: string, fn: () => Promise<T>, tables = BUDGET_TABLES): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.connection.write(label, tables, fn);
  }

  private currentMonth(): Month {
    return today(this.now()).slice(0, 7) as Month;
  }

  /** Throws `validation` for a month outside the budget's range (09 §2). Call inside a job. */
  private async requireMonth(month: string): Promise<string[]> {
    const months = await this.actual.getBudgetMonths();
    if (!months.includes(month))
      throw new RpcError('validation', `The month ${month} is outside the budget.`, {
        code: 'month-out-of-range',
      });
    return months;
  }

  /** An expense category. Call inside a job. */
  private async requireCategory(id: Id): Promise<void> {
    const groups = await this.actual.getCategoryGroups();
    const found = groups.flatMap((g) => g.categories).find((c) => c.id === id);
    if (!found) throw new RpcError('not-found', 'That category no longer exists.');
    if (found.isIncome)
      throw new RpcError('validation', 'Income categories have no budget here.', {
        code: 'income-category',
      });
  }

  // ---------------------------------------------------------------------------- reads

  /** `budget.months()`: the readable range, oldest first. */
  months(): Promise<Month[]> {
    return this.read('budget.months', async () => (await this.actual.getBudgetMonths()) as Month[]);
  }

  /** The month view; call inside a job. */
  private async view(month: string, months: readonly string[]): Promise<BudgetMonthView> {
    const before = prevMonth(month as Month);
    const [cur, prev, counts, uncategorized] = await Promise.all([
      this.actual.getBudgetMonth(month),
      // The first month's previous month isn't readable: every prev value is 0 there (09 §2).
      months.includes(before) ? this.actual.getBudgetMonth(before) : Promise.resolve(null),
      this.actual.categoryCountsInMonth(month),
      this.actual.uncategorizedSummary(month),
    ]);
    const view = toBudgetMonthView(cur, prev, {
      withTransactions: new Set(counts.keys()),
      uncategorized: { activity: uncategorized.total, hasTransactions: uncategorized.count > 0 },
    });
    if (view.otherAdjustments !== 0)
      this.hooks.onOtherAdjustments?.({ month, difference: view.otherAdjustments });
    return view;
  }

  /** `budget.month(m)` (09 §2). */
  month(month: string): Promise<BudgetMonthView> {
    return this.read('budget.month', async () => this.view(month, await this.requireMonth(month)));
  }

  /** `budget.uncategorized()`: whether the Uncategorized row shows (09 §4.2). */
  uncategorized(): Promise<{ exists: boolean }> {
    return this.read('budget.uncategorized', async () => ({
      exists: (await this.actual.uncategorizedSummary(null)).count > 0,
    }));
  }

  // ---------------------------------------------------------------------------- writes

  /** `budget.setAmount` (09 §5.4). */
  setAmount(month: string, categoryId: Id, amount: Money): Promise<null> {
    return this.write('budget.setAmount', async () => {
      await this.requireMonth(month);
      await this.requireCategory(categoryId);
      await this.actual.setBudgetAmount(month, categoryId, amount);
      return null;
    });
  }

  /** `budget.setAmounts`: a Quick Budget fill, in one `batchBudgetUpdates` (09 §5.5). */
  setAmounts(month: string, entries: readonly { categoryId: Id; amount: Money }[]): Promise<null> {
    return this.write('budget.setAmounts', async () => {
      await this.requireMonth(month);
      for (const e of entries) await this.requireCategory(e.categoryId);
      await this.actual.batchBudgetUpdates(async () => {
        for (const e of entries) await this.actual.setBudgetAmount(month, e.categoryId, e.amount);
      });
      return null;
    });
  }

  /**
   * `budget.setCarryover` (09 §6.4): Actual applies it to this and every later existing month. It
   * throws for income categories and months outside the range, so those are refused first.
   */
  setCarryover(month: string, categoryId: Id, flag: boolean): Promise<null> {
    return this.write('budget.setCarryover', async () => {
      await this.requireMonth(month);
      await this.requireCategory(categoryId);
      await this.actual.setBudgetCarryover(month, categoryId, flag);
      return null;
    });
  }

  /**
   * `budget.hold` (09 §5.5): the new hold replaces the old one, so the amount available is To Budget plus
   * the current hold.
   */
  hold(month: string, amount: Money): Promise<null> {
    return this.write('budget.hold', async () => {
      await this.requireMonth(month);
      await this.actual.resetBudgetHold(month);
      if (amount > 0) await this.actual.holdBudgetForNextMonth(month, amount);
      return null;
    });
  }

  /** `budget.resetHold` (09 §5.5). */
  resetHold(month: string): Promise<null> {
    return this.write('budget.resetHold', async () => {
      await this.requireMonth(month);
      await this.actual.resetBudgetHold(month);
      return null;
    });
  }

  // ---------------------------------------------------------------------------- Quick Budget

  /**
   * `budget.quickBudgetStats(m)` (09 §5.4–5.5) for every expense category: last month's budgeted and
   * outflows, the averages over the valid history, the scheduled outflows and Balance to 0.
   */
  quickBudgetStats(month: string): Promise<QuickBudgetStats> {
    return this.read('budget.quickBudgetStats', async () => {
      const months = await this.requireMonth(month);
      const m = month as Month;
      const current = this.currentMonth();
      const raws = new Map<string, RawBudgetMonth>();
      const raw = async (x: Month): Promise<RawBudgetMonth | null> => {
        if (!months.includes(x)) return null;
        let r = raws.get(x);
        if (!r) {
          r = await this.actual.getBudgetMonth(x);
          raws.set(x, r);
        }
        return r;
      };
      // History months: up to 12 back from the starting month, and the month before each for its data.
      const history = new Map<Month, { real: boolean; activity: Map<Id, Money> }>();
      const startFrom = nextMonth(m <= current ? prevMonth(current) : current);
      for (let i = 1; i <= 12; i++) {
        const x = addMonths(startFrom, -i);
        const r = await raw(x);
        if (!r) {
          history.set(x, { real: false, activity: new Map() });
          continue;
        }
        const before = await raw(prevMonth(x));
        const view = toBudgetMonthView(r, before, {
          withTransactions: new Set(),
          uncategorized: { activity: 0, hasTransactions: false },
        });
        history.set(x, {
          real: view.hasRealData,
          activity: new Map(
            view.groups.flatMap((g) => g.categories.map((c) => [c.id, c.activity] as const)),
          ),
        });
      }
      const h12 = validHistory(12, m, current, (x) => history.get(x)?.real === true);
      const items = averageItems(h12);
      const cur = await raw(m);
      const last = await raw(prevMonth(m));
      const scheduled = await this.scheduledInMonth(m);
      const categories: Record<Id, CategoryQuickStats> = {};
      for (const g of cur?.categoryGroups ?? []) {
        if (g.is_income === true) continue;
        for (const c of g.categories ?? []) {
          const prevCat = last?.categoryGroups
            .flatMap((x) => x.categories ?? [])
            .find((x) => x.id === c.id);
          const activity = (x: Month): Money => history.get(x)?.activity.get(c.id) ?? 0;
          const budgeted = c.budgeted ?? 0;
          categories[c.id] = {
            budgeted,
            lastBudgeted: prevCat?.budgeted ?? 0,
            lastOutflows: prevCat?.spent ? -prevCat.spent : 0,
            average3: items.average3 ? averageOutflow(items.average3, m, current, activity) : 0,
            averageYear: items.year ? averageOutflow(items.year.months, m, current, activity) : 0,
            scheduled: scheduled.get(c.id) ?? 0,
            balanceTo0: budgeted - (c.balance ?? 0),
          };
        }
      }
      return { month: m, h12, categories };
    });
  }

  /**
   * Scheduled outflows per category in a month (09 §5.5, 12 §5): occurrences from `max(first, next_date)`
   * to the month's end: from `get-upcoming-dates` from today on, and before today (overdue, not yet
   * posted) as Actual computes them (`occurrencesBefore`). Without the handler, only `next_date` counts.
   * Call inside a job.
   */
  private async scheduledInMonth(month: Month): Promise<Map<Id, Money>> {
    const [schedules, rules] = await Promise.all([
      this.actual.getSchedules(),
      this.actual.getRules(),
    ]);
    const { first, last } = monthBounds(month);
    const inputs: ScheduleOutflowInput[] = [];
    for (const s of schedules) {
      if (s.completed || !s.nextDate) continue;
      const amount = amountOf(s);
      if (amount === null || amount > 0) continue;
      const from = s.nextDate > first ? s.nextDate : first;
      if (from > last) continue;
      const occurrences = await this.occurrences(s, from as ISODate, last);
      if (occurrences.length === 0) continue;
      const template = readTemplate(rules.find((r) => r.id === s.ruleId)?.actions ?? [], amount);
      inputs.push({
        amount,
        categoryId: template.categoryId,
        lines: template.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount })),
        occurrences,
      });
    }
    return scheduledOutflows(inputs);
  }

  private async occurrences(s: RawSchedule, from: ISODate, to: ISODate): Promise<ISODate[]> {
    const fallback = (): ISODate[] =>
      s.nextDate && s.nextDate >= from && s.nextDate <= to ? [s.nextDate as ISODate] : [];
    if (typeof s.date === 'string' || s.date === null || s.date === undefined) return fallback();
    if (!this.actual.internalHandlerAvailable('schedule/get-upcoming-dates')) return fallback();
    try {
      for (let count = DATES_BATCH; count <= DATES_MAX; count *= 2) {
        const dates = await this.actual.getUpcomingDates(s.date, count);
        const lastDate = dates.at(-1);
        if (dates.length < count || (lastDate !== undefined && lastDate > to)) {
          // The handler counts from today; the overdue ones before it come from the same rules.
          const overdue = isRecurConfig(s.date) ? occurrencesBefore(s.date, today(this.now())) : [];
          const listed = [...overdue, ...dates].filter((d) => d >= from && d <= to) as ISODate[];
          return [...new Set([...fallback(), ...listed])].sort();
        }
      }
      return fallback();
    } catch (e) {
      if (isUnavailable(e)) return fallback();
      throw e;
    }
  }

  // ---------------------------------------------------------------------------- carryover extension

  /**
   * The carryover extension (09 §6.4), a session start task: months Actual creates as the calendar moves
   * start with carryover off, so every category on in `carryoverSeenEnd` is set on again from that
   * month, which reaches the new months. The new `bounds.end` is then stored in `ad:budget`. Call inside
   * a write job.
   */
  async extendCarryover(): Promise<void> {
    const months = await this.actual.getBudgetMonths();
    const lastMonth = months.at(-1);
    if (!lastMonth) return;
    const boundsEnd = nextMonth(lastMonth as Month);
    const meta = await this.metadata.read<BudgetMeta>(reservedIds.budget, RESERVED.budget);
    const seen = meta.carryoverSeenEnd;
    if (seen !== undefined && boundsEnd <= seen) return;
    if (seen !== undefined && months.includes(seen)) {
      const month = await this.actual.getBudgetMonth(seen);
      const on = month.categoryGroups
        .filter((g) => g.is_income !== true)
        .flatMap((g) => g.categories ?? [])
        .filter((c) => c.carryover === true)
        .map((c) => c.id);
      if (on.length > 0) {
        await this.actual.batchBudgetUpdates(async () => {
          for (const id of on) await this.actual.setBudgetCarryover(seen, id, true);
        });
      }
    }
    await this.metadata.modifyInJob<BudgetMeta>(reservedIds.budget, RESERVED.budget, (v) => ({
      ...v,
      carryoverSeenEnd: boundsEnd,
    }));
  }
}

/** A schedule's amount: `num1` for `isbetween` (12 §1). */
function amountOf(s: RawSchedule): Money | null {
  const a = s.amount;
  if (typeof a === 'number') return a;
  if (a && typeof a === 'object') return a.num1;
  return null;
}
