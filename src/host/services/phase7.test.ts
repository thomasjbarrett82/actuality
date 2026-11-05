// Slate wipe, Export Budget Backup and Import a budget file on the fake API (18 §2, 07 §6, 07 §3.4).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawCategoryGroup } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { exportZip } from '../testing/export-zip';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { crc32, zip, zipFolder } from '../zip';
import { AccountsService } from './accounts';
import { BudgetFileService } from './budget-file';
import { MetadataRepository } from './metadata';
import { PROGRESS_EVERY, SlateWipeService } from './slate-wipe';

const TEXTS = { startingBalancePayee: 'Starting Balance' };

const ACCOUNTS: RawAccount[] = [
  {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    sortOrder: 1,
    accountGroupId: null,
  },
  { id: 'a2', name: 'Visa', offbudget: false, closed: false, sortOrder: 2, accountGroupId: null },
  { id: 'a3', name: 'House', offbudget: true, closed: false, sortOrder: 3, accountGroupId: null },
];
const GROUPS: RawCategoryGroup[] = [
  {
    id: 'g1',
    name: 'Bills',
    isIncome: false,
    hidden: false,
    sortOrder: 1,
    categories: [
      { id: 'c1', name: 'Rent', groupId: 'g1', isIncome: false, hidden: false, sortOrder: 1 },
      { id: 'c2', name: 'Fun', groupId: 'g1', isIncome: false, hidden: false, sortOrder: 2 },
    ],
  },
  {
    id: 'gi',
    name: 'Income',
    isIncome: true,
    hidden: false,
    sortOrder: 2,
    categories: [
      {
        id: 'ci',
        name: 'Starting Balances',
        groupId: 'gi',
        isIncome: true,
        hidden: false,
        sortOrder: 1,
      },
    ],
  },
];

describe('slate wipe, backup and budget import host services', () => {
  let actual: FakeActual;
  let control: FakeControl;
  let conn: Connection;
  let slateWipe: SlateWipeService;
  let budgetFile: BudgetFileService;
  let metadata: MetadataRepository;
  let dir: string;
  const events: { event: string; payload: unknown }[] = [];
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    dir = mkdtempSync(join(tmpdir(), 'actual-desktop-p7-'));
    events.length = 0;
    actual = new FakeActual();
    actual.months = ['2026-08', '2026-09', '2026-10'];
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: ACCOUNTS,
      groups: GROUPS,
      payees: [
        { id: 'p-a1', name: 'Checking', transferAcct: 'a1' },
        { id: 'p-a2', name: 'Visa', transferAcct: 'a2' },
      ],
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a1',
          date: '2026-08-01',
          amount: 100_000,
          category: 'ci',
          startingBalance: true,
        }),
        rawTransaction({
          id: 't2',
          account: 'a1',
          date: '2026-09-03',
          amount: -20_000,
          category: 'c1',
        }),
        rawTransaction({
          id: 't3',
          account: 'a2',
          date: '2026-09-10',
          amount: -5_000,
          category: 'c2',
        }),
        // A transfer: deleting one side removes the other.
        rawTransaction({
          id: 't4',
          account: 'a1',
          date: '2026-09-12',
          amount: -1_000,
          payee: 'p-a2',
          transferId: 't5',
        }),
        rawTransaction({
          id: 't5',
          account: 'a2',
          date: '2026-09-12',
          amount: 1_000,
          payee: 'p-a1',
          transferId: 't4',
        }),
        rawTransaction({
          id: 't6',
          account: 'a1',
          date: '2026-10-02',
          amount: -3_000,
          category: 'c1',
        }),
        rawTransaction({ id: 't7', account: 'a3', date: '2026-08-05', amount: 250_000 }),
      ],
      schedules: [],
    });
    const b = budget();
    b.budgeted.set('c1:2026-09', 30_000);
    b.budgeted.set('c2:2026-09', 8_000);
    b.budgeted.set('c1:2026-10', 30_000);
    b.carryover.set('c2:2026-09', true);
    b.carryover.set('c2:2026-10', true);
    b.holds.set('2026-09', 4_000);
    const queue = new JobQueue();
    control = new FakeControl();
    conn = new Connection({
      actual,
      queue,
      control,
      emit: (event, payload) => events.push({ event, payload }),
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    metadata = new MetadataRepository(actual);
    const accounts = new AccountsService(actual, conn, metadata);
    slateWipe = new SlateWipeService(actual, queue, conn, accounts);
    budgetFile = new BudgetFileService(actual, queue, conn);
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('Wipe the Slate Clean (18 §2)', () => {
    it('counts what it would erase and the first month with data', async () => {
      expect(await slateWipe.impact(null)).toEqual({ transactions: 7, firstMonth: '2026-08' });
      expect(await slateWipe.impact('2026-10')).toEqual({
        transactions: 6,
        firstMonth: '2026-08',
      });
    });

    it('erases everything after writing the backup, keeping carryover flags', async () => {
      const backupPath = join(dir, 'backup.zip');
      const result = await slateWipe.run({ cutoffMonth: null, backupPath, texts: TEXTS });
      expect(result.backupPath).toBe(backupPath);
      expect(existsSync(backupPath)).toBe(true);
      const b = budget();
      // Balances are 0, so no Starting Balance is added: the user reconciles them (18 §2 step 6).
      expect(b.transactions).toEqual([]);
      expect([...b.budgeted.values()].every((v) => v === 0)).toBe(true);
      expect(b.holds.get('2026-09') ?? 0).toBe(0);
      expect(b.carryover.get('c2:2026-09')).toBe(true);
      expect(b.carryover.get('c2:2026-10')).toBe(true);
      expect(b.accounts.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
      expect(b.groups.flatMap((g) => g.categories.map((c) => c.id))).toEqual(['c1', 'c2', 'ci']);
      expect(control.notified.filter((n) => n.event === 'job:slateWipe')).toEqual([
        { event: 'job:slateWipe', payload: { phase: 'started', backupPath } },
        { event: 'job:slateWipe', payload: { phase: 'ended' } },
      ]);
    });

    it('with a cutoff keeps the later months and carries balances forward', async () => {
      await slateWipe.run({
        cutoffMonth: '2026-10',
        backupPath: join(dir, 'b.zip'),
        texts: TEXTS,
      });
      const b = budget();
      const left = b.transactions.filter((t) => !t.startingBalance);
      expect(left.map((t) => t.id)).toEqual(['t6']);
      const starting = b.transactions.filter((t) => t.startingBalance);
      // Checking 100,000 − 20,000 − 1,000; Visa −5,000 + 1,000; House off-budget. On budget, both signs
      // go to the income category (13 §2.1).
      expect(starting.map((t) => [t.account, t.amount, t.date, t.cleared]).sort()).toEqual([
        ['a1', 79_000, '2026-09-30', true],
        ['a2', -4_000, '2026-09-30', true],
        ['a3', 250_000, '2026-09-30', true],
      ]);
      expect(starting.find((t) => t.account === 'a1')?.category).toBe('ci');
      expect(starting.find((t) => t.account === 'a2')?.category).toBe('ci');
      expect(starting.find((t) => t.account === 'a3')?.category).toBeNull();
      expect(b.groups.flatMap((g) => g.categories.map((c) => c.id))).toEqual(['c1', 'c2', 'ci']);
      // October keeps its budget; August is zeroed; September budgets the remembered balances.
      expect(b.budgeted.get('c1:2026-10')).toBe(30_000);
      expect(b.budgeted.get('c1:2026-08') ?? 0).toBe(0);
      expect(b.budgeted.get('c1:2026-09')).toBe(10_000);
      expect(b.budgeted.get('c2:2026-09')).toBe(3_000);
      expect(b.carryover.get('c2:2026-10')).toBe(true);
    });

    it('keeps the kept side of a transfer that crosses the cutoff, as an ordinary transaction', async () => {
      const b = budget();
      b.transactions.push(
        rawTransaction({
          id: 'x1',
          account: 'a1',
          date: '2026-09-20',
          amount: -2_000,
          payee: 'p-a2',
          transferId: 'x2',
        }),
        rawTransaction({
          id: 'x2',
          account: 'a2',
          date: '2026-10-05',
          amount: 2_000,
          payee: 'p-a1',
          transferId: 'x1',
        }),
      );
      await slateWipe.run({
        cutoffMonth: '2026-10',
        backupPath: join(dir, 'b.zip'),
        texts: TEXTS,
      });
      const kept = b.transactions.find((t) => t.id === 'x2');
      expect(kept).toMatchObject({
        amount: 2_000,
        date: '2026-10-05',
        payee: null,
        transferId: null,
      });
      expect(b.transactions.some((t) => t.id === 'x1')).toBe(false);
      // The erased side still counts in Checking's carried balance: 100,000 − 20,000 − 1,000 − 2,000.
      const starting = b.transactions.find((t) => t.startingBalance && t.account === 'a1');
      expect(starting?.amount).toBe(77_000);
    });

    it('leaves a closed account with no balance', async () => {
      const b = budget();
      b.accounts.push({
        id: 'a4',
        name: 'Old',
        offbudget: false,
        closed: true,
        sortOrder: 4,
        accountGroupId: null,
      });
      b.transactions.push(
        rawTransaction({ id: 'o1', account: 'a4', date: '2026-09-02', amount: 500 }),
        rawTransaction({ id: 'o2', account: 'a4', date: '2026-10-02', amount: -500 }),
      );
      await slateWipe.run({
        cutoffMonth: '2026-10',
        backupPath: join(dir, 'b.zip'),
        texts: TEXTS,
      });
      const rows = b.transactions.filter((t) => t.account === 'a4');
      expect(rows.reduce((n, t) => n + t.amount, 0)).toBe(0);
      expect(rows.find((t) => t.startingBalance)).toMatchObject({
        amount: 500,
        date: '2026-09-30',
      });
    });

    it('counts a split once, with each of its lines', async () => {
      const lines = ['l1', 'l2'].map((id) =>
        rawTransaction({
          id,
          account: 'a1',
          date: '2026-08-20',
          amount: -1_500,
          category: 'c1',
          parentId: 's1',
        }),
      );
      budget().transactions.push(
        rawTransaction({
          id: 's1',
          account: 'a1',
          date: '2026-08-20',
          amount: -3_000,
          isParent: true,
          subtransactions: lines,
        }),
      );
      expect((await slateWipe.impact(null)).transactions).toBe(10);
      expect((await slateWipe.impact('2026-10')).transactions).toBe(9);
      await slateWipe.run({ cutoffMonth: null, backupPath: join(dir, 'b.zip'), texts: TEXTS });
      expect(budget().transactions).toEqual([]);
    });

    it('reports progress every 200 deletions', async () => {
      const b = budget();
      for (let i = 0; i < PROGRESS_EVERY * 2 + 5; i++)
        b.transactions.push(
          rawTransaction({
            id: `bulk-${String(i)}`,
            account: 'a1',
            date: '2026-08-15',
            amount: -1,
          }),
        );
      await slateWipe.run({ cutoffMonth: null, backupPath: join(dir, 'b.zip'), texts: TEXTS });
      expect(events.filter((e) => e.event === 'job:progress').map((e) => e.payload)).toEqual([
        { label: 'slateWipe.delete', done: 201, total: 412 },
        { label: 'slateWipe.delete', done: 401, total: 412 },
      ]);
    });

    it('aborts before deleting anything when the backup fails', async () => {
      actual.failExport = true;
      await expect(
        slateWipe.run({ cutoffMonth: null, backupPath: join(dir, 'b.zip'), texts: TEXTS }),
      ).rejects.toMatchObject({ details: { slateWipe: { partial: false } } });
      expect(budget().transactions).toHaveLength(7);
      actual.failExport = false;
      await expect(
        slateWipe.run({
          cutoffMonth: null,
          backupPath: join(dir, 'missing', 'b.zip'),
          texts: TEXTS,
        }),
      ).rejects.toMatchObject({
        details: { code: 'backup-failed', slateWipe: { partial: false } },
      });
      expect(control.notified.at(-1)).toEqual({
        event: 'job:slateWipe',
        payload: { phase: 'ended' },
      });
    });
  });

  describe('Export Budget Backup (07 §6)', () => {
    it("writes Actual's export zip, offline too", async () => {
      const path = join(dir, 'My backup.zip');
      actual.server = 'down';
      await budgetFile.exportBackup(path);
      expect(readFileSync(path, 'utf8')).toMatch(/^fake-zip:/);
    });
  });

  describe('Import a budget file (07 §3.4)', () => {
    let backup: string;
    beforeEach(async () => {
      backup = join(dir, 'Budget.zip');
      await budgetFile.exportBackup(backup);
    });

    it('uploads a new budget, renames a duplicate name and opens it', async () => {
      const opened = await budgetFile.importFile(backup, 'actual', '(imported 2026-10-20)', false);
      expect(opened.name).toBe('Budget (imported 2026-10-20)');
      expect(opened.cloudFileId).not.toBe('b1');
      expect(conn.state.state).toBe('Online');
      expect(conn.state.budget?.cloudFileId).toBe(opened.cloudFileId);
      expect(actual.budgets.get(opened.cloudFileId)?.transactions).toHaveLength(7);
      // The original is untouched.
      expect(budget().name).toBe('Budget');
    });

    it('reports a budget that was not uploaded and returns to the budget list', async () => {
      actual.failUpload = true;
      await expect(
        budgetFile.importFile(backup, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ details: { code: 'upload-failed' } });
      expect(conn.state.state).toBe('SignedIn');
      expect(conn.state.budget).toBeNull();
    });

    it('refuses a file it cannot read, leaving the budget open', async () => {
      await expect(
        budgetFile.importFile(join(dir, 'nope.zip'), 'actual', '(imported)', false),
      ).rejects.toMatchObject({ code: 'not-found' });
      expect(conn.state.budget?.cloudFileId).toBe('b1');
      const bad = join(dir, 'bad.zip');
      writeFileSync(bad, 'not a zip');
      await expect(budgetFile.importFile(bad, 'actual', '(imported)', false)).rejects.toMatchObject(
        { details: { code: 'bad-file' } },
      );
      expect(conn.state.state).toBe('SignedIn');
    });

    it('refuses a tracking budget before uploading it, leaving the budget open (03 §6.1)', async () => {
      const tracking = join(dir, 'Tracking.zip');
      writeFileSync(tracking, exportZip({ prefs: { budgetType: 'tracking' } }));
      await expect(
        budgetFile.importFile(tracking, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ code: 'validation', details: { code: 'tracking-budget' } });
      expect(actual.calls).not.toContain('importBudget');
      expect(conn.state).toMatchObject({ state: 'Online', budget: { cloudFileId: 'b1' } });
    });

    it('refuses a folder unless it is a YNAB 4 budget', async () => {
      const folder = join(dir, 'Thing');
      mkdirSync(folder);
      await expect(
        budgetFile.importFile(folder, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ details: { code: 'bad-file' } });
    });

    it('is rejected while offline (03 §5.1)', async () => {
      actual.server = 'down';
      await conn.syncNow().catch(() => undefined);
      expect(conn.state.state).toBe('OfflineReadOnly');
      await expect(
        budgetFile.importFile(backup, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ code: 'offline' });
      expect(actual.calls).not.toContain('importBudget');
    });

    it('asks before losing unsynced changes, and imports when forced (03 §5.4)', async () => {
      (conn as unknown as { info: { unsyncedChanges: boolean } }).info.unsyncedChanges = true;
      await expect(
        budgetFile.importFile(backup, 'actual', '(imported)', false),
      ).rejects.toMatchObject({ code: 'conflict', details: { unsyncedChanges: true } });
      expect(conn.state.budget?.cloudFileId).toBe('b1');
      const opened = await budgetFile.importFile(backup, 'actual', '(imported)', true);
      expect(opened.cloudFileId).not.toBe('b1');
    });
  });

  describe('zip (07 §3.4)', () => {
    it('zips a .ynab4 folder with the folder name as its root', async () => {
      const folder = join(dir, 'My Budget~ABC.ynab4');
      mkdirSync(join(folder, 'data1'), { recursive: true });
      writeFileSync(join(folder, 'Budget.ymeta'), '{}');
      writeFileSync(join(folder, 'data1', 'x.txt'), 'hello');
      const out = await zipFolder(folder);
      const text = new TextDecoder('latin1').decode(out);
      expect(text).toContain('My Budget~ABC.ynab4/Budget.ymeta');
      expect(text).toContain('My Budget~ABC.ynab4/data1/x.txt');
      expect(new DataView(out.buffer).getUint16(out.length - 22 + 10, true)).toBe(2);
    });

    it('computes the standard CRC-32', () => {
      expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    });
    it('writes stored entries with a central directory', () => {
      const out = zip([{ name: 'a.ynab4/Budget.ymeta', data: new TextEncoder().encode('{}') }]);
      const view = new DataView(out.buffer);
      expect(view.getUint32(0, true)).toBe(0x04034b50);
      expect(view.getUint32(out.length - 22, true)).toBe(0x06054b50);
      expect(view.getUint16(out.length - 22 + 10, true)).toBe(1);
    });
  });
});
