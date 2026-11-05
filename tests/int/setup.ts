// Shared setup for the integration tests (21 §1): the test server from the environment, bootstrap of a
// fresh CI server, and a host stack (Connection, queue, services) on a throwaway data folder.
import type { HostEvents } from '@shared/rpc/host-api';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActualApi } from '../../src/host/actual';
import { Connection } from '../../src/host/connection';
import { probe } from '../../src/host/diagnose';
import { JobQueue } from '../../src/host/queue';
import { loginWithPassword } from '../../src/host/server-api';
import { AccountsService } from '../../src/host/services/accounts';
import { BudgetService } from '../../src/host/services/budget';
import { BudgetFileService } from '../../src/host/services/budget-file';
import { CategoriesService } from '../../src/host/services/categories';
import { ExportService } from '../../src/host/services/export';
import { ImportService } from '../../src/host/services/import';
import { MetadataRepository } from '../../src/host/services/metadata';
import { NotesService } from '../../src/host/services/notes';
import { PayeesService } from '../../src/host/services/payees';
import { ReadService } from '../../src/host/services/read';
import { ReconcileService } from '../../src/host/services/reconcile';
import { ReportsService } from '../../src/host/services/reports';
import { RulesService } from '../../src/host/services/rules';
import { SchedulesService } from '../../src/host/services/schedules';
import { SlateWipeService } from '../../src/host/services/slate-wipe';
import { TagsService } from '../../src/host/services/tags';
import { TransactionsService } from '../../src/host/services/transactions';
import { FakeControl } from '../../src/host/testing/fake-control';
import { bootstrapServer } from '../fixtures/bootstrap-server';

export const SERVER = process.env['ACTUAL_TEST_SERVER_URL'] ?? '';
export const PASSWORD = process.env['ACTUAL_TEST_PASSWORD'] ?? '';
export const HAS_SERVER = SERVER !== '' && PASSWORD !== '';

export const bootstrap = (): Promise<void> => bootstrapServer(SERVER, PASSWORD);

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'actual-desktop-int-'));

export interface HostStack {
  connection: Connection;
  queue: JobQueue;
  control: FakeControl;
  metadata: MetadataRepository;
  accounts: AccountsService;
  budgetFile: BudgetFileService;
  notes: NotesService;
  read: ReadService;
  transactions: TransactionsService;
  payees: PayeesService;
  rules: RulesService;
  categories: CategoriesService;
  budget: BudgetService;
  schedules: SchedulesService;
  reconcile: ReconcileService;
  importer: ImportService;
  exporter: ExportService;
  reports: ReportsService;
  slateWipe: SlateWipeService;
  tags: TagsService;
  events: { event: keyof HostEvents; payload: unknown }[];
}

/** A host stack like the real host's (src/host/index.ts), on its own cache folder. */
export function hostStack(
  actual: ActualApi,
  dataDir: string,
  options: { control?: FakeControl; probe?: typeof probe } = {},
): HostStack {
  mkdirSync(dataDir, { recursive: true });
  const queue = new JobQueue();
  const control = options.control ?? new FakeControl();
  const events: HostStack['events'] = [];
  const connection = new Connection({
    actual,
    queue,
    control,
    emit: (event, payload) => events.push({ event, payload }),
    dataDir,
    probe: options.probe ?? probe,
    login: loginWithPassword,
  });
  const metadata = new MetadataRepository(actual);
  connection.registerStartTask('tag entities', () => metadata.ensureTags());
  const budget = new BudgetService(actual, queue, connection, metadata);
  connection.registerStartTask('carryover extension', () => budget.extendCarryover(), [
    'zero_budgets',
    'notes',
  ]);
  const accounts = new AccountsService(actual, connection, metadata);
  const read = new ReadService(actual, queue, connection, metadata);
  const budgetFile = new BudgetFileService(actual, queue, connection);
  return {
    exporter: new ExportService(read, budget, budgetFile),
    reports: new ReportsService(actual, queue, connection),
    connection,
    queue,
    control,
    metadata,
    accounts,
    reconcile: new ReconcileService(actual, queue, connection),
    importer: new ImportService(actual, queue, connection, metadata),
    budgetFile,
    notes: new NotesService(actual, queue, connection, metadata),
    read,
    transactions: new TransactionsService(actual, queue, connection, metadata),
    payees: new PayeesService(actual, queue, connection, metadata),
    rules: new RulesService(actual, queue, connection),
    categories: new CategoriesService(actual, connection, queue, metadata),
    budget,
    schedules: new SchedulesService(actual, queue, connection),
    slateWipe: new SlateWipeService(actual, queue, connection, accounts),
    tags: new TagsService(actual, queue, connection),
    events,
  };
}
