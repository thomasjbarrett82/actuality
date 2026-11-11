import { WRITE_METHODS, type HostMethod } from '@shared/rpc/host-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from './connection';
import { createHandlers, dispatch, type Services } from './dispatch';
import { JobQueue } from './queue';
import { AccountsService } from './services/accounts';
import { BudgetService } from './services/budget';
import { BudgetFileService } from './services/budget-file';
import { CategoriesService } from './services/categories';
import { ExportService } from './services/export';
import { ImportService } from './services/import';
import { MetadataRepository } from './services/metadata';
import { NotesService } from './services/notes';
import { PayeesService } from './services/payees';
import { ReadService } from './services/read';
import { ReconcileService } from './services/reconcile';
import { ReportsService } from './services/reports';
import { RulesService } from './services/rules';
import { SchedulesService } from './services/schedules';
import { SlateWipeService } from './services/slate-wipe';
import { TagsService } from './services/tags';
import { TransactionsService } from './services/transactions';
import { FakeActual } from './testing/fake-actual';
import { FakeControl } from './testing/fake-control';

const TEXTS = { adjustmentNotes: 'Auto' };

// Valid params for every write method. A new write method fails the offline test below until it's added.
const WRITE_SAMPLES: Partial<Record<HostMethod, unknown>> = {
  'notes.set': { id: 'note-test', text: 'x' },
  'budgetFile.updateProperties': { name: 'Renamed', hideFraction: true },
  'budgetFile.setEncryptionKey': { password: 'secret', remember: false },
  'prefs.setSynced': { key: 'numberFormat', value: 'dot-comma' },
  'accounts.create': { name: 'New', onBudget: true, balance: 0 },
  'accounts.update': { id: 'a1', name: 'Renamed' },
  'accounts.close': { id: 'a1' },
  'accounts.reopen': { id: 'a1' },
  'accounts.delete': { id: 'a1' },
  'accounts.reorder': { id: 'a1', beforeId: null, group: 'onBudget' },
  'transactions.commit': {
    accountId: 'a1',
    date: '2026-10-20',
    amount: -500,
    payee: { kind: 'new', name: 'Kroger' },
    categoryId: null,
    notes: '',
    checkNumber: null,
    needsReview: false,
    cleared: 'U',
  },
  'transactions.setCleared': { ids: ['t1'], state: 'C' },
  'transactions.approve': { ids: ['t1'] },
  'tags.create': { tag: 'trip', color: '#112233' },
  'tags.update': { id: 'tag-trip', color: '#445566' },
  'tags.delete': { id: 'tag-trip' },
  'tags.createMany': { tags: [{ tag: 'trip', color: '#112233' }] },
  'transactions.categorize': { ids: ['t1'], categoryId: null },
  'transactions.delete': { ids: ['t1'] },
  'transactions.undo': { token: 'any' },
  'transactions.moveToAccount': { ids: ['t1'], accountId: 'a1' },
  'transactions.setDate': { ids: ['t1'], date: '2026-10-20', clearReconciled: ['t2'] },
  'transactions.merge': { a: 't1', b: 't2' },
  'payees.rename': { id: 'p1', name: 'New name' },
  'payees.combine': { ids: ['p1'], name: 'One' },
  'payees.setEnabled': { ids: ['p1'], enabled: false },
  'payees.setRenameRules': { id: 'p1', conditions: [] },
  'payees.applyRenameRules': { id: 'p1', dryRun: false },
  'payees.setAutoCategory': { id: 'p1', categoryId: null },
  'categories.create': { groupName: 'New group', name: 'New category' },
  'categories.createGroup': { name: 'New Master Category' },
  'categories.update': { id: 'c1', name: 'Renamed' },
  'categories.updateGroup': { id: 'g1', hidden: true },
  'categories.setHidden': { categoryIds: ['c1'], groupIds: [], hidden: false },
  'categories.delete': { id: 'c1' },
  'categories.deleteGroup': { id: 'g1' },
  'categories.move': { id: 'c1', groupId: 'g1', beforeId: null },
  'categories.moveGroup': { id: 'g1', beforeId: null },
  'budget.setAmount': { month: '2026-10', categoryId: 'c1', amount: 100 },
  'budget.setAmounts': { month: '2026-10', entries: [{ categoryId: 'c1', amount: 100 }] },
  'budget.setCarryover': { month: '2026-10', categoryId: 'c1', flag: true },
  'budget.hold': { month: '2026-10', amount: 100 },
  'budget.resetHold': { month: '2026-10' },
  'notes.setCellNote': { month: '2026-10', categoryId: 'c1', text: 'x' },
  'notes.setMonthNote': { month: '2026-10', text: 'x' },
  'schedules.save': {
    name: '',
    accountId: 'a1',
    date: '2099-01-01',
    payee: { kind: 'none' },
    categoryId: null,
    notes: '',
    amountOp: 'is',
    amount: -500,
    postsTransaction: true,
  },
  'schedules.delete': { ids: ['s1'] },
  'schedules.enterNow': { ids: ['s1'] },
  'schedules.skip': { ids: ['s1'] },
  'schedules.moveToAccount': { ids: ['s1'], accountId: 'a1' },
  'import.run': {
    token: 'any',
    accounts: [],
    texts: { transferPrefixes: ['Transfer :'], plainTransfer: 'Transfer ({account})' },
  },
  'reconcile.finish': {
    accountId: 'a1',
    statementDate: '2026-10-20',
    target: 0,
    createAdjustment: false,
    texts: TEXTS,
  },
  'slateWipe.run': {
    cutoffMonth: null,
    backupPath: '/tmp/backup.zip',
    texts: { startingBalancePayee: 'Starting Balance' },
  },
};

describe('dispatch (02 §4)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          offbudget: false,
          closed: false,
          sortOrder: 1,
          accountGroupId: null,
        },
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
    const metadata = new MetadataRepository(actual);
    const accounts = new AccountsService(actual, conn, metadata);
    const read = new ReadService(actual, queue, conn, metadata);
    const budgetFile = new BudgetFileService(actual, queue, conn);
    const budget = new BudgetService(actual, queue, conn, metadata);
    handlers = createHandlers({
      connection: conn,
      accounts,
      exporter: new ExportService(read, budget, budgetFile),
      reports: new ReportsService(actual, queue, conn),
      reconcile: new ReconcileService(actual, queue, conn),
      importer: new ImportService(actual, queue, conn, metadata),
      budgetFile,
      notes: new NotesService(actual, queue, conn, metadata),
      read,
      transactions: new TransactionsService(actual, queue, conn, metadata),
      payees: new PayeesService(actual, queue, conn, metadata),
      rules: new RulesService(actual, queue, conn),
      categories: new CategoriesService(actual, conn, queue, metadata),
      budget,
      schedules: new SchedulesService(actual, queue, conn),
      slateWipe: new SlateWipeService(actual, queue, conn, accounts),
      tags: new TagsService(actual, queue, conn),
    });
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('rejects unknown methods and invalid params with validation', async () => {
    await expect(dispatch(handlers, 'session.nope', {})).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(dispatch(handlers, 'constructor', {})).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      dispatch(handlers, 'session.connect', { serverURL: 'ftp://x', remember: true }),
    ).rejects.toMatchObject({
      code: 'validation',
      details: { issues: [{ path: 'serverURL' }] },
    });
    await expect(dispatch(handlers, 'session.state', { extra: 1 })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('routes session calls', async () => {
    await expect(dispatch(handlers, 'session.state', undefined)).resolves.toMatchObject({
      state: 'Disconnected',
    });
    await dispatch(handlers, 'session.connect', {
      serverURL: 'https://x.test',
      password: 'pw',
      remember: false,
    });
    await expect(dispatch(handlers, 'session.listBudgets', {})).resolves.toHaveLength(1);
    await dispatch(handlers, 'session.openBudget', { cloudFileId: 'b1' });
    await expect(dispatch(handlers, 'session.syncNow', {})).resolves.toMatchObject({
      state: 'Online',
    });
    await expect(dispatch(handlers, 'session.retryConnection', {})).resolves.toMatchObject({
      diagnosis: 'none',
    });
    await expect(dispatch(handlers, 'session.cancelSignIn', {})).resolves.toMatchObject({
      state: 'Online',
    });
    await expect(
      dispatch(handlers, 'session.closeBudget', { force: false }),
    ).resolves.toMatchObject({ state: 'SignedIn' });
  });

  it('writes notes through the gate, and rejects them offline', async () => {
    await expect(dispatch(handlers, 'notes.get', { id: 'n' })).rejects.toMatchObject({
      code: 'validation',
    });
    await dispatch(handlers, 'session.connect', {
      serverURL: 'https://x.test',
      password: 'pw',
      remember: false,
    });
    await dispatch(handlers, 'session.openBudget', { cloudFileId: 'b1' });
    await dispatch(handlers, 'notes.set', { id: 'note-test', text: 'hello' });
    await expect(dispatch(handlers, 'notes.get', { id: 'note-test' })).resolves.toBe('hello');
    // Reserved notes change only through the metadata repository (04 §5.3).
    for (const id of ['ad:payees', 'ad:account:a1', 'ad-bak:ad:payees'])
      await expect(dispatch(handlers, 'notes.set', { id, text: '{}' })).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'reserved-note' },
      });
    actual.server = 'down';
    await dispatch(handlers, 'session.syncNow', {}).catch(() => undefined);
    await expect(
      dispatch(handlers, 'notes.set', { id: 'note-test', text: 'offline' }),
    ).rejects.toMatchObject({ code: 'offline' });
    await expect(dispatch(handlers, 'notes.get', { id: 'note-test' })).resolves.toBe('hello');
  });

  it('rejects every write method while offline (03 §5)', async () => {
    await dispatch(handlers, 'session.connect', {
      serverURL: 'https://x.test',
      password: 'pw',
      remember: false,
    });
    await dispatch(handlers, 'session.openBudget', { cloudFileId: 'b1' });
    actual.server = 'down';
    await dispatch(handlers, 'session.syncNow', {}).catch(() => undefined);
    expect(conn.state.state).toBe('OfflineReadOnly');
    for (const method of WRITE_METHODS) {
      const params = WRITE_SAMPLES[method];
      expect(params, `${method} needs sample params in WRITE_SAMPLES`).toBeDefined();
      await expect(dispatch(handlers, method, params)).rejects.toMatchObject({ code: 'offline' });
    }
  });
});

// ------------------------------------------------------------------------------------------ routing

/** Every service, as a spy that records each call and resolves with "service.method". */
const SERVICE_NAMES = [
  'connection',
  'accounts',
  'budgetFile',
  'notes',
  'read',
  'transactions',
  'payees',
  'rules',
  'categories',
  'budget',
  'schedules',
  'reconcile',
  'importer',
  'exporter',
  'reports',
  'slateWipe',
  'tags',
] as const satisfies readonly (keyof Services)[];

interface Call {
  to: string;
  args: unknown[];
}

const CONNECTION_STATE = { state: 'Online' };

function spyServices(calls: Call[]): Services {
  const service = (name: string): object =>
    new Proxy(
      {},
      {
        get: (_, prop) =>
          name === 'connection' && prop === 'state'
            ? CONNECTION_STATE
            : (...args: unknown[]) => {
                const to = `${name}.${String(prop)}`;
                calls.push({ to, args });
                return Promise.resolve(to);
              },
      },
    );
  return Object.fromEntries(SERVICE_NAMES.map((n) => [n, service(n)])) as unknown as Services;
}

// Params are sentinels: validation is tested above; this checks where each method's params go. A new
// method fails to type-check until it's added here.
const p = { marker: 'params' };
const ROUTES: Record<HostMethod, [params: object, to: string, args: unknown[]]> = {
  'session.state': [{}, '', []],
  'session.connect': [
    { serverURL: 'u', password: 'pw', remember: true, force: false },
    'connection.connect',
    ['u', 'pw', true, false],
  ],
  'session.probeLogin': [{ serverURL: 'u' }, 'connection.probeLogin', ['u']],
  'session.connectOpenId': [
    { serverURL: 'u', remember: true, force: false },
    'connection.connectOpenId',
    ['u', true, false],
  ],
  'session.cancelOpenId': [{}, 'connection.cancelOpenId', []],
  'session.serverVersion': [{}, 'connection.serverVersion', []],
  'session.setStaySignedIn': [{ on: true }, 'connection.setStaySignedIn', [true]],
  'session.clearCache': [{ force: true }, 'connection.clearCache', [true]],
  'session.signOut': [{ force: true }, 'connection.signOut', [true]],
  'session.forgetServer': [{ force: true }, 'connection.forgetServer', [true]],
  'session.listBudgets': [{}, 'connection.listBudgets', []],
  'session.openBudget': [
    { cloudFileId: 'b1', e2ePassword: 'k', remember: true },
    'connection.openBudget',
    ['b1', 'k', true],
  ],
  'session.closeBudget': [{ force: true }, 'connection.closeBudget', [true]],
  'session.syncNow': [{}, 'connection.syncNow', []],
  'session.retryConnection': [{}, 'connection.retry', ['manual']],
  'session.cancelSignIn': [{}, 'connection.cancelSignIn', []],
  'budgetFile.create': [
    { name: 'B', template: 'tpl', formats: 'fmt' },
    'budgetFile.create',
    ['B', 'tpl', 'fmt', false],
  ],
  'budgetFile.properties': [{}, 'budgetFile.properties', []],
  'budgetFile.updateProperties': [p, 'budgetFile.updateProperties', [p]],
  'budgetFile.setEncryptionKey': [
    { password: 'pw', remember: true },
    'budgetFile.setEncryptionKey',
    ['pw', true],
  ],
  'budgetFile.exportBackup': [{ path: '/x' }, 'budgetFile.exportBackup', ['/x']],
  'budgetFile.importFile': [
    { path: '/x', type: 'ynab4', importedSuffix: ' (imported)', force: true },
    'budgetFile.importFile',
    ['/x', 'ynab4', ' (imported)', true],
  ],
  'slateWipe.impact': [{ cutoffMonth: '2026-10' }, 'slateWipe.impact', ['2026-10']],
  'slateWipe.run': [p, 'slateWipe.run', [p]],
  'prefs.synced': [{}, 'budgetFile.synced', []],
  'prefs.setSynced': [{ key: 'k', value: 'v' }, 'budgetFile.setSynced', ['k', 'v']],
  'notes.get': [{ id: 'n' }, 'notes.get', ['n']],
  'notes.set': [{ id: 'n', text: 't' }, 'notes.set', ['n', 't']],
  'accounts.list': [{}, 'read.accounts', []],
  'accounts.create': [p, 'accounts.create', [p]],
  'accounts.update': [{ id: 'a1', name: 'N' }, 'accounts.update', ['a1', { name: 'N' }]],
  'accounts.close': [
    { id: 'a1', transferAccountId: 'a2', transferCategoryId: 'c1' },
    'accounts.close',
    ['a1', 'a2', 'c1'],
  ],
  'accounts.reopen': [{ id: 'a1' }, 'accounts.reopen', ['a1']],
  'accounts.delete': [{ id: 'a1' }, 'accounts.delete', ['a1']],
  'accounts.reorder': [
    { id: 'a1', beforeId: 'a2', group: 'offBudget' },
    'accounts.reorder',
    ['a1', 'a2', 'offBudget'],
  ],
  'categories.tree': [{}, 'read.categories', []],
  'payees.list': [{}, 'read.payees', []],
  'transactions.list': [{ accountId: 'a1' }, 'read.transactions', ['a1']],
  'transactions.get': [{ id: 't1' }, 'read.transaction', ['t1']],
  'transactions.commit': [p, 'transactions.commit', [p]],
  'transactions.setCleared': [
    { ids: ['t1'], state: 'C' },
    'transactions.setCleared',
    [['t1'], 'C'],
  ],
  'transactions.approve': [{ ids: ['t1'] }, 'transactions.approve', [['t1']]],
  'tags.list': [{}, 'tags.list', []],
  'tags.create': [p, 'tags.create', [p]],
  'tags.update': [{ id: 'g', color: '#fff' }, 'tags.update', ['g', { color: '#fff' }]],
  'tags.delete': [{ id: 'g' }, 'tags.delete', ['g']],
  'tags.unmanaged': [{}, 'tags.unmanaged', []],
  'tags.createMany': [{ tags: [{ tag: 'trip' }] }, 'tags.createMany', [[{ tag: 'trip' }]]],
  'transactions.categorize': [
    { ids: ['t1'], categoryId: 'c1' },
    'transactions.categorize',
    [['t1'], 'c1'],
  ],
  'transactions.delete': [{ ids: ['t1'] }, 'transactions.delete', [['t1']]],
  'transactions.undo': [{ token: 'tok' }, 'transactions.undo', ['tok']],
  'transactions.moveToAccount': [
    { ids: ['t1'], accountId: 'a2' },
    'transactions.moveToAccount',
    [['t1'], 'a2'],
  ],
  'transactions.setDate': [
    { ids: ['t1'], date: '2026-10-20' },
    'transactions.setDate',
    [['t1'], '2026-10-20', []],
  ],
  'transactions.merge': [{ a: 't1', b: 't2' }, 'transactions.merge', ['t1', 't2']],
  'transactions.lastForPayee': [{ payeeId: 'p1' }, 'transactions.lastForPayee', ['p1']],
  'transactions.nextCheckNumber': [{ accountId: 'a1' }, 'transactions.nextCheckNumber', ['a1']],
  'payees.rename': [
    { id: 'p1', name: 'N', merge: true },
    'payees.rename',
    ['p1', 'N', { merge: true }],
  ],
  'payees.renameImpact': [
    { id: 'p1', transferAccountId: 'a2', excludeId: 't1' },
    'payees.renameImpact',
    ['p1', 'a2', 't1'],
  ],
  'payees.combine': [{ ids: ['p1', 'p2'], name: 'N' }, 'payees.combine', [['p1', 'p2'], 'N']],
  'payees.setEnabled': [{ ids: ['p1'], enabled: false }, 'payees.setEnabled', [['p1'], false]],
  'payees.rules': [{ id: 'p1' }, 'payees.rules', ['p1']],
  'payees.setRenameRules': [
    { id: 'p1', conditions: ['c'] },
    'payees.setRenameRules',
    ['p1', ['c']],
  ],
  'payees.applyRenameRules': [{ id: 'p1', dryRun: true }, 'payees.applyRenameRules', ['p1', true]],
  'payees.setAutoCategory': [
    { id: 'p1', categoryId: 'c1' },
    'payees.setAutoCategory',
    ['p1', 'c1'],
  ],
  'rules.list': [{}, 'rules.list', []],
  'rules.save': [p, 'rules.save', [p]],
  'rules.delete': [{ ids: ['r1'] }, 'rules.delete', [['r1']]],
  'rules.matches': [p, 'rules.matches', [p]],
  'rules.applyActions': [
    { ids: ['t1'], actions: ['act'] },
    'rules.applyActions',
    [['t1'], ['act']],
  ],
  'categories.create': [p, 'categories.create', [p]],
  'categories.createGroup': [{ name: 'G' }, 'categories.createGroup', ['G']],
  'categories.update': [{ id: 'c1', name: 'N' }, 'categories.update', ['c1', { name: 'N' }]],
  'categories.updateGroup': [
    { id: 'g1', hidden: true },
    'categories.updateGroup',
    ['g1', { hidden: true }],
  ],
  'categories.setHidden': [
    { categoryIds: ['c1'], groupIds: ['g1'], hidden: true },
    'categories.setHidden',
    [['c1'], ['g1'], true],
  ],
  'categories.delete': [{ id: 'c1' }, 'categories.delete', ['c1']],
  'categories.deleteGroup': [{ id: 'g1' }, 'categories.deleteGroup', ['g1']],
  'categories.deleteImpact': [{ id: 'c1' }, 'categories.deleteImpact', ['c1']],
  'categories.move': [
    { id: 'c1', groupId: 'g1', beforeId: 'c2' },
    'categories.move',
    ['c1', 'g1', 'c2'],
  ],
  'categories.moveGroup': [{ id: 'g1', beforeId: 'g2' }, 'categories.moveGroup', ['g1', 'g2']],
  'categories.moveSupport': [{}, 'categories.moveSupport', []],
  'budget.months': [{}, 'budget.months', []],
  'budget.month': [{ month: '2026-10' }, 'budget.month', ['2026-10']],
  'budget.uncategorized': [{}, 'budget.uncategorized', []],
  'budget.setAmount': [
    { month: '2026-10', categoryId: 'c1', amount: 5 },
    'budget.setAmount',
    ['2026-10', 'c1', 5],
  ],
  'budget.setAmounts': [
    { month: '2026-10', entries: ['e'] },
    'budget.setAmounts',
    ['2026-10', ['e']],
  ],
  'budget.setCarryover': [
    { month: '2026-10', categoryId: 'c1', flag: true },
    'budget.setCarryover',
    ['2026-10', 'c1', true],
  ],
  'budget.hold': [{ month: '2026-10', amount: 5 }, 'budget.hold', ['2026-10', 5]],
  'budget.resetHold': [{ month: '2026-10' }, 'budget.resetHold', ['2026-10']],
  'budget.quickBudgetStats': [{ month: '2026-10' }, 'budget.quickBudgetStats', ['2026-10']],
  'notes.cellNotes': [{ month: '2026-10' }, 'notes.cellNotes', ['2026-10']],
  'notes.setCellNote': [
    { month: '2026-10', categoryId: 'c1', text: 't' },
    'notes.setCellNote',
    ['2026-10', 'c1', 't'],
  ],
  'notes.monthNote': [{ month: '2026-10' }, 'notes.monthNote', ['2026-10']],
  'notes.setMonthNote': [{ month: '2026-10', text: 't' }, 'notes.setMonthNote', ['2026-10', 't']],
  'transactions.forCategoryMonth': [
    { target: 'c1', month: '2026-10' },
    'read.forCategoryMonth',
    ['c1', '2026-10'],
  ],
  'transactions.incomeForMonth': [{ month: '2026-10' }, 'read.incomeForMonth', ['2026-10']],
  'schedules.list': [{ accountId: 'a1' }, 'schedules.list', ['a1']],
  'schedules.save': [p, 'schedules.save', [p]],
  'schedules.delete': [{ ids: ['s1'] }, 'schedules.delete', [['s1']]],
  'schedules.enterNow': [{ ids: ['s1'] }, 'schedules.enterNow', [['s1']]],
  'schedules.skip': [{ ids: ['s1'] }, 'schedules.skip', [['s1']]],
  'schedules.moveToAccount': [
    { ids: ['s1'], accountId: 'a2' },
    'schedules.moveToAccount',
    [['s1'], 'a2'],
  ],
  'schedules.draftFromTransaction': [
    { id: 't1', mode: 'recurring' },
    'schedules.draftFromTransaction',
    ['t1', 'recurring'],
  ],
  'schedules.preview': [p, 'schedules.preview', [p]],
  'schedules.linked': [{ id: 's1' }, 'schedules.linked', ['s1']],
  'schedules.matches': [p, 'schedules.matches', [p]],
  'schedules.support': [{}, 'schedules.support', []],
  'reports.get': [p, 'reports.get', [p]],
  'export.data': [p, 'exporter.data', [p]],
  'export.reportCsv': [{ path: '/x.csv', content: 'a,b' }, 'exporter.reportCsv', ['/x.csv', 'a,b']],
  'import.parse': [{ path: '/x.ofx' }, 'importer.parse', ['/x.ofx']],
  'import.run': [
    { token: 'tok', accounts: ['acc'], texts: 'texts' },
    'importer.run',
    ['tok', ['acc'], 'texts'],
  ],
  'reconcile.clearedThrough': [
    { accountId: 'a1', date: '2026-10-20' },
    'reconcile.clearedThrough',
    ['a1', '2026-10-20'],
  ],
  'reconcile.finish': [p, 'reconcile.finish', [p]],
};

describe('dispatch routing (02 §4)', () => {
  it('reads the connection state without a call', async () => {
    const calls: Call[] = [];
    const handlers = createHandlers(spyServices(calls));
    await expect(handlers['session.state']({})).resolves.toBe(CONNECTION_STATE);
    expect(calls).toEqual([]);
  });

  it.each(
    (Object.entries(ROUTES) as [HostMethod, (typeof ROUTES)[HostMethod]][]).filter(
      ([method]) => method !== 'session.state',
    ),
  )('routes %s with its params', async (method, [params, to, args]) => {
    const calls: Call[] = [];
    const handler = createHandlers(spyServices(calls))[method] as (p: object) => Promise<unknown>;
    await expect(handler(params)).resolves.toBe(to);
    expect(calls).toEqual([{ to, args }]);
  });
});
