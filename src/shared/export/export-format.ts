// Export file formats (16 §2): the register and budget CSVs, and one QIF per account. Pure builders, so
// they're golden-file tested. Headers and QIF codes are English in every UI language, so the files can be
// re-imported anywhere (20 §3.8).
import type { BudgetFormat } from '../budget-format';
import { dateOrder } from '../dates';
import { categoryLabel } from '../domain/categories';
import { ENGLISH_TRANSFER_PREFIX } from '../domain/payees';
import type {
  Account,
  BudgetMonthView,
  CategoryGroup,
  Id,
  ISODate,
  Money,
  Transaction,
} from '../domain/types';
import { currencyPlain, dateLongYear, monthHeader } from '../format';
import { separators, type MoneySettings } from '../money';

const BOM = '\uFEFF';

/** A field separator: Tab when the decimal separator is "," (16 §2.2). */
export const csvSeparator = (money: MoneySettings): string =>
  separators(money.numberFormat).decimal === ',' ? '\t' : ',';

/** A quoted text field, quotes doubled. */
export const quoted = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** A CSV document: BOM, `\n` line ends, the separator from the number format. */
export function csvDocument(lines: readonly (readonly string[])[], money: MoneySettings): string {
  const sep = csvSeparator(money);
  return BOM + lines.map((l) => l.join(sep)).join('\n') + '\n';
}

/** An amount with no symbol and no thousands separator, in the budget's decimal separator. */
export const plainAmount = (m: Money, money: MoneySettings): string => currencyPlain(m, money);

export interface ExportContext {
  format: BudgetFormat;
  accounts: readonly Account[];
  groups: readonly CategoryGroup[];
}

function categoryOf(
  ctx: ExportContext,
  id: Id | null,
): { label: string; master: string; sub: string } {
  for (const g of ctx.groups) {
    const c = id ? g.categories.find((x) => x.id === id) : undefined;
    if (c) return { label: categoryLabel(g, c), master: g.name, sub: c.name };
  }
  return { label: '', master: '', sub: '' };
}

const transferText = (ctx: ExportContext, accountId: Id): string =>
  `${ENGLISH_TRANSFER_PREFIX} ${ctx.accounts.find((a) => a.id === accountId)?.name ?? ''}`;

/** A transaction's payee text: transfers read "Transfer : X". */
const payeeOf = (
  ctx: ExportContext,
  t: { transferAccountId: Id | null; payeeName: string },
): string => (t.transferAccountId ? transferText(ctx, t.transferAccountId) : t.payeeName);

/** Export order: by date, then by id, so the file is the same every time. */
export function exportOrder(ts: readonly Transaction[]): Transaction[] {
  return [...ts].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
  );
}

/**
 * The register CSV (16 §2.2): `Account, Check Number, Date, Payee, Category, Master Category,
 * Sub Category, Notes, Outflow, Inflow, Cleared, Running Balance`, account by account. A split writes one
 * line per subtransaction (tags stay in the Notes text); cleared, check number and running balance come from the parent.
 */
export function registerCsv(
  ctx: ExportContext,
  blocks: readonly { account: Account; transactions: readonly Transaction[] }[],
): string {
  const money = ctx.format.money;
  const amount = (m: Money): [string, string] =>
    m < 0
      ? [plainAmount(-m, money), plainAmount(0, money)]
      : [plainAmount(0, money), plainAmount(m, money)];
  const lines: string[][] = [
    [
      'Account',
      'Check Number',
      'Date',
      'Payee',
      'Category',
      'Master Category',
      'Sub Category',
      'Notes',
      'Outflow',
      'Inflow',
      'Cleared',
      'Running Balance',
    ].map(quoted),
  ];
  for (const { account, transactions } of blocks) {
    let running = 0;
    for (const t of exportOrder(transactions)) {
      running += t.amount;
      const common = {
        check: t.checkNumber ?? '',
        date: dateLongYear(t.date, ctx.format.dateFormat),
        cleared: t.cleared,
        balance: plainAmount(running, money),
      };
      const parentPayee = payeeOf(ctx, t);
      const rows =
        t.subtransactions.length === 0
          ? [{ payee: parentPayee, categoryId: t.categoryId, notes: t.notes, amount: t.amount }]
          : t.subtransactions.map((l, i, all) => {
              const head = `(Split ${String(i + 1)}/${String(all.length)}) `;
              const notes = [l.notes, t.notes].filter((m) => m !== '').join(' / ');
              return {
                payee: l.transferAccountId
                  ? `${t.payeeName} / ${transferText(ctx, l.transferAccountId)}`
                  : parentPayee,
                categoryId: l.categoryId,
                notes: head + notes,
                amount: l.amount,
              };
            });
      for (const r of rows) {
        const c = categoryOf(ctx, r.categoryId);
        const [out, inn] = amount(r.amount);
        lines.push([
          quoted(account.name),
          common.check,
          common.date,
          quoted(r.payee),
          quoted(c.label),
          quoted(c.master),
          quoted(c.sub),
          quoted(r.notes),
          out,
          inn,
          common.cleared,
          common.balance,
        ]);
      }
    }
  }
  return csvDocument(lines, money);
}

/**
 * The budget CSV (16 §2.2): `Month, Category, Master Category, Sub Category, Budgeted, Outflows, Category
 * Balance`, one line per expense category per month with a blank line after each month. Months are named
 * in English ("MMMM YYYY").
 */
export function budgetCsv(ctx: ExportContext, months: readonly BudgetMonthView[]): string {
  const money = ctx.format.money;
  const lines: string[][] = [
    [
      'Month',
      'Category',
      'Master Category',
      'Sub Category',
      'Budgeted',
      'Outflows',
      'Category Balance',
    ].map(quoted),
  ];
  for (const m of months) {
    const name = monthHeader(m.month);
    for (const g of ctx.groups.filter((x) => !x.isIncome)) {
      const view = m.groups.find((x) => x.id === g.id);
      for (const c of g.categories) {
        const v = view?.categories.find((x) => x.id === c.id);
        lines.push([
          quoted(name),
          quoted(categoryLabel(g, c)),
          quoted(g.name),
          quoted(c.name),
          plainAmount(v?.budgeted ?? 0, money),
          plainAmount(v?.activity ?? 0, money),
          plainAmount(v?.balance ?? 0, money),
        ]);
      }
    }
    lines.push([]);
  }
  return csvDocument(lines, money);
}

/** The months to export (16 §2.2): from the first to the last month with data. */
export function monthsWithData(views: readonly BudgetMonthView[]): BudgetMonthView[] {
  const has = (v: BudgetMonthView): boolean =>
    v.hasRealData ||
    v.groups.some((g) => g.categories.some((c) => c.budgeted !== 0 || c.activity !== 0));
  const first = views.findIndex(has);
  if (first === -1) return [];
  const last = views.length - 1 - [...views].reverse().findIndex(has);
  return views.slice(first, last + 1);
}

/**
 * One account's QIF (16 §2.3): `!Type:Bank`, then D (month-first or day-first), T (`.` decimal), P, M, N,
 * C (`c` cleared, `R` reconciled), L ("Group: Category" or `Split Transaction`), split lines S/E/$, `^`.
 */
export function qifFile(ctx: ExportContext, transactions: readonly Transaction[]): string {
  const money = ctx.format.money;
  const monthFirst = dateOrder(ctx.format.dateFormat) !== 'DMY';
  const date = (d: ISODate): string => {
    const [y, m, day] = d.split('-');
    return monthFirst ? `${m ?? ''}/${day ?? ''}/${y ?? ''}` : `${day ?? ''}/${m ?? ''}/${y ?? ''}`;
  };
  const amount = (m: Money): string => currencyPlain(m, money, '.');
  const out: string[] = ['!Type:Bank'];
  for (const t of exportOrder(transactions)) {
    out.push(`D${date(t.date)}`, `T${amount(t.amount)}`);
    const payee = payeeOf(ctx, t);
    if (payee) out.push(`P${payee}`);
    if (t.notes) out.push(`M${t.notes}`);
    if (t.checkNumber) out.push(`N${t.checkNumber}`);
    if (t.cleared === 'C') out.push('Cc');
    if (t.cleared === 'R') out.push('CR');
    if (t.subtransactions.length > 0) {
      out.push('LSplit Transaction');
      for (const l of t.subtransactions) {
        const c = categoryOf(ctx, l.categoryId).label;
        out.push(`S${l.transferAccountId ? transferText(ctx, l.transferAccountId) : c}`);
        if (l.notes) out.push(`E${l.notes}`);
        out.push(`$${amount(l.amount)}`);
      }
    } else {
      const c = categoryOf(ctx, t.categoryId).label;
      if (c) out.push(`L${c}`);
    }
    out.push('^');
  }
  return out.join('\n') + '\n';
}

/** `YYYY-MM-DD HHmm` for export file names (16 §2.1). */
export function exportTimestamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

/** A name that every OS accepts as a file name: reserved characters become "-". */
export const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '-').trim();
