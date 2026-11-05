// Slate wipe, Export Budget Backup and Import a budget file on the fixture budget against a real server:
// slate wipe (erase all) leaves only Starting Balance transactions, zero budgeted
// amounts, the accounts, categories and schedules, and the carryover flags, with a backup zip that
// re-imports as an equal budget (18 §2 acceptance, 07 §3.4); a cutoff keeps the later months; and the
// Slate wipe is refused offline.
import { addMonths } from '@shared/dates';
import type { Month } from '@shared/domain/types';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
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

const TEXTS = { startingBalancePayee: 'Starting Balance' };

/** Everything the user sees of a budget, for comparing two copies. */
async function snapshot(host: HostStack): Promise<unknown> {
  const months = await host.budget.months();
  return {
    accounts: await host.read.accounts(),
    categories: await host.read.categories(),
    transactions: await host.read.transactions('all'),
    schedules: await host.schedules.list('all'),
    months: await Promise.all(months.map((m) => host.budget.month(m))),
  };
}

describe.skipIf(!HAS_SERVER)('slate wipe, backup and budget import (18 §2, 07 §3.4, §6)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let host: HostStack;
  const zip = readFileSync(join(import.meta.dirname, '../fixtures/budgets/typical.zip'));

  /** A fresh server copy of the fixture, opened. */
  async function openCopy(): Promise<string> {
    const id =
      (await fixtures.uploadBudgetZip(SERVER, token, new Uint8Array(zip))).cloudFileId ?? '';
    cleanup.push(() => fixtures.deleteServerBudget(SERVER, token, id));
    await host.connection.openBudget(id);
    return id;
  }

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    token = await loginWithPassword(SERVER, PASSWORD);
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
    });
    host = hostStack(actual, join(dir, 'a'), { probe: (url) => net.probe(url) });
    await host.connection.connect(SERVER, PASSWORD, false);
  });

  afterAll(async () => {
    host.connection.dispose();
    for (const c of cleanup.reverse()) await c();
  });

  it('imports an Actual export as an equal, renamed budget (07 §3.4)', async () => {
    await openCopy();
    const before = await snapshot(host);
    const name = host.connection.state.budget?.name ?? '';
    const path = join(dir, 'export.zip');
    await host.budgetFile.exportBackup(path);
    expect(statSync(path).size).toBeGreaterThan(1000);

    const opened = await host.budgetFile.importFile(path, 'actual', '(imported 2026-10-21)', false);
    cleanup.push(() => fixtures.deleteServerBudget(SERVER, token, opened.cloudFileId));
    // The fixture copy has the same name, so the import is renamed (07 §3.4 step 4).
    expect(opened.name).toBe(`${name} (imported 2026-10-21)`);
    const listed = await host.connection.listBudgets();
    expect(listed.find((b) => b.cloudFileId === opened.cloudFileId)?.name).toBe(opened.name);
    expect(await snapshot(host)).toEqual(before);
  });

  it('erases everything, keeping the setup and a backup that re-imports (18 §2 acceptance)', async () => {
    await openCopy();
    const before = await snapshot(host);
    const months = await host.budget.months();
    const carryover = async (): Promise<string[]> =>
      (await Promise.all(months.map((m) => host.budget.month(m)))).flatMap((v) =>
        v.groups.flatMap((g) =>
          g.categories.flatMap((c) => (c.carryover ? [`${v.month}:${c.id}`] : [])),
        ),
      );
    const flags = await carryover();
    expect(flags.length).toBeGreaterThan(0);
    const accounts = await host.read.accounts();
    const categories = await host.read.categories();
    const schedules = await host.schedules.list('all');
    expect(schedules.length).toBeGreaterThan(0);

    const backupPath = join(dir, 'before-slate-wipe.zip');
    const result = await host.slateWipe.run({ cutoffMonth: null, backupPath, texts: TEXTS });
    expect(result.deleted).toBeGreaterThan(0);

    const rows = await host.read.transactions('all');
    expect(rows.filter((t) => !t.isStartingBalance)).toEqual([]);
    for (const m of months)
      for (const g of (await host.budget.month(m)).groups)
        for (const c of g.categories) expect(c.budgeted, `${m} ${c.id}`).toBe(0);
    expect((await host.read.accounts()).map((a) => [a.id, a.name, a.onBudget, a.closed])).toEqual(
      accounts.map((a) => [a.id, a.name, a.onBudget, a.closed]),
    );
    expect(await host.read.categories()).toEqual(categories);
    expect((await host.schedules.list('all')).map((s) => s.id)).toEqual(schedules.map((s) => s.id));
    expect(await carryover()).toEqual(flags);

    // The backup is a valid export: it re-imports as the budget it was.
    const restored = await host.budgetFile.importFile(backupPath, 'actual', '(restored)', false);
    cleanup.push(() => fixtures.deleteServerBudget(SERVER, token, restored.cloudFileId));
    expect(await snapshot(host)).toEqual(before);
  });

  it('with a cutoff keeps every later month and carries the balances forward', async () => {
    await openCopy();
    const months = await host.budget.months();
    const first = (await host.read.transactions('all')).map((t) => t.date).sort()[0];
    if (!first) throw new Error('The fixture has no transactions.');
    // A cutoff two months after the first month with data.
    const cutoff: Month = addMonths(first.slice(0, 7) as Month, 2);
    const kept = months.filter((m) => m >= cutoff);
    const views = async () => Promise.all(kept.map((m) => host.budget.month(m)));
    const keptBefore = (await views()).map((v) =>
      v.groups.flatMap((g) => g.categories.map((c) => [c.id, c.budgeted, c.carryover])),
    );
    const balancesBefore = (await host.read.accounts()).map((a) => [a.id, a.balances.working]);
    const keptRows = (await host.read.transactions('all')).filter((t) => t.date >= `${cutoff}-01`);

    await host.slateWipe.run({
      cutoffMonth: cutoff,
      backupPath: join(dir, 'cutoff.zip'),
      texts: TEXTS,
    });

    // A negative Starting Balance goes to the income category like any other, so no category is
    // created (13 §2.1).
    expect(
      (await views()).map((v) =>
        v.groups.flatMap((g) => g.categories.map((c) => [c.id, c.budgeted, c.carryover])),
      ),
    ).toEqual(keptBefore);
    const rows = await host.read.transactions('all');
    expect(rows.filter((t) => !t.isStartingBalance && t.date < `${cutoff}-01`)).toEqual([]);
    expect(
      rows
        .filter((t) => t.date >= `${cutoff}-01`)
        .map((t) => t.id)
        .sort(),
    ).toEqual(keptRows.map((t) => t.id).sort());
    // Each open account keeps its balance: the Starting Balance stands in for the erased rows.
    const after = new Map((await host.read.accounts()).map((a) => [a.id, a.balances.working]));
    for (const [id, balance] of balancesBefore)
      expect(after.get(id as string), String(id)).toBe(balance);
  });

  it('with a cutoff leaves a closed account with no balance', async () => {
    await openCopy();
    const old = (await host.read.accounts()).find((a) => a.name === 'Old Checking');
    if (!old) throw new Error('The fixture has no closed account.');
    // Rows that cross the cutoff: the erased one is offset by a Starting Balance in the closed account.
    await host.accounts.reopen(old.id);
    const row = (date: string, amount: number) =>
      actual.addTransaction(old.id, {
        id: crypto.randomUUID(),
        date,
        amount,
        category: null,
        notes: '',
        cleared: true,
        reconciled: false,
      });
    await host.queue.run(
      'test.rows',
      async () => {
        await row('2026-01-15', 700);
        await row('2026-03-15', -700);
      },
      { kind: 'write' },
    );
    await host.accounts.close(old.id);

    await host.slateWipe.run({
      cutoffMonth: '2026-02',
      backupPath: join(dir, 'closed.zip'),
      texts: TEXTS,
    });

    const after = (await host.read.accounts()).find((a) => a.id === old.id);
    expect(after).toMatchObject({ closed: true, balances: { working: 0 } });
    const starting = (await host.read.transactions(old.id)).filter((t) => t.isStartingBalance);
    expect(starting.map((t) => [t.date, t.amount])).toEqual([['2026-01-31', 700]]);
  });

  it('is refused while offline (03 §5)', async () => {
    await openCopy();
    net.down();
    await host.connection.syncNow().catch(() => undefined);
    expect(host.connection.state.state).toBe('OfflineReadOnly');
    await expect(
      host.slateWipe.run({
        cutoffMonth: null,
        backupPath: join(dir, 'offline.zip'),
        texts: TEXTS,
      }),
    ).rejects.toMatchObject({ code: 'offline' });
    net.up();
  });
});
