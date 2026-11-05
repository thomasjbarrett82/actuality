// The schedules service (03 §8 `schedules.*`; 12). Schedules are Actual's, and Actual's own schedule
// service posts due occurrences (12 §2), so this only reads them, saves the Schedule dialog's edits (the
// schedule, the template actions on its rule and the transactions it links, as one job), and runs the
// scheduler's actions. Occurrence dates always come from Actual's internal `schedule/get-upcoming-dates`,
// and matching transactions from Actual's own conditions (12 §1, §3.1).
import { addMonths, daysInMonth, monthOf, parts, today, toISODate } from '@shared/dates';
import type {
  Id,
  ISODate,
  Money,
  RecurConfig,
  Schedule,
  ScheduleDraft,
  ScheduleLine,
  ScheduleMatch,
} from '@shared/domain/types';
import { decode, encode } from '@shared/metadata/notes-codec';
import type { PayeeRef, ScheduleEdit, ScheduleMatchQuery } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { frequencyOf, isRecurConfig, toScheduleDate } from '@shared/schedule/frequency';
import { readTemplate, writeTemplate, type Template } from '@shared/schedule/template';
import {
  UNAVAILABLE_HANDLER,
  type ActualApi,
  type RawAccount,
  type RawPayee,
  type RawRow,
  type RawRule,
  type RawRuleCondition,
  type RawSchedule,
  type ScheduleAmount,
  type SubTransactionInput,
} from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import { addRestoring } from './restore';
import { transferPayeeOf } from './transactions';

const TABLES = ['schedules', 'rules', 'transactions', 'payees'];
/** `get-upcoming-dates` batch size for Make recurring's first date (12 §4). */
const DATES_BATCH = 12;
/** Find matching transactions lists at most this many (12 §3.1). */
const MATCHES_MAX = 100;

const isUnavailable = (e: unknown): boolean =>
  e instanceof RpcError &&
  (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER;

/** A schedule's amount: `num1` for `isbetween` (12 §1). */
function amountOf(s: RawSchedule): Money {
  const a = s.amount;
  if (typeof a === 'number') return a;
  if (a && typeof a === 'object') return a.num1;
  return 0;
}

/** `num2` of an `isbetween` amount. */
const amount2Of = (s: RawSchedule): Money | null =>
  s.amount && typeof s.amount === 'object' ? s.amount.num2 : null;

/** The amount Actual stores for an edit: `{ num1, num2 }` for `isbetween` (12 §1). */
const amountFor = (e: {
  amountOp: string;
  amount: Money;
  amount2?: Money | undefined;
}): ScheduleAmount =>
  e.amountOp === 'isbetween' ? { num1: e.amount, num2: e.amount2 ?? e.amount } : e.amount;

/** A value with its object keys sorted, so equal configs compare equal as JSON. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}
const sameDate = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const amountOpOf = (s: RawSchedule): Schedule['amountOp'] =>
  s.amountOp === 'is' || s.amountOp === 'isbetween' ? s.amountOp : 'isapprox';

export class SchedulesService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    /** "Today" (tests). */
    private readonly now: () => Date = () => new Date(),
  ) {}

  private read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(label, fn, { kind: 'read' });
  }

  private write<T>(label: string, fn: () => Promise<T>, transactions = 0): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.connection.write(label, TABLES, fn, { transactions });
  }

  private today(): ISODate {
    return today(this.now());
  }

  // ------------------------------------------------------------------------------------- reads

  /** `schedules.list` (12 §3): not completed; one account's, or every one in All Accounts. */
  list(accountId: Id): Promise<Schedule[]> {
    return this.read('schedules.list', async () => {
      const [schedules, rules, payees] = await Promise.all([
        this.actual.getSchedules(),
        this.actual.getRules(),
        this.actual.getPayees(),
      ]);
      return schedules
        .filter((s) => !s.completed && (accountId === 'all' || s.account === accountId))
        .map((s) => toSchedule(s, rules, payees));
    });
  }

  support(): Promise<{ skip: boolean; upcomingDates: boolean }> {
    return Promise.resolve({
      skip: this.actual.internalHandlerAvailable('schedule/skip-next-date'),
      upcomingDates: this.actual.internalHandlerAvailable('schedule/get-upcoming-dates'),
    });
  }

  /** `schedules.preview` (12 §3.1): an unsaved date's next occurrences, from Actual. */
  preview(p: { date: ScheduleEdit['date']; count: number }): Promise<ISODate[]> {
    return this.read('schedules.preview', async () => {
      if (typeof p.date === 'string') return p.date >= this.today() ? [p.date as ISODate] : [];
      return (await this.actual.getUpcomingDates(p.date, p.count)) as ISODate[];
    });
  }

  /** `schedules.linked` (12 §3.1): the top-level transactions linked to a schedule. */
  linked(id: Id): Promise<ScheduleMatch[]> {
    return this.read('schedules.linked', async () =>
      (await this.actual.linkedTransactions(id)).map(toMatch),
    );
  }

  /**
   * `schedules.matches` (12 §3.1): Actual's matches for the conditions its schedule rule would have. A
   * payee that doesn't exist yet matches nothing; null when Actual lacks the handler.
   */
  matches(q: ScheduleMatchQuery): Promise<ScheduleMatch[] | null> {
    return this.read('schedules.matches', async () => {
      const payeeId = payeeIdOf(q.payee, await this.actual.getPayees());
      if (payeeId === undefined) return [];
      const conditions: RawRuleCondition[] = [
        ...(payeeId === null ? [] : [{ op: 'is', field: 'payee', value: payeeId }]),
        { op: 'is', field: 'account', value: q.accountId },
        { op: 'isapprox', field: 'date', value: q.date },
        { op: q.amountOp, field: 'amount', value: amountFor(q) },
      ];
      try {
        return (await this.actual.scheduleMatches(conditions, MATCHES_MAX)).map(toMatch);
      } catch (e) {
        if (isUnavailable(e)) return null;
        throw e;
      }
    });
  }

  // ------------------------------------------------------------------------------------- save

  /**
   * `schedules.save` (12 §3.1), one job: `createSchedule` (or `updateSchedule` with what changed), then
   * `updateRule` on its rule with the template actions, then the links, then Move to scheduler's original.
   */
  save(edit: ScheduleEdit): Promise<{ id: Id }> {
    const touched = (edit.link?.length ?? 0) + (edit.unlink?.length ?? 0) + (edit.moveFrom ? 1 : 0);
    return this.write(
      'schedules.save',
      async () => {
        const [accounts, payees, schedules] = await Promise.all([
          this.actual.getAccounts(),
          this.actual.getPayees(),
          this.actual.getSchedules(),
        ]);
        const account = accounts.find((a) => a.id === edit.accountId);
        if (!account) throw new RpcError('not-found', 'That account no longer exists.');
        const existing = edit.id ? schedules.find((s) => s.id === edit.id) : undefined;
        if (edit.id && !existing)
          throw new RpcError('not-found', 'That schedule no longer exists.');
        validate(edit, accounts);
        const name = edit.name.trim();
        if (name !== '' && schedules.some((s) => s.id !== edit.id && (s.name ?? '') === name))
          throw new RpcError('validation', 'There is already a schedule with that name.', {
            code: 'name-taken',
          });
        const original = edit.moveFrom ? await this.actual.getTransaction(edit.moveFrom) : null;
        if (edit.moveFrom && !original)
          throw new RpcError('not-found', 'That transaction no longer exists.');
        const date = edit.date as ISODate | RecurConfig;
        const dateChanged = !existing || !sameDate(existing.date, date);
        if (dateChanged) await this.checkDate(date);
        const payee = await this.resolvePayee(edit, payees, accounts);
        const amount = amountFor(edit);

        let id: Id;
        if (!existing) {
          id = await this.actual.createSchedule({
            name,
            postsTransaction: edit.postsTransaction,
            payee: payee.id,
            account: account.id,
            amount,
            amountOp: edit.amountOp,
            date,
          });
        } else {
          id = existing.id;
          await this.actual.updateSchedule(id, {
            ...(name === (existing.name ?? '') ? {} : { name }),
            ...(edit.postsTransaction === (existing.postsTransaction !== false)
              ? {}
              : { postsTransaction: edit.postsTransaction }),
            payee: payee.id,
            account: account.id,
            amount,
            amountOp: edit.amountOp,
            ...(dateChanged ? { date } : {}),
          });
        }
        await this.writeRule(id, payee.id, templateOf(edit, account, accounts, payees));
        await this.writeLinks(id, edit.link ?? [], edit.unlink ?? []);
        if (original) await this.deleteWithMirrors(original.id, original.subtransactions);
        return { id };
      },
      touched,
    );
  }

  /**
   * The dates the app accepts (12 §1): a Once date from today on; a recurring config ending on or after
   * its start, with an occurrence from today on (else Actual's `next_date` would be a past occurrence,
   * which its service posts). Without `get-upcoming-dates` that last check is skipped. Inside a job.
   */
  private async checkDate(date: ISODate | RecurConfig): Promise<void> {
    if (typeof date === 'string') {
      if (date < this.today())
        throw new RpcError('validation', "Transactions can't be scheduled before today.", {
          code: 'date-before-today',
        });
      return;
    }
    if (date.endMode === 'on_date' && date.endDate !== undefined && date.endDate < date.start)
      throw new RpcError('validation', 'The end date is before the start date.', {
        code: 'end-before-start',
      });
    if (!this.actual.internalHandlerAvailable('schedule/get-upcoming-dates')) return;
    let dates: string[];
    try {
      dates = await this.actual.getUpcomingDates(date, 1);
    } catch (e) {
      if (isUnavailable(e)) return;
      throw e;
    }
    if (dates.length === 0)
      throw new RpcError('validation', 'The schedule has no dates from today on.', {
        code: 'no-upcoming',
      });
  }

  /** Links and unlinks the dialog's transactions (12 §3.1). Rows that are gone are skipped. */
  private async writeLinks(id: Id, link: readonly Id[], unlink: readonly Id[]): Promise<void> {
    if (link.length + unlink.length === 0) return;
    const rows = new Map(
      (await this.actual.getTransactionRows({ ids: [...link, ...unlink] })).map((r) => [r.id, r]),
    );
    for (const tid of unlink)
      if (rows.get(tid)?.schedule === id)
        await this.actual.updateTransaction(tid, { schedule: null });
    for (const tid of link) {
      const row = rows.get(tid);
      if (row && !row.isChild && row.schedule !== id)
        await this.actual.updateTransaction(tid, { schedule: id });
    }
  }

  private validateTransferTarget(accountId: Id, accounts: readonly RawAccount[]): void {
    if (!accounts.some((a) => a.id === accountId))
      throw new RpcError('validation', 'The transfer account does not exist.', {
        code: 'invalid-transfer',
      });
  }

  private async resolvePayee(
    edit: ScheduleEdit,
    payees: readonly RawPayee[],
    accounts: readonly RawAccount[],
  ): Promise<{ id: Id | null }> {
    const p = edit.payee;
    switch (p.kind) {
      case 'none':
        return { id: null };
      case 'existing':
        if (!payees.some((x) => x.id === p.id))
          throw new RpcError('not-found', 'That payee no longer exists.');
        return { id: p.id };
      case 'transfer':
        this.validateTransferTarget(p.accountId, accounts);
        return { id: transferPayeeOf(payees, p.accountId) };
      case 'new': {
        const name = p.name.trim();
        const found = payees.find(
          (x) => !x.transferAcct && x.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
        return { id: found ? found.id : await this.actual.createPayee(name) };
      }
    }
  }

  /**
   * The schedule's rule gets the template actions (12 §1); `link-schedule` and actions the app doesn't
   * write are kept. With no payee the payee condition goes: Actual would match on a payee named "null".
   */
  private async writeRule(scheduleId: Id, payeeId: Id | null, template: Template): Promise<void> {
    const schedule = (await this.actual.getSchedules()).find((s) => s.id === scheduleId);
    const rule = (await this.actual.getRules()).find((r) => r.id === schedule?.ruleId);
    if (!rule) throw new RpcError('internal', 'The schedule has no rule.');
    const conditions =
      payeeId === null ? rule.conditions.filter((c) => c.field !== 'payee') : rule.conditions;
    await this.actual.updateRule({
      ...rule,
      conditions,
      actions: writeTemplate(rule.actions, template),
    });
  }

  // ---------------------------------------------------------------------------------- actions

  /** `schedules.delete` (12 §3): no confirmation, no undo. */
  delete(ids: readonly Id[]): Promise<null> {
    return this.write('schedules.delete', async () => {
      const known = new Set((await this.actual.getSchedules()).map((s) => s.id));
      for (const id of ids) if (known.has(id)) await this.actual.deleteSchedule(id);
      return null;
    });
  }

  /**
   * Enter in register now (12 §3), one job: each occurrence is added approved and linked to its schedule,
   * what Actual's rule rewrites is restored, then a recurring schedule skips to its next date and a Once
   * schedule is deleted. Without the skip handler, recurring ones advance when Actual's service runs.
   */
  enterNow(ids: readonly Id[]): Promise<{ ids: Id[] }> {
    return this.write(
      'schedules.enterNow',
      async () => {
        const [schedules, rules, payees, accounts] = await Promise.all([
          this.actual.getSchedules(),
          this.actual.getRules(),
          this.actual.getPayees(),
          this.actual.getAccounts(),
        ]);
        const out: Id[] = [];
        for (const id of ids) {
          const raw = schedules.find((s) => s.id === id);
          if (!raw || raw.completed || !raw.account || !raw.nextDate) continue;
          const s = toSchedule(raw, rules, payees);
          const account = accounts.find((a) => a.id === raw.account);
          if (!account) continue;
          const txId = crypto.randomUUID();
          const lines = s.subtransactions.map((l): SubTransactionInput => ({
            amount: l.amount,
            payee: l.payeeId,
            category: account.offbudget ? null : l.categoryId,
            notes: encode({ notes: l.notes, checkNumber: null, needsReview: false }),
          }));
          await addRestoring(this.actual, account.id, {
            id: txId,
            date: raw.nextDate,
            amount: s.amount,
            payee: raw.payee,
            category: lines.length > 0 || account.offbudget ? null : s.categoryId,
            notes: encode({ notes: s.notes, checkNumber: null, needsReview: false }),
            cleared: false,
            reconciled: false,
            schedule: id,
            ...(lines.length > 0 ? { subtransactions: lines } : {}),
          });
          out.push(txId);
          await this.advance(raw);
        }
        return { ids: out };
      },
      ids.length * 2,
    );
  }

  /** Moves a schedule past the occurrence just entered. Inside a job. */
  private async advance(raw: RawSchedule): Promise<void> {
    if (typeof raw.date === 'string') {
      await this.actual.deleteSchedule(raw.id);
      return;
    }
    if (!this.actual.internalHandlerAvailable('schedule/skip-next-date')) return;
    try {
      await this.actual.skipNextDate(raw.id);
    } catch (e) {
      if (!isUnavailable(e)) throw e;
    }
  }

  /** Skip this payment (12 §3): `next_date` moves on without entering anything. No effect on Once. */
  skip(ids: readonly Id[]): Promise<null> {
    return this.write('schedules.skip', async () => {
      const schedules = await this.actual.getSchedules();
      const recurring = ids.some((id) => {
        const schedule = schedules.find((x) => x.id === id);
        return schedule && !schedule.completed && typeof schedule.date !== 'string';
      });
      if (recurring && !this.actual.internalHandlerAvailable('schedule/skip-next-date'))
        throw new RpcError(
          'actual',
          'This version of Actual does not support skipping schedules.',
          {
            code: UNAVAILABLE_HANDLER,
          },
        );
      for (const id of ids) {
        const s = schedules.find((x) => x.id === id);
        if (!s || s.completed || typeof s.date === 'string') continue;
        await this.actual.skipNextDate(id);
      }
      return null;
    });
  }

  /**
   * Move to account (12 §3). A transfer into the target itself is refused, and so is a split with a
   * transfer line into it, as for transactions (10 §6.1).
   */
  moveToAccount(ids: readonly Id[], accountId: Id): Promise<null> {
    return this.write('schedules.moveToAccount', async () => {
      const [accounts, payees, schedules, rules] = await Promise.all([
        this.actual.getAccounts(),
        this.actual.getPayees(),
        this.actual.getSchedules(),
        this.actual.getRules(),
      ]);
      const target = accounts.find((a) => a.id === accountId);
      if (!target || target.closed)
        throw new RpcError('not-found', 'That account no longer exists.');
      const own = payees.find((p) => p.transferAcct === accountId)?.id;
      const moving = schedules.filter((s) => ids.includes(s.id) && s.account !== accountId);
      const linePayees = (s: RawSchedule): (Id | null)[] =>
        readTemplate(rules.find((r) => r.id === s.ruleId)?.actions ?? [], amountOf(s)).lines.map(
          (l) => l.payeeId,
        );
      if (own !== undefined && moving.some((s) => s.payee === own || linePayees(s).includes(own)))
        throw new RpcError('validation', 'A transfer cannot be moved into its own account.', {
          code: 'transfer-into-target',
        });
      for (const s of moving) await this.actual.updateSchedule(s.id, { account: accountId });
      return null;
    });
  }

  /**
   * `schedules.draftFromTransaction` (12 §4): the Schedule dialog's pre-fill. Recurring: Monthly from the
   * first occurrence after today (Actual's dates, else the transaction's date + 1 month). Move: Once on
   * the transaction's date, which must be after today. A read: nothing is written until the dialog saves.
   */
  draftFromTransaction(id: Id, mode: 'recurring' | 'move'): Promise<ScheduleDraft> {
    return this.read('schedules.draftFromTransaction', async () => {
      const t = await this.actual.getTransaction(id);
      if (!t) throw new RpcError('not-found', 'That transaction no longer exists.');
      if (t.parentId)
        throw new RpcError('validation', 'A split line is scheduled through its split.');
      const payees = await this.actual.getPayees();
      const transferOf = (payeeId: Id | null): Id | null =>
        payeeId ? (payees.find((p) => p.id === payeeId)?.transferAcct ?? null) : null;
      const lines = t.subtransactions.map((l): ScheduleLine => {
        const transfer = transferOf(l.payee);
        return {
          amount: l.amount,
          method: 'fixed-amount',
          payeeId: transfer ? l.payee : null,
          transferAccountId: transfer,
          categoryId: transfer ? null : l.category,
          notes: decode(l.notes).notes,
        };
      });
      const today = this.today();
      let date: ISODate | RecurConfig;
      if (mode === 'move') {
        if (t.date <= today)
          throw new RpcError('validation', 'Only a transaction dated after today can be moved.', {
            code: 'date-not-future',
          });
        date = t.date as ISODate;
      } else {
        const start = await this.firstMonthlyAfter(t.date as ISODate, today);
        date = toScheduleDate('Monthly', start);
      }
      return {
        accountId: t.account,
        date,
        payeeId: t.payee,
        transferAccountId: transferOf(t.payee),
        categoryId: lines.length > 0 ? null : t.category,
        notes: decode(t.notes).notes,
        amount: t.amount,
        subtransactions: lines,
      };
    });
  }

  /** The first monthly occurrence (same day as `date`) after today. Inside a job. */
  private async firstMonthlyAfter(date: ISODate, today: ISODate): Promise<ISODate> {
    const fallback = (): ISODate => {
      const { d } = parts(date);
      let month = addMonths(monthOf(date), 1);
      for (;;) {
        const [y, m] = month.split('-').map(Number) as [number, number];
        const next = toISODate(y, m, Math.min(d, daysInMonth(y, m)));
        if (next > today) return next;
        month = addMonths(month, 1);
      }
    };
    if (!this.actual.internalHandlerAvailable('schedule/get-upcoming-dates')) return fallback();
    try {
      const dates = await this.actual.getUpcomingDates(
        toScheduleDate('Monthly', date),
        DATES_BATCH,
      );
      return (dates.find((d) => d > today) as ISODate | undefined) ?? fallback();
    } catch (e) {
      if (isUnavailable(e)) return fallback();
      throw e;
    }
  }

  /** Deletes a transaction, and the mirrors of a split's transfer lines, which Actual only unlinks. */
  private async deleteWithMirrors(
    id: Id,
    lines: readonly { transferId: Id | null }[],
  ): Promise<void> {
    await this.actual.deleteTransaction(id);
    for (const l of lines) {
      if (!l.transferId) continue;
      const [mirror] = await this.actual.getTransactionRows({ ids: [l.transferId] });
      if (mirror) await this.actual.deleteTransaction(mirror.id);
    }
  }
}

type TemplateLine = Template['lines'][number];

/** A payee reference's id for matching: null for none, undefined for a payee that doesn't exist yet. */
function payeeIdOf(ref: PayeeRef, payees: readonly RawPayee[]): Id | null | undefined {
  switch (ref.kind) {
    case 'none':
      return null;
    case 'existing':
      return ref.id;
    case 'transfer':
      return payees.find((p) => p.transferAcct === ref.accountId)?.id;
    case 'new': {
      const name = ref.name.trim().toLocaleLowerCase();
      return payees.find((p) => !p.transferAcct && p.name.toLocaleLowerCase() === name)?.id;
    }
  }
}

const toMatch = (r: RawRow): ScheduleMatch => ({
  id: r.id,
  accountId: r.account,
  date: r.date as ISODate,
  payeeId: r.payee,
  notes: decode(r.notes).notes,
  amount: r.amount,
});

function validate(edit: ScheduleEdit, accounts: readonly RawAccount[]): void {
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

/** The template an edit saves. Categories that can't apply (off-budget, on↔on transfers) are dropped. */
function templateOf(
  edit: ScheduleEdit,
  account: RawAccount,
  accounts: readonly RawAccount[],
  payees: readonly RawPayee[],
): Template {
  const isOnOn = (target: Id | null): boolean =>
    target !== null &&
    !account.offbudget &&
    accounts.find((a) => a.id === target)?.offbudget === false;
  const transferTarget = edit.payee.kind === 'transfer' ? edit.payee.accountId : null;
  const lines = (edit.lines ?? []).map((l): TemplateLine => ({
    amount: l.amount,
    method: 'fixed-amount',
    payeeId: l.transferAccountId === null ? null : transferPayeeOf(payees, l.transferAccountId),
    categoryId: account.offbudget || isOnOn(l.transferAccountId) ? null : l.categoryId,
    notes: l.notes.trim(),
  }));
  return {
    categoryId:
      lines.length > 0 || account.offbudget || isOnOn(transferTarget) ? null : edit.categoryId,
    notes: edit.notes.trim(),
    lines,
  };
}

/** Actual's schedule as the app shows it (12 §1). */
export function toSchedule(
  s: RawSchedule,
  rules: readonly RawRule[],
  payees: readonly RawPayee[],
): Schedule {
  const amount = amountOf(s);
  const rule = rules.find((r) => r.id === s.ruleId);
  const template = readTemplate(rule?.actions ?? [], amount);
  const transferOf = (payeeId: Id | null): Id | null =>
    payeeId ? (payees.find((p) => p.id === payeeId)?.transferAcct ?? null) : null;
  const freq = frequencyOf(s.date);
  const date = typeof s.date === 'string' || isRecurConfig(s.date) ? s.date : '';
  return {
    id: s.id,
    name: s.name ?? null,
    accountId: s.account,
    nextDate: (s.nextDate ?? (typeof s.date === 'string' ? s.date : '')) as ISODate,
    frequency: freq.frequency,
    twiceAMonthStartDay: freq.twiceAMonthStartDay,
    payeeId: s.payee,
    transferAccountId: transferOf(s.payee),
    categoryId: template.categoryId,
    notes: template.notes,
    amount,
    amountOp: amountOpOf(s),
    amount2: amount2Of(s),
    subtransactions: template.lines.map((l): ScheduleLine => ({
      amount: l.amount,
      method: l.method,
      payeeId: l.payeeId,
      transferAccountId: transferOf(l.payeeId),
      categoryId: l.categoryId,
      notes: l.notes,
    })),
    postsTransaction: s.postsTransaction !== false,
    completed: s.completed,
    raw: { date, ruleId: s.ruleId ?? '' },
  };
}
