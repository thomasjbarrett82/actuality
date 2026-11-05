// Builds the demo budget for the user guide's screenshots (`npm run demo:build`, 21 §2): tidy, believable
// data with generic payee names and none of the test fixtures' deliberate errors. It writes an Actual
// export zip to tests/fixtures/budgets/demo.zip (git-ignored); import it with File ▸ Open… ▸ Open another
// budget ▸ Import a budget file… ▸ Actual export (.zip) (07 §3.4). No server is needed to build it.
//
// Its 14 months end in the current month and its transactions stop at today, so build it again before a
// round of screenshots. Every month's Available to Budget is 0; this month has one overspent category
// (Restaurants) and three credit card transactions waiting for approval, to illustrate those pages. The
// schedules start after today, so nothing is posted when the budget is imported.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealActualForTests, type ActualModule } from '../../src/host/actual';
import { day, rng, type Tx } from './budget-helpers';
import { FIXTURE_DIR, fixtureMonths, thisMonth } from './fixture-facts';

const NAME = 'My Budget';
const ZIP = join(FIXTURE_DIR, 'demo.zip');
const MONTHS = fixtureMonths(thisMonth());
const CURRENT = MONTHS.at(-1) ?? thisMonth();
const NOW = new Date();
const TODAY = NOW.getDate();

/** The Personal/Family starting categories (07 §4.1), as Budget Setup creates them. */
const TEMPLATE: [string, string[]][] = [
  ['Giving', ['Tithing', 'Charitable']],
  ['Monthly Bills', ['Rent/Mortgage', 'Phone', 'Internet', 'Cable TV', 'Electricity', 'Water', 'Natural Gas/Propane/Oil']],
  ['Everyday Expenses', ['Groceries', 'Fuel', 'Spending Money', 'Restaurants', 'Medical', 'Clothing', 'Household Goods']],
  ['Rainy Day Funds', ['Emergency Fund', 'Car Repairs', 'Home Maintenance', 'Car Insurance', 'Life Insurance', 'Health Insurance', 'Birthdays', 'Christmas']],
  ['Savings Goals', ['Car Replacement', 'Vacation']],
  ['Debt', ['Car Payment', 'Student Loan Payment', 'Personal Loan Payment']],
];

/** Budgeted every month, in cents. Emergency Fund gets what's left, so Available to Budget is 0. */
const BUDGET: Record<string, number> = {
  Tithing: 20_000, Charitable: 5_000,
  'Rent/Mortgage': 120_000, Phone: 6_500, Internet: 6_000, Electricity: 12_000, Water: 2_500, 'Natural Gas/Propane/Oil': 6_000,
  Groceries: 65_000, Fuel: 18_000, 'Spending Money': 20_000, Restaurants: 15_000, Medical: 5_000, Clothing: 8_000, 'Household Goods': 10_000,
  'Car Repairs': 5_000, 'Home Maintenance': 7_500, 'Car Insurance': 9_500, Birthdays: 4_000, Christmas: 7_500,
  'Car Replacement': 30_000, Vacation: 30_000,
  'Student Loan Payment': 25_000,
};

/** Everyday spending: category, payees, and how many transactions a month. Spent across the accounts. */
const EVERYDAY: [string, string[], [number, number]][] = [
  ['Groceries', ['Grocery Mart', 'Fresh Market', 'Corner Bakery'], [8, 12]],
  ['Fuel', ['Fuel Stop', 'Highway Gas'], [3, 5]],
  ['Spending Money', ['Online Shop', 'Bookstore', 'Game Shop'], [3, 6]],
  ['Restaurants', ['Corner Cafe', 'Pizza Place', 'Thai Garden', 'Burger Barn'], [3, 6]],
  ['Clothing', ['Clothing Co', 'Shoe Shop'], [0, 2]],
  ['Household Goods', ['Home Store', 'Hardware Hub'], [1, 3]],
];

const PAYEES = [
  ...new Set(EVERYDAY.flatMap(([, names]) => names)),
  'Acme Corp', 'Bank Interest', 'City Power', 'Gas Utility', 'Phone Co', 'Internet Co', 'City Water',
  'Auto Insurance Co', 'Community Church', 'Food Bank', 'Loan Servicer', 'City Pharmacy', 'Dental Care',
  'Gift Shop', 'Toy Store', 'Auto Shop', 'Seaside Inn', 'Harbor Grill', 'Retirement Plan',
];

const daysIn = (month: string): number => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y ?? 0, m ?? 1, 0).getDate();
};
/** The last day with transactions: today in the current month. */
const lastDay = (month: string): number => (month === CURRENT ? TODAY : daysIn(month));
const iso = (d: Date): string =>
  `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The next date after today that falls on this day of the month. */
function nextOn(dayOfMonth: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() + (TODAY < dayOfMonth ? 0 : 1), dayOfMonth);
  return iso(d);
}

async function fillDemo(api: ActualModule): Promise<void> {
  const random = rng(20261104);
  const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;

  // Accounts: 4 in the budget (the card owes money), 2 off budget.
  const checking = await api.createAccount({ name: 'Checking' }, 320_000);
  const savings = await api.createAccount({ name: 'Savings' }, 800_000);
  const card = await api.createAccount({ name: 'Credit Card' }, -120_000);
  const cash = await api.createAccount({ name: 'Cash' }, 15_000);
  const mortgage = await api.createAccount({ name: 'Mortgage', offbudget: true }, -21_500_000);
  const retirement = await api.createAccount({ name: 'Retirement', offbudget: true }, 4_500_000);
  await api.updateNote(`account-${checking}`, 'Joint account at the credit union.');

  const cat: Record<string, string> = {};
  const C = (name: string): string => {
    const id = cat[name];
    if (!id) throw new Error(`no category ${name}`);
    return id;
  };
  for (const [group, names] of TEMPLATE) {
    const groupId = await api.createCategoryGroup({ name: group, is_income: false, hidden: false });
    // createCategory puts each category at the top of its group, so add them last to first (07 §4).
    for (const name of [...names].reverse()) {
      cat[name] = await api.createCategory({ name, group_id: groupId, is_income: false, hidden: false });
    }
  }
  const income = (await api.getCategories()).find((c) => c.is_income && c.name === 'Income');
  if (!income) throw new Error('runImport made no Income category');
  cat['Income'] = income.id;
  await api.updateNote(C('Groceries'), 'Weekly shop, plus a bulk run every other month.');
  await api.updateNote(C('Car Repairs'), 'Saving for new tires in the spring.');
  await api.updateNote(C('Vacation'), 'A week at the beach next summer.');

  const payee: Record<string, string> = {};
  const P = (name: string): string => {
    const id = payee[name];
    if (!id) throw new Error(`no payee ${name}`);
    return id;
  };
  for (const name of PAYEES) payee[name] = await api.createPayee({ name });
  const transferTo = new Map(
    (await api.getPayees()).flatMap((p) => (p.transfer_acct ? [[p.transfer_acct, p.id] as const] : [])),
  );
  const toAccount = (accountId: string): string => {
    const id = transferTo.get(accountId);
    if (!id) throw new Error(`no transfer payee for ${accountId}`);
    return id;
  };
  // A rename rule for the bank's text and an auto-category rule, as Payee Settings makes them (14 §1).
  await api.createRule({
    stage: 'pre',
    conditionsOp: 'or',
    conditions: [{ field: 'imported_payee', op: 'matches', value: '^grocery mart' }],
    actions: [{ field: 'payee', op: 'set', value: P('Grocery Mart') }],
  });
  await api.createRule({
    stage: null,
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: P('Grocery Mart') }],
    actions: [{ field: 'category', op: 'set', value: C('Groceries') }],
  });
  await api.createTag({ tag: 'vacation', color: '#1f77b4', description: 'Spending on trips away' });

  // Transactions, month by month, up to today.
  const byAccount = new Map<string, Tx[]>();
  const add = (account: string, tx: Tx): void => {
    byAccount.set(account, [...(byAccount.get(account) ?? []), tx]);
  };
  /** Adds a transaction if its day has come. */
  const on = (account: string, month: string, d: number, tx: Omit<Tx, 'date'>): void => {
    if (d <= lastDay(month)) add(account, { date: day(month, d), ...tx });
  };
  let check = 2041;
  let cardSpentLastMonth = 120_000; // The first payment clears the opening balance.
  MONTHS.forEach((month, mi) => {
    const full = daysIn(month);
    const elapsed = lastDay(month) / full;
    let cardSpent = 0;
    const spend = (account: string, d: number, amount: number, name: string, category: string, notes = ''): void => {
      if (d > lastDay(month)) return;
      add(account, { date: day(month, d), amount: -amount, payee: P(name), category: C(category), ...(notes ? { notes } : {}) });
      if (account === card) cardSpent += amount;
    };
    /** The account an everyday purchase is paid from: mostly the card. */
    const wallet = (): string => {
      const r = random();
      return r < 0.6 ? card : r < 0.92 ? checking : cash;
    };

    // Income and the regular bills, from Checking.
    on(checking, month, 1, { amount: 485_000, payee: P('Acme Corp'), category: C('Income'), notes: 'Paycheck' });
    on(checking, month, 2, { amount: -120_000, payee: toAccount(mortgage), category: C('Rent/Mortgage') });
    on(checking, month, 5, { amount: -30_000, payee: toAccount(savings) });
    on(checking, month, 9, { amount: -10_000, payee: toAccount(cash) });
    spend(checking, 7, 20_000, 'Community Church', 'Tithing', `⟦chk ${String(check++)}⟧`);
    spend(checking, 12, 6_500, 'Phone Co', 'Phone');
    spend(checking, 14, between(7_000, 11_500), 'City Power', 'Electricity');
    spend(checking, 15, 25_000, 'Loan Servicer', 'Student Loan Payment');
    spend(checking, 16, between(3_000, 6_000), 'Gas Utility', 'Natural Gas/Propane/Oil');
    spend(checking, 18, 6_000, 'Internet Co', 'Internet');
    spend(checking, 22, 9_500, 'Auto Insurance Co', 'Car Insurance');
    spend(checking, 25, 5_000, 'Food Bank', 'Charitable');
    if (mi % 2 === 1) spend(checking, 10, between(4_000, 5_000), 'City Water', 'Water');
    on(checking, month, 20, { amount: -cardSpentLastMonth, payee: toAccount(card) });
    on(savings, month, full, { amount: between(600, 900), payee: P('Bank Interest'), category: C('Income') });
    on(retirement, month, 28, { amount: between(-60_000, 180_000), payee: P('Retirement Plan') });

    // A bulk shop split across two categories, every other month.
    let splitGroceries = 0;
    let splitHousehold = 0;
    if (mi % 2 === 0 && 12 <= lastDay(month)) {
      splitGroceries = 6_000;
      splitHousehold = 2_000;
      add(checking, {
        date: day(month, 12),
        amount: -(splitGroceries + splitHousehold),
        payee: P('Grocery Mart'),
        subtransactions: [
          { amount: -splitGroceries, category: C('Groceries') },
          { amount: -splitHousehold, category: C('Household Goods'), notes: 'Cleaning supplies' },
        ],
      });
    }

    // Everyday spending: under budget, and in proportion to the days so far this month. This month's
    // Restaurants is over budget, so the Budget screen has an overspent category to show.
    for (const [category, names, [min, max]] of EVERYDAY) {
      const overspent = month === CURRENT && category === 'Restaurants';
      let total = Math.round((BUDGET[category] ?? 0) * (overspent ? 1.15 : (0.7 + random() * 0.25) * elapsed));
      if (category === 'Groceries') total -= splitGroceries;
      if (category === 'Household Goods') total -= splitHousehold;
      const count = Math.max(overspent ? 1 : 0, Math.round(between(min, max) * elapsed));
      if (count === 0 || total <= 0) continue;
      const weights = Array.from({ length: count }, () => 0.5 + random());
      const sum = weights.reduce((a, b) => a + b, 0);
      let left = total;
      weights.forEach((w, i) => {
        const amount = i === count - 1 ? left : Math.floor((total * w) / sum);
        left -= amount;
        spend(wallet(), between(1, lastDay(month)), amount, pick(names), category);
      });
    }

    // Occasional spending from the funds that build up.
    if (mi % 2 === 1) spend(card, between(1, 28), between(2_000, 9_000), pick(['City Pharmacy', 'Dental Care']), 'Medical');
    if (mi % 4 === 1) spend(card, between(1, 28), between(3_000, 7_500), 'Gift Shop', 'Birthdays');
    if (mi === 4 || mi === 11) spend(checking, between(1, 28), between(12_000, 20_000), 'Hardware Hub', 'Home Maintenance');
    if (mi === 8) spend(checking, 17, 38_000, 'Auto Shop', 'Car Repairs', 'Brakes and an oil change');
    if (mi === 9) {
      spend(card, 11, 64_000, 'Seaside Inn', 'Vacation', '#vacation');
      spend(card, 12, 8_500, 'Harbor Grill', 'Vacation', 'Dinner by the water #vacation');
    }
    if (month.endsWith('-12')) {
      const saved = (BUDGET['Christmas'] ?? 0) * (mi + 1);
      const gifts = Math.round(saved * 0.9);
      spend(card, 6, Math.round(gifts * 0.5), 'Toy Store', 'Christmas');
      spend(card, 13, Math.round(gifts * 0.3), 'Online Shop', 'Christmas');
      spend(card, 18, gifts - Math.round(gifts * 0.5) - Math.round(gifts * 0.3), 'Gift Shop', 'Christmas');
    }
    cardSpentLastMonth = cardSpent;
  });

  // Cleared up to five days ago. The three latest card purchases came from the bank and wait for approval
  // (imported transactions are cleared, 04 §7).
  const recent = new Date(NOW.getFullYear(), NOW.getMonth(), TODAY - 5);
  for (const txs of byAccount.values()) for (const tx of txs) tx.cleared = tx.date < iso(recent);
  const cardTxs = [...(byAccount.get(card) ?? [])].filter((t) => t.category).sort((a, b) => a.date.localeCompare(b.date));
  for (const tx of cardTxs.slice(-3)) {
    tx.notes = `${tx.notes ?? ''} #needs-review`.trim();
    tx.cleared = true;
  }
  for (const [account, txs] of byAccount) {
    await api.addTransactions(account, txs, { runTransfers: true, learnCategories: false });
  }

  // Reconciled before last month, as if the statements were checked (13 §6.3). Only parents and plain rows:
  // a split's lines follow their parent (see build-fixture.ts).
  const lastMonth = MONTHS.at(-2) ?? CURRENT;
  const rows = (await api.aqlQuery(
    api.q('transactions').filter({ date: { $lt: `${lastMonth}-01` }, cleared: true }).select(['id']).options({ splits: 'grouped' }),
  )) as { data: { id: string }[] };
  for (const { id } of rows.data) await api.updateTransaction(id, { reconciled: true });
  const [ly, lm] = lastMonth.split('-').map(Number);
  const reconciledAt = String(new Date(ly ?? 0, (lm ?? 1) - 1, 0, 18).getTime());
  for (const account of [checking, savings, card]) {
    // The API passes fields it doesn't type through to Actual's account update (04 §3).
    const fields = { last_reconciled: reconciledAt } as unknown as Parameters<ActualModule['updateAccount']>[1];
    await api.updateAccount(account, fields);
  }

  // Budgets up to this month, then whatever is left into the Emergency Fund, month by month, so
  // Available to Budget is 0 everywhere.
  for (const month of MONTHS) {
    await api.batchBudgetUpdates(async () => {
      for (const [name, amount] of Object.entries(BUDGET)) await api.setBudgetAmount(month, C(name), amount);
    });
    const { toBudget } = await api.getBudgetMonth(month);
    if (toBudget < 0) throw new Error(`${month} is overbudgeted by ${String(-toBudget)}`);
    await api.setBudgetAmount(month, C('Emergency Fund'), toBudget);
  }

  const count = [...byAccount.values()].reduce((n, txs) => n + txs.length, 0);
  console.log(`demo: ${String(count)} transactions over ${String(MONTHS.length)} months`);
}

/**
 * Upcoming schedules, each starting after today, with their categories on their rules (12 §1). Runs after
 * runImport: inside it, reads of rules return nothing, so a schedule's rule can't be found there.
 */
async function addSchedules(api: ActualModule): Promise<void> {
  const accounts = new Map((await api.getAccounts()).map((a) => [a.name, a.id]));
  const payees = await api.getPayees();
  const categories = new Map((await api.getCategories()).map((c) => [c.name, c.id]));
  const id = <T>(map: Map<string, T>, name: string): T => {
    const found = map.get(name);
    if (found === undefined) throw new Error(`no ${name}`);
    return found;
  };
  const payee = (name: string): string => id(new Map(payees.map((p) => [p.name, p.id])), name);
  const transferTo = (account: string): string =>
    id(new Map(payees.flatMap((p) => (p.transfer_acct ? [[p.transfer_acct, p.id] as const] : []))), id(accounts, account));
  const monthly = (dayOfMonth: number, interval = 1) => ({
    frequency: 'monthly' as const,
    interval,
    start: nextOn(dayOfMonth),
    endMode: 'never' as const,
  });
  const schedules: [string, string, number, ReturnType<typeof monthly>, string | null][] = [
    ['Paycheck', payee('Acme Corp'), 485_000, monthly(1), 'Income'],
    ['Savings transfer', transferTo('Savings'), -30_000, monthly(5), null],
    ['Phone bill', payee('Phone Co'), -6_500, monthly(12), 'Phone'],
    ['Student loan', payee('Loan Servicer'), -25_000, monthly(15), 'Student Loan Payment'],
    ['Internet', payee('Internet Co'), -6_000, monthly(18), 'Internet'],
    ['Car insurance', payee('Auto Insurance Co'), -9_500, monthly(22), 'Car Insurance'],
    ['Water bill', payee('City Water'), -4_800, monthly(10, 2), 'Water'],
  ];
  for (const [name, schedulePayee, amount, date, category] of schedules) {
    const scheduleId = await api.createSchedule({
      name,
      posts_transaction: true,
      payee: schedulePayee,
      account: id(accounts, 'Checking'),
      amount,
      amountOp: 'is',
      date,
    });
    if (!category) continue;
    // A schedule's rule is the one whose link-schedule action names it (12 §1).
    const rule = (await api.getRules()).find((r) =>
      r.actions.some((a) => a.op === 'link-schedule' && a.value === scheduleId),
    );
    if (!rule) throw new Error(`no rule for schedule ${name}`);
    await api.updateRule({
      ...rule,
      actions: [...rule.actions, { op: 'set', field: 'category', value: id(categories, category), type: 'id' }],
    });
  }
}

async function main(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-demo-'));
  try {
    const { fixtures } = await createRealActualForTests(dir);
    const zip = await fixtures.buildBudgetZip(NAME, fillDemo, addSchedules);
    writeFileSync(ZIP, zip);
    console.log(`wrote ${ZIP} (${String(Math.round(zip.byteLength / 1024))} KB)`);
    console.log('Import it in Actuality: File ▸ Open… ▸ Open another budget ▸ Import a budget file… ▸ Actual export (.zip)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
// The API may keep timers alive.
process.exit(0);
