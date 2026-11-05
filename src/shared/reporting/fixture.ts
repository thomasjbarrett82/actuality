// A small budget for the report tests (15 §4–6): two on-budget accounts and an off-budget one, a closed
// account, income, bills and food, a split, a card payment, a transfer out of the pool, a negative income
// side, Starting Balances, and sides after today. The tests' expected values are worked out by hand.
import type { ISODate } from '../domain/types';
import type { ReportInput, ReportSide } from './input';

export const TODAY = '2026-10-20' as ISODate;
let seq = 0;
export function side(
  accountId: string,
  date: string,
  amount: number,
  more: Partial<ReportSide> = {},
): ReportSide {
  seq++;
  const id = more.id ?? `t${String(seq).padStart(3, '0')}`;
  return {
    id,
    transactionId: more.transactionId ?? id,
    line: 0,
    accountId,
    date: date as ISODate,
    amount,
    payeeId: null,
    categoryId: null,
    transferAccountId: null,
    startingBalance: false,
    ...more,
  };
}

const sides: ReportSide[] = [
  side('chk', '2026-01-01', 100_000, { startingBalance: true }),
  side('card', '2026-01-01', -20_000, { startingBalance: true }),
  // August
  side('chk', '2026-08-01', 300_000, { payeeId: 'employer', categoryId: 'salary' }),
  side('chk', '2026-08-03', -120_000, { payeeId: 'landlord', categoryId: 'rent' }),
  side('card', '2026-08-05', -15_000, { payeeId: 'market', categoryId: 'groceries' }),
  side('card', '2026-08-06', 2_000, { payeeId: 'market', categoryId: 'groceries' }),
  side('old', '2026-08-10', -9_999, { payeeId: 'market', categoryId: 'groceries' }),
  side('chk', '2026-08-20', -15_000, { payeeId: 'to-card', transferAccountId: 'card' }),
  side('card', '2026-08-20', 15_000, { payeeId: 'to-chk', transferAccountId: 'chk' }),
  // September: a split, a negative income side and a transfer out to the off-budget savings
  side('chk', '2026-09-01', 300_000, { payeeId: 'employer', categoryId: 'salary' }),
  side('chk', '2026-09-02', -5_000, {
    id: 's1a',
    transactionId: 's1',
    line: 0,
    payeeId: 'market',
    categoryId: 'groceries',
  }),
  side('chk', '2026-09-02', -3_000, {
    id: 's1b',
    transactionId: 's1',
    line: 1,
    payeeId: 'market',
    categoryId: 'dining',
  }),
  side('chk', '2026-09-15', -1_000, { payeeId: 'employer', categoryId: 'salary' }),
  side('chk', '2026-09-25', -50_000, { payeeId: 'to-sav', transferAccountId: 'sav' }),
  side('sav', '2026-09-25', 50_000, { payeeId: 'to-chk', transferAccountId: 'chk' }),
  // October, with one side after today in this month and one in a future month
  side('chk', '2026-10-01', 300_000, { payeeId: 'employer', categoryId: 'salary' }),
  side('chk', '2026-10-03', -120_000, { payeeId: 'landlord', categoryId: 'rent' }),
  side('sav', '2026-10-05', 100, { payeeId: 'bank' }),
  side('card', '2026-10-10', -2_500, { payeeId: 'cafe', categoryId: 'dining' }),
  side('chk', '2026-10-25', -8_000, { payeeId: 'utility', categoryId: 'power' }),
  side('chk', '2026-11-03', -120_000, { payeeId: 'landlord', categoryId: 'rent' }),
].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

export const REPORT_FIXTURE: ReportInput = {
  accounts: [
    { id: 'chk', name: 'Checking', offBudget: false, closed: false, sortIndex: 1 },
    { id: 'card', name: 'Card', offBudget: false, closed: false, sortIndex: 2 },
    { id: 'sav', name: 'Savings', offBudget: true, closed: false, sortIndex: 3 },
    { id: 'old', name: 'Old', offBudget: false, closed: true, sortIndex: 4 },
  ],
  groups: [
    {
      id: 'g-income',
      name: 'Income',
      isIncome: true,
      categories: [{ id: 'salary', name: 'Salary', groupId: 'g-income', isIncome: true }],
    },
    {
      id: 'g-bills',
      name: 'Bills',
      isIncome: false,
      categories: [
        { id: 'rent', name: 'Rent', groupId: 'g-bills', isIncome: false },
        { id: 'power', name: 'Power', groupId: 'g-bills', isIncome: false },
      ],
    },
    {
      id: 'g-food',
      name: 'Food',
      isIncome: false,
      categories: [
        { id: 'groceries', name: 'Groceries', groupId: 'g-food', isIncome: false },
        { id: 'dining', name: 'Dining', groupId: 'g-food', isIncome: false },
      ],
    },
  ],
  payees: [
    { id: 'employer', name: 'Employer', transferAccountId: null },
    { id: 'landlord', name: 'Landlord', transferAccountId: null },
    { id: 'market', name: 'Market', transferAccountId: null },
    { id: 'cafe', name: 'Cafe', transferAccountId: null },
    { id: 'utility', name: 'Utility', transferAccountId: null },
    { id: 'bank', name: 'Bank', transferAccountId: null },
    { id: 'to-card', name: '', transferAccountId: 'card' },
    { id: 'to-chk', name: '', transferAccountId: 'chk' },
    { id: 'to-sav', name: '', transferAccountId: 'sav' },
  ],
  sides,
};
