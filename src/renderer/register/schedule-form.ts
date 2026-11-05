// The Schedule dialog's form (12 §3.1): a schedule, a new one or a register transaction's draft as the
// dialog edits it, and the `schedules.save` parameters it becomes. The transaction part is the register's
// EditableTransaction, so the payee, category and split helpers of 11 work on it unchanged.
import { addDays } from '@shared/dates';
import type {
  Account,
  Id,
  ISODate,
  Money,
  Payee,
  RecurConfig,
  Schedule,
  ScheduleDraft,
  ScheduleLine,
} from '@shared/domain/types';
import type { ScheduleEdit, ScheduleMatchQuery } from '@shared/rpc/host-api';
import { isRecurConfig, toScheduleDate } from '@shared/schedule/frequency';
import { lineKey, linesOf, payeeRefOf, type EditableTransaction, type EditTexts } from './editable';

export interface ScheduleForm {
  /** Null for a new schedule. */
  id: Id | null;
  name: string;
  /** Account, payee, category, split lines and notes; `amount` is set from the fields below on save. */
  tx: EditableTransaction;
  amountOp: Schedule['amountOp'];
  outflow: boolean;
  /** The amount's magnitude, and "is between"'s other end. */
  magnitude: Money;
  magnitude2: Money;
  /** Off: Once on `once`. On: `config`. */
  repeats: boolean;
  once: ISODate;
  config: RecurConfig;
  postsTransaction: boolean;
}

/** The parts a form is built from: a saved schedule, a draft, or nothing yet. */
interface FormSource {
  id: Id | null;
  name: string;
  accountId: Id;
  date: ISODate | RecurConfig;
  payeeId: Id | null;
  transferAccountId: Id | null;
  categoryId: Id | null;
  notes: string;
  amountOp: Schedule['amountOp'];
  amount: Money;
  amount2: Money | null;
  lines: readonly ScheduleLine[];
  postsTransaction: boolean;
}

export interface FormContext extends EditTexts {
  payees: readonly Payee[];
  accounts: ReadonlyMap<Id, Account>;
  today: ISODate;
}

function formOf(src: FormSource, ctx: FormContext): ScheduleForm {
  const transferName = (id: Id | null): string => {
    const a = id ? ctx.accounts.get(id) : undefined;
    return a ? ctx.transfer(a.name) : '';
  };
  const split = src.lines.length > 0;
  const first = isRecurConfig(src.date) ? src.date.start : src.date;
  const sign = src.amount !== 0 ? src.amount : (src.amount2 ?? 0);
  return {
    id: src.id,
    name: src.name,
    tx: {
      id: src.id,
      accountId: src.accountId,
      date: first,
      checkNumber: '',
      payeeText: src.transferAccountId
        ? transferName(src.transferAccountId)
        : (ctx.payees.find((p) => p.id === src.payeeId)?.name ?? ''),
      payeeId: src.transferAccountId ? null : src.payeeId,
      transferAccountId: src.transferAccountId,
      categoryText: split ? '' : ctx.categoryText(src.categoryId),
      categoryId: split ? null : src.categoryId,
      split,
      lines: src.lines.map((l) => ({
        key: lineKey(),
        id: null,
        payeeText: transferName(l.transferAccountId),
        transferAccountId: l.transferAccountId,
        categoryText: ctx.categoryText(l.categoryId),
        categoryId: l.categoryId,
        notes: l.notes,
        amount: l.amount,
      })),
      notes: src.notes,
      amount: src.amount,
      cleared: 'U',
      needsReview: false,
    },
    amountOp: src.amountOp,
    outflow: sign <= 0,
    magnitude: Math.abs(src.amount),
    magnitude2: Math.abs(src.amount2 ?? src.amount),
    repeats: isRecurConfig(src.date),
    once: isRecurConfig(src.date) ? src.date.start : src.date,
    // A JSON copy: the config may be reactive (a proxy can't be structured-cloned), and it is JSON.
    config: isRecurConfig(src.date)
      ? (JSON.parse(JSON.stringify(src.date)) as RecurConfig)
      : (toScheduleDate('Monthly', src.date) as RecurConfig),
    postsTransaction: src.postsTransaction,
  };
}

/** A new schedule (12 §1): Monthly from tomorrow, auto-added, "is exactly". */
export function newForm(accountId: Id, ctx: FormContext): ScheduleForm {
  return formOf(
    {
      id: null,
      name: '',
      accountId,
      date: toScheduleDate('Monthly', addDays(ctx.today, 1)),
      payeeId: null,
      transferAccountId: null,
      categoryId: null,
      notes: '',
      amountOp: 'is',
      amount: 0,
      amount2: null,
      lines: [],
      postsTransaction: true,
    },
    ctx,
  );
}

export function scheduleForm(s: Schedule, fallbackAccountId: Id, ctx: FormContext): ScheduleForm {
  return formOf(
    {
      id: s.id,
      name: s.name ?? '',
      accountId: s.accountId ?? fallbackAccountId,
      date: (s.raw.date || s.nextDate) as ISODate | RecurConfig,
      payeeId: s.payeeId,
      transferAccountId: s.transferAccountId,
      categoryId: s.categoryId,
      notes: s.notes,
      amountOp: s.amountOp,
      amount: s.amount,
      amount2: s.amount2,
      lines: s.subtransactions,
      postsTransaction: s.postsTransaction,
    },
    ctx,
  );
}

/** Make recurring… / Move to scheduler… (12 §4). */
export function draftForm(d: ScheduleDraft, ctx: FormContext): ScheduleForm {
  return formOf(
    {
      id: null,
      name: '',
      accountId: d.accountId,
      date: d.date,
      payeeId: d.payeeId,
      transferAccountId: d.transferAccountId,
      categoryId: d.categoryId,
      notes: d.notes,
      amountOp: 'is',
      amount: d.amount,
      amount2: null,
      lines: d.subtransactions,
      postsTransaction: true,
    },
    ctx,
  );
}

/** The signed amounts (12 §1): the same sign, the smaller magnitude first for "is between". */
export function amountsOf(f: ScheduleForm): { amount: Money; amount2?: Money } {
  const signed = (m: Money): Money => (m === 0 ? 0 : f.outflow ? -m : m);
  if (f.amountOp !== 'isbetween') return { amount: signed(f.magnitude) };
  const [lo, hi] =
    f.magnitude <= f.magnitude2 ? [f.magnitude, f.magnitude2] : [f.magnitude2, f.magnitude];
  return { amount: signed(lo), amount2: signed(hi) };
}

/**
 * The schedule's `date`: a plain copy of the config, since the form is reactive and a proxy can't be
 * posted to the host.
 */
export const dateOf = (f: ScheduleForm): ISODate | RecurConfig =>
  f.repeats ? (JSON.parse(JSON.stringify(f.config)) as RecurConfig) : f.once;

/** Find matching transactions' query (12 §3.1). */
export function matchQueryOf(f: ScheduleForm, payees: readonly Payee[]): ScheduleMatchQuery {
  return {
    accountId: f.tx.accountId,
    payee: payeeRefOf(f.tx, payees),
    date: dateOf(f),
    amountOp: f.amountOp,
    ...amountsOf(f),
  };
}

/** `schedules.save`'s parameters. The split rules (11 §7.3) have already run on `tx`. */
export function toEdit(
  f: ScheduleForm,
  payees: readonly Payee[],
  links: { link: readonly Id[]; unlink: readonly Id[]; moveFrom: Id | null },
): ScheduleEdit {
  const d = f.tx;
  return {
    ...(f.id === null ? {} : { id: f.id }),
    name: f.name.trim(),
    accountId: d.accountId,
    date: dateOf(f),
    payee: payeeRefOf(d, payees),
    categoryId: d.split ? null : d.categoryId,
    notes: d.notes.trim(),
    amountOp: f.amountOp,
    ...amountsOf(f),
    postsTransaction: f.postsTransaction,
    ...(d.split ? { lines: linesOf(d) } : {}),
    ...(links.link.length > 0 ? { link: [...links.link] } : {}),
    ...(links.unlink.length > 0 ? { unlink: [...links.unlink] } : {}),
    ...(links.moveFrom ? { moveFrom: links.moveFrom } : {}),
  };
}
