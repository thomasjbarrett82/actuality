// File ▸ Print… (16 §3): the print view of the screen shown, in the preview window. Register: the account
// (or All Accounts) with its search and date filter, the totals, and the visible columns at widths in
// proportion to the screen's, split lines as indented rows. Budget: the selected month's summary and its
// categories (09).
import { nextMonth, prevMonth } from '@shared/dates';
import { dateShort, monthShortYear } from '@shared/format';
import { hiddenCategoryIds, hiddenTotals } from '../budget/budget-model';
import type { BudgetScreen } from '../budget/use-budget';
import { dateLocale } from '../i18n';
import { tr } from '../register/dialogs';
import { layoutOf } from '../register/layout';
import { quotedSearch } from '../register/search';
import type { Register } from '../register/use-register';
import { useSettings } from '../stores/settings';
import { amountCell, esc, PRINT_PALETTES, printAmount, printDocument } from './print-view';

const palette = () => PRINT_PALETTES[useSettings().app.colorVision === 'cvd' ? 'cvd' : 'standard'];

async function show(title: string, body: string, pdfName: string): Promise<void> {
  await window.app.shell.printPreview({ html: printDocument(title, body, palette()), pdfName });
}

const REGISTER_HEADS: Record<string, string> = {
  account: 'app.regAccountHeader',
  check: 'register.columnCheckNumber',
  date: 'register.columnDate',
  payee: 'register.columnPayee',
  category: 'register.columnCategory',
  notes: 'register.columnNotes',
  outflow: 'register.columnOutflow',
  inflow: 'register.columnInflow',
  balance: 'register.columnBalance',
  cleared: 'register.columnCleared',
};

/** The register's printout (16 §3). */
export async function printRegister(reg: Register): Promise<void> {
  const layout = layoutOf(reg.visible, reg.columns).filter(
    (c) => c.field !== 'select' && c.field !== 'error',
  );
  const total = layout.reduce((s, c) => s + c.width, 0);
  const money = reg.format.money;
  const name = reg.isAll ? tr('app.sidebarAllAccounts') : (reg.account?.name ?? '');
  const search = quotedSearch(reg.appliedSearch);
  const meta = [
    [tr('app.prnShowing'), dateFilterText(reg)],
    ...(search ? [[tr('app.prnSearch'), search]] : []),
    ...(reg.searching
      ? [
          [
            tr('app.regSearchTotal', { n: reg.searchTotal.count }),
            printAmount(reg.searchTotal.total, money),
          ],
        ]
      : []),
    [tr('app.regClearedBalance'), printAmount(reg.balancesTotal.cleared, money)],
    [tr('app.regUnclearedTransactions'), printAmount(reg.balancesTotal.uncleared, money)],
    [tr('app.regWorkingBalance'), printAmount(reg.balancesTotal.working, money)],
  ];
  const cols = layout
    .map((c) => `<col style="width:${((c.width / total) * 100).toFixed(2)}%">`)
    .join('');
  const head = layout
    .map(
      (c) =>
        `<th${c.field === 'outflow' || c.field === 'inflow' || c.field === 'balance' ? ' class="num"' : ''}>${esc(tr(REGISTER_HEADS[c.field] ?? 'register.columnDate'))}</th>`,
    )
    .join('');
  const balances = new Map(
    reg.items.flatMap((i) => (i.kind === 'row' ? [[i.row.t.id, i.balance] as const] : [])),
  );
  const rows: string[] = [];
  for (const s of reg.shown) {
    const t = s.row.t;
    const cells = layout.map((c) => {
      switch (c.field) {
        case 'account':
          return `<td>${esc(s.row.accountName)}</td>`;
        case 'check':
          return `<td>${esc(t.checkNumber ?? '')}</td>`;
        case 'date':
          return `<td>${esc(dateShort(t.date, reg.format.dateFormat))}</td>`;
        case 'payee':
          return `<td>${esc(s.row.payeeText)}</td>`;
        case 'category':
          return `<td>${esc(s.row.categoryText)}</td>`;
        case 'notes':
          return `<td>${esc(t.notes)}</td>`;
        case 'outflow':
          return t.amount < 0 ? amountCell(-t.amount, money) : '<td></td>';
        case 'inflow':
          return t.amount > 0 ? amountCell(t.amount, money) : '<td></td>';
        case 'balance': {
          const b = balances.get(t.id);
          return b ? amountCell(b.working, money) : '<td></td>';
        }
        case 'cleared':
          return `<td>${t.cleared === 'U' ? '' : t.cleared}</td>`;
        default:
          return '<td></td>';
      }
    });
    rows.push(`<tr>${cells.join('')}</tr>`);
    for (const l of s.row.lines) {
      const line = layout.map((c) => {
        switch (c.field) {
          case 'payee':
            return `<td class="indent">${esc(l.transferText)}</td>`;
          case 'category':
            return `<td>${esc(l.categoryText)}</td>`;
          case 'notes':
            return `<td>${esc(l.line.notes)}</td>`;
          case 'outflow':
            return l.line.amount < 0 ? amountCell(-l.line.amount, money) : '<td></td>';
          case 'inflow':
            return l.line.amount > 0 ? amountCell(l.line.amount, money) : '<td></td>';
          default:
            return '<td></td>';
        }
      });
      rows.push(`<tr class="line">${line.join('')}</tr>`);
    }
  }
  const body =
    `<h1>${esc(name)}</h1>` +
    `<dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k ?? '')}</dt><dd>${esc(v ?? '')}</dd>`).join('')}</dl>` +
    `<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  await show(name, body, `${name}.pdf`);
}

function dateFilterText(reg: Register): string {
  const f = reg.dateFilter;
  if (f.preset === 'custom' && f.from && f.to)
    return tr('app.regDateCustom', {
      from: monthShortYear(f.from, dateLocale.value),
      through: monthShortYear(f.to, dateLocale.value),
    });
  const keys: Record<string, string> = {
    thisMonth: 'app.regDateThisMonth',
    latest3: 'app.regDateLatest3',
    thisYear: 'app.regDateThisYear',
    lastYear: 'app.regDateLastYear',
  };
  return tr(keys[f.preset] ?? 'app.regDateAll');
}

/** The Budget screen's printout (16 §3): the selected month. */
export async function printBudget(b: BudgetScreen): Promise<void> {
  const month = b.selected;
  const view = month ? b.views.get(month) : undefined;
  if (!month || !view) return;
  const money = b.format.money;
  const short = (m: typeof month): string => monthShortYear(m, dateLocale.value);
  const title = tr('app.prnBudgetTitle', { month: short(month) });
  const summary: [string, number][] = [
    [tr('app.budNotBudgetedIn', { month: short(prevMonth(month)) }), view.notBudgetedPrev],
    [tr('app.budOverspentIn', { month: short(prevMonth(month)) }), view.overspentPrev],
    [tr('app.budIncomeFor', { month: short(month) }), view.income],
    [tr('app.budBudgetedIn', { month: short(month) }), -view.budgeted],
    ...(view.heldForNext !== 0
      ? [
          [tr('app.budHeldFor', { month: short(nextMonth(month)) }), -view.heldForNext] as [
            string,
            number,
          ],
        ]
      : []),
    [tr(view.toBudget < 0 ? 'app.prnOverBudgeted' : 'budget.availableToBudget'), view.toBudget],
  ];
  const row = (label: string, budgeted: number, spent: number, balance: number, cls = ''): string =>
    `<tr${cls ? ` class="${cls}"` : ''}><td${cls === '' ? ' class="indent"' : ''}>${esc(label)}</td>${amountCell(budgeted, money)}${amountCell(-spent, money)}${amountCell(balance, money)}</tr>`;
  const rows: string[] = [];
  if (view.uncategorized.hasTransactions)
    rows.push(
      row(
        tr('app.categoryUncategorized'),
        0,
        view.uncategorized.activity,
        view.uncategorized.activity,
        'group',
      ),
    );
  const hidden = hiddenCategoryIds(b.tree);
  for (const g of b.tree.filter((x) => !x.isIncome && !x.hidden)) {
    const gv = view.groups.find((x) => x.id === g.id);
    rows.push(row(g.name, gv?.budgeted ?? 0, gv?.activity ?? 0, gv?.balance ?? 0, 'group'));
    for (const c of g.categories.filter((x) => !x.hidden)) {
      const cv = gv?.categories.find((x) => x.id === c.id);
      rows.push(row(c.name, cv?.budgeted ?? 0, cv?.activity ?? 0, cv?.balance ?? 0));
    }
  }
  const h = hiddenTotals(view, hidden);
  if (hidden.size > 0)
    rows.push(row(tr('app.categoryHiddenCategories'), h.budgeted, h.activity, h.balance, 'group'));
  rows.push(
    row(
      tr('app.prnTotals'),
      view.totals.budgeted,
      view.totals.activity,
      view.totals.balance,
      'total',
    ),
  );
  const body =
    `<h1>${esc(title)}</h1>` +
    `<dl class="meta">${summary.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${v < 0 ? 'neg' : ''}">${esc(printAmount(v, money))}</dd>`).join('')}</dl>` +
    `<table><colgroup><col style="width:46%"><col><col><col></colgroup><thead><tr><th>${esc(tr('register.columnCategory'))}</th><th class="num">${esc(tr('budget.budgeted'))}</th><th class="num">${esc(tr('app.budSpent'))}</th><th class="num">${esc(tr('budget.balance'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  await show(title, body, `${title}.pdf`);
}
