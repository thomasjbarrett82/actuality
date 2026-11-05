// The renderer↔host method map, `HostApi` (02 §4, 03 §8). Names are normative. Params are validated with
// these zod schemas in the host; results are typed here.
import { z } from 'zod';
import type { WeekDay } from '../budget-format';
import type { ConnectionInfo, Diagnosis, OpenBudgetInfo } from '../connection';
import { DATE_FORMATS } from '../dates';
import { ACCOUNT_GROUPS } from '../domain/accounts';
import type { Rule, RuleMatch } from '../domain/rules';
import type {
  Account,
  BudgetMonthView,
  CategoryGroup,
  Id,
  ISODate,
  Money,
  Month,
  Payee,
  RenameCondition,
  Schedule,
  ScheduleDraft,
  ScheduleMatch,
  TagEntity,
  Transaction,
} from '../domain/types';
import type { BankFormat, ParsedAccount } from '../import/import-rules';
import { NUMBER_FORMATS } from '../money';
import type { QuickBudgetStats } from '../quickbudget/quickbudget';
import { reportRequestSchema } from '../reporting/model';
import type { ReportResult } from '../reporting/result';
import type { RpcErrorData } from './protocol';

const empty = z.object({}).strict();
const serverURL = z.url({ protocol: /^https?$/ });
/** Proceed although unsynced changes would be lost: the user confirmed the 03 §5.4 dialog. */
const force = z.object({ force: z.boolean() }).strict();

/** The synced prefs the app writes (04 §3). `budgetType` is read-only in this app. */
export const SYNCED_PREF_KEYS = [
  'defaultCurrencyCode',
  'numberFormat',
  'hideFraction',
  'dateFormat',
  'currencySymbolPosition',
  'currencySpaceBetweenAmountAndSymbol',
  'firstDayOfWeekIdx',
] as const;
export type SyncedPrefKey = (typeof SYNCED_PREF_KEYS)[number];

/** Budget Setup's format fields (07 §4). `currency` is an ISO code, or '' for no currency. */
const budgetFormats = z
  .object({
    currency: z.union([z.literal(''), z.string().regex(/^[A-Z]{3}$/)]),
    numberFormat: z.enum(NUMBER_FORMATS),
    dateFormat: z.enum(DATE_FORMATS),
    hideFraction: z.boolean(),
  })
  .strict();
export type BudgetFormats = z.infer<typeof budgetFormats>;

/**
 * A starting template (07 §4.1), with the names already in the UI language: they're written into the
 * budget as the user's data (20 §3.8). `incomeCategory` is used only if the income group is ever empty.
 */
const budgetTemplate = z
  .object({
    groups: z
      .array(z.object({ name: z.string().min(1), categories: z.array(z.string().min(1)) }).strict())
      .max(50),
    incomeCategory: z.string().min(1),
  })
  .strict();
export type BudgetTemplate = z.infer<typeof budgetTemplate>;

/** Budget Properties (07 §4). */
export interface BudgetProperties extends BudgetFormats {
  name: string;
  /** The `save-prefs` handler exists (03 §3); otherwise the name is read-only. */
  renameAvailable: boolean;
  /** Owned by another user on a multi-user server: the name is read-only (03 §7.1). */
  shared: boolean;
  /** `firstDayOfWeekIdx`, or null when unset: the UI locale's week start applies (07 §4). */
  firstDayOfWeek: WeekDay | null;
  /** End-to-end encryption, from the server's `hasKey`; unknown when the server can't be read (07 §4). */
  encryption: 'enabled' | 'disabled' | 'unknown';
  /** The `key-make` handler exists (03 §7); otherwise encryption can't be enabled or its key replaced. */
  encryptionKeyAvailable: boolean;
}

/** `budgetFile.setEncryptionKey` succeeded (03 §7), with what secure storage couldn't do. */
export interface EncryptionKeyResult {
  /** Remember was ticked, but the password couldn't be saved. */
  rememberFailed: boolean;
  /** Remember wasn't ticked, and a remembered password for the old key couldn't be deleted. */
  forgetFailed: boolean;
}

const id = z.string().min(1);
const money = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Text the host writes into the budget, already in the UI language (20 §3.8): the adjustment's notes. */
const reconcileTexts = z.object({ adjustmentNotes: z.string() }).strict();
export type ReconcileTexts = z.infer<typeof reconcileTexts>;

const ids = z.array(id).min(1).max(100_000);
/** A rule condition or action (23 §1): Actual validates the values; unknown keys are kept. */
const ruleCondition = z.looseObject({ field: z.string().min(1), op: z.string().min(1) });
const ruleAction = z.looseObject({ op: z.string().min(1), field: z.string().optional() });
/** A tag name without the `#`: no whitespace, no `#` (04 §5.2). */
const tagName = z
  .string()
  .min(1)
  .regex(/^[^\s#]+$/);
/** The only color form the app writes (04 §5.2). */
const tagColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/**
 * A transaction's payee in a commit (11 §6 step 6): none, an existing payee, a new name (the host creates
 * it), or a transfer to an account (its transfer payee).
 */
const payeeRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('existing'), id }).strict(),
  z.object({ kind: z.literal('new'), name: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('transfer'), accountId: id }).strict(),
]);
export type PayeeRef = z.infer<typeof payeeRef>;

/** A split line in a commit: existing lines keep their id (04 §3). */
const splitLine = z
  .object({
    id: id.optional(),
    amount: money,
    transferAccountId: id.nullable(),
    categoryId: id.nullable(),
    notes: z.string(),
  })
  .strict();

/** The edit the commit pipeline writes (11 §6), after the renderer's dialogs. */
const commitEdit = z
  .object({
    /** Absent for a new transaction. */
    id: id.optional(),
    accountId: id,
    date: isoDate,
    amount: money,
    payee: payeeRef,
    categoryId: id.nullable(),
    notes: z.string(),
    checkNumber: z.string().nullable(),
    needsReview: z.boolean(),
    cleared: z.enum(['U', 'C', 'R']),
    /** Present for a split; the amounts must add up to `amount` (04 §9). */
    lines: z.array(splitLine).min(1).optional(),
    /** The user confirmed a change to a transfer whose other side is reconciled: it becomes Cleared. */
    clearOtherSide: z.boolean().optional(),
  })
  .strict();
export type CommitEdit = z.infer<typeof commitEdit>;

/** `transactions.commit`'s result (11 §6). */
export interface CommitResult {
  id: Id;
  /** Actual's rules linked the new transaction to this schedule (12 §2): the editor's notifier. */
  matched: { scheduleId: Id; payeeId: Id | null } | null;
}

/** Actual's recurrence config (12 §1, §3.1). Fields the app doesn't know pass through and are kept. */
const recurConfig = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).optional(),
    start: isoDate,
    endMode: z.enum(['never', 'after_n_occurrences', 'on_date']).optional(),
    endOccurrences: z.number().int().min(1).optional(),
    endDate: isoDate.optional(),
    patterns: z
      .array(z.object({ type: z.string().min(1), value: z.number().int() }).loose())
      .max(100)
      .optional(),
    skipWeekend: z.boolean().optional(),
    weekendSolveMode: z.enum(['before', 'after']).optional(),
  })
  .loose();

/** A schedule's date: a plain date (Once) or a RecurConfig (12 §1). */
const scheduleDate = z.union([isoDate, recurConfig]);
const amountOp = z.enum(['is', 'isapprox', 'isbetween']);

/** The Schedule dialog's save (12 §3.1). */
const scheduleEdit = z
  .object({
    /** Absent for a new schedule. */
    id: id.optional(),
    /** Empty for no name. */
    name: z.string().max(200),
    accountId: id,
    date: scheduleDate,
    payee: payeeRef,
    categoryId: id.nullable(),
    notes: z.string(),
    amountOp,
    /** `num1` for isbetween. */
    amount: money,
    /** isbetween only: `num2`. */
    amount2: money.optional(),
    postsTransaction: z.boolean(),
    /** Present for a split; the amounts must add up to `amount` (04 §9). */
    lines: z.array(splitLine).min(1).optional(),
    /** Transactions to link to the schedule, and to unlink from it. */
    link: z.array(id).max(1000).optional(),
    unlink: z.array(id).max(1000).optional(),
    /** Move to scheduler… (12 §4): the transaction to delete once the schedule is written. */
    moveFrom: id.optional(),
  })
  .strict();
export type ScheduleEdit = z.infer<typeof scheduleEdit>;

/** Find matching transactions (12 §3.1): the dialog's unsaved payee, account, amount and date. */
const scheduleMatchQuery = z
  .object({
    accountId: id,
    payee: payeeRef,
    date: scheduleDate,
    amountOp,
    amount: money,
    amount2: money.optional(),
  })
  .strict();
export type ScheduleMatchQuery = z.infer<typeof scheduleMatchQuery>;

/** One file account's choices in the import dialogs (16 §1.4). `accountId` null skips it. */
const importRunAccount = z
  .object({
    index: z.number().int().min(0),
    accountId: id.nullable(),
    importNotes: z.boolean(),
    swapPayeeNotes: z.boolean(),
    /** QIF/CSV: the chosen date order; null for OFX. */
    dateOrder: z.enum(['MDY', 'DMY', 'YMD']).nullable(),
    includeBeforeStart: z.boolean(),
  })
  .strict();
export type ImportRunAccount = z.infer<typeof importRunAccount>;

/**
 * Text the import writes or reads, in the UI language (20 §3.8): the transfer prefixes ("Transfer :" and
 * its English form) and the plain payee for a transfer to an unknown account, with `{account}`.
 */
const importTexts = z
  .object({
    transferPrefixes: z.array(z.string().min(1)).min(1).max(4),
    plainTransfer: z.string().includes('{account}'),
  })
  .strict();
export type ImportTexts = z.infer<typeof importTexts>;

/** An Export choice (16 §2.1): the files go into `folder`, named with the budget and `timestamp`. */
const exportRequest = z
  .object({
    kind: z.enum(['csv', 'qif', 'budgetCsv']),
    folder: z.string().min(1),
    budgetName: z.string(),
    /** `YYYY-MM-DD HHmm`, in the user's clock. */
    timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{4}$/),
    /** "Export current register view only": the view's account (or 'all'), name and transactions. */
    view: z
      .object({
        accountId: z.union([z.literal('all'), id]),
        name: z.string(),
        ids: z.array(id).max(200_000),
      })
      .strict()
      .nullable(),
    overwrite: z.boolean(),
  })
  .strict();
export type ExportRequest = z.infer<typeof exportRequest>;

export interface ExportResult {
  folder: string;
  /** The file names written. */
  files: string[];
}

/** Import a budget file (07 §3.4): Actual's `importBudget` types. `ynab5` is an nYNAB export (.json). */
export const BUDGET_FILE_TYPES = ['actual', 'ynab4', 'ynab5'] as const;
export type BudgetFileType = (typeof BUDGET_FILE_TYPES)[number];

/** Wipe the Slate Clean (18 §2): the texts the job writes, in the UI language. */
const slateWipeTexts = z
  .object({
    /** The Starting Balance transactions' payee. */
    startingBalancePayee: z.string().min(1),
  })
  .strict();

/** What a slate wipe would erase (18 §2 confirm step). */
export interface SlateWipeImpact {
  /** Transactions to delete: split lines and the two sides of a transfer each count once. */
  transactions: number;
  /** The first month with data: the cutoff combo lists the months from the current one back to it. */
  firstMonth: Month | null;
}

export interface SlateWipeResult {
  backupPath: string;
  deleted: number;
}

/** A remembered mapping (16 §1.4, `ad:import-mappings`). */
export interface ImportMappingInfo {
  accountId: Id | null;
  importNotes: boolean;
  swapPayeeNotes: boolean;
  dateOrder?: 'MDY' | 'DMY' | 'YMD';
}

/** `import.parse` (16 §1.3). */
export interface ImportParse {
  /** Names the parsed file for `import.run`. */
  token: string;
  fileName: string;
  format: BankFormat;
  accounts: ParsedAccount[];
  emptyAccounts: number;
  /** OFX: unreadable transactions in the accounts dropped for having none that could be read. */
  unreadable?: number;
  /** Remembered mappings by key. */
  mappings: Record<string, ImportMappingInfo>;
  /** Each open account's start date (16 §1.4), null without transactions. */
  startDates: Record<Id, ISODate | null>;
}

/** One file account's outcome (16 §1.6). */
export interface ImportAccountResult {
  index: number;
  accountId: Id | null;
  status: 'imported' | 'skipped' | 'failed';
  error?: string;
  added: number;
  updated: number;
  ignored: number;
  startAdjusted: boolean;
}

export const hostMethods = {
  'session.state': { params: empty },
  'session.connect': {
    params: z
      .object({
        serverURL,
        /** Omitted on later starts: the stored session token is used (03 §6.1). */
        password: z.string().min(1).optional(),
        remember: z.boolean(),
        /** Sign in as a different user although the open budget has unsynced changes (03 §7.1). */
        force: z.boolean().optional(),
      })
      .strict(),
  },
  'session.probeLogin': { params: z.object({ serverURL }).strict() },
  'session.connectOpenId': {
    params: z.object({ serverURL, remember: z.boolean(), force: z.boolean().optional() }).strict(),
  },
  'session.cancelOpenId': { params: empty },
  'session.serverVersion': { params: empty },
  'session.setStaySignedIn': { params: z.object({ on: z.boolean() }).strict() },
  'session.clearCache': { params: force },
  'session.signOut': { params: force },
  'session.forgetServer': { params: force },
  'session.listBudgets': { params: empty },
  'session.openBudget': {
    params: z
      .object({
        cloudFileId: z.string().min(1),
        e2ePassword: z.string().min(1).optional(),
        remember: z.boolean().optional(),
      })
      .strict(),
  },
  'session.closeBudget': { params: force },
  'session.syncNow': { params: empty },
  'session.retryConnection': { params: empty },
  /** Cancel on the sign-in modal (03 §4 AuthRequired → Cancel). */
  'session.cancelSignIn': { params: empty },
  'budgetFile.create': {
    params: z
      .object({
        name: z.string(),
        template: budgetTemplate,
        formats: budgetFormats,
        /** Close the open budget although its unsynced changes would stay behind (03 §5.4). */
        force: z.boolean().optional(),
      })
      .strict(),
  },
  'budgetFile.properties': { params: empty },
  /** File ▸ Export Budget Backup… (07 §6): the host writes Actual's export zip to `path`. */
  'budgetFile.exportBackup': { params: z.object({ path: z.string().min(1) }).strict() },
  /**
   * Import a budget file (07 §3.4): uploads it as a new server budget and opens it. `path` is a file, or a
   * YNAB 4 budget folder (`.ynab4`). `importedSuffix` ("(imported {date})") renames an import whose name
   * another server budget already has.
   */
  'budgetFile.importFile': {
    params: z
      .object({
        path: z.string().min(1),
        type: z.enum(BUDGET_FILE_TYPES),
        importedSuffix: z.string().min(1),
        force: z.boolean().optional(),
      })
      .strict(),
  },
  'budgetFile.updateProperties': {
    params: budgetFormats
      .partial()
      .extend({
        name: z.string().optional(),
        firstDayOfWeek: z.number().int().min(0).max(6).optional(),
      })
      .strict(),
  },
  /**
   * Enables end-to-end encryption on the open budget, or replaces its key (03 §7, 07 §4). Resets sync:
   * this copy becomes the server's source of truth.
   */
  'budgetFile.setEncryptionKey': {
    params: z.object({ password: z.string().min(1), remember: z.boolean() }).strict(),
  },
  'prefs.synced': { params: empty },
  'prefs.setSynced': {
    params: z.object({ key: z.enum(SYNCED_PREF_KEYS), value: z.string() }).strict(),
  },
  'notes.get': { params: z.object({ id: z.string().min(1) }).strict() },
  'notes.set': { params: z.object({ id: z.string().min(1), text: z.string() }).strict() },
  'accounts.list': { params: empty },
  /** Create Account (13 §2): `balance` is signed as typed; Actual adds the starting balance. */
  'accounts.create': {
    params: z.object({ name: z.string(), onBudget: z.boolean(), balance: money }).strict(),
  },
  /** The account header's Rename and Notes (13 §3): only the field that changed. */
  'accounts.update': {
    params: z.object({ id, name: z.string().optional(), note: z.string().optional() }).strict(),
  },
  'accounts.close': {
    params: z
      .object({ id, transferAccountId: id.optional(), transferCategoryId: id.optional() })
      .strict(),
  },
  'accounts.reopen': { params: z.object({ id }).strict() },
  'accounts.delete': { params: z.object({ id }).strict() },
  /** A sidebar drop or its keyboard equivalent (08 §4, 22 §2.4): a move within the account's own group. */
  'accounts.reorder': {
    params: z.object({ id, beforeId: id.nullable(), group: z.enum(ACCOUNT_GROUPS) }).strict(),
  },
  'categories.tree': { params: empty },
  'payees.list': { params: empty },
  'transactions.list': {
    params: z.object({ accountId: z.union([z.literal('all'), z.string().min(1)]) }).strict(),
  },
  'transactions.get': { params: z.object({ id }).strict() },
  'transactions.commit': { params: commitEdit },
  /** Mark as Cleared / Uncleared (10 §6.1, §6.4): reconciled rows are skipped; Cleared also approves. */
  'transactions.setCleared': {
    params: z.object({ ids, state: z.enum(['U', 'C']) }).strict(),
  },
  'transactions.approve': { params: z.object({ ids }).strict() },
  /** Tag entities (04 §5.2). A tag name has no whitespace or `#`; `needs-review` can't be renamed or deleted. */
  'tags.list': { params: z.object({}).strict() },
  'tags.create': {
    params: z
      .object({ tag: tagName, color: tagColor.optional(), description: z.string().optional() })
      .strict(),
  },
  'tags.update': {
    params: z
      .object({
        id,
        tag: tagName.optional(),
        color: tagColor.nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .strict(),
  },
  'tags.delete': { params: z.object({ id }).strict() },
  'tags.discover': { params: z.object({}).strict() },
  /** Categorize As (10 §6.1) and the error popovers (10 §6.3). Ids may be split lines. */
  'transactions.categorize': {
    params: z.object({ ids, categoryId: id.nullable() }).strict(),
  },
  'transactions.delete': { params: z.object({ ids }).strict() },
  'transactions.undo': { params: z.object({ token: z.string().min(1) }).strict() },
  'transactions.moveToAccount': { params: z.object({ ids, accountId: id }).strict() },
  /**
   * Change Date… (10 §6.1, X25): one date on every transaction; split lines count as their parent.
   * `clearReconciled`: reconciled transactions or other sides of their transfers that become Cleared.
   */
  'transactions.setDate': {
    params: z
      .object({ ids, date: isoDate, clearReconciled: z.array(id).max(100_000).optional() })
      .strict(),
  },
  'transactions.merge': { params: z.object({ a: id, b: id }).strict() },
  'transactions.lastForPayee': { params: z.object({ payeeId: id }).strict() },
  'transactions.nextCheckNumber': { params: z.object({ accountId: id }).strict() },
  /**
   * Rename or merge a payee (14 §3). With `transferAccountId` the new name is "Transfer : {account}":
   * its transactions become transfers. `categoryId`: also categorize its uncategorized transactions and
   * set the result's auto-category rule (11 §8 "Rename and categorize").
   */
  'payees.rename': {
    params: z
      .object({
        id,
        name: z.string(),
        transferAccountId: id.optional(),
        categoryId: id.optional(),
      })
      .strict(),
  },
  /** How many transactions a rename touches (14 §3.1, 11 §8). `excludeId`: the one being edited. */
  'payees.renameImpact': {
    params: z.object({ id, transferAccountId: id.optional(), excludeId: id.optional() }).strict(),
  },
  'payees.combine': { params: z.object({ ids, name: z.string().trim().min(1) }).strict() },
  'payees.setEnabled': { params: z.object({ ids, enabled: z.boolean() }).strict() },
  'payees.rules': { params: z.object({ id }).strict() },
  'payees.setRenameRules': {
    params: z
      .object({
        id,
        conditions: z.array(
          z
            .object({
              op: z.enum(['contains', 'is', 'startsWith', 'endsWith']),
              value: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  'payees.applyRenameRules': { params: z.object({ id, dryRun: z.boolean() }).strict() },
  'payees.setAutoCategory': { params: z.object({ id, categoryId: id.nullable() }).strict() },
  'rules.list': { params: empty },
  /** Create (no `id`) or update a rule (23 §4); a schedule's rule is refused. */
  'rules.save': {
    params: z
      .object({
        id: id.optional(),
        stage: z.enum(['pre', 'post']).nullable(),
        conditionsOp: z.enum(['and', 'or']),
        conditions: z.array(ruleCondition).min(1).max(200),
        actions: z.array(ruleAction).min(1).max(200),
      })
      .strict(),
  },
  'rules.delete': { params: z.object({ ids }).strict() },
  'rules.matches': {
    params: z
      .object({ conditionsOp: z.enum(['and', 'or']), conditions: z.array(ruleCondition).max(200) })
      .strict(),
  },
  'rules.applyActions': {
    params: z.object({ ids, actions: z.array(ruleAction).min(1).max(200) }).strict(),
  },
  /**
   * Add New Category (11 §4.2): into an existing group, or a new group created in the same job. The
   * category goes at the end of its group (04 §3). With `unique`, a taken name gets " 2", " 3"… (09 §4.3).
   */
  'categories.create': {
    params: z
      .object({
        groupId: id.optional(),
        groupName: z.string().optional(),
        name: z.string(),
        unique: z.boolean().optional(),
      })
      .strict(),
  },
  /** The Categories header's [+] (09 §4.1): a group at the top, its name made unique (" 2", " 3"…). */
  'categories.createGroup': { params: z.object({ name: z.string().trim().min(1) }).strict() },
  /** Edit category (09 §6.1): rename and/or hide. Names are checked only when they change. */
  'categories.update': {
    params: z.object({ id, name: z.string().optional(), hidden: z.boolean().optional() }).strict(),
  },
  /** Edit master category (09 §6.2). `reserved`: the UI language's reserved names, refused too. */
  'categories.updateGroup': {
    params: z
      .object({
        id,
        name: z.string().optional(),
        hidden: z.boolean().optional(),
        reserved: z.array(z.string()).max(20).optional(),
      })
      .strict(),
  },
  /** Show Hidden Categories (09 §6.5): unhide (or hide) groups and categories in one job. */
  'categories.setHidden': {
    params: z
      .object({
        categoryIds: z.array(id).max(10_000),
        groupIds: z.array(id).max(10_000),
        hidden: z.boolean(),
      })
      .strict(),
  },
  'categories.delete': { params: z.object({ id }).strict() },
  'categories.deleteGroup': { params: z.object({ id }).strict() },
  /** For the delete confirmations (09 §6.1–6.2): a category's or a group's. */
  'categories.deleteImpact': { params: z.object({ id }).strict() },
  /** A drop or Move Up/Down/Move to Group… (09 §4.3): into `groupId`, before `beforeId` (null = last). */
  'categories.move': { params: z.object({ id, groupId: id, beforeId: id.nullable() }).strict() },
  'categories.moveGroup': { params: z.object({ id, beforeId: id.nullable() }).strict() },
  /** Whether the move handlers are known to be missing (03 §3), so the UI can use its fallback. */
  'categories.moveSupport': { params: empty },
  'budget.months': { params: empty },
  'budget.month': { params: z.object({ month }).strict() },
  /** The Uncategorized row (09 §4.2): whether such transactions exist in any month. */
  'budget.uncategorized': { params: empty },
  'budget.setAmount': { params: z.object({ month, categoryId: id, amount: money }).strict() },
  /** Quick Budget fills (09 §5.5): one `batchBudgetUpdates`. */
  'budget.setAmounts': {
    params: z
      .object({
        month,
        entries: z
          .array(z.object({ categoryId: id, amount: money }).strict())
          .min(1)
          .max(10_000),
      })
      .strict(),
  },
  'budget.setCarryover': {
    params: z.object({ month, categoryId: id, flag: z.boolean() }).strict(),
  },
  /** Hold for next month (09 §5.5, X1): replaces any hold already set. */
  'budget.hold': { params: z.object({ month, amount: money.min(0) }).strict() },
  'budget.resetHold': { params: z.object({ month }).strict() },
  'budget.quickBudgetStats': { params: z.object({ month }).strict() },
  /** Cell notes of a month (09 §6.3): `ad:cellnotes:{month}`. */
  'notes.cellNotes': { params: z.object({ month }).strict() },
  'notes.setCellNote': {
    params: z.object({ month, categoryId: id, text: z.string() }).strict(),
  },
  /** The month note, Actual's `budget-{YYYY-MM}` (04 §3). */
  'notes.monthNote': { params: z.object({ month }).strict() },
  'notes.setMonthNote': { params: z.object({ month, text: z.string() }).strict() },
  /**
   * The transactions callout (09 §6.6): a category's or group's on-budget transactions in a month,
   * 'uncategorized' (the Uncategorized row) or 'all' (every expense category, the totals row).
   */
  'transactions.forCategoryMonth': { params: z.object({ target: id, month }).strict() },
  /** "Income for {Month}" (09 §5.1): the month's income-category transactions. */
  'transactions.incomeForMonth': { params: z.object({ month }).strict() },
  /** The scheduler pane (12 §3): schedules that aren't completed, of one account or all of them. */
  'schedules.list': {
    params: z.object({ accountId: z.union([z.literal('all'), z.string().min(1)]) }).strict(),
  },
  'schedules.save': { params: scheduleEdit },
  'schedules.delete': { params: z.object({ ids }).strict() },
  /** Enter in register now (12 §3): one approved, linked transaction each; returns their ids. */
  'schedules.enterNow': { params: z.object({ ids }).strict() },
  'schedules.skip': { params: z.object({ ids }).strict() },
  'schedules.moveToAccount': { params: z.object({ ids, accountId: id }).strict() },
  /** Make recurring… / Move to scheduler… (12 §4): the Schedule dialog's pre-fill. A read. */
  'schedules.draftFromTransaction': {
    params: z.object({ id, mode: z.enum(['recurring', 'move']) }).strict(),
  },
  /** The next occurrences of an unsaved date, from Actual (12 §3.1). */
  'schedules.preview': {
    params: z.object({ date: scheduleDate, count: z.number().int().min(1).max(20) }).strict(),
  },
  /** The transactions linked to a schedule (12 §3.1). */
  'schedules.linked': { params: z.object({ id }).strict() },
  /** Actual's matches for the dialog's conditions (12 §3.1); null without the handler. */
  'schedules.matches': { params: scheduleMatchQuery },
  /** Whether the schedule handlers are known to be missing (03 §3), so the UI uses its fallbacks. */
  'schedules.support': { params: empty },
  /** Reads and parses a bank file (16 §1.3). */
  'import.parse': { params: z.object({ path: z.string().min(1) }).strict() },
  /** Imports the mapped accounts of a parsed file, each in its own job (16 §1.5). */
  'import.run': {
    params: z
      .object({
        token: z.string().min(1),
        accounts: z.array(importRunAccount).max(100),
        texts: importTexts,
      })
      .strict(),
  },
  /** The active report (15 §7): one read job; aggregate rows and series, never the ledger. */
  'reports.get': { params: reportRequestSchema },
  /** File ▸ Export… (16 §2): refused with `conflict` (`details.names`) while files exist, unless `overwrite`. */
  'export.data': { params: exportRequest },
  /** A report's CSV (15 §7, 16 §2.4): the file the renderer built, written to the path the user chose. */
  'export.reportCsv': {
    params: z.object({ path: z.string().min(1), content: z.string().max(50_000_000) }).strict(),
  },
  /** The slate wipe confirm step (18 §2): what would be erased, all dates or before the cutoff. */
  'slateWipe.impact': { params: z.object({ cutoffMonth: month.nullable() }).strict() },
  /** Wipe the Slate Clean (18 §2): one job, after writing the backup zip to `backupPath`. */
  'slateWipe.run': {
    params: z
      .object({
        cutoffMonth: month.nullable(),
        backupPath: z.string().min(1),
        texts: slateWipeTexts,
      })
      .strict(),
  },
  /** The Reconcile Account dialog's hint (13 §6.1): the cleared balance through a date. */
  'reconcile.clearedThrough': { params: z.object({ accountId: id, date: isoDate }).strict() },
  /** Finish Reconciliation (13 §6.3), with the adjustment transaction when `createAdjustment`. */
  'reconcile.finish': {
    params: z
      .object({
        accountId: id,
        statementDate: isoDate,
        target: money,
        createAdjustment: z.boolean(),
        texts: reconcileTexts,
      })
      .strict(),
  },
} as const satisfies Record<string, { params: z.ZodType }>;

/** `categories.deleteImpact` (09 §6.1–6.2). */
export interface DeleteImpact {
  /** Months in the budget's range with money budgeted. */
  budgetedMonths: number;
  transactionCount: number;
  transactionTotal: Money;
}

/** A row of the transactions callout (09 §6.6). Split lines carry their parent's payee and notes. */
export interface CalloutTransaction {
  /** The row: a transaction, or a split's line. */
  id: Id;
  /** The transaction to jump to: the row itself, or a line's split. */
  transactionId: Id;
  accountId: Id;
  accountName: string;
  date: ISODate;
  payeeName: string;
  /** A split line's transfer target account. */
  transferAccountName: string | null;
  isSplitLine: boolean;
  notes: string;
  /** A split line's parent notes. */
  parentNotes: string;
  amount: Money;
}

/** `transactions.delete` / `moveToAccount` / `setDate`: the undo token (10 §8), null when nothing changed. */
export interface UndoableResult {
  token: string | null;
  /** How many transactions were deleted, moved or re-dated. */
  count: number;
}

/** `transactions.lastForPayee` (11 §4.3). */
export interface LastForPayee {
  /** The most recent non-split transaction with the payee, in any account. */
  last: { categoryId: Id | null; notes: string; amount: Money } | null;
  /** The payee's auto-category rule (14 §1). */
  ruleCategoryId: Id | null;
}

/** `payees.renameImpact` (14 §3.1, 11 §8). */
export interface RenameImpact {
  /** Transactions using the payee (not counting `excludeId`). */
  total: number;
  /** Those the rename can change: a rename to a transfer can't touch its own account or splits. */
  renameable: number;
  /** Those without a category (not splits). */
  uncategorized: number;
}

/** `payees.rules` (14 §1, §4). */
export interface PayeeRules {
  renameRules: RenameCondition[];
  autoCategoryId: Id | null;
  /** Rules for this payee the panel can't show ("Other rule (edit in Rules)", 23 §2.1). */
  otherRuleIds: Id[];
}

/** `payees.applyRenameRules` (14 §4). */
export interface ApplyRenameResult {
  count: number;
  /** The distinct payees the matching transactions come from. */
  payeeNames: string[];
}

/** A budget in the Budget List (03 §6.1): de-duplicated by `cloudFileId`. */
export interface BudgetListEntry {
  cloudFileId: string;
  groupId: string;
  name: string;
  /** End-to-end encrypted (`hasKey`). */
  encrypted: boolean;
  /** A local copy exists on this device ("Offline copy" ✓). */
  offlineCopy: boolean;
  /** The budget's owner isn't the signed-in user (multi-user servers, 03 §7.1). */
  shared: boolean;
}

/** The server's active sign-in method (03 §7). */
export interface LoginProbe {
  method: 'password' | 'openid' | 'unsupported';
  /** The OpenID provider's name, for "Sign in with {displayName}". */
  displayName: string;
}

export interface HostResults {
  'session.state': ConnectionInfo;
  'session.connect': ConnectionInfo;
  'session.listBudgets': BudgetListEntry[];
  'session.openBudget': OpenBudgetInfo;
  'session.closeBudget': ConnectionInfo;
  'session.syncNow': ConnectionInfo;
  /** `errorCode`: Node's error code behind a diagnosis (shown for tls-other, 03 §9.1). */
  'session.retryConnection': {
    connection: ConnectionInfo;
    diagnosis: Diagnosis;
    errorCode?: string;
  };
  'session.cancelSignIn': ConnectionInfo;
  'session.probeLogin': LoginProbe;
  'session.connectOpenId': ConnectionInfo;
  'session.cancelOpenId': ConnectionInfo;
  'session.serverVersion': string | null;
  'session.setStaySignedIn': null;
  'session.clearCache': ConnectionInfo;
  'session.signOut': ConnectionInfo;
  'session.forgetServer': ConnectionInfo;
  'budgetFile.create': OpenBudgetInfo;
  'budgetFile.properties': BudgetProperties;
  'budgetFile.exportBackup': null;
  'budgetFile.importFile': OpenBudgetInfo;
  'slateWipe.impact': SlateWipeImpact;
  'slateWipe.run': SlateWipeResult;
  'budgetFile.updateProperties': null;
  'budgetFile.setEncryptionKey': EncryptionKeyResult;
  'prefs.synced': Record<string, string>;
  'prefs.setSynced': null;
  'notes.get': string | null;
  'notes.set': null;
  'accounts.list': Account[];
  'accounts.create': { id: Id };
  'accounts.update': null;
  'accounts.close': null;
  'accounts.reopen': null;
  'accounts.delete': null;
  'accounts.reorder': null;
  'categories.tree': CategoryGroup[];
  'payees.list': Payee[];
  'transactions.list': Transaction[];
  'transactions.get': Transaction | null;
  'transactions.commit': CommitResult;
  'transactions.setCleared': null;
  'transactions.approve': null;
  'tags.list': TagEntity[];
  'tags.create': TagEntity;
  'tags.update': TagEntity;
  'tags.delete': null;
  'tags.discover': TagEntity[];
  'transactions.categorize': null;
  'transactions.delete': UndoableResult;
  /** Old id → new id of every re-created transaction. */
  'transactions.undo': { ids: Record<Id, Id> };
  'transactions.moveToAccount': UndoableResult;
  'transactions.setDate': UndoableResult;
  'transactions.merge': { id: Id };
  'transactions.lastForPayee': LastForPayee;
  'transactions.nextCheckNumber': string | null;
  'payees.rename': { id: Id };
  'payees.renameImpact': RenameImpact;
  'payees.combine': { id: Id };
  'payees.setEnabled': null;
  'payees.rules': PayeeRules;
  'payees.setRenameRules': null;
  'payees.applyRenameRules': ApplyRenameResult;
  'payees.setAutoCategory': null;
  'rules.list': Rule[];
  'rules.save': { id: Id };
  'rules.delete': null;
  'rules.matches': { rows: RuleMatch[]; more: boolean } | null;
  'rules.applyActions': { count: number };
  'categories.create': { id: Id; groupId: Id; name: string };
  'categories.createGroup': { id: Id; name: string };
  'categories.update': null;
  'categories.updateGroup': null;
  'categories.setHidden': null;
  'categories.delete': null;
  'categories.deleteGroup': null;
  'categories.deleteImpact': DeleteImpact;
  'categories.move': null;
  'categories.moveGroup': null;
  'categories.moveSupport': { category: boolean; group: boolean };
  'budget.months': Month[];
  'budget.month': BudgetMonthView;
  'budget.uncategorized': { exists: boolean };
  'budget.setAmount': null;
  'budget.setAmounts': null;
  'budget.setCarryover': null;
  'budget.hold': null;
  'budget.resetHold': null;
  'budget.quickBudgetStats': QuickBudgetStats;
  'notes.cellNotes': Record<Id, string>;
  'notes.setCellNote': null;
  'notes.monthNote': string | null;
  'notes.setMonthNote': null;
  'transactions.forCategoryMonth': CalloutTransaction[];
  'transactions.incomeForMonth': CalloutTransaction[];
  'schedules.list': Schedule[];
  'schedules.save': { id: Id };
  'schedules.delete': null;
  'schedules.enterNow': { ids: Id[] };
  'schedules.skip': null;
  'schedules.moveToAccount': null;
  'schedules.draftFromTransaction': ScheduleDraft;
  'schedules.preview': ISODate[];
  'schedules.linked': ScheduleMatch[];
  'schedules.matches': ScheduleMatch[] | null;
  'schedules.support': { skip: boolean; upcomingDates: boolean };
  'reports.get': ReportResult;
  'export.data': ExportResult;
  'export.reportCsv': null;
  'import.parse': ImportParse;
  'import.run': ImportAccountResult[];
  'reconcile.clearedThrough': Money;
  'reconcile.finish': { reconciled: number; adjustmentId: Id | null };
}

export type HostMethod = keyof typeof hostMethods;
type ParamsOut<M extends HostMethod> = z.output<(typeof hostMethods)[M]['params']>;
export type CreateAccountInput = ParamsOut<'accounts.create'>;
export type AccountUpdate = Omit<ParamsOut<'accounts.update'>, 'id'>;
/** Budget Properties changes (07 §4): only the fields that changed. */
export type BudgetPropertiesPatch = z.output<
  (typeof hostMethods)['budgetFile.updateProperties']['params']
>;
export type HostParams<M extends HostMethod> = z.input<(typeof hostMethods)[M]['params']>;
export type HostResult<M extends HostMethod> = HostResults[M];

/** Host → renderer events (03 §8). */
export interface HostEvents {
  'connection:state': ConnectionInfo;
  /** Tables Actual changed (03 §4.1). The renderer invalidates its Vue Query keys from them. */
  'data:changed': { tables: string[] };
  'budget:opened': OpenBudgetInfo;
  /** A long job's progress (03 §3): `label` names the step, e.g. 'slateWipe.delete' (18 §2). */
  'job:progress': { label: string; done: number; total: number };
  /**
   * A slate wipe was running when the host died (03 §6.5 step 5): sent after the restarted host's
   * reopen, so the renderer shows the slate wipe error with the backup path (18 §2).
   */
  'slateWipe:interrupted': { backupPath: string };
  /**
   * Reopening a crashed host's budget failed (03 §6.5): the renderer handles it like any failed open
   * (encryption prompt, Budget List with the error).
   */
  'session:restoreFailed': { cloudFileId: string; error: RpcErrorData };
}

export type HostEvent = keyof HostEvents;

/** Methods that write. Each runs as a gated write job (03 §5). */
export const WRITE_METHODS: ReadonlySet<HostMethod> = new Set<HostMethod>([
  'notes.set',
  'budgetFile.updateProperties',
  'budgetFile.setEncryptionKey',
  'prefs.setSynced',
  'accounts.create',
  'accounts.update',
  'accounts.close',
  'accounts.reopen',
  'accounts.delete',
  'accounts.reorder',
  'transactions.commit',
  'transactions.setCleared',
  'transactions.approve',
  'tags.create',
  'tags.update',
  'tags.delete',
  'tags.discover',
  'transactions.categorize',
  'transactions.delete',
  'transactions.undo',
  'transactions.moveToAccount',
  'transactions.setDate',
  'transactions.merge',
  'payees.rename',
  'payees.combine',
  'payees.setEnabled',
  'payees.setRenameRules',
  'payees.applyRenameRules',
  'payees.setAutoCategory',
  'categories.create',
  'categories.createGroup',
  'categories.update',
  'categories.updateGroup',
  'categories.setHidden',
  'categories.delete',
  'categories.deleteGroup',
  'categories.move',
  'categories.moveGroup',
  'budget.setAmount',
  'budget.setAmounts',
  'budget.setCarryover',
  'budget.hold',
  'budget.resetHold',
  'notes.setCellNote',
  'notes.setMonthNote',
  'schedules.save',
  'schedules.delete',
  'schedules.enterNow',
  'schedules.skip',
  'schedules.moveToAccount',
  'reconcile.finish',
  'import.run',
  'slateWipe.run',
]);
