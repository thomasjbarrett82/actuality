// The Budget screen's host methods against a real server (09 §2, §5.5, §6, §9): month
// views equal to Actual's numbers in every fixture month (criteria 1–2), the range guard, budget writes,
// Quick Budget stats, notes, the transactions popover's rows, categories (create, rename, hide, delete
// with its impact) and moves with and without the internal move handlers (checked through ActualQL and a
// second device), a budget in Actual's Tracking mode refused on open (01 §3), and every new write
// refused offline.
import { addMonths, today } from '@shared/dates';
import { toBudgetMonthView } from '@shared/domain/budget-month';
import type { Month } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  UNAVAILABLE_HANDLER,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { FIXTURE_MONTHS } from '../fixtures/fixture-facts';
import { installNetworkSwitch, type NetworkSwitch } from './network';
import {
  bootstrap,
  HAS_SERVER,
  hostStack,
  PASSWORD,
  SERVER,
  tempDir,
  type HostStack,
} from './setup';

describe.skipIf(!HAS_SERVER)('the budget against a real server (09)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let typicalId: string;
  let trackingId: string;
  let trackingZip: Uint8Array;
  let host: HostStack;

  const aql = async <T>(build: (q: ActualTestFixtures['api']['q']) => unknown): Promise<T> =>
    ((await fixtures.api.aqlQuery(build(fixtures.api.q) as never)) as { data: T }).data;

  async function device(name: string, cloudFileId: string, api: ActualApi = actual) {
    const stack = hostStack(api, join(dir, name), { probe: (url) => net.probe(url) });
    await stack.connection.connect(SERVER, PASSWORD, false);
    await stack.connection.openBudget(cloudFileId);
    return stack;
  }

  async function leave(stack: HostStack): Promise<void> {
    await stack.connection.syncNow();
    await stack.connection.closeBudget(false);
    stack.connection.dispose();
  }

  const category = async (name: string) => {
    const found = (await host.read.categories())
      .flatMap((g) => g.categories)
      .find((c) => c.name === name);
    if (!found) throw new Error(`no category ${name}`);
    return found;
  };
  const group = async (name: string) => {
    const found = (await host.read.categories()).find((g) => g.name === name);
    if (!found) throw new Error(`no group ${name}`);
    return found;
  };
  const sortOrders = async (table: 'categories' | 'category_groups', ids: string[]) =>
    new Map(
      (
        await aql<{ id: string; sort_order: number }[]>((q) =>
          q(table)
            .filter({ id: { $oneof: ids } })
            .select(['id', 'sort_order']),
        )
      ).map((r) => [r.id, r.sort_order]),
    );

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    token = await loginWithPassword(SERVER, PASSWORD);
    const zip = (file: string) =>
      new Uint8Array(readFileSync(join(import.meta.dirname, `../fixtures/budgets/${file}`)));
    typicalId =
      (await fixtures.uploadBudgetZip(SERVER, token, zip('typical.zip'))).cloudFileId ?? '';
    trackingZip = await fixtures.buildBudgetZip('Tracking', (api) =>
      api.setPreference('budgetType', 'tracking'),
    );
    trackingId = (await fixtures.uploadBudgetZip(SERVER, token, trackingZip)).cloudFileId ?? '';
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, typicalId);
      await fixtures.deleteServerBudget(SERVER, token, trackingId);
    });
    host = await device('a', typicalId);
  });

  afterAll(async () => {
    net.up();
    host.connection.dispose();
    for (const step of cleanup.reverse()) await step();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('month views (09 §2; §9 criteria 1–2)', () => {
    it('equal Actual’s numbers and hold the header identity in every fixture month', async () => {
      const months = await host.budget.months();
      for (const m of FIXTURE_MONTHS as Month[]) {
        const v = await host.budget.month(m);
        const cur = await fixtures.api.getBudgetMonth(m);
        const prevMonth = addMonths(m, -1);
        const prev = months.includes(prevMonth)
          ? await fixtures.api.getBudgetMonth(prevMonth)
          : null;
        const expected = toBudgetMonthView(cur as never, prev as never, {
          withTransactions: new Set(),
          uncategorized: v.uncategorized,
        });
        expect(v.toBudget, m).toBe(cur.toBudget);
        expect(v.budgeted, m).toBe(-cur.totalBudgeted);
        expect(v.totals, m).toEqual(expected.totals);
        expect(v.income, m).toBe(expected.income);
        expect(v.overspentPrev, m).toBe(cur.lastMonthOverspent);
        expect(v.otherAdjustments, m).toBe(0);
        for (const g of v.groups)
          for (const c of g.categories) {
            const raw = cur.categoryGroups
              .flatMap((x) => x.categories ?? [])
              .find((x) => x['id'] === c.id);
            expect([c.budgeted, c.activity, c.balance], `${m} ${c.id}`).toEqual([
              raw?.['budgeted'],
              raw?.['spent'],
              raw?.['balance'],
            ]);
          }
      }
    });

    it('counts transactions per category and the Uncategorized row like ActualQL (04 §6)', async () => {
      const m = FIXTURE_MONTHS.at(-2) as Month;
      const v = await host.budget.month(m);
      const groceries = await category('Groceries');
      const count = await aql<number>((q) =>
        q('transactions')
          .filter({
            'account.offbudget': false,
            category: groceries.id,
            date: { $transform: '$month', $eq: m },
          })
          .calculate({ $count: '$id' }),
      );
      const cell = v.groups.flatMap((g) => g.categories).find((c) => c.id === groceries.id);
      expect(cell?.hasTransactions).toBe(count > 0);
      const rows = await aql<{ amount: number }[]>((q) =>
        q('transactions')
          .filter({
            'account.offbudget': false,
            category: null,
            $or: [{ 'payee.transfer_acct': null }, { 'payee.transfer_acct.offbudget': true }],
            date: { $transform: '$month', $eq: m },
          })
          .select(['amount']),
      );
      expect(v.uncategorized).toEqual({
        activity: rows.reduce((s, r) => s + r.amount, 0),
        hasTransactions: rows.length > 0,
      });
      expect((await host.budget.uncategorized()).exists).toBe(true);
    });

    it('refuses months outside the range, for reads and every budget write (09 §2)', async () => {
      const months = await host.budget.months();
      const after = addMonths(months.at(-1) as Month, 1);
      const groceries = await category('Groceries');
      await expect(host.budget.month(after)).rejects.toMatchObject({ code: 'validation' });
      for (const write of [
        () => host.budget.setAmount(after, groceries.id, 100),
        () => host.budget.setAmounts(after, [{ categoryId: groceries.id, amount: 100 }]),
        () => host.budget.setCarryover(after, groceries.id, true),
        () => host.budget.hold(after, 100),
        () => host.budget.resetHold(after),
      ])
        await expect(write()).rejects.toMatchObject({ code: 'validation' });
      const raw = await aql<unknown[]>((q) =>
        q('zero_budgets')
          .filter({ month: Number(after.replace('-', '')), category: groceries.id })
          .select(['amount']),
      ).catch(() => []);
      expect(raw).toEqual([]);
    });
  });

  describe('budget writes (09 §5.4–5.5, §6.4)', () => {
    const month = today(new Date()).slice(0, 7) as Month;

    it('sets one amount and a batch of them', async () => {
      const fuel = await category('Fuel');
      const clothing = await category('Clothing');
      await host.budget.setAmount(month, fuel.id, 12_345);
      await host.budget.setAmounts(month, [
        { categoryId: fuel.id, amount: 22_222 },
        { categoryId: clothing.id, amount: 11_111 },
      ]);
      const v = await host.budget.month(month);
      const cells = new Map(v.groups.flatMap((g) => g.categories).map((c) => [c.id, c]));
      expect(cells.get(fuel.id)?.budgeted).toBe(22_222);
      expect(cells.get(clothing.id)?.budgeted).toBe(11_111);
      expect(v.otherAdjustments).toBe(0);
    });

    it('holds for next month, replacing the hold, and resets it (X1)', async () => {
      await host.budget.setAmount(month, (await category('Fuel')).id, 0);
      const before = await host.budget.month(month);
      await host.budget.hold(month, 1_000);
      await host.budget.hold(month, 2_000);
      const held = await host.budget.month(month);
      expect(held.heldForNext).toBe(Math.min(2_000, Math.max(0, before.toBudget)));
      expect(held.otherAdjustments).toBe(0);
      await host.budget.resetHold(month);
      expect((await host.budget.month(month)).heldForNext).toBe(0);
    });

    it('sets carryover from a month on, and refuses income categories (S-10)', async () => {
      const medical = await category('Medical');
      await host.budget.setCarryover(month, medical.id, true);
      for (const m of (await host.budget.months()).filter((x) => x >= month)) {
        const c = (await host.budget.month(m)).groups
          .flatMap((g) => g.categories)
          .find((x) => x.id === medical.id);
        expect(c?.carryover, m).toBe(true);
      }
      const income = (await host.read.categories()).find((g) => g.isIncome)?.categories[0];
      await expect(host.budget.setCarryover(month, income?.id ?? '', true)).rejects.toMatchObject({
        code: 'validation',
      });
    });

    it('gives Quick Budget stats from the history, with scheduled outflows (09 §5.5)', async () => {
      const stats = await host.budget.quickBudgetStats(month);
      expect(stats.h12).toBeGreaterThan(3);
      const rent = await category('Rent/Mortgage');
      const prev = await fixtures.api.getBudgetMonth(addMonths(month, -1));
      const raw = prev.categoryGroups
        .flatMap((g) => g.categories ?? [])
        .find((c) => c['id'] === rent.id);
      expect(stats.categories[rent.id]).toMatchObject({
        lastBudgeted: raw?.['budgeted'],
        lastOutflows: -(raw?.['spent'] as number),
      });
      expect(stats.categories[rent.id]?.average3).toBeGreaterThan(0);
      // Every schedule's dates come from get-upcoming-dates, from today on.
      for (const s of await actual.getSchedules()) {
        if (typeof s.date !== 'object' || s.completed) continue;
        const dates = await actual.getUpcomingDates(s.date, 3);
        expect(dates.length, s.id).toBeGreaterThan(0);
        expect([...dates].sort(), s.id).toEqual(dates);
        expect(dates[0] && dates[0] >= today(new Date())).toBe(true);
      }
      // The weekly schedule (−10.00) categorized as Groceries: its occurrences next month. The fixture's
      // schedules start years out, past the budget's months, so it's moved to start next month.
      const groceries = await category('Groceries');
      const next3rd = `${addMonths(month, 1)}-03`;
      const fixtureWeekly = (await fixtures.api.getSchedules()).find((s) => s.name === 'Weekly');
      if (!fixtureWeekly || typeof fixtureWeekly.date !== 'object')
        throw new Error('no weekly schedule');
      await fixtures.api.updateSchedule(
        fixtureWeekly.id,
        { date: { ...fixtureWeekly.date, start: next3rd } },
        true,
      );
      const weekly = (await fixtures.api.getSchedules()).find((s) => s.id === fixtureWeekly.id);
      const rule = (await fixtures.api.getRules()).find((r) => r.id === weekly?.rule);
      if (!weekly || !rule) throw new Error('no weekly schedule');
      await fixtures.api.updateRule({
        ...rule,
        actions: [
          ...rule.actions,
          { op: 'set', field: 'category', value: groceries.id, type: 'id' },
        ],
      } as never);
      const nextMonth = addMonths(month, 1);
      const occurrences = (await actual.getUpcomingDates(weekly.date, 12)).filter(
        (d) => d.startsWith(nextMonth) && d >= (weekly.next_date ?? ''),
      );
      const next = await host.budget.quickBudgetStats(nextMonth);
      expect(occurrences.length).toBeGreaterThan(0);
      expect(next.categories[groceries.id]?.scheduled).toBe(occurrences.length * 1_000);
    });
  });

  describe('notes (09 §6.3)', () => {
    it('writes month notes as Actual’s budget-{month} and cell notes into ad:cellnotes', async () => {
      const month = FIXTURE_MONTHS.at(-1) as Month;
      await host.notes.setMonthNote(month, 'Payday is late');
      expect(await host.notes.monthNote(month)).toBe('Payday is late');
      expect(await fixtures.api.getNote(`budget-${month}`)).toMatchObject({
        note: 'Payday is late',
      });
      const fuel = await category('Fuel');
      await host.notes.setCellNote(month, fuel.id, 'Road trip');
      expect(await host.notes.cellNotes(month)).toEqual({ [fuel.id]: 'Road trip' });
      await host.notes.setCellNote(month, fuel.id, '');
      expect(await host.notes.cellNotes(month)).toEqual({});
    });
  });

  describe('the transactions popover (09 §6.6)', () => {
    it('lists a category’s outflows in the month, split lines included, newest first', async () => {
      const month = FIXTURE_MONTHS.at(-2) as Month;
      const groceries = await category('Groceries');
      const rows = await host.read.forCategoryMonth(groceries.id, month);
      const raw = await aql<{ amount: number }[]>((q) =>
        q('transactions')
          .filter({
            'account.offbudget': false,
            category: groceries.id,
            date: { $transform: '$month', $eq: month },
          })
          .select(['amount']),
      );
      expect(rows).toHaveLength(raw.length);
      const cell = (await host.budget.month(month)).groups
        .flatMap((g) => g.categories)
        .find((c) => c.id === groceries.id);
      expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(cell?.activity);
      expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort().reverse());
      const income = await host.read.incomeForMonth(month);
      expect(income.reduce((s, r) => s + r.amount, 0)).toBe(
        (await host.budget.month(month)).incomeReceived,
      );
      const everyday = await group('Everyday Expenses');
      const all = await host.read.forCategoryMonth(everyday.id, month);
      expect(all.length).toBeGreaterThanOrEqual(rows.length);
    });
  });

  describe('categories (09 §4.1, §4.3, §6.1–6.2, §6.5)', () => {
    it('adds a master category at the top and a category at its end', async () => {
      const g = await host.categories.createGroup('New Master Category');
      const g2 = await host.categories.createGroup('New Master Category');
      expect(g2.name).toBe('New Master Category 2');
      const tree = await host.read.categories();
      expect(tree[0]?.id).toBe(g2.id);
      expect(tree[1]?.id).toBe(g.id);
      await host.categories.create({ groupId: g.id, name: 'New Category', unique: true });
      const c2 = await host.categories.create({
        groupId: g.id,
        name: 'New Category',
        unique: true,
      });
      expect(c2.name).toBe('New Category 2');
      expect((await group('New Master Category')).categories.map((c) => c.name)).toEqual([
        'New Category',
        'New Category 2',
      ]);
      await host.categories.deleteGroup(g2.id);
    });

    it('renames, hides and unhides (09 §9 criterion 5)', async () => {
      const c = await category('New Category');
      await host.categories.update(c.id, { name: 'Pets' });
      await expect(host.categories.update(c.id, { name: 'New Category 2' })).rejects.toMatchObject({
        details: { code: 'name-duplicate' },
      });
      await host.categories.update(c.id, { hidden: true });
      expect((await category('Pets')).hidden).toBe(true);
      await host.categories.setHidden([c.id], [], false);
      expect((await category('Pets')).hidden).toBe(false);
    });

    it('reports a delete’s impact, then uncategorizes its transactions (S-4)', async () => {
      const pets = await category('Pets');
      const month = FIXTURE_MONTHS.at(-1) as Month;
      await host.budget.setAmount(month, pets.id, 5_000);
      const checking = (await host.read.accounts()).find((a) => a.name === 'Checking');
      await host.transactions.commit({
        accountId: checking?.id ?? '',
        date: `${month}-03`,
        amount: -1_234,
        payee: { kind: 'new', name: 'Vet' },
        categoryId: pets.id,
        notes: '',
        checkNumber: null,
        needsReview: false,
        cleared: 'U',
      });
      expect(await host.categories.deleteImpact(pets.id)).toEqual({
        budgetedMonths: 1,
        transactionCount: 1,
        transactionTotal: -1_234,
      });
      await host.notes.setCellNote(month, pets.id, 'Vet bill');
      await host.categories.delete(pets.id);
      const vet = (await host.read.transactions(checking?.id ?? '')).find(
        (t) => t.payeeName === 'Vet',
      );
      expect(vet?.categoryId).toBeNull();
      expect(await host.notes.cellNotes(month)).not.toHaveProperty(pets.id);
      await host.categories.deleteGroup((await group('New Master Category')).id);
    });

    it('reorders within and across groups and reorders groups, seen on a second device (09 §4.3)', async () => {
      const everyday = await group('Everyday Expenses');
      const bills = await group('Monthly Bills');
      const [first, second] = everyday.categories;
      if (!first || !second) throw new Error('fixture group too small');
      await host.categories.move(second.id, everyday.id, first.id);
      let orders = await sortOrders('categories', [first.id, second.id]);
      expect(orders.get(second.id)).toBeLessThan(orders.get(first.id) ?? 0);
      await host.categories.move(first.id, bills.id, null);
      expect((await group('Monthly Bills')).categories.at(-1)?.id).toBe(first.id);
      await host.categories.moveGroup(bills.id, everyday.id);
      orders = await sortOrders('category_groups', [bills.id, everyday.id]);
      expect(orders.get(bills.id)).toBeLessThan(orders.get(everyday.id) ?? 0);
      await host.connection.syncNow();

      const b = await device('b', typicalId);
      const tree = await b.read.categories();
      const names = tree.map((g) => g.name);
      expect(names.indexOf('Monthly Bills')).toBeLessThan(names.indexOf('Everyday Expenses'));
      expect(tree.find((g) => g.id === bills.id)?.categories.at(-1)?.id).toBe(first.id);
      await leave(b);
      host = await device('a', typicalId);
    });

    it('without the move handlers: moves only across groups (03 §3)', async () => {
      const missing = new Proxy(actual, {
        get(target, prop, receiver) {
          if (prop === 'internalHandlerAvailable')
            return (name: string) => name !== 'category-move' && name !== 'category-group-move';
          if (prop === 'moveCategory' || prop === 'moveCategoryGroup')
            return () =>
              Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
      });
      await leave(host);
      const c = await device('c', typicalId, missing);
      const savings = (await c.read.categories()).find((g) => g.name === 'Savings Goals');
      const rainy = (await c.read.categories()).find((g) => g.name === 'Rainy Day Funds');
      const [one, two] = savings?.categories ?? [];
      if (!savings || !rainy || !one || !two) throw new Error('fixture groups missing');
      await expect(c.categories.move(two.id, savings.id, one.id)).rejects.toMatchObject({
        details: { code: UNAVAILABLE_HANDLER },
      });
      await c.categories.move(one.id, rainy.id, null);
      const moved = (await c.read.categories())
        .flatMap((g) => g.categories)
        .find((x) => x.id === one.id);
      expect(moved?.groupId).toBe(rainy.id);
      await expect(c.categories.moveGroup(rainy.id, null)).rejects.toMatchObject({
        details: { code: UNAVAILABLE_HANDLER },
      });
      expect(await c.categories.moveSupport()).toEqual({ category: false, group: false });
      await leave(c);
      host = await device('a', typicalId);
    });
  });

  describe('tracking budgets (01 §3, 03 §6.1)', () => {
    it('refuses to open a budget in Actual’s Tracking mode, and stays signed in', async () => {
      await leave(host);
      const t = hostStack(actual, join(dir, 't'), { probe: (url) => net.probe(url) });
      await t.connection.connect(SERVER, PASSWORD, false);
      await expect(t.connection.openBudget(trackingId)).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'tracking-budget' },
      });
      expect(t.connection.state).toMatchObject({ state: 'SignedIn', budget: null });
      t.connection.dispose();
      host = await device('a', typicalId);
    });

    it('refuses to import an Actual export of a tracking budget before uploading it', async () => {
      const path = join(dir, 'Tracking.zip');
      writeFileSync(path, trackingZip);
      const before = (await host.connection.listBudgets()).length;
      await expect(
        host.budgetFile.importFile(path, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ details: { code: 'tracking-budget' } });
      expect(host.connection.state.budget?.cloudFileId).toBe(typicalId);
      expect(await host.connection.listBudgets()).toHaveLength(before);
    });
  });

  it('rejects every budget, category and note write while offline (03 §5)', async () => {
    const fuel = await category('Fuel');
    const everyday = await group('Everyday Expenses');
    const month = today(new Date()).slice(0, 7) as Month;
    net.down();
    await host.connection.syncNow().catch(() => undefined);
    expect(host.connection.state.state).toBe('OfflineReadOnly');
    const writes = [
      () => host.budget.setAmount(month, fuel.id, 1),
      () => host.budget.setAmounts(month, [{ categoryId: fuel.id, amount: 1 }]),
      () => host.budget.setCarryover(month, fuel.id, true),
      () => host.budget.hold(month, 1),
      () => host.budget.resetHold(month),
      () => host.categories.createGroup('Offline group'),
      () => host.categories.update(fuel.id, { name: 'Offline' }),
      () => host.categories.updateGroup(everyday.id, { name: 'Offline' }),
      () => host.categories.setHidden([fuel.id], [], true),
      () => host.categories.delete(fuel.id),
      () => host.categories.deleteGroup(everyday.id),
      () => host.categories.move(fuel.id, everyday.id, null),
      () => host.categories.moveGroup(everyday.id, null),
      () => host.notes.setCellNote(month, fuel.id, 'x'),
      () => host.notes.setMonthNote(month, 'x'),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'offline' });
    net.up();
    await host.connection.retry('manual');
    expect((await category('Fuel')).name).toBe('Fuel');
  });
});
