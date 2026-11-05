// The metadata layer and the read services against a real server and the Typical fixture:
// values must match independent ActualQL sums, every reserved note must round-trip through the
// server to a fresh device, and a backup note must never load as metadata.
import { balancesOf } from '@shared/domain/balances';
import { RESERVED, reservedIds } from '@shared/metadata/reserved';
import { REVIEW_TAG } from '@shared/metadata/tags';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { TYPICAL_ACCOUNTS } from '../fixtures/fixture-facts';
import {
  bootstrap,
  HAS_SERVER,
  hostStack,
  PASSWORD,
  SERVER,
  tempDir,
  type HostStack,
} from './setup';

describe.skipIf(!HAS_SERVER)('metadata and read services on the fixture (04 §5–8)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let cloudFileId: string;
  let host: HostStack;

  beforeAll(async () => {
    await bootstrap();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    cleanup.push(() => actual.shutdown().catch(() => undefined));
    token = await loginWithPassword(SERVER, PASSWORD);
    const zip = readFileSync(join(import.meta.dirname, '../fixtures/budgets/typical.zip'));
    const file = await fixtures.uploadBudgetZip(SERVER, token, new Uint8Array(zip));
    cloudFileId = file.cloudFileId ?? '';
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, cloudFileId);
    });
    host = hostStack(actual, join(dir, 'device-a'));
    cleanup.push(() => {
      host.connection.dispose();
    });
    await host.connection.connect(SERVER, PASSWORD, false);
    await host.connection.openBudget(cloudFileId);
  });

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
    rmSync(dir, { recursive: true, force: true });
  });

  /** An ActualQL query straight through the API, independent of the read services. */
  const aql = async <T>(build: (q: ActualTestFixtures['api']['q']) => unknown): Promise<T> =>
    ((await fixtures.api.aqlQuery(build(fixtures.api.q) as never)) as { data: T }).data;

  it('lists the fixture accounts with balances equal to independent AQL sums', async () => {
    const accounts = await host.read.accounts();
    expect(accounts.map((a) => a.name).sort()).toEqual([...TYPICAL_ACCOUNTS].sort());
    for (const account of accounts) {
      const groups = await aql<{ cleared: boolean; reconciled: boolean; total: number }[]>((q) =>
        q('transactions')
          .filter({ account: account.id })
          .groupBy(['cleared', 'reconciled'])
          .select(['cleared', 'reconciled', { total: { $sum: '$amount' } }]),
      );
      const expected = balancesOf(
        groups.map((g) => ({
          amount: g.total,
          cleared: g.reconciled ? ('R' as const) : g.cleared ? ('C' as const) : ('U' as const),
        })),
      );
      expect(account.balances, account.name).toEqual(expected);
    }
    const byName = new Map(accounts.map((a) => [a.name, a]));
    expect(byName.get('Old Checking')).toMatchObject({ closed: true, balances: { working: 0 } });
    expect(byName.get('Mortgage')).toMatchObject({ onBudget: false });
    expect(byName.get('Checking')).toMatchObject({
      note: 'Joint account at the credit union.',
      scheduledCount: 16,
    });
    // A balance owed is just a negative balance (13 §1); nothing about it is stored.
    expect(byName.get('Visa')?.balances.working).toBeLessThan(0);
    expect(byName.get('Visa')?.lastReconciledDate).toBeNull();
  });

  it('lists every transaction, splits grouped, with the derived states the fixture plants', async () => {
    const all = await host.read.transactions('all');
    const grouped = await aql<{ id: string }[]>((q) =>
      q('transactions').select(['id']).options({ splits: 'grouped' }),
    );
    expect(all.length).toBe(grouped.length);
    const states = new Map<string, number>();
    for (const t of all) states.set(t.errorLevel, (states.get(t.errorLevel) ?? 0) + 1);
    expect(states.get('error')).toBeGreaterThanOrEqual(1);
    expect(states.get('needsCategory')).toBeGreaterThanOrEqual(3);
    expect(states.get('forReview')).toBeGreaterThan(0);
    const splits = all.filter((t) => t.subtransactions.length > 0);
    expect(splits.length).toBeGreaterThanOrEqual(28);
    for (const s of splits)
      expect(s.subtransactions.reduce((n, l) => n + l.amount, 0)).toBe(s.amount);
    expect(all.some((t) => t.checkNumber !== null && t.notes === 'Rent')).toBe(true);
    expect(all.some((t) => t.tags.length > 0)).toBe(true);
    // Account attention equals the per-transaction states.
    const accounts = await host.read.accounts();
    for (const a of accounts) {
      const own = all.filter((t) => t.accountId === a.id && t.errorLevel !== 'none');
      expect(a.attention.count, a.name).toBe(own.length);
    }
  });

  it('gets each transaction equal to its list entry, a split whole by its parent or a line id', async () => {
    const all = await host.read.transactions('all');
    const splits = all.filter((t) => t.subtransactions.length > 0);
    const transfers = all.filter((t) => t.transferSide !== null);
    // The filtered grouped query must return a split with every line (04 §6).
    expect(splits.length).toBeGreaterThan(0);
    expect(transfers.length).toBeGreaterThan(0);
    // Every split, transfer and review or error state, and some plain rows: one at a time, a check of
    // all of them takes long enough to need its own timeout.
    const sample = new Set([
      ...splits,
      ...transfers,
      ...all.filter((t) => t.errorLevel !== 'none' || t.checkNumber !== null).slice(0, 40),
      ...all.slice(0, 20),
    ]);
    for (const t of sample) expect(await host.read.transaction(t.id), t.id).toEqual(t);
    for (const s of splits) {
      const lineId = s.subtransactions.at(-1)?.id ?? '';
      expect(await host.read.transaction(lineId), lineId).toEqual(s);
    }
    await expect(host.read.transaction('no-such-transaction')).resolves.toBeNull();
  });

  it('builds the category tree with hidden items and notes', async () => {
    const groups = await host.read.categories();
    const byName = new Map(groups.map((g) => [g.name, g]));
    expect(byName.get('Old Stuff')?.hidden).toBe(true);
    const everyday = byName.get('Everyday Expenses');
    expect(everyday?.categories.find((c) => c.name === 'Groceries')?.note).toContain('Costco');
    expect(
      byName.get('Rainy Day Funds')?.categories.find((c) => c.name === 'Christmas')?.hidden,
    ).toBe(true);
    expect(byName.has('Pre-Existing Debt')).toBe(false);
    expect(groups.some((g) => g.isIncome)).toBe(true);
  });

  it('lists payees with rules, usage and the disabled one', async () => {
    const payees = new Map((await host.read.payees()).map((p) => [p.name, p]));
    expect(payees.get('Kroger')).toMatchObject({
      renameRules: [{ op: 'startsWith', value: 'KROGER #' }],
    });
    expect(payees.get('Kroger')?.autoCategoryId).toBeTruthy();
    expect(payees.get('Withdrawal')?.enabled).toBe(false);
    expect(payees.get('NetCo')?.usageCount).toBeGreaterThan(14);
    // Usage = transactions (split lines counted, parents not) + schedules, from independent queries.
    const schedules = await fixtures.api.getSchedules();
    for (const p of payees.values()) {
      const count = await aql<number>((q) =>
        q('transactions').filter({ payee: p.id }).calculate({ $count: '$id' }),
      );
      const scheduled = schedules.filter((s) => s.payee === p.id).length;
      expect(p.usageCount, p.name).toBe(count + scheduled);
    }
  });

  it('creates the needs-review tag entity, and only that one, when the session goes Online (04 §5.2)', async () => {
    await host.queue.run('wait', () => Promise.resolve(), { kind: 'read' });
    const tags = (await fixtures.api.getTags()).map((t) => t.tag);
    expect(tags).toContain(REVIEW_TAG);
    expect(tags.filter((t) => t.startsWith('flag-'))).toEqual([]);
  });

  it('round-trips every reserved note to a fresh device, and never loads a backup', async () => {
    const write = <T>(
      id: string,
      kind: (typeof RESERVED)[keyof typeof RESERVED],
      mutate: (v: T) => T,
    ) =>
      host.connection.write('test: metadata', ['notes'], () =>
        host.metadata.modifyInJob(id, kind as never, mutate as never),
      );
    await write(reservedIds.payees, RESERVED.payees, () => ({
      v: 1,
      disabled: ['p-test'],
      extra: 'kept',
    }));
    await write(reservedIds.cellNotes('2026-10'), RESERVED.cellNotes, () => ({
      v: 1,
      notes: { c1: 'Ünïcode ✓\nline 2' },
    }));
    await write(reservedIds.importMappings, RESERVED.importMappings, () => ({
      v: 1,
      mappings: [
        {
          key: '1234|5678',
          accountId: null,
          importNotes: true,
          swapPayeeNotes: false,
          dateOrder: 'DMY',
        },
      ],
    }));
    await write(reservedIds.budget, RESERVED.budget, () => ({ v: 1, carryoverSeenEnd: '2027-10' }));
    // An invalid note (written by another client: notes.set refuses reserved ids) is backed up before
    // it's overwritten.
    await host.connection.write('test: corrupt', ['notes'], () =>
      actual.updateNote(reservedIds.budget, '{not json'),
    );
    await write(reservedIds.budget, RESERVED.budget, () => ({ v: 1, carryoverSeenEnd: '2027-11' }));
    await host.connection.syncNow();
    const before = await host.queue.run('load', () => host.metadata.loadAll(), { kind: 'read' });
    await host.connection.closeBudget(false);
    host.connection.dispose();

    // A second device: a fresh cache downloads the budget from the server.
    host = hostStack(actual, join(dir, 'device-b'));
    await host.connection.connect(SERVER, PASSWORD, false);
    await host.connection.openBudget(cloudFileId);
    const after = await host.queue.run('load', () => host.metadata.loadAll(), { kind: 'read' });
    expect(after.payees).toEqual({ v: 1, disabled: ['p-test'], extra: 'kept' });
    expect(
      await host.queue.run(
        'cell',
        () => host.metadata.read(reservedIds.cellNotes('2026-10'), RESERVED.cellNotes),
        { kind: 'read' },
      ),
    ).toEqual({ v: 1, notes: { c1: 'Ünïcode ✓\nline 2' } });
    expect(after.importMappings.mappings[0]).toMatchObject({ key: '1234|5678', dateOrder: 'DMY' });
    expect(after.budget).toEqual({ v: 1, carryoverSeenEnd: '2027-11' });
    expect(after).toEqual(before);
    expect(
      await host.queue.run('bak', () => actual.getNote('ad-bak:ad:budget'), { kind: 'read' }),
    ).toBe('{not json');
    const reserved = await host.queue.run('ids', () => actual.getReservedNotes(), { kind: 'read' });
    expect(reserved.some((n) => n.id.startsWith('ad-bak:'))).toBe(false);
  });
});
