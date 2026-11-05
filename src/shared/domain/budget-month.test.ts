// The month adapter (09 §2) against the shapes and signs Actual returns.
import { describe, expect, it } from 'vitest';
import { identityToBudget, toBudgetMonthView, type RawBudgetMonth } from './budget-month';

const extras = {
  withTransactions: new Set(['c-groc']),
  uncategorized: { activity: -2500, hasTransactions: true },
};

// A USD scenario: M−1 holds $200; Groceries overspent $50 without carryover; Dining $30 with it.
const PREV: RawBudgetMonth = {
  month: '2026-09',
  incomeAvailable: 300000,
  lastMonthOverspent: 0,
  forNextMonth: 20000,
  totalBudgeted: -195000,
  toBudget: 85000,
  fromLastMonth: 0,
  totalIncome: 300000,
  totalSpent: -203000,
  totalBalance: -8000,
  categoryGroups: [],
};

const CUR: RawBudgetMonth = {
  month: '2026-10',
  incomeAvailable: 205000,
  lastMonthOverspent: -5000,
  forNextMonth: 0,
  totalBudgeted: -30000,
  toBudget: 170000,
  fromLastMonth: 105000,
  totalIncome: 100000,
  totalSpent: -10000,
  totalBalance: 17000,
  categoryGroups: [
    {
      id: 'g-food',
      is_income: false,
      budgeted: 30000,
      spent: -10000,
      balance: 17000,
      categories: [
        { id: 'c-groc', budgeted: 20000, spent: -10000, balance: 10000, carryover: false },
        { id: 'c-dine', budgeted: 10000, spent: 0, balance: 7000, carryover: true },
      ],
    },
    {
      id: 'g-income',
      is_income: true,
      received: 100000,
      categories: [{ id: 'c-inc', is_income: true, received: 100000 }],
    },
  ],
};

describe('toBudgetMonthView (09 §2)', () => {
  it('maps the envelope fields and signs', () => {
    const v = toBudgetMonthView(CUR, PREV, extras);
    expect(v).toMatchObject({
      month: '2026-10',
      type: 'envelope',
      notBudgetedPrev: 85000,
      overspentPrev: -5000,
      incomeReceived: 100000,
      incomeHeldFromPrev: 20000,
      income: 120000,
      budgeted: 30000,
      heldForNext: 0,
      toBudget: 170000,
      otherAdjustments: 0,
      totals: { budgeted: 30000, activity: -10000, balance: 17000 },
      uncategorized: { activity: -2500, hasTransactions: true },
      hasRealData: true,
    });
    expect(v.groups).toEqual([
      {
        id: 'g-food',
        budgeted: 30000,
        activity: -10000,
        balance: 17000,
        categories: [
          {
            id: 'c-groc',
            budgeted: 20000,
            activity: -10000,
            balance: 10000,
            carryover: false,
            hasTransactions: true,
          },
          {
            id: 'c-dine',
            budgeted: 10000,
            activity: 0,
            balance: 7000,
            carryover: true,
            hasTransactions: false,
          },
        ],
      },
    ]);
    expect(v.incomeGroups[0]?.activity).toBe(100000);
  });

  it('holds the header identity exactly (09 §9 criterion 2)', () => {
    const v = toBudgetMonthView(CUR, PREV, extras);
    expect(identityToBudget(v)).toBe(v.toBudget);
  });

  it('reports the difference as other adjustments when Actual disagrees', () => {
    const v = toBudgetMonthView({ ...CUR, toBudget: 160000 }, PREV, extras);
    expect(v.toBudget).toBe(160000);
    expect(v.otherAdjustments).toBe(-10000);
  });

  it('treats every previous value as 0 in the first month', () => {
    const v = toBudgetMonthView({ ...CUR, lastMonthOverspent: 0 }, null, extras);
    expect(v.notBudgetedPrev).toBe(0);
    expect(v.incomeHeldFromPrev).toBe(0);
  });

  it('marks a month with no income, budget or spending as without real data', () => {
    const empty: RawBudgetMonth = {
      ...CUR,
      totalIncome: 0,
      totalBudgeted: 0,
      totalSpent: 0,
      categoryGroups: [],
    };
    expect(toBudgetMonthView(empty, null, extras).hasRealData).toBe(false);
  });
});
