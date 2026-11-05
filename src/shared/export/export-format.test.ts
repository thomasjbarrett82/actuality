// Export formats against golden files (16 §2, §4 criterion 3): the register CSV (splits, transfers, tags,
// cleared states, running balance), the budget CSV (envelope; a Tab separator with a "," decimal), and the
// per-account QIF in both date orders.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET_FORMAT } from '../budget-format';
import type { Account, BudgetMonthView, CategoryGroup, Transaction } from '../domain/types';
import {
  budgetCsv,
  csvSeparator,
  exportTimestamp,
  monthsWithData,
  qifFile,
  quoted,
  registerCsv,
  safeFileName,
  type ExportContext,
} from './export-format';

const account = (id: string, name: string, sortIndex: number): Account => ({
  id,
  name,
  onBudget: true,
  closed: false,
  sortIndex,
  note: null,
  lastReconciledDate: null,
  accountGroupId: null,
  balances: { cleared: 0, uncleared: 0, working: 0, reconciled: 0 },
  attention: { count: 0, maxLevel: 'none' },
  hasTransactions: true,
  scheduledCount: 0,
});

const GROUPS: CategoryGroup[] = [
  {
    id: 'g-bills',
    name: 'Monthly Bills',
    isIncome: false,
    hidden: false,
    sortIndex: 1,
    note: null,
    categories: [
      {
        id: 'c-rent',
        groupId: 'g-bills',
        name: 'Rent',
        isIncome: false,
        hidden: false,
        sortIndex: 1,
        note: null,
      },
      {
        id: 'c-water',
        groupId: 'g-bills',
        name: 'Water "City"',
        isIncome: false,
        hidden: false,
        sortIndex: 2,
        note: null,
      },
    ],
  },
  {
    id: 'g-inc',
    name: 'Income',
    isIncome: true,
    hidden: false,
    sortIndex: 0,
    note: null,
    categories: [
      {
        id: 'c-inc',
        groupId: 'g-inc',
        name: 'Available This Month',
        isIncome: true,
        hidden: false,
        sortIndex: 1,
        note: null,
      },
    ],
  },
];

const tx = (t: Partial<Transaction> & { id: string; accountId: string }): Transaction => ({
  date: '2026-01-05',
  amount: 0,
  payeeId: null,
  payeeName: '',
  transferAccountId: null,
  transferId: null,
  transferSide: null,
  categoryId: null,
  notes: '',
  checkNumber: null,
  tags: [],
  needsReview: false,
  cleared: 'U',
  importedId: null,
  importedPayee: null,
  scheduleId: null,
  isStartingBalance: false,
  subtransactions: [],
  errorLevel: 'none',
  errorMessage: null,
  rawNotes: '',
  ...t,
});

const CHECKING = account('a1', 'Checking', 1);
const SAVINGS = account('a2', 'Savings', 2);
const ctx: ExportContext = {
  format: DEFAULT_BUDGET_FORMAT,
  accounts: [CHECKING, SAVINGS],
  groups: GROUPS,
};

const CHECKING_TXNS: Transaction[] = [
  tx({
    id: 't3',
    accountId: 'a1',
    date: '2026-01-20',
    amount: -12_345,
    payeeName: 'City Water',
    categoryId: 'c-water',
    checkNumber: '1042',
    cleared: 'R',
    notes: 'quarterly #utilities',
  }),
  tx({
    id: 't1',
    accountId: 'a1',
    date: '2026-01-02',
    amount: 250_000,
    payeeName: 'Employer',
    categoryId: 'c-inc',
    cleared: 'C',
    notes: 'January',
  }),
  tx({
    id: 't2',
    accountId: 'a1',
    date: '2026-01-05',
    amount: -100_000,
    payeeName: 'Landlord',
    notes: 'rent & savings',
    subtransactions: [
      {
        id: 'l1',
        parentId: 't2',
        amount: -80_000,
        payeeId: null,
        transferAccountId: null,
        transferId: null,
        transferSide: null,
        categoryId: 'c-rent',
        notes: 'rent',
        rawNotes: 'rent',
        errorLevel: 'none',
        errorMessage: null,
      },
      {
        id: 'l2',
        parentId: 't2',
        amount: -20_000,
        payeeId: 'p-a2',
        transferAccountId: 'a2',
        transferId: 'm1',
        transferSide: null,
        categoryId: null,
        notes: '',
        rawNotes: '',
        errorLevel: 'none',
        errorMessage: null,
      },
    ],
  }),
];
const SAVINGS_TXNS: Transaction[] = [
  tx({
    id: 'm1',
    accountId: 'a2',
    date: '2026-01-05',
    amount: 20_000,
    transferAccountId: 'a1',
    payeeName: 'Checking',
  }),
];

const month = (
  m: `${number}-${number}`,
  rent: [number, number, number],
  real = true,
): BudgetMonthView => ({
  month: m,
  type: 'envelope',
  notBudgetedPrev: 0,
  overspentPrev: 0,
  income: 0,
  incomeReceived: 0,
  incomeHeldFromPrev: 0,
  budgeted: 0,
  heldForNext: 0,
  toBudget: 0,
  otherAdjustments: 0,
  totals: { budgeted: 0, activity: 0, balance: 0 },
  groups: [
    {
      id: 'g-bills',
      budgeted: 0,
      activity: 0,
      balance: 0,
      categories: [
        {
          id: 'c-rent',
          budgeted: rent[0],
          activity: rent[1],
          balance: rent[2],
          carryover: false,
          hasTransactions: real,
        },
      ],
    },
  ],
  incomeGroups: [],
  uncategorized: { activity: 0, hasTransactions: false },
  hasRealData: real,
});

describe('export formats (16 §2)', () => {
  it('writes the register CSV (golden)', async () => {
    const csv = registerCsv(ctx, [
      { account: CHECKING, transactions: CHECKING_TXNS },
      { account: SAVINGS, transactions: SAVINGS_TXNS },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    await expect(csv).toMatchFileSnapshot('./golden/register.csv');
  });

  it('writes the budget CSV, with a Tab where "," is the decimal (golden)', async () => {
    const months = monthsWithData([
      month('2025-12', [0, 0, 0], false),
      month('2026-01', [80_000, -80_000, 0]),
      month('2026-02', [80_000, 0, 80_000]),
      month('2026-03', [0, 0, 80_000], false),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    const comma = {
      ...ctx,
      format: { ...ctx.format, money: { ...ctx.format.money, numberFormat: 'dot-comma' as const } },
    };
    expect(csvSeparator(comma.format.money)).toBe('\t');
    await expect(budgetCsv(comma, months)).toMatchFileSnapshot('./golden/budget.csv');
  });

  it('writes a QIF per account, month-first or day-first (golden)', async () => {
    await expect(qifFile(ctx, CHECKING_TXNS)).toMatchFileSnapshot('./golden/checking.qif');
    const dmy = { ...ctx, format: { ...ctx.format, dateFormat: 'dd/MM/yyyy' as const } };
    expect(qifFile(dmy, SAVINGS_TXNS)).toContain('D05/01/2026');
    expect(qifFile(dmy, SAVINGS_TXNS)).toContain('PTransfer : Checking');
  });

  it('quotes text, names files safely and stamps the time', () => {
    expect(quoted('say "hi"')).toBe('"say ""hi"""');
    expect(safeFileName('My: Budget/2026?')).toBe('My- Budget-2026-');
    expect(exportTimestamp(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05 0907');
  });
});
