// Account writes against a real server (13 §2–5, §8; 08 §4): Actual's own starting
// balance (13 §8 criterion 1), reorder within a group as the sidebar's drops write it, close (and Actual's
// delete-when-empty), reopen and force close (13 §8 criterion 4), the fixture's error badges, edits seen
// from a second device and after a restart (13 §8 criterion 3), and writes refused offline.
import { APP_NAME } from '@shared/app';
import { today } from '@shared/dates';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { TYPICAL_ATTENTION } from '../fixtures/fixture-facts';
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

describe.skipIf(!HAS_SERVER)('accounts against a real server (13 §2–5, 08 §4)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let fixtureId: string;
  let emptyId: string;
  let host: HostStack;

  /** An ActualQL query straight through the API, independent of the services. */
  const aql = async <T>(build: (q: ActualTestFixtures['api']['q']) => unknown): Promise<T> =>
    ((await fixtures.api.aqlQuery(build(fixtures.api.q) as never)) as { data: T }).data;
  const accountRow = async (id: string) =>
    (
      await aql<
        { id: string; name: string; offbudget: boolean; closed: boolean; sort_order: number }[]
      >((q) =>
        q('accounts').filter({ id }).select(['id', 'name', 'offbudget', 'closed', 'sort_order']),
      )
    )[0];
  const byName = async (name: string) => {
    const found = (await host.read.accounts()).find((a) => a.name === name);
    if (!found) throw new Error(`no account ${name}`);
    return found;
  };

  /** A host stack on its own cache folder, signed in and with `cloudFileId` open. */
  async function device(name: string, cloudFileId: string): Promise<HostStack> {
    const stack = hostStack(actual, join(dir, name), { probe: (url) => net.probe(url) });
    await stack.connection.connect(SERVER, PASSWORD, false);
    await stack.connection.openBudget(cloudFileId);
    return stack;
  }

  async function leave(stack: HostStack): Promise<void> {
    await stack.connection.syncNow();
    await stack.connection.closeBudget(false);
    stack.connection.dispose();
  }

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    cleanup.push(() => actual.shutdown().catch(() => undefined));
    token = await loginWithPassword(SERVER, PASSWORD);
    const zip = readFileSync(join(import.meta.dirname, '../fixtures/budgets/typical.zip'));
    fixtureId =
      (await fixtures.uploadBudgetZip(SERVER, token, new Uint8Array(zip))).cloudFileId ?? '';
    const empty = await fixtures.createServerBudget(
      SERVER,
      token,
      `${APP_NAME} accounts ${String(Date.now())}`,
    );
    emptyId = empty.cloudFileId ?? '';
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, fixtureId);
      await fixtures.deleteServerBudget(SERVER, token, emptyId);
    });
  });

  afterAll(async () => {
    net.up();
    host.connection.dispose();
    for (const step of cleanup.reverse()) await step();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('a new budget', () => {
    it("a balance of −500 keeps Actual's starting balance: today, Cleared, its income category (13 §8 criterion 1)", async () => {
      host = await device('empty-a', emptyId);
      const date = today(new Date());
      const groupsBefore = await host.read.categories();
      const { id } = await host.accounts.create({
        name: 'Visa: Gold',
        onBudget: true,
        balance: -50_000,
      });
      const account = (await host.read.accounts()).find((a) => a.id === id);
      expect(account).toMatchObject({ balances: { working: -50_000 }, lastReconciledDate: null });
      const [starting, ...others] = await host.read.transactions(id);
      expect(others).toEqual([]);
      expect(starting).toMatchObject({
        amount: -50_000,
        date,
        cleared: 'C',
        isStartingBalance: true,
        payeeName: 'Starting Balance',
      });
      const groups = await host.read.categories();
      const income = groups.filter((g) => g.isIncome).flatMap((g) => g.categories);
      expect(income.map((c) => c.id)).toContain(starting?.categoryId);
      // No other category or group, and no app metadata.
      expect(groups.map((g) => [g.id, g.categories.map((c) => c.id)])).toEqual(
        groupsBefore.map((g) => [g.id, g.categories.map((c) => c.id)]),
      );
      expect(await host.notes.get(`ad:account:${id}`)).toBeNull();

      // Off budget: no category.
      const off = await host.accounts.create({ name: 'House', onBudget: false, balance: 100_000 });
      const [offStart] = await host.read.transactions(off.id);
      expect(offStart).toMatchObject({ amount: 100_000, categoryId: null });
    });

    it("closing an account with no transactions deletes it, as Actual's close does (13 §8 criterion 4)", async () => {
      const { id } = await host.accounts.create({
        name: 'Spare',
        onBudget: true,
        balance: 0,
      });
      await host.accounts.update(id, { note: 'Spare change' });
      await host.accounts.close(id);
      expect(await accountRow(id)).toBeUndefined();
      expect(await host.notes.get(`account-${id}`)).toBe('');
    });

    it('force close deletes an open account and all of its transactions (13 §5)', async () => {
      const { id } = await host.accounts.create({ name: 'Temp', onBudget: true, balance: 2_500 });
      await host.accounts.update(id, { note: 'Temporary' });
      await host.accounts.delete(id);
      expect(await accountRow(id)).toBeUndefined();
      expect(
        await aql<{ id: string }[]>((q) =>
          q('transactions').filter({ account: id }).select(['id']),
        ),
      ).toEqual([]);
      expect(await host.notes.get(`account-${id}`)).toBe('');
      await leave(host);
    });
  });

  describe('the Typical fixture', () => {
    it('reports the fixture’s error counts for the sidebar badges (08 §2.2)', async () => {
      host = await device('fixture-a', fixtureId);
      const accounts = await host.read.accounts();
      const badges = Object.fromEntries(
        accounts.filter((a) => a.attention.count > 0).map((a) => [a.name, a.attention]),
      );
      expect(badges).toEqual(TYPICAL_ATTENTION);
    });

    it('reorders within a group, writing only the moved account (04 §3)', async () => {
      const [checking, savings, visa] = await Promise.all(
        ['Checking', 'Savings', 'Visa'].map((n) => byName(n)),
      );
      const others = await aql<{ id: string; sort_order: number }[]>((q) =>
        q('accounts')
          .filter({ id: { $ne: visa?.id } })
          .select(['id', 'sort_order']),
      );
      await host.accounts.reorder(visa?.id ?? '', checking?.id ?? '', 'onBudget');
      const onBudget = (await host.read.accounts())
        .filter((a) => a.onBudget && !a.closed)
        .sort((a, b) => a.sortIndex - b.sortIndex);
      expect(onBudget.map((a) => a.name).slice(0, 2)).toEqual(['Visa', 'Checking']);
      const after = await aql<{ id: string; sort_order: number }[]>((q) =>
        q('accounts')
          .filter({ id: { $ne: visa?.id } })
          .select(['id', 'sort_order']),
      );
      expect(after).toEqual(others);
      expect(savings).toBeDefined();
    });

    it('refuses a drop on another group: Actual is unchanged (08 §4)', async () => {
      const savings = await byName('Savings');
      const mortgage = await byName('Mortgage');
      const before = await accountRow(savings.id);
      await expect(
        host.accounts.reorder(savings.id, mortgage.id, 'offBudget'),
      ).rejects.toMatchObject({ details: { code: 'other-group' } });
      await expect(host.accounts.reorder(savings.id, null, 'closed')).rejects.toMatchObject({
        details: { code: 'other-group' },
      });
      expect(await accountRow(savings.id)).toEqual(before);
    });

    it('closes with a balance moved to another account, reopens, and keeps a closed one (13 §4)', async () => {
      const cash = await byName('Cash');
      const checking = await byName('Checking');
      await expect(host.accounts.close(cash.id)).rejects.toMatchObject({
        details: { code: 'balance-not-zero' },
      });
      await host.accounts.close(cash.id, checking.id);
      expect(await accountRow(cash.id)).toMatchObject({ closed: true });
      expect((await byName('Cash')).balances.working).toBe(0);
      expect((await byName('Checking')).balances.working).toBe(
        checking.balances.working + cash.balances.working,
      );
      // Only an open account can be force-closed: a closed one can only be re-opened.
      await expect(host.accounts.delete(cash.id)).rejects.toMatchObject({
        details: { code: 'account-closed' },
      });
      await host.accounts.reopen(cash.id);
      expect(await accountRow(cash.id)).toMatchObject({ closed: false });
    });

    it('edits survive a restart and show on a second device (13 §8 criterion 3)', async () => {
      const visa = await byName('Visa');
      await host.accounts.update(visa.id, {
        name: 'Visa Platinum',
        note: 'Pay in full each month',
      });
      await leave(host);

      host = await device('fixture-b', fixtureId);
      const seen = (await host.read.accounts()).find((a) => a.id === visa.id);
      expect(seen).toMatchObject({
        name: 'Visa Platinum',
        note: 'Pay in full each month',
      });
      await leave(host);

      // Device A again, on its own cache: a restart.
      host = await device('fixture-a', fixtureId);
      expect((await host.read.accounts()).find((a) => a.id === visa.id)).toMatchObject({
        name: 'Visa Platinum',
        note: 'Pay in full each month',
      });
    });

    it('rejects every account write while offline (03 §5)', async () => {
      const checking = await byName('Checking');
      net.down();
      await host.connection.syncNow().catch(() => undefined);
      expect(host.connection.state.state).toBe('OfflineReadOnly');
      const writes = [
        () =>
          host.accounts.create({
            name: 'Offline',
            onBudget: true,
            balance: 0,
          }),
        () => host.accounts.update(checking.id, { name: 'Offline name' }),
        () => host.accounts.close(checking.id),
        () => host.accounts.reopen(checking.id),
        () => host.accounts.delete(checking.id),
        () => host.accounts.reorder(checking.id, null, 'onBudget'),
      ];
      for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'offline' });
      net.up();
      await host.connection.retry('manual');
      expect((await byName('Checking')).name).toBe('Checking');
    });
  });
});
