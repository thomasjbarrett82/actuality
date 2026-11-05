// Builds the fixture budgets (21 §2) with the API's runImport and writes them as Actual export zips, with a
// record of the month they were built in. Their 14 months end in that month, so they don't age:
//   npm run fixtures:build                 always rebuilds
//   npm run fixtures:build -- --if-stale   rebuilds only for a new month, builder or API version (the
//                                          integration and E2E global setups run this)
// The data is generated from a fixed seed, so a rebuild has the same shape (Actual's ids and the dates
// still differ).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealActualForTests, type ActualModule } from '../../src/host/actual';
import { day, rng, type Tx } from './budget-helpers';
import {
  FIXTURE_DIR,
  FIXTURE_RECORD,
  fixtureMonths,
  LARGE_TRANSACTIONS,
  thisMonth,
} from './fixture-facts';

const END_MONTH = thisMonth();
const FIXTURE_MONTHS = fixtureMonths(END_MONTH);
const ZIPS = ['typical.zip', 'large.zip'] as const;

const TEMPLATE: [string, string[]][] = [
  ['Giving', ['Tithing', 'Charitable']],
  ['Monthly Bills', ['Rent/Mortgage', 'Phone', 'Internet', 'Electricity', 'Water']],
  ['Everyday Expenses', ['Groceries', 'Fuel', 'Spending Money', 'Restaurants', 'Medical', 'Clothing', 'Household Goods']],
  ['Rainy Day Funds', ['Emergency Fund', 'Car Repairs', 'Car Insurance', 'Birthdays', 'Christmas']],
  ['Savings Goals', ['Car Replacement', 'Vacation']],
];

const MERCHANTS: Record<string, string[]> = {
  Groceries: ['Kroger', 'Costco', 'Trader Joe’s', 'Whole Foods'],
  Fuel: ['Shell', 'Chevron'],
  Restaurants: ['Chipotle', 'Pizza Place', 'Corner Cafe', 'Thai Garden'],
  'Spending Money': ['Amazon', 'Target', 'Bookstore'],
  Clothing: ['Old Navy', 'REI'],
  Medical: ['City Pharmacy', 'Dental Care'],
  'Household Goods': ['Home Depot', 'IKEA'],
};

async function fillTypical(api: ActualModule): Promise<void> {
  const random = rng(20261018);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;
  const cents = (min: number, max: number): number => -Math.round((min + random() * (max - min)) * 100);

  // Accounts (21 §2): 4 on-budget, 2 off-budget, 1 closed.
  const checking = await api.createAccount({ name: 'Checking' }, 250_000);
  const savings = await api.createAccount({ name: 'Savings' }, 1_000_000);
  const visa = await api.createAccount({ name: 'Visa' }, -120_000);
  const cash = await api.createAccount({ name: 'Cash' }, 20_000);
  const mortgage = await api.createAccount({ name: 'Mortgage', offbudget: true }, -25_000_000);
  const k401 = await api.createAccount({ name: '401k', offbudget: true }, 4_000_000);
  const oldChecking = await api.createAccount({ name: 'Old Checking' }, 0);

  // Categories: the template, a hidden category and a hidden group. The Visa owes money: a negative balance.
  const cat: Record<string, string> = {};
  const C = (name: string): string => {
    const id = cat[name];
    if (!id) throw new Error(`no category ${name}`);
    return id;
  };
  for (const [group, names] of TEMPLATE) {
    const groupId = await api.createCategoryGroup({ name: group, is_income: false, hidden: false });
    for (const name of names) {
      cat[name] = await api.createCategory({ name, group_id: groupId, is_income: false, hidden: name === 'Christmas' });
    }
  }
  const oldGroup = await api.createCategoryGroup({ name: 'Old Stuff', is_income: false, hidden: true });
  cat['Gym'] = await api.createCategory({ name: 'Gym', group_id: oldGroup, is_income: false, hidden: false });
  const income = (await api.getCategories()).find((c) => c.is_income && c.name === 'Income');
  if (!income) throw new Error('runImport made no Income category');
  cat['Income'] = income.id;
  await api.updateNote(C('Groceries'), 'Weekly shop plus the monthly Costco run.');
  await api.updateNote(C('Car Repairs'), 'Saving up for tyres.');

  // Payees, a disabled bank-generic payee (X12), and the app's two rule kinds (14 §1).
  const payee: Record<string, string> = {};
  const P = (name: string): string => {
    const id = payee[name];
    if (!id) throw new Error(`no payee ${name}`);
    return id;
  };
  const merchantNames = [...new Set(Object.values(MERCHANTS).flat())];
  for (const name of [...merchantNames, 'Employer Inc', 'Landlord', 'Power Co', 'City Water', 'PhoneCo', 'NetCo', 'Church', 'Charity Fund', 'Insurance Co', 'Withdrawal']) {
    payee[name] = await api.createPayee({ name });
  }
  const transferTo = new Map(
    (await api.getPayees()).flatMap((p) => (p.transfer_acct ? [[p.transfer_acct, p.id] as const] : [])),
  );
  const toAccount = (accountId: string): string => {
    const id = transferTo.get(accountId);
    if (!id) throw new Error(`no transfer payee for ${accountId}`);
    return id;
  };
  await api.createRule({
    stage: 'pre',
    conditionsOp: 'or',
    conditions: [{ field: 'imported_payee', op: 'matches', value: '^KROGER #' }],
    actions: [{ field: 'payee', op: 'set', value: P('Kroger') }],
  });
  await api.createRule({
    // Actual's default stage is null (14 §1).
    stage: null,
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: P('Kroger') }],
    actions: [{ field: 'category', op: 'set', value: C('Groceries') }],
  });
  await api.updateNote('ad:payees', JSON.stringify({ v: 1, disabled: [P('Withdrawal')] }));
  await api.updateNote(`account-${checking}`, 'Joint account at the credit union.');

  // 14 months of transactions.
  const byAccount = new Map<string, Tx[]>();
  const add = (account: string, tx: Tx): void => {
    byAccount.set(account, [...(byAccount.get(account) ?? []), tx]);
  };
  // User tags (04 §5.1): case-sensitive, several per note, including former `#flag-*` values, which are ordinary.
  const userTags = ['#Vacation2025', '#trip', '#flag-red', '#home #Reimbursable'];
  let check = 1001;
  FIXTURE_MONTHS.forEach((month, mi) => {
    const recent = mi >= FIXTURE_MONTHS.length - 2;
    const cleared = (): boolean => !recent || random() < 0.6;
    const reviewTag = (): string => (mi === FIXTURE_MONTHS.length - 1 && random() < 0.3 ? ' #needs-review' : '');
    const userTag = (): string => (random() < 0.05 ? ` ${pick(userTags)}` : '');

    for (const d of [1, 15]) {
      add(checking, { date: day(month, d), amount: 285_000, payee: P('Employer Inc'), category: C('Income'), cleared: cleared() });
    }
    add(checking, {
      date: day(month, 1),
      amount: -150_000,
      payee: P('Landlord'),
      category: C('Rent/Mortgage'),
      notes: `Rent ⟦chk ${String(check++)}⟧`,
      cleared: cleared(),
    });
    for (const [name, cat2, amt] of [
      ['Power Co', 'Electricity', [80, 160]],
      ['City Water', 'Water', [30, 60]],
      ['PhoneCo', 'Phone', [55, 70]],
      ['NetCo', 'Internet', [60, 60]],
      ['Church', 'Tithing', [100, 100]],
      ['Insurance Co', 'Car Insurance', [95, 95]],
    ] as const) {
      add(checking, { date: day(month, 3 + Math.floor(random() * 20)), amount: cents(amt[0], amt[1]), payee: P(name), category: C(cat2), cleared: cleared() });
    }
    // Everyday spending: ~110 on Checking, ~50 on the Visa, ~15 in cash.
    for (const [account, count] of [[checking, 90], [visa, 50], [cash, 15]] as const) {
      for (let i = 0; i < count; i++) {
        const category = pick(Object.keys(MERCHANTS));
        add(account, {
          date: day(month, 1 + Math.floor(random() * 28)),
          amount: cents(4, category === 'Groceries' ? 180 : 70),
          payee: P(pick(MERCHANTS[category] ?? [])),
          category: C(category),
          notes: `${random() < 0.2 ? 'note ' + String(i) : ''}${userTag()}${reviewTag()}`.trim(),
          cleared: cleared(),
        });
      }
    }
    // A Costco split, and a split with a transfer line (each line with a transfer gets its own mirror).
    add(checking, {
      date: day(month, 12),
      amount: -42_000,
      payee: P('Costco'),
      cleared: cleared(),
      subtransactions: [
        { amount: -25_000, category: C('Groceries') },
        { amount: -12_000, category: C('Household Goods') },
        { amount: -5_000, category: C('Clothing'), notes: 'socks' },
      ],
    });
    add(checking, {
      date: day(month, 20),
      amount: -40_000,
      payee: P('Target'),
      cleared: cleared(),
      subtransactions: [
        { amount: -10_000, category: C('Spending Money') },
        { amount: -30_000, payee: toAccount(savings) },
      ],
    });
    // Transfers: on↔on (no category), on→off (categorized), card payment.
    add(checking, { date: day(month, 5), amount: -30_000, payee: toAccount(savings), cleared: cleared() });
    add(checking, { date: day(month, 6), amount: -60_000, payee: toAccount(visa), cleared: cleared() });
    add(checking, { date: day(month, 2), amount: -120_000, payee: toAccount(mortgage), category: C('Rent/Mortgage'), cleared: cleared() });
    add(checking, {
      date: day(month, 16),
      amount: -50_000,
      payee: toAccount(k401),
      // One month's 401k transfer is left uncategorized: needsCategory (04 §7).
      ...(mi === 3 ? {} : { category: C('Car Replacement') }),
      cleared: cleared(),
    });
    add(cash, { date: day(month, 9), amount: 10_000, payee: toAccount(checking), cleared: cleared() });
    add(savings, { date: day(month, 28), amount: 1_234, payee: P('Employer Inc'), category: C('Income'), notes: 'Interest', cleared: cleared() });
  });
  // Edge cases: uncategorized spending, and an on↔on transfer that was (wrongly) categorized.
  const last = FIXTURE_MONTHS.at(-1) ?? END_MONTH;
  add(checking, { date: day(last, 8), amount: -2_500, payee: P('Amazon'), cleared: false });
  add(checking, { date: day(last, 9), amount: -7_500, payee: P('Withdrawal'), cleared: false });

  let total = 0;
  for (const [account, txs] of byAccount) {
    await api.addTransactions(account, txs, { runTransfers: true, learnCategories: false });
    total += txs.length;
  }

  // Reconcile everything but the last two months (Actual: cleared + reconciled). Only parents and plain
  // rows (splits 'grouped'): a split's lines follow their parent, and a partial updateTransaction on a
  // split line sets that line's amount to 0 (seen with API 26.10.0).
  const reconcileBefore = FIXTURE_MONTHS.at(-2) ?? last;
  const rows = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({ date: { $lt: `${reconcileBefore}-01` }, cleared: true })
      .select(['id'])
      .options({ splits: 'grouped' }),
  )) as { data: { id: string }[] };
  for (const { id } of rows.data) await api.updateTransaction(id, { reconciled: true });

  // An on↔on transfer that kept a category, as a broken import leaves it: Actual clears the category when it
  // creates a mirror, so this row is added without one (04 §7 error state).
  await api.addTransactions(
    checking,
    [{ date: day(last, 10), amount: -20_000, payee: toAccount(savings), category: C('Groceries'), cleared: false }],
    { runTransfers: false, learnCategories: false },
  );

  // The closed account: an in-and-out pair, then closed at zero.
  await api.addTransactions(oldChecking, [
    { date: day(FIXTURE_MONTHS[0] ?? last, 3), amount: 5_000, payee: P('Employer Inc'), category: C('Income') },
    { date: day(FIXTURE_MONTHS[0] ?? last, 4), amount: -5_000, payee: P('Target'), category: C('Spending Money') },
  ]);
  await api.closeAccount(oldChecking);

  // Budgets: fixed amounts every month, carryover on the car-repair category in some months, one hold.
  const budgeted: Record<string, number> = {
    'Rent/Mortgage': 270_000, Electricity: 15_000, Water: 5_000, Phone: 7_000, Internet: 6_000,
    Tithing: 10_000, 'Car Insurance': 9_500, Groceries: 90_000, Fuel: 20_000, Restaurants: 25_000,
    'Spending Money': 30_000, Clothing: 8_000, Medical: 5_000, 'Household Goods': 10_000,
    'Car Repairs': 5_000, 'Car Replacement': 50_000, Vacation: 10_000,
  };
  for (const month of FIXTURE_MONTHS) {
    await api.batchBudgetUpdates(async () => {
      for (const [name, amount] of Object.entries(budgeted)) {
        await api.setBudgetAmount(month, C(name), amount);
      }
    });
    if (FIXTURE_MONTHS.indexOf(month) % 3 === 0) await api.setBudgetCarryover(month, C('Car Repairs'), true);
  }
  await api.holdBudgetForNextMonth(FIXTURE_MONTHS.at(-2) ?? last, 50_000);

  // Schedules: all 13 frequencies, a custom one, one that isn't entered automatically, and a transfer.
  // They start far in the future: once a start date passes, Actual's schedule service (12 §2) posts the
  // occurrences when a test opens the fixture, and the fixture's facts would depend on the day it runs.
  const start = '2036-11-03';
  const freq = (frequency: 'daily' | 'weekly' | 'monthly' | 'yearly', interval: number, extra = {}) => ({
    frequency,
    interval,
    start,
    endMode: 'never' as const,
    ...extra,
  });
  const dates: [string, unknown][] = [
    ['Once', start],
    ['Daily', freq('daily', 1)],
    ['Weekly', freq('weekly', 1)],
    ['Every other week', freq('weekly', 2)],
    ['Twice a month', freq('monthly', 1, { patterns: [{ type: 'day', value: 3 }, { type: 'day', value: 18 }] })],
    ['Every 4 weeks', freq('weekly', 4)],
    ['Monthly', freq('monthly', 1)],
    ['Every other month', freq('monthly', 2)],
    ['Every 3 months', freq('monthly', 3)],
    ['Every 4 months', freq('monthly', 4)],
    ['Twice a year', freq('monthly', 6)],
    ['Yearly', freq('yearly', 1)],
    ['Every other year', freq('yearly', 2)],
    ['Custom: every 3 weeks', freq('weekly', 3)],
  ];
  for (const [name, date] of dates) {
    await api.createSchedule({
      name,
      posts_transaction: true,
      payee: P('NetCo'),
      account: checking,
      amount: -1_000,
      amountOp: 'is',
      date: date as never,
    });
  }
  await api.createSchedule({ name: 'Not automatic', posts_transaction: false, payee: P('PhoneCo'), account: checking, amount: -6_500, amountOp: 'is', date: freq('monthly', 1) });
  await api.createSchedule({ name: 'Savings transfer', posts_transaction: true, payee: toAccount(savings), account: checking, amount: -10_000, amountOp: 'is', date: freq('monthly', 1) });

  console.log(`typical: ${String(total)} transactions`);
}

async function fillLarge(api: ActualModule): Promise<void> {
  const random = rng(7);
  const account = await api.createAccount({ name: 'Checking' }, 0);
  const group = await api.createCategoryGroup({ name: 'Spending', is_income: false, hidden: false });
  const category = await api.createCategory({ name: 'Everything', group_id: group, is_income: false, hidden: false });
  const payees = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => api.createPayee({ name: `Store ${n}` })));
  const batch: Tx[] = [];
  for (let i = 0; i < LARGE_TRANSACTIONS; i++) {
    const month = FIXTURE_MONTHS[i % FIXTURE_MONTHS.length] ?? END_MONTH;
    batch.push({
      date: day(month, 1 + (i % 28)),
      amount: -Math.round(100 + random() * 10_000),
      payee: payees[i % payees.length] ?? '',
      category,
      cleared: random() < 0.8,
    });
  }
  for (let i = 0; i < batch.length; i += 2_000) {
    await api.addTransactions(account, batch.slice(i, i + 2_000), { runTransfers: false, learnCategories: false });
  }
}

/** What the zips are built from besides the month: this builder, its helpers and the API that exports them. */
function sourceHash(): string {
  const api = readFileSync(join(import.meta.dirname, '../../node_modules/@actual-app/api/package.json'));
  return createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .update(readFileSync(join(import.meta.dirname, 'budget-helpers.ts')))
    .update(api)
    .digest('hex');
}

function isCurrent(source: string): boolean {
  if (!existsSync(FIXTURE_RECORD) || ZIPS.some((z) => !existsSync(join(FIXTURE_DIR, z)))) return false;
  const record = JSON.parse(readFileSync(FIXTURE_RECORD, 'utf8')) as { endMonth?: string; source?: string };
  return record.endMonth === END_MONTH && record.source === source;
}

async function main(): Promise<void> {
  const source = sourceHash();
  if (process.argv.includes('--if-stale') && isCurrent(source)) {
    console.log(`fixtures are current (${END_MONTH})`);
    return;
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  rmSync(FIXTURE_RECORD, { force: true });
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-fixture-'));
  try {
    const { fixtures } = await createRealActualForTests(dir);
    for (const [file, name, fill] of [
      ['typical.zip', 'Fixture: Typical', fillTypical],
      ['large.zip', 'Fixture: Large', fillLarge],
    ] as const) {
      const zip = await fixtures.buildBudgetZip(name, fill);
      writeFileSync(join(FIXTURE_DIR, file), zip);
      console.log(`wrote ${file} (${String(Math.round(zip.byteLength / 1024))} KB)`);
    }
    // Written last: a build that fails part-way leaves no record, so the next run builds again.
    writeFileSync(FIXTURE_RECORD, `${JSON.stringify({ endMonth: END_MONTH, source })}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
// The API may keep timers alive.
process.exit(0);
