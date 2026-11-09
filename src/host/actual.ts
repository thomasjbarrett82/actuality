// The only module that loads @actual-app/api (02 §1, 03 §3), and the test seam: host services use the
// `ActualApi` interface; unit tests use FakeActual, integration tests the real thing.
//
// - The fetch timeout wrapper is installed before a dynamic import(): the API reads globalThis.fetch once.
// - Sync events: the API's emitter keeps handlers across init/shutdown, so this module
//   subscribes once per process, at the first successful init, and fans events out itself.
// - Offline-fallback backstop: while a server budget is open local-only (03 §6.2), every write throws
//   `offline`, because Actual wouldn't record it for sync.
import type * as ApiModule from '@actual-app/api';
import type { RawBudgetMonth } from '@shared/domain/budget-month';
import type { BudgetFileType } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { installFetchTimeout, type InstallOptions } from './fetch-timeout';

/** An entry of `getBudgets()` (03 §1). A budget cached on this device is listed twice (03 §6.1). */
export interface BudgetFile {
  name: string;
  cloudFileId?: string;
  groupId?: string;
  hasKey?: boolean;
  encryptKeyId?: string;
  /** "remote" for the server's copy. */
  state?: string;
  /** Local id: present on the local copy. */
  id?: string;
  owner?: string;
  usersWithAccess?: unknown;
}

/** Actual's internal `sync` event. */
export type SyncEvent =
  | { type: 'start' }
  | { type: 'applied'; tables: string[] }
  | { type: 'success'; tables: string[] }
  | { type: 'error'; subtype?: string }
  | { type: 'unauthorized' };

/**
 * The internal handlers the app may call (03 §3), plus `delete-budget` with a local id only, which removes
 * another user's cached copy on a user switch (03 §7.1).
 */
export type InternalHandler =
  | 'category-move'
  | 'category-group-move'
  | 'schedule/get-upcoming-dates'
  | 'schedule/skip-next-date'
  | 'make-filters-from-conditions'
  | 'rule-apply-actions'
  | 'save-prefs'
  | 'key-make'
  | 'tags-discover'
  | 'tags-rename'
  | 'delete-budget'
  | 'transactions-batch-update';

export const UNAVAILABLE_HANDLER = 'internal-handler-unavailable';

/** The settling wrappers poll every 10 ms for up to 3 s (03 §3). */
const SETTLE_POLL_MS = 10;
const SETTLE_TIMEOUT_MS = 3000;

/** A handler the API doesn't have fails as `handler is not a function` (runHandler, 26.10.0). */
const isMissingHandler = (e: unknown): boolean =>
  e instanceof TypeError && /not a function/.test(e.message);

export type InitConfig =
  { dataDir: string; serverURL: string; sessionToken: string } | { dataDir: string };

// Actual's rows as the host reads them (04 §3, §6). Services turn them into the domain types (04 §2).

export interface RawAccount {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  /** `accounts.sort_order`. */
  sortOrder: number;
  accountGroupId: string | null;
  /**
   * `accounts.last_reconciled` (04 §3): when the last reconciliation finished, in ms since the epoch, as
   * Actual stores it (a string). Absent or empty: never reconciled. `getAccounts()` doesn't return it.
   */
  lastReconciled?: string | null;
}

export interface RawCategory {
  id: string;
  name: string;
  groupId: string;
  isIncome: boolean;
  hidden: boolean;
  sortOrder: number;
}

export interface RawCategoryGroup {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  sortOrder: number;
  categories: RawCategory[];
}

export interface RawPayee {
  id: string;
  name: string;
  transferAcct: string | null;
}

/** A rule condition. Fields the app doesn't use (`type`, `options`) are kept as read. */
export interface RawRuleCondition {
  field: string;
  op: string;
  value: unknown;
  type?: string;
  [key: string]: unknown;
}

/** A rule action, kept whole like conditions. */
export interface RawRuleAction {
  field?: string;
  op: string;
  value: unknown;
  type?: string;
  [key: string]: unknown;
}

export interface RawRule {
  id: string;
  stage: string | null;
  conditionsOp: string;
  conditions: RawRuleCondition[];
  actions: RawRuleAction[];
}

/** A row of the register query (04 §6), grouped: split parents carry their children. */
export interface RawTransaction {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  transferId: string | null;
  importedId: string | null;
  importedPayee: string | null;
  schedule: string | null;
  startingBalance: boolean;
  sortOrder: number;
  isParent: boolean;
  parentId: string | null;
  subtransactions: RawTransaction[];
}

export interface RawNote {
  id: string;
  note: string | null;
}

export interface RawSchedule {
  id: string;
  /** Actual's name: unique when set, preserved (12 §1). */
  name?: string | null;
  account: string | null;
  payee: string | null;
  completed: boolean;
  /** Actual's `next_date` (system-managed, 12 §1). */
  nextDate?: string | null;
  /** A number, or `{ num1, num2 }` for `isbetween`. */
  amount?: number | { num1: number; num2: number } | null;
  amountOp?: string;
  /** A plain date (Once) or a RecurConfig (12 §1). */
  date?: unknown;
  /** The schedule's rule, which carries its template actions (12 §1). */
  ruleId?: string | null;
  /** Actual's `posts_transaction`: its schedule service enters due occurrences (12 §2). */
  postsTransaction?: boolean;
}

/** A schedule's amount: a number, or `{ num1, num2 }` for `isbetween`. */
export type ScheduleAmount = number | { num1: number; num2: number };

/** A schedule to create (12 §3.1). `payee` null leaves the payee condition out. */
export interface ScheduleInput {
  /** Empty for no name. */
  name: string;
  postsTransaction: boolean;
  payee: string | null;
  account: string;
  amount: ScheduleAmount;
  amountOp: 'is' | 'isapprox' | 'isbetween';
  /** A plain date (Once) or a RecurConfig. */
  date: unknown;
}

/**
 * Fields `updateSchedule` may write (12 §3.1). `next_date` is system-managed and never written. An empty
 * name clears it: Actual writes `null` as the text "null".
 */
export interface SchedulePatch {
  name?: string;
  postsTransaction?: boolean;
  payee?: string | null;
  account?: string;
  amount?: ScheduleAmount;
  amountOp?: 'is' | 'isapprox' | 'isbetween';
  date?: unknown;
}

/** A split line of a new or updated transaction (04 §3). Lines without an id are created. */
export interface SubTransactionInput {
  id?: string;
  amount: number;
  /** A transfer line's transfer payee; null takes the parent's payee (Actual's makeChild). */
  payee: string | null;
  category: string | null;
  notes: string;
}

/** A new transaction for `addTransactions` (04 §3). `cleared` is always explicit: Actual defaults it to true. */
export interface NewTransaction {
  id: string;
  date: string;
  amount: number;
  /** A payee by name; Actual finds or creates it. Used when `payee` is absent. */
  payeeName?: string;
  /** A payee id (or a transfer payee). */
  payee?: string | null;
  category: string | null;
  notes: string;
  cleared: boolean;
  reconciled: boolean;
  importedId?: string | null;
  importedPayee?: string | null;
  /** Links it to a schedule (Enter in register now, 12 §3). */
  schedule?: string | null;
  /** Actual's `starting_balance_flag`: the Starting Balance rows a slate wipe adds (18 §2). */
  startingBalance?: boolean;
  subtransactions?: SubTransactionInput[];
}

/** A bank transaction for `importTransactions` (16 §1.5). Without `payeeName` only `importedPayee` is set. */
export interface ImportInput {
  date: string;
  amount: number;
  payeeName?: string;
  /** A transfer payee's id, for "Transfer : X" to another account. */
  payee?: string;
  importedPayee: string;
  importedId: string;
  notes: string;
  category: string | null;
  subtransactions?: { amount: number; category: string | null; notes: string }[];
}

/** `importTransactions`' result: Actual's reconciliation added some rows and matched others (X4). */
export interface ImportResult {
  added: string[];
  updated: string[];
  errors: string[];
}

/**
 * A report side (15 §6): a transaction that isn't a split, or one split line, read for Reports. A line
 * without its own payee takes its parent's; `line` is its position in the split.
 */
export interface RawReportSide {
  id: string;
  transactionId: string;
  line: number;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  startingBalance: boolean;
}

/** Fields `updateTransaction` may write (04 §3). */
export interface TransactionPatch {
  date?: string;
  amount?: number;
  category?: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  payee?: string | null;
  notes?: string;
  /** Moves it (and a split's lines) to another account. */
  account?: string;
  /** Links it to a schedule, or unlinks it with null (12 §3.1). */
  schedule?: string | null;
  /** A split parent's full line array: lines with ids are kept, others created, missing deleted. */
  subtransactions?: SubTransactionInput[];
}

/** A transaction row as stored, split parents and lines alike (`splits: 'all'`). */
export interface RawRow {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  transferId: string | null;
  importedId: string | null;
  importedPayee: string | null;
  schedule: string | null;
  isParent: boolean;
  isChild: boolean;
  parentId: string | null;
}

/** A rule to create or update (14 §1). */
export interface RuleInput {
  stage: string | null;
  conditionsOp: string;
  conditions: RawRuleCondition[];
  actions: RawRuleAction[];
}

/** Fields `updateAccount` may write (04 §3). `sortOrder` is written alone. */
export interface AccountPatch {
  name?: string;
  offbudget?: boolean;
  closed?: boolean;
  sortOrder?: number;
  /** `last_reconciled`, ms since the epoch as a string, as Actual web writes it at Finish (13 §6.3). */
  lastReconciled?: string;
}

export interface RawTag {
  id: string;
  tag: string;
  color: string | null;
  description: string | null;
}

export interface ActualApi {
  init(config: InitConfig): Promise<void>;
  shutdown(): Promise<void>;
  getBudgets(): Promise<BudgetFile[]>;
  /** `syncId` is the file's groupId. `password` is the end-to-end encryption password. */
  downloadBudget(syncId: string, password?: string): Promise<void>;
  loadBudget(localId: string): Promise<void>;
  sync(): Promise<void>;
  /** Synced prefs; every value is a string (04 §3). */
  getPreferences(): Promise<Record<string, string | undefined>>;
  setPreference(key: string, value: string): Promise<void>;
  getNote(id: string): Promise<string | null>;
  updateNote(id: string, text: string): Promise<void>;
  /** Notes by id, in one query; ids with no row are left out. */
  getNotes(ids: readonly string[]): Promise<RawNote[]>;
  /** Every reserved note: the `'ad:'`…`'ad;'` range, so `ad-bak:` backups never load (04 §5.3). */
  getReservedNotes(): Promise<RawNote[]>;
  /** Accounts in `sort_order`, ties by name (04 §3). */
  getAccounts(): Promise<RawAccount[]>;
  /** Groups and their categories, each in `sort_order` (04 §3). Hidden ones included. */
  getCategoryGroups(): Promise<RawCategoryGroup[]>;
  getPayees(): Promise<RawPayee[]>;
  getRules(): Promise<RawRule[]>;
  /** The register query (04 §6), grouped, for one account or all of them. */
  getTransactions(accountId: string | null): Promise<RawTransaction[]>;
  /** One transaction by the register query, grouped: a split parent comes with all its lines. */
  getTransaction(parentId: string): Promise<RawTransaction | null>;
  /** How many transactions (split children counted, parents not) use each payee. */
  getPayeeUsage(): Promise<Map<string, number>>;
  getTags(): Promise<RawTag[]>;
  getSchedules(): Promise<RawSchedule[]>;
  /** `createSchedule` (12 §3): Actual creates its rule (conditions + `link-schedule`). Returns the id. */
  createSchedule(input: ScheduleInput): Promise<string>;
  /** `updateSchedule`: Actual merges the conditions and keeps the rule's other actions. */
  updateSchedule(id: string, patch: SchedulePatch): Promise<void>;
  /** `deleteSchedule`: the schedule and its rule. */
  deleteSchedule(id: string): Promise<void>;
  /**
   * The internal `schedule/skip-next-date` (03 §3): `next_date` moves on by one occurrence. A
   * missing handler throws `actual` with `details.code = 'internal-handler-unavailable'`.
   */
  skipNextDate(id: string): Promise<void>;
  createTag(tag: { tag: string; color?: string; description?: string }): Promise<void>;
  /** `updateTag`: the color and description. A rename goes through `renameTag`, which rewrites the notes. */
  updateTag(
    id: string,
    fields: { color?: string | null; description?: string | null },
  ): Promise<void>;
  /**
   * The internal `tags-rename` (04 §5.2): renames the entity and rewrites that exact hashtag in every
   * transaction's notes. The public `updateTag` renames only the entity (26.10.0).
   */
  renameTag(id: string, tag: string): Promise<void>;
  /** `deleteTag`: removes the entity only; the hashtag text stays in the notes. */
  deleteTag(id: string): Promise<void>;
  /** The internal `tags-discover` (04 §5.2): creates entities for note tags that have none. */
  discoverTags(): Promise<void>;
  /**
   * Creates an account (04 §3). With a non-zero balance Actual adds the starting-balance transaction
   * itself: dated today, cleared, payee "Starting Balance", categorized as its starting-balance income
   * category on-budget. Returns the id.
   */
  createAccount(name: string, offbudget: boolean, initialBalance: number): Promise<string>;
  updateAccount(id: string, patch: AccountPatch): Promise<void>;
  /**
   * Actual's `closeAccount` (13 §4). A non-zero balance needs a transfer account. **It deletes an account
   * that has no transactions** (26.10.0), as Actual web's close does.
   */
  closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void>;
  reopenAccount(id: string): Promise<void>;
  /**
   * Actual's forced close: deletes the account, its transactions and its transfer payee (13 §5). **It
   * does nothing to an account that is closed already** (26.10.0), so only open accounts are deleted.
   */
  deleteAccount(id: string): Promise<void>;
  /** Adds one transaction with `runTransfers` and no learning (04 §3). Returns once it is written. */
  addTransaction(accountId: string, t: NewTransaction): Promise<void>;
  /** Adds transactions with `runTransfers` and no learning (04 §3). Returns once they are written. */
  addTransactions(accountId: string, ts: readonly NewTransaction[]): Promise<void>;
  /**
   * `importTransactions` (16 §1.5): Actual's reconciliation skips known `imported_id`s and matches similar
   * existing rows. Always `defaultCleared`, never re-importing deleted rows, and bank text kept as sent
   * (`payeeNameNormalization: 'original'`).
   */
  importTransactions(accountId: string, ts: readonly ImportInput[]): Promise<ImportResult>;
  /**
   * The settling `updateTransaction` wrapper (03 §3): resolves only once every written field reads back
   * (a split's line ids and amounts too, and a transfer's other side its amount), and rejects with
   * `timeout` after 3 s. A category Actual rewrites itself (on↔on transfers, moves off-budget) isn't
   * waited for.
   */
  updateTransaction(id: string, patch: TransactionPatch): Promise<void>;
  /**
   * The settling `deleteTransaction` wrapper (03 §3): resolves once the row is gone, and a transfer's
   * other side too. A split's lines go with it; their transfer mirrors are unlinked, not deleted (04 §3).
   */
  deleteTransaction(id: string): Promise<void>;
  /**
   * Deletes many top-level rows in one `transactions-batch-update` (Wipe the Slate Clean, 18 §2), which
   * resolves once they're gone with their split lines and transfer counterparts. Ids already gone are
   * skipped. Without the batch handler, each goes through the settling `deleteTransaction`.
   */
  deleteTransactions(ids: readonly string[]): Promise<void>;
  /** Actual's `mergeTransactions` (X4): returns the id kept, once the other is gone. */
  mergeTransactions(a: string, b: string): Promise<string>;
  /** Rows by id, or the lines of the given parents (`splits: 'all'`). Unknown ids are left out. */
  getTransactionRows(filter: {
    ids?: readonly string[];
    parentIds?: readonly string[];
  }): Promise<RawRow[]>;
  /** The most recent non-split row with this payee, in any account (11 §4.3). */
  lastTransactionForPayee(payeeId: string): Promise<RawRow | null>;
  /** The top-level rows linked to a schedule, the most recent first (12 §3.1). */
  linkedTransactions(scheduleId: string): Promise<RawRow[]>;
  /**
   * Top-level rows no schedule links that match a schedule's conditions, the most recent first (12 §3.1).
   * Actual's internal `make-filters-from-conditions` turns the conditions into its own query; a missing
   * handler throws `internal-handler-unavailable`.
   */
  scheduleMatches(conditions: readonly RawRuleCondition[], limit: number): Promise<RawRow[]>;
  /**
   * Rows a rule's conditions match (23 §4): split lines on their own (`splits: 'inline'`), the most recent
   * first. Uses `make-filters-from-conditions`; a missing handler throws `internal-handler-unavailable`.
   */
  ruleMatches(
    conditions: readonly RawRuleCondition[],
    conditionsOp: 'and' | 'or',
    limit: number,
  ): Promise<RawRow[]>;
  /**
   * The internal `rule-apply-actions` (23 §3.4) on these rows. Throws `validation` when Actual can't
   * read an action, and `internal-handler-unavailable` when the handler is missing.
   */
  applyRuleActions(ids: readonly string[], actions: readonly RawRuleAction[]): Promise<void>;
  /** Creates a payee and returns its id. */
  createPayee(name: string): Promise<string>;
  updatePayee(id: string, patch: { name: string }): Promise<void>;
  /** Moves the transactions of `ids` to `targetId` and deletes them (14 §3). */
  mergePayees(targetId: string, ids: readonly string[]): Promise<void>;
  deletePayee(id: string): Promise<void>;
  createRule(rule: RuleInput): Promise<string>;
  updateRule(rule: RawRule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  /** The budget's readable months, oldest first. */
  getBudgetMonths(): Promise<string[]>;
  /** On for the month and every later existing month. */
  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>;
  /**
   * `getBudgetMonth(m)`. Actual throws for a month outside `getBudgetMonths()`, so callers check
   * the range first.
   */
  getBudgetMonth(month: string): Promise<RawBudgetMonth>;
  /** Doesn't validate the month: callers check the range first. */
  setBudgetAmount(month: string, categoryId: string, amount: number): Promise<void>;
  /** Runs `fn`'s budget writes as one batch (`batchBudgetUpdates`, 04 §3). */
  batchBudgetUpdates(fn: () => Promise<void>): Promise<void>;
  /** Actual's hold for next month (X1). False when nothing could be held. */
  holdBudgetForNextMonth(month: string, amount: number): Promise<boolean>;
  resetBudgetHold(month: string): Promise<void>;
  /** With no transfer category: its transactions become uncategorized (09 §6.1). */
  deleteCategory(id: string): Promise<void>;
  deleteCategoryGroup(id: string): Promise<void>;
  /** Transactions per category in a month: on-budget accounts, split lines counted (09 §2). */
  categoryCountsInMonth(month: string): Promise<Map<string, number>>;
  /**
   * The Uncategorized row's transactions (04 §6): on-budget, uncategorized, not on-budget transfers, split
   * lines included. In `month`, or in any month for null (then `total` is 0).
   */
  uncategorizedSummary(month: string | null): Promise<{ count: number; total: number }>;
  /** On-budget rows in a month (split lines, not parents) with these categories, or uncategorized. */
  monthRows(
    month: string,
    filter: { categoryIds: readonly string[] } | 'uncategorized',
  ): Promise<RawRow[]>;
  /** Every transaction side, all history, splits as their lines (Reports, 15 §6–7). */
  reportSides(): Promise<RawReportSide[]>;
  /** Count and sum of the rows with these categories in any month (09 §6.1 delete confirmation). */
  categoryUsage(categoryIds: readonly string[]): Promise<{ count: number; total: number }>;
  /**
   * The internal `schedule/get-upcoming-dates` (03 §3): the next `count` occurrences of a schedule's
   * date config **from today on**. A missing handler throws `internal-handler-unavailable`.
   */
  getUpcomingDates(config: unknown, count: number): Promise<string[]>;
  /** `updateCategory` always sends the name, or Actual throws. `groupId` moves it. */
  updateCategory(
    id: string,
    patch: { name: string; hidden?: boolean; groupId?: string },
  ): Promise<void>;
  /** `updateCategoryGroup` always sends the name, or Actual throws. */
  updateCategoryGroup(id: string, patch: { name: string; hidden?: boolean }): Promise<void>;
  /**
   * The internal `category-group-move` (03 §3): puts the group before `targetId`, or last for null. A
   * missing handler throws `actual` with `details.code = 'internal-handler-unavailable'`.
   */
  moveCategoryGroup(id: string, targetId: string | null): Promise<void>;
  /** The internal `category-move` (03 §3): into `groupId`, before `targetId`, or last for null. */
  moveCategory(id: string, groupId: string, targetId: string | null): Promise<void>;
  /** The server's version, or null when there's no server or it can't be reached. */
  getServerVersion(): Promise<string | null>;
  /** Deletes a budget's local copy (03 §7.1 user switch). Never the open budget. Needs an init. */
  deleteLocalBudget(localId: string): Promise<void>;
  /**
   * Creates a budget with the public `runImport` (07 §4): `fill` runs inside the import, then the
   * budget is uploaded and left loaded. Upload errors are only logged by the API, so this returns the new
   * budget's local `getBudgets()` entry, whose `cloudFileId` the caller checks against the server's list.
   */
  createBudget(name: string, fill: () => Promise<void>): Promise<BudgetFile | null>;
  /** Appends a group after the last one (Actual's insertCategoryGroup). Returns its id. */
  createCategoryGroup(name: string, isIncome?: boolean): Promise<string>;
  /** Puts the category at the **top** of its group. Returns its id. */
  createCategory(groupId: string, name: string, isIncome?: boolean): Promise<string>;
  /**
   * Renames the open budget, on the server and locally, with the internal `save-prefs { budgetName }`
   * (03 §3). A missing handler throws `actual` with `details.code = 'internal-handler-unavailable'`.
   */
  renameBudget(name: string): Promise<void>;
  /**
   * Enables end-to-end encryption on the open budget, or replaces its key, with the internal `key-make`
   * (03 §7). Actual makes a randomized key from the password, resets sync and uploads this copy as the
   * new source of truth. Throws with the handler's error reason (`network`, `upload-failure`, …); a
   * missing handler throws `actual` with `details.code = 'internal-handler-unavailable'`.
   */
  makeEncryptionKey(password: string): Promise<void>;
  /** Actual's `exportBudget` (07 §6, 18 §2): the open budget as Actual's export zip. */
  exportBudget(): Promise<Uint8Array>;
  /**
   * Actual's `importBudget` (07 §3.4): imports the file as a new budget, which the API uploads and
   * leaves loaded. Upload errors are only logged, so the result's `cloudFileId` is the server entry that
   * is new since the import started, if there is one. `filename` names a buffer (a YNAB 4 zip's name
   * must end in `.zip`).
   */
  importBudget(
    data: Uint8Array,
    type: BudgetFileType,
    filename: string,
  ): Promise<BudgetFile | null>;
  /** False once an internal handler was found missing (03 §3), so the UI uses its fallback. */
  internalHandlerAvailable(name: InternalHandler): boolean;
  /** Adds a sync-event listener. The underlying subscription is made once per process. */
  onSync(handler: (event: SyncEvent) => void): void;
  /** Blocks every write while an offline-fallback session is open (03 §6.2). */
  setOfflineFallback(on: boolean): void;
}

type Api = typeof ApiModule;

export interface RealActualOptions {
  /** Test harness only (21 §1): a never-uploaded local budget may be written. Not reachable over RPC. */
  localTestBudget?: boolean;
  /** The fetch wrapper's hooks and the HTTP join point, woven by host/index.ts (02 §8.2). */
  fetch?: InstallOptions;
}

/** Loads @actual-app/api, after installing the fetch timeout wrapper. */
export async function createRealActual(opts: RealActualOptions = {}): Promise<ActualApi> {
  installFetchTimeout(opts.fetch);
  const mod = (await import('@actual-app/api')) as Api & { default?: Api };
  const api: Api = mod.default ?? mod;
  return new RealActual(api, opts);
}

/**
 * Integration-test fixtures (21 §1): throwaway budgets on a real server. Kept here because this module is
 * the only importer of @actual-app/api. Each call runs its own init/shutdown, so call it only while no
 * Connection session is open in this process. Not reachable over RPC.
 */
export interface ActualTestFixtures {
  /** Creates an empty budget and uploads it. Returns the server's file entry. */
  createServerBudget(serverURL: string, sessionToken: string, name: string): Promise<BudgetFile>;
  /** Deletes a budget from the server. */
  deleteServerBudget(serverURL: string, sessionToken: string, cloudFileId: string): Promise<void>;
  /**
   * Builds a local budget that is never uploaded (no server session), fills it inside `runImport`, and
   * returns it as an Actual export zip (21 §2 `build-fixture.ts`). The local copy is deleted afterwards.
   * `finish` runs after `runImport`, with the budget loaded: reads of rules and schedules return nothing
   * inside `runImport` (API 26.11.0), so writes that need them go there.
   */
  buildBudgetZip(
    name: string,
    fill: (api: ActualModule) => Promise<void>,
    finish?: (api: ActualModule) => Promise<void>,
  ): Promise<Uint8Array>;
  /**
   * Uploads an export zip as a new server budget with `importBudget(zip, { type: 'actual' })` and confirms
   * the upload through `getBudgets()`, because upload errors aren't thrown (21 §2).
   */
  uploadBudgetZip(serverURL: string, sessionToken: string, zip: Uint8Array): Promise<BudgetFile>;
  /**
   * Downloads a server budget into a fresh session and lists its accounts as the server has them, for
   * E2E checks that a change reached Actual.
   */
  serverAccounts(
    serverURL: string,
    sessionToken: string,
    cloudFileId: string,
  ): Promise<{ name: string; offbudget: boolean; closed: boolean }[]>;
  /**
   * Downloads a server budget into a fresh session and returns `getBudgetMonth` for the months, for E2E
   * checks that the Budget screen shows Actual's numbers (21 §3 journey 1).
   */
  serverBudgetMonths(
    serverURL: string,
    sessionToken: string,
    cloudFileId: string,
    months: readonly string[],
  ): Promise<Record<string, unknown>[]>;
  /** The API itself, for independent ActualQL checks while a Connection session is open (21 §1). */
  readonly api: ActualModule;
}

/** The API module's type, for test fixtures only. */
export type ActualModule = Api;

export async function createRealActualForTests(
  dataDir: string,
): Promise<{ actual: ActualApi; fixtures: ActualTestFixtures }> {
  const actual = await createRealActual();
  const mod = (await import('@actual-app/api')) as Api & { default?: Api };
  const api: Api = mod.default ?? mod;
  const fixtures: ActualTestFixtures = {
    api,
    async buildBudgetZip(name, fill, finish) {
      const lib = await api.init({ dataDir });
      try {
        await api.runImport(name, () => fill(api));
        if (finish) await finish(api);
        const zip = await api.exportBudget();
        const local = (await api.getBudgets()).find((b) => b.name === name && b.id);
        if (local?.id) await lib.send('delete-budget', { id: local.id });
        return zip;
      } finally {
        await api.shutdown();
      }
    },
    async uploadBudgetZip(serverURL, sessionToken, zip) {
      await api.init({ dataDir, serverURL, sessionToken });
      try {
        const remoteIds = async (): Promise<Set<string>> =>
          new Set(
            (await api.getBudgets()).flatMap((b) =>
              b.state === 'remote' && b.cloudFileId ? [b.cloudFileId] : [],
            ),
          );
        const before = await remoteIds();
        await api.importBudget(zip, { type: 'actual' });
        const added = [...(await remoteIds())].find((id) => !before.has(id));
        const file = (await api.getBudgets()).find(
          (b) => b.state === 'remote' && b.cloudFileId === added,
        );
        if (!file) throw new Error('The fixture budget was not uploaded to the server.');
        return file;
      } finally {
        await api.shutdown();
      }
    },
    async createServerBudget(serverURL, sessionToken, name) {
      await api.init({ dataDir, serverURL, sessionToken });
      try {
        await api.runImport(name, () => Promise.resolve());
        const files = await api.getBudgets();
        const remote = files.find((f) => f.name === name && f.cloudFileId);
        if (!remote) throw new Error(`The test budget ${name} was not uploaded.`);
        return remote;
      } finally {
        await api.shutdown();
      }
    },
    async serverAccounts(serverURL, sessionToken, cloudFileId) {
      await api.init({ dataDir, serverURL, sessionToken });
      try {
        const file = (await api.getBudgets()).find(
          (b) => b.state === 'remote' && b.cloudFileId === cloudFileId,
        );
        if (!file?.groupId) throw new Error(`No server budget ${cloudFileId}.`);
        await api.downloadBudget(file.groupId);
        return (await api.getAccounts()).map((a) => ({
          name: a.name,
          offbudget: a.offbudget === true,
          closed: a.closed === true,
        }));
      } finally {
        await api.shutdown();
      }
    },
    async serverBudgetMonths(serverURL, sessionToken, cloudFileId, months) {
      await api.init({ dataDir, serverURL, sessionToken });
      try {
        const file = (await api.getBudgets()).find(
          (b) => b.state === 'remote' && b.cloudFileId === cloudFileId,
        );
        if (!file?.groupId) throw new Error(`No server budget ${cloudFileId}.`);
        await api.downloadBudget(file.groupId);
        const out: Record<string, unknown>[] = [];
        for (const m of months) out.push(await api.getBudgetMonth(m));
        return out;
      } finally {
        await api.shutdown();
      }
    },
    async deleteServerBudget(serverURL, sessionToken, cloudFileId) {
      const lib = await api.init({ dataDir, serverURL, sessionToken });
      try {
        await lib.send('delete-budget', { cloudFileId });
      } finally {
        await api.shutdown();
      }
    },
  };
  return { actual, fixtures };
}

/** Ids per `$oneof` query. */
const ROW_CHUNK = 500;

const ROW_FIELDS = [
  'id',
  'account',
  'date',
  'amount',
  'payee',
  'category',
  'notes',
  'cleared',
  'reconciled',
  'transfer_id',
  'imported_id',
  'imported_payee',
  'schedule',
  'is_parent',
  'is_child',
  'parent_id',
] as const;

interface RowFields {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  transfer_id: string | null;
  imported_id: string | null;
  imported_payee: string | null;
  schedule: string | null;
  is_parent: boolean;
  is_child: boolean;
  parent_id: string | null;
}

const toRow = (r: RowFields): RawRow => ({
  id: r.id,
  account: r.account,
  date: r.date,
  amount: r.amount,
  payee: r.payee,
  category: r.category,
  notes: r.notes,
  cleared: r.cleared,
  reconciled: r.reconciled,
  transferId: r.transfer_id,
  importedId: r.imported_id,
  importedPayee: r.imported_payee,
  schedule: r.schedule,
  isParent: r.is_parent,
  isChild: r.is_child,
  parentId: r.parent_id,
});

/** A split line as Actual takes it. Without a payee, Actual gives the line the parent's (makeChild). */
const childFields = (l: SubTransactionInput): Record<string, unknown> => ({
  ...(l.id === undefined ? {} : { id: l.id }),
  amount: l.amount,
  ...(l.payee === null ? {} : { payee: l.payee }),
  category: l.category,
  notes: l.notes,
});

/** The sorted amounts of a set of lines, to compare what was written with what landed. */
const amountsKey = (xs: readonly { amount: number }[]): string =>
  xs
    .map((x) => x.amount)
    .sort((a, b) => a - b)
    .join(',');

class RealActual implements ActualApi {
  private readonly listeners = new Set<(event: SyncEvent) => void>();
  private subscribed = false;
  private offlineFallback = false;
  /** The internal handler interface of the current init. */
  private lib: Awaited<ReturnType<Api['init']>> | null = null;

  constructor(
    private readonly api: Api,
    private readonly opts: RealActualOptions,
  ) {}

  async init(config: InitConfig): Promise<void> {
    const lib = await this.api.init(config);
    this.lib = lib;
    if (!this.subscribed) {
      this.subscribed = true;
      lib.on('sync', (event: SyncEvent) => {
        for (const l of this.listeners) l(event);
      });
    }
  }

  async shutdown(): Promise<void> {
    await this.api.shutdown();
  }

  async getBudgets(): Promise<BudgetFile[]> {
    return await this.api.getBudgets();
  }

  async downloadBudget(syncId: string, password?: string): Promise<void> {
    await this.api.downloadBudget(syncId, password === undefined ? {} : { password });
  }

  async loadBudget(localId: string): Promise<void> {
    await this.api.loadBudget(localId);
  }

  async sync(): Promise<void> {
    await this.api.sync();
  }

  async getPreferences(): Promise<Record<string, string | undefined>> {
    return await this.api.getPreferences();
  }

  async setPreference(key: string, value: string): Promise<void> {
    this.assertWritable();
    await this.api.setPreference(key as Parameters<Api['setPreference']>[0], value);
  }

  private async aql<T>(query: unknown): Promise<T> {
    const result = (await this.api.aqlQuery(query as Parameters<Api['aqlQuery']>[0])) as {
      data: T;
    };
    return result.data;
  }

  async getNotes(ids: readonly string[]): Promise<RawNote[]> {
    if (ids.length === 0) return [];
    return this.aql<RawNote[]>(
      this.api
        .q('notes')
        .filter({ id: { $oneof: [...ids] } })
        .select(['id', 'note']),
    );
  }

  async getReservedNotes(): Promise<RawNote[]> {
    // `$like` fails on the id field; ';' is the character after ':'.
    return this.aql<RawNote[]>(
      this.api
        .q('notes')
        .filter({ id: { $gte: 'ad:', $lt: 'ad;' } })
        .select(['id', 'note']),
    );
  }

  async getAccounts(): Promise<RawAccount[]> {
    const [accounts, orders] = await Promise.all([
      this.api.getAccounts(),
      this.aql<{ id: string; sort_order: number | null; last_reconciled: string | null }[]>(
        this.api.q('accounts').select(['id', 'sort_order', 'last_reconciled']),
      ),
    ]);
    const order = new Map(orders.map((o) => [o.id, o.sort_order ?? 0]));
    const reconciled = new Map(orders.map((o) => [o.id, o.last_reconciled]));
    return accounts
      .map((a): RawAccount => ({
        id: a.id,
        name: a.name,
        offbudget: a.offbudget === true,
        closed: a.closed === true,
        sortOrder: order.get(a.id) ?? 0,
        accountGroupId: a.account_group_id ?? null,
        lastReconciled: reconciled.get(a.id) ?? null,
      }))
      .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
  }

  async getCategoryGroups(): Promise<RawCategoryGroup[]> {
    type Row = {
      id: string;
      name: string;
      is_income: boolean;
      hidden: boolean;
      sort_order: number | null;
    };
    const [groups, categories] = await Promise.all([
      this.aql<Row[]>(
        this.api.q('category_groups').select(['id', 'name', 'is_income', 'hidden', 'sort_order']),
      ),
      this.aql<(Row & { group: string })[]>(
        this.api
          .q('categories')
          .select(['id', 'name', 'group', 'is_income', 'hidden', 'sort_order']),
      ),
    ]);
    const bySort = <T extends { sortOrder: number; name: string }>(a: T, b: T): number =>
      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    return groups
      .map((g): RawCategoryGroup => ({
        id: g.id,
        name: g.name,
        isIncome: g.is_income,
        hidden: g.hidden,
        sortOrder: g.sort_order ?? 0,
        categories: categories
          .filter((c) => c.group === g.id)
          .map((c) => ({
            id: c.id,
            name: c.name,
            groupId: g.id,
            isIncome: c.is_income,
            hidden: c.hidden,
            sortOrder: c.sort_order ?? 0,
          }))
          .sort(bySort),
      }))
      .sort(bySort);
  }

  async getPayees(): Promise<RawPayee[]> {
    const payees = await this.api.getPayees();
    return payees.map((p) => ({ id: p.id, name: p.name, transferAcct: p.transfer_acct ?? null }));
  }

  async getRules(): Promise<RawRule[]> {
    const rules = await this.api.getRules();
    // Conditions and actions are kept whole, so an update writes back what the app doesn't use.
    return rules.map((r) => ({
      id: r.id,
      stage: r.stage ?? null,
      conditionsOp: r.conditionsOp,
      conditions: r.conditions.map((c) => ({ ...(c as RawRuleCondition) })),
      actions: r.actions.map((a) => ({ ...(a as RawRuleAction) })),
    }));
  }

  async getTransactions(accountId: string | null): Promise<RawTransaction[]> {
    return this.registerQuery(accountId === null ? {} : { account: accountId });
  }

  async getTransaction(parentId: string): Promise<RawTransaction | null> {
    // Grouped, a filter on the parent's id gives the parent with its lines (checked in the
    // integration tests, 04 §6).
    const [row] = await this.registerQuery({ id: parentId });
    return row ?? null;
  }

  /** The register query (04 §6): the fields the register needs, splits grouped under their parents. */
  private async registerQuery(filter: Record<string, string>): Promise<RawTransaction[]> {
    type Row = {
      id: string;
      account: string;
      date: string;
      amount: number;
      payee: string | null;
      category: string | null;
      notes: string | null;
      cleared: boolean;
      reconciled: boolean;
      transfer_id: string | null;
      imported_id: string | null;
      imported_payee: string | null;
      is_parent: boolean;
      is_child: boolean;
      parent_id: string | null;
      schedule: string | null;
      starting_balance_flag: boolean;
      sort_order: number | null;
      subtransactions?: Row[];
    };
    const toRaw = (r: Row): RawTransaction => ({
      id: r.id,
      account: r.account,
      date: r.date,
      amount: r.amount,
      payee: r.payee,
      category: r.category,
      notes: r.notes,
      cleared: r.cleared,
      reconciled: r.reconciled,
      transferId: r.transfer_id,
      importedId: r.imported_id,
      importedPayee: r.imported_payee,
      schedule: r.schedule,
      startingBalance: r.starting_balance_flag,
      sortOrder: r.sort_order ?? 0,
      isParent: r.is_parent,
      parentId: r.parent_id,
      subtransactions: (r.subtransactions ?? []).map(toRaw),
    });
    const rows = await this.aql<Row[]>(
      this.api
        .q('transactions')
        .filter(filter)
        .select([
          'id',
          'account',
          'date',
          'amount',
          'payee',
          'category',
          'notes',
          'cleared',
          'reconciled',
          'transfer_id',
          'imported_id',
          'imported_payee',
          'is_parent',
          'is_child',
          'parent_id',
          'schedule',
          'starting_balance_flag',
          'sort_order',
        ])
        .options({ splits: 'grouped' }),
    );
    return rows.map(toRaw);
  }

  async getPayeeUsage(): Promise<Map<string, number>> {
    const rows = await this.aql<{ payee: string | null; count: number }[]>(
      this.api
        .q('transactions')
        .filter({ payee: { $ne: null } })
        .groupBy('payee')
        .select(['payee', { count: { $count: '$id' } }]),
    );
    return new Map(rows.flatMap((r) => (r.payee ? [[r.payee, r.count] as const] : [])));
  }

  async getSchedules(): Promise<RawSchedule[]> {
    const schedules = await this.api.getSchedules();
    return schedules.map((s) => ({
      id: s.id,
      account: s.account ?? null,
      payee: s.payee ?? null,
      completed: s.completed === true,
      nextDate: s.next_date ?? null,
      amount: (s.amount as RawSchedule['amount']) ?? null,
      amountOp: s.amountOp,
      date: s.date,
      ruleId: s.rule ?? null,
      name: s.name ?? null,
      postsTransaction: s.posts_transaction,
    }));
  }

  async createSchedule(input: ScheduleInput): Promise<string> {
    this.assertWritable();
    return this.api.createSchedule({
      name: input.name,
      posts_transaction: input.postsTransaction,
      // Actual writes a payee condition from whatever it gets, so no payee is fixed up by the caller.
      payee: input.payee,
      account: input.account,
      amount: input.amount,
      amountOp: input.amountOp,
      date: input.date,
    } as unknown as Parameters<Api['createSchedule']>[0]);
  }

  async updateSchedule(id: string, patch: SchedulePatch): Promise<void> {
    this.assertWritable();
    if (Object.keys(patch).length === 0) return;
    const { postsTransaction, ...rest } = patch;
    const fields = {
      ...rest,
      ...(postsTransaction === undefined ? {} : { posts_transaction: postsTransaction }),
    };
    await this.api.updateSchedule(id, fields as Parameters<Api['updateSchedule']>[1]);
  }

  async deleteSchedule(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteSchedule(id);
  }

  async skipNextDate(id: string): Promise<void> {
    this.assertWritable();
    await this.internal('schedule/skip-next-date', { id });
  }

  async getTags(): Promise<RawTag[]> {
    const tags = await this.api.getTags();
    return tags.map((t) => ({
      id: t.id,
      tag: t.tag,
      color: t.color ?? null,
      description: t.description ?? null,
    }));
  }

  async createTag(tag: { tag: string; color?: string; description?: string }): Promise<void> {
    this.assertWritable();
    await this.api.createTag(tag);
  }

  async updateTag(
    id: string,
    fields: { color?: string | null; description?: string | null },
  ): Promise<void> {
    this.assertWritable();
    await this.api.updateTag(id, fields);
  }

  async renameTag(id: string, tag: string): Promise<void> {
    this.assertWritable();
    await this.internal('tags-rename', { id, tag });
  }

  async deleteTag(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteTag(id);
  }

  async discoverTags(): Promise<void> {
    this.assertWritable();
    await this.internal('tags-discover', {});
  }

  async deleteLocalBudget(localId: string): Promise<void> {
    // Only the local id: with a cloudFileId the handler would delete the server copy too.
    await this.internal('delete-budget', { id: localId });
  }

  private readonly missingHandlers = new Set<InternalHandler>();

  internalHandlerAvailable(name: InternalHandler): boolean {
    return !this.missingHandlers.has(name);
  }

  /** Calls an internal handler (03 §3); a missing one is remembered and reported as unavailable. */
  private async internal(name: InternalHandler, args: unknown): Promise<unknown> {
    if (!this.lib) throw new Error('The API is not initialized.');
    try {
      return await (this.lib.send as (n: string, a: unknown) => Promise<unknown>)(name, args);
    } catch (e) {
      if (!isMissingHandler(e)) throw e;
      this.missingHandlers.add(name);
      throw new RpcError('actual', `This version of Actual has no ${name} handler.`, {
        code: UNAVAILABLE_HANDLER,
      });
    }
  }

  async createBudget(name: string, fill: () => Promise<void>): Promise<BudgetFile | null> {
    // Our BudgetFile type: the API declares cloudFileId always present, but the new local entry lacks it.
    const before: BudgetFile[] = await this.api.getBudgets();
    const localIds = new Set(before.flatMap((b) => (b.id ? [b.id] : [])));
    const remoteIds = new Set(
      before.flatMap((b) => (b.state === 'remote' && b.cloudFileId ? [b.cloudFileId] : [])),
    );
    await this.api.runImport(name, fill);
    const after: BudgetFile[] = await this.api.getBudgets();
    const local = after.find((b) => b.id && !localIds.has(b.id));
    if (!local) return null;
    // Straight after the import the local entry may not list its cloudFileId yet (26.10.0), so the
    // server's new entry with this name identifies the upload.
    const remote = after.find(
      (b) =>
        b.state === 'remote' &&
        b.cloudFileId !== undefined &&
        !remoteIds.has(b.cloudFileId) &&
        (local.cloudFileId ? b.cloudFileId === local.cloudFileId : b.name === local.name),
    );
    const cloudFileId = local.cloudFileId ?? remote?.cloudFileId;
    return cloudFileId === undefined ? { ...local } : { ...local, cloudFileId };
  }

  async createCategoryGroup(name: string, isIncome = false): Promise<string> {
    this.assertWritable();
    return this.api.createCategoryGroup({ name, is_income: isIncome, hidden: false });
  }

  async createCategory(groupId: string, name: string, isIncome = false): Promise<string> {
    this.assertWritable();
    return this.api.createCategory({ name, group_id: groupId, is_income: isIncome, hidden: false });
  }

  async renameBudget(name: string): Promise<void> {
    this.assertWritable();
    await this.internal('save-prefs', { budgetName: name });
  }

  async makeEncryptionKey(password: string): Promise<void> {
    this.assertWritable();
    // key-make reports failure as a result, not a throw.
    const result = (await this.internal('key-make', { password })) as {
      error?: { reason?: string; message?: string };
    } | null;
    const error = result?.error;
    if (error) {
      const reason = error.reason ?? 'internal';
      throw Object.assign(new Error(error.message ?? `key-make failed: ${reason}`), { reason });
    }
  }

  async exportBudget(): Promise<Uint8Array> {
    return this.api.exportBudget();
  }

  async importBudget(
    data: Uint8Array,
    type: BudgetFileType,
    filename: string,
  ): Promise<BudgetFile | null> {
    const before: BudgetFile[] = await this.api.getBudgets();
    const remoteIds = new Set(
      before.flatMap((b) => (b.state === 'remote' && b.cloudFileId ? [b.cloudFileId] : [])),
    );
    const { id } = await this.api.importBudget(data, { type, filename });
    const after: BudgetFile[] = await this.api.getBudgets();
    const local = after.find((b) => b.id === id && b.state !== 'remote');
    if (!local) return null;
    // As after runImport, the local entry may not list its cloudFileId yet: the server's new entry with
    // this name identifies the upload.
    const remote = after.find(
      (b) =>
        b.state === 'remote' &&
        b.cloudFileId !== undefined &&
        !remoteIds.has(b.cloudFileId) &&
        (local.cloudFileId ? b.cloudFileId === local.cloudFileId : b.name === local.name),
    );
    // Without a server entry the import stayed on this computer: no cloudFileId (07 §3.4 step 3).
    const file = Object.fromEntries(
      Object.entries(local).filter(([key]) => key !== 'cloudFileId'),
    ) as BudgetFile;
    return remote?.cloudFileId === undefined ? file : { ...file, cloudFileId: remote.cloudFileId };
  }

  async getServerVersion(): Promise<string | null> {
    const result = await this.api.getServerVersion();
    return 'version' in result ? result.version : null;
  }

  async getNote(id: string): Promise<string | null> {
    const note = await this.api.getNote(id);
    return note?.note ?? null;
  }

  async updateNote(id: string, text: string): Promise<void> {
    this.assertWritable();
    await this.api.updateNote(id, text);
  }

  async createAccount(name: string, offbudget: boolean, initialBalance: number): Promise<string> {
    this.assertWritable();
    return this.api.createAccount({ name, offbudget, closed: false }, initialBalance);
  }

  async updateAccount(id: string, patch: AccountPatch): Promise<void> {
    this.assertWritable();
    const { sortOrder, lastReconciled, ...rest } = patch;
    // The API passes fields it doesn't type through to Actual's account update (04 §3).
    await this.api.updateAccount(id, {
      ...rest,
      ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
      ...(lastReconciled === undefined ? {} : { last_reconciled: lastReconciled }),
    });
  }

  async closeAccount(
    id: string,
    transferAccountId?: string,
    transferCategoryId?: string,
  ): Promise<void> {
    this.assertWritable();
    await this.api.closeAccount(id, transferAccountId, transferCategoryId);
  }

  async reopenAccount(id: string): Promise<void> {
    this.assertWritable();
    await this.api.reopenAccount(id);
  }

  async deleteAccount(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteAccount(id);
  }

  async addTransaction(accountId: string, t: NewTransaction): Promise<void> {
    await this.addTransactions(accountId, [t]);
  }

  async addTransactions(accountId: string, ts: readonly NewTransaction[]): Promise<void> {
    this.assertWritable();
    if (ts.length === 0) return;
    await this.api.addTransactions(
      accountId,
      ts.map(
        (t) =>
          ({
            id: t.id,
            date: t.date,
            amount: t.amount,
            ...(t.payee === undefined ? { payee_name: t.payeeName ?? '' } : { payee: t.payee }),
            category: t.category,
            notes: t.notes,
            cleared: t.cleared,
            reconciled: t.reconciled,
            ...(t.importedId ? { imported_id: t.importedId } : {}),
            ...(t.importedPayee ? { imported_payee: t.importedPayee } : {}),
            ...(t.schedule ? { schedule: t.schedule } : {}),
            ...(t.startingBalance ? { starting_balance_flag: true } : {}),
            ...(t.subtransactions ? { subtransactions: t.subtransactions.map(childFields) } : {}),
          }) as unknown as Parameters<Api['addTransactions']>[1][number],
      ),
      { runTransfers: true, learnCategories: false },
    );
  }

  async importTransactions(accountId: string, ts: readonly ImportInput[]): Promise<ImportResult> {
    this.assertWritable();
    if (ts.length === 0) return { added: [], updated: [], errors: [] };
    const result = await this.api.importTransactions(
      accountId,
      ts.map(
        (t) =>
          ({
            date: t.date,
            amount: t.amount,
            ...(t.payee ? { payee: t.payee } : t.payeeName ? { payee_name: t.payeeName } : {}),
            imported_payee: t.importedPayee,
            imported_id: t.importedId,
            notes: t.notes,
            category: t.category,
            ...(t.subtransactions ? { subtransactions: t.subtransactions } : {}),
          }) as unknown as Parameters<Api['importTransactions']>[1][number],
      ),
      {
        defaultCleared: true,
        dryRun: false,
        reimportDeleted: false,
        payeeNameNormalization: 'original',
      },
    );
    return {
      added: [...result.added],
      updated: [...result.updated],
      errors: result.errors.map((e) => e.message),
    };
  }

  async updateTransaction(id: string, patch: TransactionPatch): Promise<void> {
    this.assertWritable();
    if (await this.viaBatch(() => this.batchUpdate(id, patch))) return;
    await this.publicUpdate(id, patch);
  }

  async deleteTransaction(id: string): Promise<void> {
    this.assertWritable();
    if (await this.viaBatch(() => this.batchDelete(id))) return;
    await this.publicDelete(id);
  }

  async deleteTransactions(ids: readonly string[]): Promise<void> {
    this.assertWritable();
    if (ids.length === 0) return;
    const batched = await this.viaBatch(async () => {
      const rows = await this.getTransactionRows({ ids });
      if (rows.length === 0) return;
      await this.internal('transactions-batch-update', {
        added: [],
        updated: [],
        deleted: rows.map((r) => ({ id: r.id })),
        runTransfers: true,
      });
    });
    if (batched) return;
    for (const id of ids) await this.publicDelete(id);
  }

  /**
   * Runs a write through the internal `transactions-batch-update` (03 §3). Sent
   * through `send`, it runs in Actual's sequential write queue and resolves once everything is written,
   * transfer upkeep included. The public update/delete start the same batch without awaiting it and
   * outside that queue, so a later call could overlap its tail and never return. False when the handler
   * is missing: the caller then uses the public methods.
   */
  private async viaBatch(write: () => Promise<void>): Promise<boolean> {
    if (!this.internalHandlerAvailable('transactions-batch-update')) return false;
    try {
      await write();
      return true;
    } catch (e) {
      if (
        e instanceof RpcError &&
        (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER
      )
        return false;
      throw e;
    }
  }

  /**
   * The rows Actual's own update would change (its updateTransaction diff): the transaction, and a split's
   * lines, which take the parent's date, account and cleared state, and its payee unless they're transfers.
   * An empty `subtransactions` turns a split back into a normal transaction.
   */
  private async batchUpdate(id: string, patch: TransactionPatch): Promise<void> {
    const [before] = await this.getTransactionRows({ ids: [id] });
    if (!before) return;
    const { subtransactions, ...scalars } = patch;
    const lines =
      before.isParent || subtransactions ? await this.getTransactionRows({ parentIds: [id] }) : [];
    const inherited = {
      date: scalars.date ?? before.date,
      account: scalars.account ?? before.account,
      cleared: scalars.cleared ?? before.cleared,
      reconciled: scalars.reconciled ?? before.reconciled,
    };
    const parentPayee = scalars.payee === undefined ? before.payee : scalars.payee;
    const added: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const deleted: { id: string }[] = [];
    if (!subtransactions) {
      updated.push({ id, ...scalars });
      // A split's lines follow their parent (Actual's makeChild).
      for (const l of lines)
        updated.push({
          id: l.id,
          ...inherited,
          ...(l.payee === before.payee ? { payee: parentPayee } : {}),
        });
    } else if (subtransactions.length === 0) {
      updated.push({ id, ...scalars, is_parent: false });
      deleted.push(...lines.map((l) => ({ id: l.id })));
    } else {
      updated.push({ id, ...scalars, is_parent: true, category: null });
      const existing = new Map(lines.map((l) => [l.id, l]));
      subtransactions.forEach((sub, i) => {
        const fields = {
          ...inherited,
          amount: sub.amount,
          payee: sub.payee ?? parentPayee,
          category: sub.category,
          notes: sub.notes,
        };
        if (sub.id !== undefined && existing.has(sub.id)) {
          existing.delete(sub.id);
          updated.push({ id: sub.id, ...fields });
        } else {
          added.push({
            id: sub.id ?? crypto.randomUUID(),
            ...fields,
            is_child: true,
            parent_id: id,
            sort_order: -(i + 1),
          });
        }
      });
      deleted.push(...[...existing.keys()].map((lineId) => ({ id: lineId })));
    }
    await this.internal('transactions-batch-update', {
      added,
      updated,
      deleted,
      runTransfers: true,
    });
  }

  /** Deletes a row; a split's last line turns the parent back into a normal transaction (Actual's rule). */
  private async batchDelete(id: string): Promise<void> {
    const [before] = await this.getTransactionRows({ ids: [id] });
    if (!before) return;
    const updated: Record<string, unknown>[] = [];
    if (before.isChild && before.parentId) {
      const siblings = await this.getTransactionRows({ parentIds: [before.parentId] });
      if (siblings.length === 1) updated.push({ id: before.parentId, is_parent: false });
    }
    await this.internal('transactions-batch-update', {
      added: [],
      updated,
      deleted: [{ id }],
      runTransfers: true,
    });
  }

  /** The public `updateTransaction`, settled by polling (03 §3): the fallback without the batch handler. */
  private async publicUpdate(id: string, patch: TransactionPatch): Promise<void> {
    if (patch.subtransactions?.length === 0) {
      // An empty array would leave a parent with no lines: delete them one by one instead.
      for (const l of await this.getTransactionRows({ parentIds: [id] }))
        await this.publicDelete(l.id);
      const rest = { ...patch };
      delete rest.subtransactions;
      if (Object.keys(rest).length > 0) await this.publicUpdate(id, rest);
      return;
    }
    const [before] = await this.getTransactionRows({ ids: [id] });
    const { subtransactions, ...scalars } = patch;
    const beforeLines = subtransactions ? await this.getTransactionRows({ parentIds: [id] }) : [];
    await this.api.updateTransaction(id, {
      ...scalars,
      ...(subtransactions ? { subtransactions: subtransactions.map(childFields) } : {}),
    } as Parameters<Api['updateTransaction']>[1]);
    // updateTransaction may resolve before its write lands: wait until the fields read back. One
    // update lands as one batch, so a category Actual rewrites itself is only checked when it's alone.
    // Actual keeps transfers in step in a second batch after that, so wait for it too: a later write
    // racing it would see half-updated rows.
    const fields = Object.keys(scalars) as (keyof typeof scalars)[];
    const checked = fields.length > 1 ? fields.filter((f) => f !== 'category') : fields;
    await this.settle(async () => {
      const [row] = await this.getTransactionRows({ ids: [id] });
      if (!row) return false;
      for (const f of checked) {
        const want = scalars[f];
        const have = row[f];
        if (f === 'notes' ? (have ?? '') !== (want ?? '') : have !== want) return false;
      }
      if (subtransactions) {
        const lines = await this.getTransactionRows({ parentIds: [id] });
        if (lines.length !== subtransactions.length) return false;
        if (!subtransactions.every((l) => l.id === undefined || lines.some((x) => x.id === l.id)))
          return false;
        if (amountsKey(lines) !== amountsKey(subtransactions)) return false;
        // Transfer lines have their mirrors; dropped transfer lines' mirrors are gone or unlinked.
        const transferLines = subtransactions.filter((l) => l.payee !== null).length;
        if (lines.filter((l) => l.transferId).length < transferLines) return false;
        for (const l of lines) if (l.transferId && !(await this.mirrors(l))) return false;
        const kept = new Set(lines.map((l) => l.id));
        for (const gone of beforeLines.filter((l) => l.transferId && !kept.has(l.id)))
          if (!(await this.detached(gone.transferId ?? '', gone.id))) return false;
      }
      return this.transferSettled(row, before ?? null);
    });
  }

  /** The public `deleteTransaction`, settled by polling (03 §3): the fallback without the batch handler. */
  private async publicDelete(id: string): Promise<void> {
    const [before] = await this.getTransactionRows({ ids: [id] });
    if (!before) return;
    const lines = before.isParent ? await this.getTransactionRows({ parentIds: [id] }) : [];
    await this.api.deleteTransaction(id);
    // deleteTransaction resolves before its write lands: wait until the row (and a split's lines)
    // is gone, and every transfer counterpart is gone or unlinked (04 §3), which Actual does afterwards.
    await this.settle(async () => {
      const ids = [id, ...lines.map((l) => l.id)];
      if ((await this.getTransactionRows({ ids })).length > 0) return false;
      for (const r of [before, ...lines])
        if (r.transferId && !(await this.detached(r.transferId, r.id))) return false;
      return true;
    });
  }

  async mergeTransactions(a: string, b: string): Promise<string> {
    this.assertWritable();
    const kept = await this.api.mergeTransactions([a, b]);
    const gone = kept === a ? b : a;
    await this.settle(async () => (await this.getTransactionRows({ ids: [gone] })).length === 0);
    return kept;
  }

  /** A row's transfer counterpart exists and shows the propagated amount. */
  private async mirrors(row: RawRow): Promise<boolean> {
    const [other] = await this.getTransactionRows({ ids: [row.transferId ?? ''] });
    return other !== undefined && other.amount === -row.amount;
  }

  /** The former counterpart of `fromId` is gone, or no longer points back to it. */
  private async detached(otherId: string, fromId: string): Promise<boolean> {
    const [other] = await this.getTransactionRows({ ids: [otherId] });
    return other === undefined || other.transferId !== fromId;
  }

  /** A transfer's other side shows the propagated amount, or a dropped transfer's mirror is gone. */
  private async transferSettled(row: RawRow, before: RawRow | null): Promise<boolean> {
    if (row.transferId) return this.mirrors(row);
    if (before?.transferId) return this.detached(before.transferId, before.id);
    return true;
  }

  /** Polls `done` every 10 ms for up to 3 s (03 §3). */
  private async settle(done: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      if (await done()) return;
      if (Date.now() > deadline)
        throw new RpcError('timeout', 'The transaction change did not land in time.');
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  }

  async getTransactionRows(filter: {
    ids?: readonly string[];
    parentIds?: readonly string[];
  }): Promise<RawRow[]> {
    const field = filter.ids ? 'id' : 'parent_id';
    const values = [...(filter.ids ?? filter.parentIds ?? [])];
    const out: RawRow[] = [];
    // `$oneof` in chunks keeps each SQL statement small.
    for (let i = 0; i < values.length; i += ROW_CHUNK) {
      const rows = await this.aql<RowFields[]>(
        this.api
          .q('transactions')
          .filter({ [field]: { $oneof: values.slice(i, i + ROW_CHUNK) } })
          .select([...ROW_FIELDS])
          .options({ splits: 'all' }),
      );
      out.push(...rows.map(toRow));
    }
    return out;
  }

  async lastTransactionForPayee(payeeId: string): Promise<RawRow | null> {
    const [row] = await this.aql<RowFields[]>(
      this.api
        .q('transactions')
        .filter({ payee: payeeId, is_parent: false, is_child: false })
        .orderBy([{ date: 'desc' }, { sort_order: 'desc' }])
        .limit(1)
        .select([...ROW_FIELDS])
        .options({ splits: 'all' }),
    );
    return row ? toRow(row) : null;
  }

  async linkedTransactions(scheduleId: string): Promise<RawRow[]> {
    const rows = await this.aql<RowFields[]>(
      this.api
        .q('transactions')
        .filter({ schedule: scheduleId, is_child: false })
        .orderBy([{ date: 'desc' }, { sort_order: 'desc' }])
        .select([...ROW_FIELDS])
        .options({ splits: 'all' }),
    );
    return rows.map(toRow);
  }

  async scheduleMatches(conditions: readonly RawRuleCondition[], limit: number): Promise<RawRow[]> {
    const { filters } = (await this.internal('make-filters-from-conditions', {
      conditions,
    })) as { filters: unknown[] };
    const rows = await this.aql<RowFields[]>(
      this.api
        .q('transactions')
        .filter({ $and: [...filters, { schedule: null }, { is_child: false }] })
        .orderBy([{ date: 'desc' }, { sort_order: 'desc' }])
        .limit(limit)
        .select([...ROW_FIELDS])
        .options({ splits: 'all' }),
    );
    return rows.map(toRow);
  }

  async ruleMatches(
    conditions: readonly RawRuleCondition[],
    conditionsOp: 'and' | 'or',
    limit: number,
  ): Promise<RawRow[]> {
    const { filters } = (await this.internal('make-filters-from-conditions', {
      conditions,
    })) as { filters: unknown[] };
    const rows = await this.aql<RowFields[]>(
      this.api
        .q('transactions')
        .filter({ [conditionsOp === 'or' ? '$or' : '$and']: filters })
        .orderBy([{ date: 'desc' }, { sort_order: 'desc' }])
        .limit(limit)
        .select([...ROW_FIELDS])
        .options({ splits: 'inline' }),
    );
    return rows.map(toRow);
  }

  async applyRuleActions(ids: readonly string[], actions: readonly RawRuleAction[]): Promise<void> {
    this.assertWritable();
    if (ids.length === 0) return;
    // Actual's rule editor passes whole rows (`select('*')`), so the handler sees every field.
    const transactions = await this.aql<unknown[]>(
      this.api
        .q('transactions')
        .filter({ id: { $oneof: [...ids] } })
        .select('*')
        .options({ splits: 'inline' }),
    );
    const result = await this.internal('rule-apply-actions', { transactions, actions });
    if (result === null)
      throw new RpcError('validation', 'Actual could not read the rule actions.', {
        code: 'invalid-action',
      });
  }

  async createPayee(name: string): Promise<string> {
    this.assertWritable();
    return this.api.createPayee({ name });
  }

  async updatePayee(id: string, patch: { name: string }): Promise<void> {
    this.assertWritable();
    await this.api.updatePayee(id, patch);
  }

  async mergePayees(targetId: string, ids: readonly string[]): Promise<void> {
    this.assertWritable();
    await this.api.mergePayees(targetId, [...ids]);
  }

  async deletePayee(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deletePayee(id);
  }

  async createRule(rule: RuleInput): Promise<string> {
    this.assertWritable();
    const created = await this.api.createRule(rule as Parameters<Api['createRule']>[0]);
    return created.id;
  }

  async updateRule(rule: RawRule): Promise<void> {
    this.assertWritable();
    await this.api.updateRule(rule as Parameters<Api['updateRule']>[0]);
  }

  async deleteRule(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteRule(id);
  }

  async getBudgetMonths(): Promise<string[]> {
    return this.api.getBudgetMonths();
  }

  async setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
    this.assertWritable();
    await this.api.setBudgetCarryover(month, categoryId, flag);
  }

  async getBudgetMonth(month: string): Promise<RawBudgetMonth> {
    try {
      return (await this.api.getBudgetMonth(month)) as unknown as RawBudgetMonth;
    } catch (e) {
      // Actual throws a plain `{ type: 'APIError', message }` here.
      const message = (e as { message?: unknown } | null)?.message;
      throw new RpcError('validation', typeof message === 'string' ? message : String(e));
    }
  }

  async setBudgetAmount(month: string, categoryId: string, amount: number): Promise<void> {
    this.assertWritable();
    await this.api.setBudgetAmount(month, categoryId, amount);
  }

  async batchBudgetUpdates(fn: () => Promise<void>): Promise<void> {
    this.assertWritable();
    await this.api.batchBudgetUpdates(fn);
  }

  async holdBudgetForNextMonth(month: string, amount: number): Promise<boolean> {
    this.assertWritable();
    return this.api.holdBudgetForNextMonth(month, amount);
  }

  async resetBudgetHold(month: string): Promise<void> {
    this.assertWritable();
    await this.api.resetBudgetHold(month);
  }

  async deleteCategory(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteCategory(id);
  }

  async deleteCategoryGroup(id: string): Promise<void> {
    this.assertWritable();
    await this.api.deleteCategoryGroup(id);
  }

  /** `date` in a month, as ActualQL filters it (04 §6). */
  private inMonth(month: string): Record<string, unknown> {
    return { date: { $transform: '$month', $eq: month } };
  }

  async categoryCountsInMonth(month: string): Promise<Map<string, number>> {
    const rows = await this.aql<{ category: string | null; count: number }[]>(
      this.api
        .q('transactions')
        .filter({ 'account.offbudget': false, category: { $ne: null }, ...this.inMonth(month) })
        .groupBy('category')
        .select(['category', { count: { $count: '$id' } }]),
    );
    return new Map(rows.flatMap((r) => (r.category ? [[r.category, r.count] as const] : [])));
  }

  /** The Uncategorized row's filter (04 §6). */
  private readonly uncategorizedFilter = {
    'account.offbudget': false,
    category: null,
    $or: [{ 'payee.transfer_acct': null }, { 'payee.transfer_acct.offbudget': true }],
  };

  async uncategorizedSummary(month: string | null): Promise<{ count: number; total: number }> {
    const filter = { ...this.uncategorizedFilter, ...(month === null ? {} : this.inMonth(month)) };
    const count = await this.aql<number>(
      this.api.q('transactions').filter(filter).calculate({ $count: '$id' }),
    );
    if (month === null || count === 0) return { count, total: 0 };
    const total = await this.aql<number | null>(
      this.api.q('transactions').filter(filter).calculate({ $sum: '$amount' }),
    );
    return { count, total: total ?? 0 };
  }

  async monthRows(
    month: string,
    filter: { categoryIds: readonly string[] } | 'uncategorized',
  ): Promise<RawRow[]> {
    if (filter !== 'uncategorized' && filter.categoryIds.length === 0) return [];
    const where =
      filter === 'uncategorized'
        ? this.uncategorizedFilter
        : { 'account.offbudget': false, category: { $oneof: [...filter.categoryIds] } };
    const rows = await this.aql<RowFields[]>(
      this.api
        .q('transactions')
        .filter({ ...where, ...this.inMonth(month) })
        .select([...ROW_FIELDS])
        .options({ splits: 'inline' }),
    );
    return rows.map(toRow);
  }

  async reportSides(): Promise<RawReportSide[]> {
    // Grouped, so a split's lines come in their order under the parent that lends them its payee.
    type Row = {
      id: string;
      account: string;
      date: string;
      amount: number;
      payee: string | null;
      category: string | null;
      starting_balance_flag: boolean | null;
      subtransactions?: Row[];
    };
    const rows = await this.aql<Row[]>(
      this.api
        .q('transactions')
        .select(['id', 'account', 'date', 'amount', 'payee', 'category', 'starting_balance_flag'])
        .options({ splits: 'grouped' }),
    );
    return rows.flatMap((t): RawReportSide[] => {
      const lines = t.subtransactions ?? [];
      const own = (r: Row, line: number): RawReportSide => ({
        id: r.id,
        transactionId: t.id,
        line,
        account: r.account,
        date: r.date,
        amount: r.amount,
        payee: r.payee ?? t.payee,
        category: r.category,
        startingBalance: t.starting_balance_flag === true,
      });
      return lines.length > 0 ? lines.map(own) : [own(t, 0)];
    });
  }

  async categoryUsage(categoryIds: readonly string[]): Promise<{ count: number; total: number }> {
    if (categoryIds.length === 0) return { count: 0, total: 0 };
    const filter = { category: { $oneof: [...categoryIds] } };
    const count = await this.aql<number>(
      this.api.q('transactions').filter(filter).calculate({ $count: '$id' }),
    );
    const total = await this.aql<number | null>(
      this.api.q('transactions').filter(filter).calculate({ $sum: '$amount' }),
    );
    return { count, total: total ?? 0 };
  }

  async getUpcomingDates(config: unknown, count: number): Promise<string[]> {
    return (await this.internal('schedule/get-upcoming-dates', { config, count })) as string[];
  }

  async updateCategory(
    id: string,
    patch: { name: string; hidden?: boolean; groupId?: string },
  ): Promise<void> {
    this.assertWritable();
    const { groupId, ...rest } = patch;
    await this.api.updateCategory(id, {
      ...rest,
      ...(groupId === undefined ? {} : { group_id: groupId }),
    });
  }

  async updateCategoryGroup(id: string, patch: { name: string; hidden?: boolean }): Promise<void> {
    this.assertWritable();
    await this.api.updateCategoryGroup(id, patch);
  }

  async moveCategoryGroup(id: string, targetId: string | null): Promise<void> {
    this.assertWritable();
    await this.internal('category-group-move', { id, targetId });
  }

  async moveCategory(id: string, groupId: string, targetId: string | null): Promise<void> {
    this.assertWritable();
    await this.internal('category-move', { id, groupId, targetId });
  }

  onSync(handler: (event: SyncEvent) => void): void {
    this.listeners.add(handler);
  }

  setOfflineFallback(on: boolean): void {
    this.offlineFallback = on;
  }

  private assertWritable(): void {
    if (this.offlineFallback && !this.opts.localTestBudget) {
      throw new RpcError('offline', 'Writes are blocked while the budget is open offline.');
    }
  }
}
