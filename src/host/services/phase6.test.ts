// Reconcile, import and export services on the fake API (13 §6, 16).
import { decode } from '@shared/metadata/notes-codec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawCategoryGroup } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { BudgetService } from './budget';
import { BudgetFileService } from './budget-file';
import { ExportService } from './export';
import { ImportService } from './import';
import { MetadataRepository } from './metadata';
import { ReadService } from './read';
import { ReconcileService } from './reconcile';

const TEXTS = { adjustmentNotes: 'Reconciliation balance adjustment' };
/** When Finish runs: Actual's `last_reconciled`, read back as its local calendar date. */
const FINISHED_AT = new Date(2026, 9, 20, 15, 30).getTime();
const IMPORT_TEXTS = { transferPrefixes: ['Transfer :'], plainTransfer: 'Transfer ({account})' };

const ACCOUNTS: RawAccount[] = [
  {
    id: 'a1',
    name: 'Checking',
    offbudget: false,
    closed: false,
    sortOrder: 1,
    accountGroupId: null,
  },
  {
    id: 'a2',
    name: 'Savings',
    offbudget: false,
    closed: false,
    sortOrder: 2,
    accountGroupId: null,
  },
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
    ],
  },
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('reconcile, import and export host services', () => {
  let actual: FakeActual;
  let conn: Connection;
  let metadata: MetadataRepository;
  let read: ReadService;
  let reconcile: ReconcileService;
  let importer: ImportService;
  let exporter: ExportService;
  const files = new Map<string, string>();
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    actual = new FakeActual();
    actual.months = ['2026-09', '2026-10'];
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: ACCOUNTS,
      groups: GROUPS,
      payees: [
        { id: 'p-shop', name: 'Shop', transferAcct: null },
        { id: 'p-a1', name: 'Checking', transferAcct: 'a1' },
        { id: 'p-a2', name: 'Savings', transferAcct: 'a2' },
      ],
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a1',
          date: '2026-09-01',
          amount: 10_000,
          cleared: true,
          reconciled: true,
          startingBalance: true,
        }),
        rawTransaction({
          id: 't2',
          account: 'a1',
          date: '2026-10-02',
          amount: -2_000,
          cleared: true,
          notes: 'x #needs-review',
          category: 'c1',
          payee: 'p-shop',
        }),
        rawTransaction({
          id: 't3',
          account: 'a1',
          date: '2026-10-05',
          amount: -500,
          cleared: false,
          category: 'c1',
        }),
        rawTransaction({
          id: 't4',
          account: 'a1',
          date: '2026-10-30',
          amount: -100,
          cleared: true,
        }),
      ],
    });
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    metadata = new MetadataRepository(actual);
    read = new ReadService(actual, queue, conn, metadata);
    reconcile = new ReconcileService(actual, queue, conn, () => FINISHED_AT);
    files.clear();
    importer = new ImportService(actual, queue, conn, metadata, (path) => {
      const f = files.get(path);
      return f === undefined
        ? Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
        : Promise.resolve(enc(f));
    });
    const written = new Map<string, string>();
    exporter = new ExportService(
      read,
      new BudgetService(actual, queue, conn, metadata),
      new BudgetFileService(actual, queue, conn),
      (p, c) => {
        if (p.includes('locked'))
          return Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' }));
        written.set(p, c);
        return Promise.resolve();
      },
      (p) => written.has(p),
    );
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  describe('reconcile (13 §6)', () => {
    it('reads the cleared balance through a date', async () => {
      expect(await reconcile.clearedThrough('a1', '2026-10-10')).toBe(8_000);
    });
    it('counts a reconciled transaction dated after the date, as the footer does', async () => {
      budget().transactions.push(
        rawTransaction({
          id: 'late',
          account: 'a1',
          date: '2026-10-25',
          amount: 700,
          cleared: true,
          reconciled: true,
        }),
      );
      const hint = await reconcile.clearedThrough('a1', '2026-10-10');
      expect(hint).toBe(8_700);
      const r = await reconcile.finish({
        accountId: 'a1',
        statementDate: '2026-10-10',
        target: hint,
        createAdjustment: true,
        texts: TEXTS,
      });
      expect(r.adjustmentId).toBeNull();
    });
    it('reconciles cleared rows up to the date, approves them and records the time', async () => {
      const r = await reconcile.finish({
        accountId: 'a1',
        statementDate: '2026-10-10',
        target: 8_000,
        createAdjustment: false,
        texts: TEXTS,
      });
      expect(r).toEqual({ reconciled: 1, adjustmentId: null });
      const t2 = budget().transactions.find((t) => t.id === 't2');
      expect(t2).toMatchObject({ reconciled: true });
      expect(decode(t2?.notes).needsReview).toBe(false);
      expect(budget().transactions.find((t) => t.id === 't4')?.reconciled).toBe(false);
      // Actual's own field, as Actual web writes it: the finish time in ms, as a string (13 §6.3).
      expect(budget().accounts.find((a) => a.id === 'a1')?.lastReconciled).toBe(
        String(FINISHED_AT),
      );
      const a1 = (await read.accounts()).find((a) => a.id === 'a1');
      expect(a1?.lastReconciledDate).toBe('2026-10-20');
    });
    it('counts only candidate transactions still present when reconciliation finishes', async () => {
      const getTransactionRows = actual.getTransactionRows.bind(actual);
      vi.spyOn(actual, 'getTransactionRows').mockImplementation(async (query) =>
        query.ids?.includes('t2') ? [] : getTransactionRows(query),
      );
      const result = await reconcile.finish({
        accountId: 'a1',
        statementDate: '2026-10-10',
        target: 8_000,
        createAdjustment: false,
        texts: TEXTS,
      });
      expect(result.reconciled).toBe(0);
    });
    it("adds Actual's adjustment for the difference: no payee or category, reconciled", async () => {
      const r = await reconcile.finish({
        accountId: 'a1',
        statementDate: '2026-10-10',
        target: 7_000,
        createAdjustment: true,
        texts: TEXTS,
      });
      const adj = budget().transactions.find((t) => t.id === r.adjustmentId);
      expect(adj).toMatchObject({
        amount: -1_000,
        date: '2026-10-10',
        payee: null,
        category: null,
        notes: 'Reconciliation balance adjustment',
        cleared: true,
        reconciled: true,
      });
      expect(r.reconciled).toBe(2);
    });
    it('is refused offline', async () => {
      actual.server = 'down';
      await conn.syncNow().catch(() => undefined);
      await expect(
        reconcile.finish({
          accountId: 'a1',
          statementDate: '2026-10-10',
          target: 0,
          createAdjustment: false,
          texts: TEXTS,
        }),
      ).rejects.toMatchObject({ code: 'offline' });
    });
  });

  describe('import (16 §1)', () => {
    const csv =
      'Date,Payee,Category,Notes,Amount\n10/01/2026,Shop,Bills: Rent,first,-12.00\n10/03/2026,Transfer : Savings,,,-6.00\n10/04/2026,Transfer : Nowhere,Gym,,-1.00\n';
    const run = async (name: string, over = {}) => {
      const parsed = await importer.parse(name);
      return importer.run(
        parsed.token,
        parsed.accounts.map((_, index) => ({
          index,
          accountId: 'a1',
          importNotes: true,
          swapPayeeNotes: false,
          dateOrder: 'MDY' as const,
          includeBeforeStart: true,
          ...over,
        })),
        IMPORT_TEXTS,
      );
    };
    it('imports categories, transfers and plain "Transfer (X)" payees, tagged for review', async () => {
      files.set('/f/bank.csv', csv);
      const [r] = await run('/f/bank.csv');
      expect(r).toMatchObject({ status: 'imported', added: 3, updated: 0, ignored: 0 });
      const added = budget().transactions.filter((t) => t.importedId);
      const rent = added.find((t) => t.amount === -1200);
      expect(rent).toMatchObject({ category: 'c1' });
      expect(decode(rent?.notes)).toMatchObject({ notes: 'first', needsReview: true });
      expect(added.find((t) => t.amount === -600)?.payee).toBe('p-a2');
      const gym = added.find((t) => t.amount === -100);
      expect(decode(gym?.notes).notes).toBe('Gym');
      expect(budget().payees.some((p) => p.name === 'Transfer (Nowhere)')).toBe(true);
      const [again] = await run('/f/bank.csv');
      expect(again).toMatchObject({ added: 0, ignored: 3 });
    });
    it('reports missing files, CSVs in another format and skipped accounts', async () => {
      await expect(importer.parse('/f/none.ofx')).rejects.toMatchObject({
        details: { code: 'file-not-found' },
      });
      files.set('/f/bad.csv', 'Who,What\nx,y\n');
      await expect(importer.parse('/f/bad.csv')).rejects.toMatchObject({
        details: { code: 'csv-format' },
      });
      await expect(importer.parse('/f/x.txt')).rejects.toMatchObject({
        details: { code: 'unsupported-file' },
      });
      files.set('/f/bank.csv', csv);
      const [r] = await run('/f/bank.csv', { accountId: null });
      expect(r?.status).toBe('skipped');
    });
    it('remembers an OFX mapping and offsets the starting balance for earlier rows', async () => {
      files.set(
        '/f/a.ofx',
        'OFXHEADER:100\n<OFX><SIGNONMSGSRSV1><SONRS><FI><FID>9</FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>77<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260801<TRNAMT>-3.00<FITID>F1<NAME>Old</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
      );
      const parsed = await importer.parse('/f/a.ofx');
      expect(parsed.startDates['a1']).toBe('2026-09-01');
      const [r] = await importer.run(
        parsed.token,
        [
          {
            index: 0,
            accountId: 'a1',
            importNotes: true,
            swapPayeeNotes: false,
            dateOrder: null,
            includeBeforeStart: true,
          },
        ],
        IMPORT_TEXTS,
      );
      expect(r).toMatchObject({ added: 1, startAdjusted: true });
      expect(budget().transactions.find((t) => t.id === 't1')?.amount).toBe(10_300);
      // Importing the same file again matches the row: the starting balance stays put.
      const [again] = await importer.run(
        (await importer.parse('/f/a.ofx')).token,
        [
          {
            index: 0,
            accountId: 'a1',
            importNotes: true,
            swapPayeeNotes: false,
            dateOrder: null,
            includeBeforeStart: true,
          },
        ],
        IMPORT_TEXTS,
      );
      expect(again).toMatchObject({ added: 0, startAdjusted: false });
      expect(budget().transactions.find((t) => t.id === 't1')?.amount).toBe(10_300);
      expect((await importer.parse('/f/a.ofx')).mappings['9|77']).toMatchObject({
        accountId: 'a1',
      });
    });
    it('reads import mappings one by one, keeping an entry it can’t read', async () => {
      const unreadable = {
        key: 'x|1',
        accountId: 'a1',
        importNotes: true,
        swapPayeeNotes: false,
        dateOrder: 'XYZ',
      };
      budget().notes.set(
        'ad:import-mappings',
        JSON.stringify({
          v: 1,
          mappings: [
            unreadable,
            { key: '9|77', accountId: 'a1', importNotes: false, swapPayeeNotes: false },
          ],
        }),
      );
      files.set(
        '/f/a.ofx',
        'OFXHEADER:100\n<OFX><SIGNONMSGSRSV1><SONRS><FI><FID>9</FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>77<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-3.00<FITID>F1<NAME>Shop</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
      );
      const parsed = await importer.parse('/f/a.ofx');
      expect(parsed.mappings).toEqual({
        '9|77': { accountId: 'a1', importNotes: false, swapPayeeNotes: false },
      });
      await importer.run(
        parsed.token,
        [
          {
            index: 0,
            accountId: 'a1',
            importNotes: true,
            swapPayeeNotes: false,
            dateOrder: null,
            includeBeforeStart: false,
          },
        ],
        IMPORT_TEXTS,
      );
      const stored = JSON.parse(budget().notes.get('ad:import-mappings') ?? '{}') as {
        mappings: unknown[];
      };
      expect(stored.mappings).toEqual([
        unreadable,
        { key: '9|77', accountId: 'a1', importNotes: true, swapPayeeNotes: false },
      ]);
    });
    it('tags rows Actual matched for review', async () => {
      files.set('/f/m.csv', 'Date,Payee,Amount\n10/06/2026,Shop,-5.00\n');
      const [r] = await run('/f/m.csv');
      expect(r).toMatchObject({ added: 0, updated: 1 });
      expect(decode(budget().transactions.find((t) => t.id === 't3')?.notes).needsReview).toBe(
        true,
      );
    });
    it('restores what the rules changed on added rows (16 §1.5, 12 §2)', async () => {
      files.set(
        '/f/r.csv',
        'Date,Payee,Category,Notes,Amount\n10/01/2026,Landlord,Bills: Rent,october,-900.00\n10/02/2026,Cafe,,coffee,-4.00\n10/03/2026,Gym,,,-30.00\n',
      );
      // A schedule's rule links the rent and applies its template; another rule rewrites the cafe's notes.
      actual.onAdd = (row) => {
        if (row.amount === -90_000) {
          row.schedule = 's-rent';
          row.category = 'c-sched';
          row.notes = 'template';
        } else if (row.amount === -400) row.notes = 'renamed by rule';
        else row.schedule = 's-gym';
      };
      const [r] = await run('/f/r.csv');
      expect(r).toMatchObject({ status: 'imported', added: 3 });
      const added = budget().transactions.filter((t) => t.importedId);
      const rent = added.find((t) => t.amount === -90_000);
      expect(rent).toMatchObject({ schedule: 's-rent', category: 'c1' });
      expect(decode(rent?.notes)).toMatchObject({ notes: 'october', needsReview: true });
      const cafe = added.find((t) => t.amount === -400);
      expect(decode(cafe?.notes)).toMatchObject({ notes: 'renamed by rule', needsReview: true });
      // No imported category: the schedule's stays.
      const gym = added.find((t) => t.amount === -3_000);
      expect(gym).toMatchObject({ schedule: 's-gym' });
      expect(decode(gym?.notes).needsReview).toBe(true);
    });
    it('refuses the run offline', async () => {
      files.set('/f/bank.csv', csv);
      const parsed = await importer.parse('/f/bank.csv');
      actual.server = 'down';
      await conn.syncNow().catch(() => undefined);
      await expect(importer.run(parsed.token, [], IMPORT_TEXTS)).rejects.toMatchObject({
        code: 'offline',
      });
    });
  });

  describe('export (16 §2)', () => {
    const base = {
      folder: '/out',
      budgetName: 'My: Budget',
      timestamp: '2026-10-20 1200',
      view: null,
    };
    it('writes the register and budget CSVs, then refuses to overwrite them', async () => {
      const r = await exporter.data({ ...base, kind: 'csv', overwrite: false });
      expect(r.files).toEqual([
        'My- Budget as of 2026-10-20 1200-Register.csv',
        'My- Budget as of 2026-10-20 1200-Budget.csv',
      ]);
      await expect(exporter.data({ ...base, kind: 'csv', overwrite: false })).rejects.toMatchObject(
        {
          code: 'conflict',
          details: { names: r.files },
        },
      );
      expect((await exporter.data({ ...base, kind: 'csv', overwrite: true })).files).toHaveLength(
        2,
      );
    });
    it('writes a QIF per account, or one for the current view', async () => {
      expect((await exporter.data({ ...base, kind: 'qif', overwrite: false })).files).toEqual([
        'My- Budget-Checking as of 2026-10-20 1200.qif',
      ]);
      const view = { accountId: 'a1', name: 'Checking', ids: ['t2'] };
      expect(
        (await exporter.data({ ...base, folder: '/v', kind: 'qif', view, overwrite: false })).files,
      ).toHaveLength(1);
    });
    it('reports locked files', async () => {
      await expect(
        exporter.data({ ...base, folder: '/locked', kind: 'csv', overwrite: false }),
      ).rejects.toMatchObject({ details: { code: 'file-locked' } });
    });
    it('writes report CSVs and reports locked files (16 §2.4)', async () => {
      expect(await exporter.reportCsv('/out/r.csv', 'x')).toBeNull();
      await expect(exporter.reportCsv('/out/r.txt', 'x')).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(exporter.reportCsv('/locked/r.csv', 'x')).rejects.toMatchObject({
        details: { code: 'file-locked' },
      });
    });
  });
});
