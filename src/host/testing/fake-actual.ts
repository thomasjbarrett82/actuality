// In-memory ActualApi for host unit tests (21 §1). It models server responses for:
// server up/down/hanging, token checks, budgets listed twice when cached (03 §6.1), encryption, notes,
// sync events, the offline-fallback write backstop (03 §6.2).
import { addDays, addMonths, daysInMonth, monthOf, parts, today, toISODate } from '@shared/dates';
import type { RawBudgetGroup, RawBudgetMonth } from '@shared/domain/budget-month';
import type { ISODate } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import type {
  AccountPatch,
  ActualApi,
  BudgetFile,
  ImportInput,
  ImportResult,
  InitConfig,
  InternalHandler,
  NewTransaction,
  RawAccount,
  RawCategoryGroup,
  RawNote,
  RawPayee,
  RawReportSide,
  RawRow,
  RawRule,
  RawRuleAction,
  RawRuleCondition,
  RawSchedule,
  RawTag,
  RawTransaction,
  RuleInput,
  ScheduleInput,
  SchedulePatch,
  SyncEvent,
  TransactionPatch,
} from '../actual';
import { UNAVAILABLE_HANDLER } from '../actual';

export type ServerMode = 'up' | 'down' | 'hang';

export interface FakeBudget {
  cloudFileId: string;
  groupId: string;
  name: string;
  password?: string;
  /** The server user who owns it (multi-user servers, 03 §7.1). */
  owner?: string;
  prefs: Record<string, string | undefined>;
  notes: Map<string, string>;
  accounts: RawAccount[];
  groups: RawCategoryGroup[];
  payees: RawPayee[];
  rules: RawRule[];
  /** Grouped, as the register query returns them. */
  transactions: RawTransaction[];
  tags: RawTag[];
  schedules: RawSchedule[];
  /** `${categoryId}:${month}` → carryover flag. */
  carryover: Map<string, boolean>;
  /** `${categoryId}:${month}` → budgeted amount. */
  budgeted: Map<string, number>;
  /** month → manual hold for next month (X1). */
  holds: Map<string, number>;
}

/** A transaction row as the fake stores it, with defaults for the fields a test leaves out. */
export function rawTransaction(
  t: Partial<RawTransaction> & { id: string; account: string },
): RawTransaction {
  return {
    date: '2026-10-01',
    amount: 0,
    payee: null,
    category: null,
    notes: null,
    cleared: false,
    reconciled: false,
    transferId: null,
    importedId: null,
    importedPayee: null,
    schedule: null,
    startingBalance: false,
    sortOrder: 0,
    isParent: false,
    parentId: null,
    subtransactions: [],
    ...t,
  };
}

/** A stored row as `getTransactionRows` returns it. */
function toRawRow(t: RawTransaction): RawRow {
  return {
    id: t.id,
    account: t.account,
    date: t.date,
    amount: t.amount,
    payee: t.payee,
    category: t.category,
    notes: t.notes,
    cleared: t.cleared,
    reconciled: t.reconciled,
    transferId: t.transferId,
    importedId: t.importedId,
    importedPayee: t.importedPayee,
    schedule: t.schedule,
    isParent: t.subtransactions.length > 0,
    isChild: t.parentId !== null,
    parentId: t.parentId,
  };
}

/** One condition of the fake's rule model (`ruleMatches`). */
function fakeCondition(c: RawRuleCondition, t: RawTransaction): boolean {
  const field: Record<string, unknown> = {
    imported_payee: t.importedPayee,
    payee: t.payee,
    account: t.account,
    category: t.category,
    notes: t.notes,
    date: t.date,
    amount: t.amount,
    cleared: t.cleared,
    reconciled: t.reconciled,
  };
  let v = field[c.field];
  if (c.field === 'amount' && (c.options as { outflow?: boolean } | undefined)?.outflow)
    v = -(v as number);
  const fold = (x: unknown): unknown => (typeof x === 'string' ? x.toLocaleLowerCase() : x);
  switch (c.op) {
    case 'is':
      return fold(v ?? (typeof c.value === 'string' ? '' : null)) === fold(c.value);
    case 'isNot':
      return fold(v) !== fold(c.value);
    case 'contains':
      return String(fold(v ?? '')).includes(String(fold(c.value)));
    case 'oneOf':
      return Array.isArray(c.value) && c.value.map(fold).includes(fold(v));
    case 'gt':
      return (v as number) > (c.value as number);
    case 'lt':
      return (v as number) < (c.value as number);
    default:
      return false;
  }
}

const apiError = (code: string, message = code): Error =>
  Object.assign(new Error(message), { code });

/** Actual's forced close: the account, its rows and its transfer payee go; other sides are unlinked. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function removeAccount(b: FakeBudget, id: string): void {
  const own = new Set(b.transactions.filter((t) => t.account === id).map((t) => t.id));
  for (const t of b.transactions) {
    if (t.transferId && own.has(t.transferId)) {
      t.payee = null;
      t.transferId = null;
    }
  }
  b.transactions = b.transactions.filter((t) => t.account !== id);
  b.accounts = b.accounts.filter((a) => a.id !== id);
  b.payees = b.payees.filter((p) => p.transferAcct !== id);
}

export class FakeActual implements ActualApi {
  server: ServerMode = 'up';
  validTokens = new Set<string>(['good-token']);
  readonly budgets = new Map<string, FakeBudget>();
  /** cloudFileId → local id, for budgets cached on this device. */
  readonly localCopies = new Map<string, string>();
  readonly calls: string[] = [];
  private listeners: ((e: SyncEvent) => void)[] = [];
  private mode: 'none' | 'server' | 'local' = 'none';
  private open: FakeBudget | null = null;
  private offlineFallback = false;
  /** Writes made in the open budget since the last successful sync. */
  pendingWrites = 0;

  addBudget(b: Partial<FakeBudget> & { cloudFileId: string; name: string }): FakeBudget {
    const budget: FakeBudget = {
      groupId: `g-${b.cloudFileId}`,
      prefs: {},
      notes: new Map(),
      accounts: [],
      groups: [],
      payees: [],
      rules: [],
      transactions: [],
      tags: [],
      schedules: [],
      carryover: new Map(),
      budgeted: new Map(),
      holds: new Map(),
      ...b,
    };
    this.budgets.set(b.cloudFileId, budget);
    return budget;
  }

  emitSync(e: SyncEvent): void {
    for (const l of this.listeners) l(e);
  }

  private async network<T>(fn: () => T): Promise<T> {
    if (this.server === 'down') throw apiError('network-failure');
    if (this.server === 'hang') await new Promise(() => undefined);
    return fn();
  }

  async init(config: InitConfig): Promise<void> {
    this.calls.push(`init:${'serverURL' in config ? 'server' : 'local'}`);
    this.open = null;
    if ('serverURL' in config) {
      await this.network(() => {
        if (!this.validTokens.has(config.sessionToken)) throw apiError('token-expired');
      });
      this.mode = 'server';
    } else {
      this.mode = 'local';
    }
  }

  shutdown(): Promise<void> {
    this.calls.push('shutdown');
    this.open = null;
    this.mode = 'none';
    return Promise.resolve();
  }

  async getBudgets(): Promise<BudgetFile[]> {
    this.calls.push('getBudgets');
    const local: BudgetFile[] = [...this.localCopies].flatMap(([cloudFileId, id]) => {
      const b = this.budgets.get(cloudFileId);
      return b ? [{ name: b.name, cloudFileId, groupId: b.groupId, id }] : [];
    });
    if (this.mode === 'server' && this.server === 'hang') await new Promise(() => undefined);
    if (this.mode !== 'server' || this.server !== 'up') return local;
    const remote: BudgetFile[] = [...this.budgets.values()].map((b) => ({
      name: b.name,
      cloudFileId: b.cloudFileId,
      groupId: b.groupId,
      state: 'remote',
      hasKey: b.password !== undefined,
      ...(b.owner === undefined ? {} : { owner: b.owner }),
    }));
    return Promise.resolve([...local, ...remote]);
  }

  async downloadBudget(syncId: string, password?: string): Promise<void> {
    this.calls.push(`downloadBudget:${syncId}`);
    const b = [...this.budgets.values()].find((x) => x.groupId === syncId);
    if (!b) throw apiError('budget-not-found');
    if (this.server !== 'up' && this.localCopies.has(b.cloudFileId)) {
      // As the API does: loads the local copy, then fails.
      this.open = b;
      throw apiError('network-failure');
    }
    await this.network(() => {
      if (b.password !== undefined && password === undefined) throw apiError('missing-key');
      if (b.password !== undefined && password !== b.password) throw apiError('decrypt-failure');
    });
    this.open = b;
    this.localCopies.set(
      b.cloudFileId,
      this.localCopies.get(b.cloudFileId) ?? `local-${b.cloudFileId}`,
    );
  }

  loadBudget(localId: string): Promise<void> {
    this.calls.push(`loadBudget:${localId}`);
    const entry = [...this.localCopies].find(([, id]) => id === localId);
    const b = entry ? this.budgets.get(entry[0]) : undefined;
    if (!b) return Promise.reject(apiError('budget-not-found'));
    this.open = b;
    return Promise.resolve();
  }

  async sync(): Promise<void> {
    this.calls.push('sync');
    if (this.mode === 'local') throw new Error('We had an unknown problem opening the budget');
    this.emitSync({ type: 'start' });
    try {
      await this.network(() => undefined);
    } catch (e) {
      this.emitSync({ type: 'error', subtype: 'network' });
      throw e;
    }
    this.pendingWrites = 0;
    this.emitSync({ type: 'success', tables: [] });
  }

  getPreferences(): Promise<Record<string, string | undefined>> {
    return Promise.resolve({ ...(this.open?.prefs ?? {}) });
  }

  private requireOpen(): FakeBudget {
    if (!this.open) throw new Error('No budget open');
    return this.open;
  }

  private write(tables: string[], fn: (b: FakeBudget) => void): Promise<void> {
    if (this.offlineFallback)
      return Promise.reject(new RpcError('offline', 'Writes are blocked offline.'));
    fn(this.requireOpen());
    this.pendingWrites++;
    this.emitSync({ type: 'applied', tables });
    return Promise.resolve();
  }

  setPreference(key: string, value: string): Promise<void> {
    return this.write(['preferences'], (b) => {
      b.prefs[key] = value;
    });
  }

  getNotes(ids: readonly string[]): Promise<RawNote[]> {
    const notes = this.requireOpen().notes;
    return Promise.resolve(
      ids.filter((id) => notes.has(id)).map((id) => ({ id, note: notes.get(id) ?? null })),
    );
  }

  getReservedNotes(): Promise<RawNote[]> {
    const notes = [...this.requireOpen().notes].filter(([id]) => id >= 'ad:' && id < 'ad;');
    return Promise.resolve(notes.map(([id, note]) => ({ id, note })));
  }

  getAccounts(): Promise<RawAccount[]> {
    const sorted = [...this.requireOpen().accounts].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    return Promise.resolve(sorted.map((a) => ({ ...a })));
  }

  getCategoryGroups(): Promise<RawCategoryGroup[]> {
    return Promise.resolve(structuredClone(this.requireOpen().groups));
  }

  getPayees(): Promise<RawPayee[]> {
    return Promise.resolve(this.requireOpen().payees.map((p) => ({ ...p })));
  }

  getRules(): Promise<RawRule[]> {
    return Promise.resolve(structuredClone(this.requireOpen().rules));
  }

  getTransactions(accountId: string | null): Promise<RawTransaction[]> {
    const all = this.requireOpen().transactions;
    return Promise.resolve(
      structuredClone(accountId === null ? all : all.filter((t) => t.account === accountId)),
    );
  }

  getTransaction(parentId: string): Promise<RawTransaction | null> {
    const found = this.requireOpen().transactions.find((t) => t.id === parentId);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  getPayeeUsage(): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    for (const t of this.requireOpen().transactions) {
      for (const row of t.subtransactions.length > 0 ? t.subtransactions : [t]) {
        if (row.payee) usage.set(row.payee, (usage.get(row.payee) ?? 0) + 1);
      }
    }
    return Promise.resolve(usage);
  }

  getSchedules(): Promise<RawSchedule[]> {
    return Promise.resolve(this.requireOpen().schedules.map((s) => structuredClone(s)));
  }

  createSchedule(input: ScheduleInput): Promise<string> {
    const id = this.newId('sched');
    const ruleId = this.newId('rule');
    return this.write(['schedules', 'rules'], (b) => {
      b.rules.push({
        id: ruleId,
        stage: null,
        conditionsOp: 'and',
        conditions: [
          { op: 'is', field: 'payee', value: input.payee },
          { op: 'is', field: 'account', value: input.account },
          { op: 'isapprox', field: 'date', value: structuredClone(input.date) },
          { op: input.amountOp, field: 'amount', value: input.amount },
        ],
        actions: [{ op: 'link-schedule', value: id }],
      });
      b.schedules.push({
        id,
        name: input.name.trim() || null,
        account: input.account,
        payee: input.payee,
        completed: false,
        nextDate: firstDate(input.date),
        amount: input.amount,
        amountOp: input.amountOp,
        date: structuredClone(input.date),
        ruleId,
        postsTransaction: input.postsTransaction,
      });
    }).then(() => id);
  }

  updateSchedule(id: string, patch: SchedulePatch): Promise<void> {
    return this.write(['schedules', 'rules'], (b) => {
      const s = b.schedules.find((x) => x.id === id);
      if (!s) throw new Error(`Schedule ${id} not found`);
      const rule = b.rules.find((r) => r.id === s.ruleId);
      const cond = (field: string) => rule?.conditions.find((c) => c.field === field);
      if (patch.name !== undefined) s.name = patch.name.trim() || null;
      if (patch.postsTransaction !== undefined) s.postsTransaction = patch.postsTransaction;
      if (patch.payee !== undefined) {
        s.payee = patch.payee;
        const c = cond('payee');
        if (c) c.value = patch.payee;
        else rule?.conditions.push({ op: 'is', field: 'payee', value: patch.payee });
      }
      if (patch.account !== undefined) {
        s.account = patch.account;
        const c = cond('account');
        if (c) c.value = patch.account;
      }
      if (patch.amount !== undefined) {
        s.amount = patch.amount;
        const c = cond('amount');
        if (c) c.value = patch.amount;
      }
      if (patch.amountOp !== undefined) {
        s.amountOp = patch.amountOp;
        const c = cond('amount');
        if (c) c.op = patch.amountOp;
      }
      if (patch.date !== undefined) {
        s.date = structuredClone(patch.date);
        s.nextDate = firstDate(patch.date);
        const c = cond('date');
        if (c) c.value = structuredClone(patch.date);
      }
    });
  }

  deleteSchedule(id: string): Promise<void> {
    return this.write(['schedules', 'rules'], (b) => {
      const s = b.schedules.find((x) => x.id === id);
      b.schedules = b.schedules.filter((x) => x.id !== id);
      if (s?.ruleId) b.rules = b.rules.filter((r) => r.id !== s.ruleId);
    });
  }

  skipNextDate(id: string): Promise<void> {
    if (this.missingHandlers.has('schedule/skip-next-date'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    return this.write(['schedules'], (b) => {
      const s = b.schedules.find((x) => x.id === id);
      if (!s?.nextDate || typeof s.date !== 'object') return;
      s.nextDate = nextOccurrence(s.date as FakeRecur, s.nextDate as ISODate);
    });
  }

  getTags(): Promise<RawTag[]> {
    return Promise.resolve(this.requireOpen().tags.map((t) => ({ ...t })));
  }

  createTag(tag: { tag: string; color?: string; description?: string }): Promise<void> {
    return this.write(['tags'], (b) => {
      b.tags.push({
        id: `tag-${tag.tag}`,
        tag: tag.tag,
        color: tag.color ?? null,
        description: tag.description ?? null,
      });
    });
  }

  updateTag(
    id: string,
    fields: { color?: string | null; description?: string | null },
  ): Promise<void> {
    return this.write(['tags'], (b) => {
      const t = b.tags.find((x) => x.id === id);
      if (!t) return;
      if (fields.color !== undefined) t.color = fields.color;
      if (fields.description !== undefined) t.description = fields.description;
    });
  }

  /** Like Actual's `tags-rename`: the entity, and its exact hashtag in every transaction's notes. */
  renameTag(id: string, tag: string): Promise<void> {
    if (this.missingHandlers.has('tags-rename'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    // Actual checks every row of its tags table, the deleted ones too.
    if (this.deletedTagNames.has(tag))
      return Promise.reject(new Error('A tag with that name already exists'));
    return this.write(['tags', 'transactions'], (b) => {
      const t = b.tags.find((x) => x.id === id);
      if (!t || t.tag === tag) return;
      const re = new RegExp(`(?<!#)#${escapeRe(t.tag)}(?=\\s|#|$)`, 'g');
      const rewrite = (row: RawTransaction): void => {
        if (row.notes) row.notes = row.notes.replace(re, `#${tag}`);
      };
      for (const row of b.transactions) {
        rewrite(row);
        row.subtransactions.forEach(rewrite);
      }
      t.tag = tag;
    });
  }

  /** The names of deleted tags, which Actual keeps as tombstones. */
  private readonly deletedTagNames = new Set<string>();

  deleteTag(id: string): Promise<void> {
    return this.write(['tags'], (b) => {
      const name = b.tags.find((t) => t.id === id)?.tag;
      if (name !== undefined) this.deletedTagNames.add(name);
      b.tags = b.tags.filter((t) => t.id !== id);
    });
  }

  getTaggedNotes(): Promise<string[]> {
    const rows = this.requireOpen().transactions.flatMap((t) => [t, ...t.subtransactions]);
    return Promise.resolve(rows.flatMap((r) => (r.notes?.includes('#') ? [r.notes] : [])));
  }

  /** The next created budget isn't uploaded: the API only logs that. */
  failUpload = false;
  /** Internal handlers this "version of Actual" doesn't have (03 §3). */
  readonly missingHandlers = new Set<InternalHandler>();
  /** A server refusal for renames, as a BASIC user on someone else's budget (03 §7.1). */
  refuseRename = false;
  private created = 0;

  async createBudget(name: string, fill: () => Promise<void>): Promise<BudgetFile | null> {
    this.calls.push(`createBudget:${name}`);
    this.created++;
    const cloudFileId = `new-${String(this.created)}`;
    const budget: FakeBudget = {
      cloudFileId,
      groupId: `g-${cloudFileId}`,
      name,
      prefs: {},
      budgeted: new Map(),
      holds: new Map(),
      notes: new Map(),
      accounts: [],
      groups: [
        {
          id: `income-${cloudFileId}`,
          name: 'Income',
          isIncome: true,
          hidden: false,
          sortOrder: 16384,
          categories: [
            {
              id: `inc-${cloudFileId}`,
              name: 'Income',
              groupId: `income-${cloudFileId}`,
              isIncome: true,
              hidden: false,
              sortOrder: 16384,
            },
          ],
        },
      ],
      payees: [],
      rules: [],
      transactions: [],
      tags: [],
      schedules: [],
      carryover: new Map(),
    };
    this.open = budget;
    try {
      await fill();
    } catch (e) {
      this.open = null;
      throw e;
    }
    const localId = `local-${cloudFileId}`;
    if (this.failUpload || this.server !== 'up') {
      // A local-only budget: listed locally, without a server copy.
      this.orphans.set(localId, budget);
      return { name, id: localId };
    }
    this.budgets.set(cloudFileId, budget);
    this.localCopies.set(cloudFileId, localId);
    return { name, cloudFileId, groupId: budget.groupId, id: localId };
  }

  /** Budgets created locally whose upload failed. */
  readonly orphans = new Map<string, FakeBudget>();

  createCategoryGroup(name: string, isIncome = false): Promise<string> {
    const id = `grp-${name}`;
    return this.write(['category_groups'], (b) => {
      const last = Math.max(0, ...b.groups.map((g) => g.sortOrder));
      b.groups.push({ id, name, isIncome, hidden: false, sortOrder: last + 16384, categories: [] });
    }).then(() => id);
  }

  createCategory(groupId: string, name: string, isIncome = false): Promise<string> {
    const id = `cat-${groupId}-${name}`;
    return this.write(['categories'], (b) => {
      const group = b.groups.find((g) => g.id === groupId);
      if (!group) throw new Error(`No group ${groupId}`);
      const first = Math.min(16384, ...group.categories.map((c) => c.sortOrder));
      group.categories.unshift({
        id,
        name,
        groupId,
        isIncome,
        hidden: false,
        sortOrder: first / 2,
      });
    }).then(() => id);
  }

  renameBudget(name: string): Promise<void> {
    if (this.missingHandlers.has('save-prefs')) {
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    }
    if (this.refuseRename)
      return Promise.reject(
        Object.assign(new Error('PostError: forbidden'), { reason: 'forbidden' }),
      );
    return this.write(['preferences'], (b) => {
      b.name = name;
    });
  }

  /** The next `key-make` fails with this reason, after (`afterReset`) or before the server reset. */
  failKeyMake: { reason: string; afterReset?: boolean } | null = null;

  async makeEncryptionKey(password: string): Promise<void> {
    if (this.missingHandlers.has('key-make'))
      throw new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER });
    if (this.offlineFallback) throw new RpcError('offline', 'Writes are blocked offline.');
    const b = this.requireOpen();
    this.calls.push('makeEncryptionKey');
    const fail = this.failKeyMake;
    this.failKeyMake = null;
    if (fail && !fail.afterReset)
      throw Object.assign(new Error(fail.reason), { reason: fail.reason });
    await this.network(() => undefined);
    // A sync reset gives the budget a new group; the new key is randomized even for the same password.
    b.groupId = `g-${b.cloudFileId}-${++this.resets}`;
    if (fail) throw Object.assign(new Error(fail.reason), { reason: fail.reason });
    b.password = password;
    this.pendingWrites = 0;
  }

  private resets = 0;

  internalHandlerAvailable(name: InternalHandler): boolean {
    return !this.missingHandlers.has(name);
  }

  deleteLocalBudget(localId: string): Promise<void> {
    for (const [cloudFileId, id] of this.localCopies)
      if (id === localId) this.localCopies.delete(cloudFileId);
    this.calls.push(`deleteLocalBudget:${localId}`);
    return Promise.resolve();
  }

  /** Zips `exportBudget` made: the bytes are a key into this map (`fake-zip:{n}`). */
  private readonly exported = new Map<string, FakeBudget>();
  /** The next `exportBudget` fails (18 §2: the slate wipe aborts). */
  failExport = false;

  exportBudget(): Promise<Uint8Array> {
    const b = this.requireOpen();
    if (this.failExport) return Promise.reject(new Error('Error exporting budget: internal-error'));
    const key = `fake-zip:${String(this.exported.size + 1)}`;
    this.exported.set(key, structuredClone(b));
    return Promise.resolve(new TextEncoder().encode(key));
  }

  /** Imports a zip `exportBudget` made, as a new budget: uploaded unless `failUpload`. */
  importBudget(data: Uint8Array): Promise<BudgetFile | null> {
    this.calls.push('importBudget');
    const source = this.exported.get(new TextDecoder().decode(data));
    if (!source) return Promise.reject(new Error('Error importing budget: not-actual'));
    this.created++;
    const cloudFileId = `imp-${String(this.created)}`;
    const budget: FakeBudget = {
      ...structuredClone(source),
      cloudFileId,
      groupId: `g-${cloudFileId}`,
    };
    this.open = budget;
    const localId = `local-${cloudFileId}`;
    if (this.failUpload || this.server !== 'up') {
      this.orphans.set(localId, budget);
      return Promise.resolve({ name: budget.name, id: localId });
    }
    this.budgets.set(cloudFileId, budget);
    this.localCopies.set(cloudFileId, localId);
    return Promise.resolve({
      name: budget.name,
      cloudFileId,
      groupId: budget.groupId,
      id: localId,
    });
  }

  getServerVersion(): Promise<string | null> {
    return Promise.resolve(this.mode === 'server' && this.server === 'up' ? '26.2.0' : null);
  }

  getNote(id: string): Promise<string | null> {
    return Promise.resolve(this.open?.notes.get(id) ?? null);
  }

  updateNote(id: string, text: string): Promise<void> {
    if (!this.open && !this.offlineFallback) return Promise.reject(new Error('No budget open'));
    return this.write(['notes'], (b) => {
      b.notes.set(id, text);
    });
  }

  /** "Today" for the transactions the fake creates itself. */
  today = today(new Date());
  /** The budget's readable months. */
  months: string[] = [];
  /** Carryover writes, in order: `${month}:${categoryId}:${flag}`. */
  readonly carryoverCalls: string[] = [];
  private accountsCreated = 0;

  private findPayee(b: FakeBudget, name: string): string {
    const lower = name.toLowerCase();
    const found = b.payees.find((p) => !p.transferAcct && p.name.toLowerCase() === lower);
    if (found) return found.id;
    const id = `payee-${String(b.payees.length + 1)}`;
    b.payees.push({ id, name, transferAcct: null });
    return id;
  }

  createAccount(name: string, offbudget: boolean, initialBalance: number): Promise<string> {
    this.accountsCreated++;
    const id = `acct-new-${String(this.accountsCreated)}`;
    return this.write(['accounts', 'payees', 'transactions'], (b) => {
      const group = b.accounts.filter((a) => a.offbudget === offbudget && !a.closed);
      const last = Math.max(0, ...group.map((a) => a.sortOrder));
      b.accounts.push({
        id,
        name,
        offbudget,
        closed: false,
        sortOrder: last + 16384,
        accountGroupId: null,
      });
      b.payees.push({ id: `tp-${id}`, name: '', transferAcct: id });
      if (initialBalance === 0) return;
      // Actual's getStartingBalancePayee: "Starting Balances", else the first income category.
      const income = b.groups.filter((g) => g.isIncome).flatMap((g) => g.categories);
      const category =
        income.find((c) => c.name.toLowerCase() === 'starting balances') ?? income[0];
      b.transactions.push(
        rawTransaction({
          id: `sb-${id}`,
          account: id,
          date: this.today,
          amount: initialBalance,
          payee: this.findPayee(b, 'Starting Balance'),
          category: offbudget ? null : (category?.id ?? null),
          cleared: true,
          startingBalance: true,
        }),
      );
    }).then(() => id);
  }

  updateAccount(id: string, patch: AccountPatch): Promise<void> {
    return this.write(['accounts'], (b) => {
      const a = b.accounts.find((x) => x.id === id);
      if (!a) throw new Error(`No account ${id}`);
      Object.assign(a, patch);
    });
  }

  closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void> {
    return this.write(['accounts', 'transactions'], (b) => {
      const a = b.accounts.find((x) => x.id === id);
      if (!a || a.closed) return;
      // Actual 26.10.0 deletes an account that has no transactions instead of closing it.
      if (!b.transactions.some((t) => t.account === id)) {
        removeAccount(b, id);
        return;
      }
      const balance = b.transactions
        .filter((t) => t.account === id)
        .reduce((sum, t) => sum + t.amount, 0);
      if (balance !== 0 && !transferAccountId)
        throw apiError('APIError', 'balance is non-zero: transferAccountId is required');
      a.closed = true;
      if (balance === 0 || !transferAccountId) return;
      const n = String(b.transactions.length + 1);
      b.transactions.push(
        rawTransaction({
          id: `close-${n}`,
          account: id,
          date: this.today,
          amount: -balance,
          payee: `tp-${transferAccountId}`,
          category: transferCategoryId ?? null,
          notes: 'Closing account',
          transferId: `close-mirror-${n}`,
        }),
        rawTransaction({
          id: `close-mirror-${n}`,
          account: transferAccountId,
          date: this.today,
          amount: balance,
          payee: `tp-${id}`,
          notes: 'Closing account',
          transferId: `close-${n}`,
        }),
      );
    });
  }

  reopenAccount(id: string): Promise<void> {
    return this.updateAccount(id, { closed: false });
  }

  deleteAccount(id: string): Promise<void> {
    return this.write(['accounts', 'transactions', 'payees'], (b) => {
      // Actual 26.10.0: a forced close skips an account that is closed already.
      if (b.accounts.find((a) => a.id === id)?.closed) return;
      removeAccount(b, id);
    });
  }

  addTransaction(accountId: string, t: NewTransaction): Promise<void> {
    return this.addTransactions(accountId, [t]);
  }

  /** Ids Actual has deleted: a create that reuses one is silently dropped. */
  private readonly deletedIds = new Set<string>();
  private rowsCreated = 0;

  addTransactions(accountId: string, ts: readonly NewTransaction[]): Promise<void> {
    return this.write(['transactions'], (b) => {
      for (const t of ts) {
        if (this.deletedIds.has(t.id)) continue;
        const parent = rawTransaction({
          id: t.id,
          account: accountId,
          date: t.date,
          amount: t.amount,
          payee: t.payee === undefined ? this.findPayee(b, t.payeeName ?? '') : t.payee,
          category: t.category,
          notes: t.notes,
          cleared: t.cleared,
          reconciled: t.reconciled,
          importedId: t.importedId ?? null,
          importedPayee: t.importedPayee ?? null,
          schedule: t.schedule ?? null,
          startingBalance: t.startingBalance === true,
          isParent: (t.subtransactions?.length ?? 0) > 0,
        });
        parent.subtransactions = (t.subtransactions ?? []).map((l) =>
          this.makeChild(parent, l, l.id ?? this.newId('c')),
        );
        if (parent.isParent) parent.category = null;
        b.transactions.push(parent);
        this.onAdd?.(parent, b);
        if (!parent.isParent) this.syncTransfer(b, parent, null);
        for (const child of parent.subtransactions) this.syncTransfer(b, child, null);
      }
    });
  }

  /**
   * A small model of Actual's import reconciliation (X4): a known `imported_id` is ignored, an unimported
   * row with the same amount within 7 days is matched (updated), anything else is added, cleared.
   */
  async importTransactions(accountId: string, ts: readonly ImportInput[]): Promise<ImportResult> {
    const b = this.requireOpen();
    const result: ImportResult = { added: [], updated: [], errors: [] };
    const own = () => b.transactions.filter((t) => t.account === accountId);
    for (const t of ts) {
      if (own().some((x) => x.importedId === t.importedId)) continue;
      const match = own().find(
        (x) =>
          x.importedId === null &&
          x.amount === t.amount &&
          Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 7 * 86_400_000,
      );
      if (match) {
        await this.write(['transactions'], () => {
          match.importedId = t.importedId;
          match.importedPayee = t.importedPayee;
        });
        result.updated.push(match.id);
        continue;
      }
      const id = this.newId('imp');
      await this.addTransactions(accountId, [
        {
          id,
          date: t.date,
          amount: t.amount,
          ...(t.payee ? { payee: t.payee } : { payeeName: t.payeeName ?? '' }),
          category: t.category,
          notes: t.notes,
          cleared: true,
          reconciled: false,
          importedId: t.importedId,
          importedPayee: t.importedPayee,
          ...(t.subtransactions
            ? { subtransactions: t.subtransactions.map((l) => ({ ...l, payee: null })) }
            : {}),
        },
      ]);
      if (!t.payee && !t.payeeName) {
        const row = b.transactions.find((x) => x.id === id);
        if (row) row.payee = null;
      }
      result.added.push(id);
    }
    return result;
  }

  private newId(prefix: string): string {
    this.rowsCreated++;
    return `${prefix}-${String(this.rowsCreated)}`;
  }

  private makeChild(
    parent: RawTransaction,
    l: { amount: number; payee: string | null; category: string | null; notes: string },
    id: string,
  ): RawTransaction {
    return rawTransaction({
      id,
      account: parent.account,
      date: parent.date,
      amount: l.amount,
      payee: l.payee ?? parent.payee,
      category: l.category,
      notes: l.notes,
      cleared: parent.cleared,
      reconciled: parent.reconciled,
      parentId: parent.id,
    });
  }

  /** Every row, parents and lines, with the parent of each line. */
  private rows(b: FakeBudget): { row: RawTransaction; parent: RawTransaction | null }[] {
    return b.transactions.flatMap((t) => [
      { row: t, parent: null },
      ...t.subtransactions.map((c) => ({ row: c, parent: t })),
    ]);
  }

  private locate(
    b: FakeBudget,
    id: string,
  ): { row: RawTransaction; parent: RawTransaction | null } | undefined {
    return this.rows(b).find((x) => x.row.id === id);
  }

  private transferTarget(b: FakeBudget, payee: string | null): string | null {
    return payee ? (b.payees.find((p) => p.id === payee)?.transferAcct ?? null) : null;
  }

  private offBudget(b: FakeBudget, accountId: string): boolean {
    return b.accounts.find((a) => a.id === accountId)?.offbudget === true;
  }

  /**
   * Actual's transfer upkeep for one row after it changed: create the mirror for a new transfer,
   * move it to a new target account, delete it when the payee is no longer a transfer, and copy amount and
   * notes. Dates don't propagate. On↔on transfers lose their category.
   */
  private syncTransfer(b: FakeBudget, row: RawTransaction, oldPayee: string | null): void {
    const target = this.transferTarget(b, row.payee);
    const oldTarget = this.transferTarget(b, oldPayee);
    const mirror = row.transferId ? this.locate(b, row.transferId)?.row : undefined;
    if (!target) {
      if (mirror && oldTarget) {
        if (row.parentId === null) this.removeRow(b, mirror.id);
        else mirror.transferId = null;
        row.transferId = null;
      }
      return;
    }
    if (!this.offBudget(b, row.account) && !this.offBudget(b, target)) row.category = null;
    if (mirror) {
      mirror.account = target;
      mirror.amount = -row.amount;
      mirror.notes = row.notes;
      return;
    }
    const id = this.newId('mirror');
    b.transactions.push(
      rawTransaction({
        id,
        account: target,
        date: row.date,
        amount: -row.amount,
        payee: `tp-${row.account}`,
        notes: row.notes,
        transferId: row.id,
      }),
    );
    row.transferId = id;
  }

  /** Removes a row; a parent takes its lines with it, a line leaves its split. */
  private removeRow(b: FakeBudget, id: string): void {
    this.deletedIds.add(id);
    const at = b.transactions.findIndex((t) => t.id === id);
    if (at !== -1) {
      const [gone] = b.transactions.splice(at, 1);
      for (const c of gone?.subtransactions ?? []) this.deletedIds.add(c.id);
      return;
    }
    for (const t of b.transactions) {
      const i = t.subtransactions.findIndex((c) => c.id === id);
      if (i === -1) continue;
      t.subtransactions.splice(i, 1);
      if (t.subtransactions.length === 0) t.isParent = false;
    }
  }

  updateTransaction(id: string, patch: TransactionPatch): Promise<void> {
    return this.write(['transactions'], (b) => {
      const found = this.locate(b, id);
      if (!found) throw new Error(`No transaction ${id}`);
      const { row } = found;
      const { subtransactions, ...scalars } = patch;
      const oldPayee = row.payee;
      const oldAccount = row.account;
      Object.assign(row, scalars);
      for (const c of row.subtransactions) {
        c.date = row.date;
        c.account = row.account;
        c.cleared = row.cleared;
        c.reconciled = row.reconciled;
        if (c.payee === oldPayee && scalars.payee !== undefined) c.payee = row.payee;
      }
      if (subtransactions) {
        const kept = new Map(row.subtransactions.map((c) => [c.id, c]));
        const next = subtransactions.map((l) => {
          const existing = l.id === undefined ? undefined : kept.get(l.id);
          if (!existing) return this.makeChild(row, l, l.id ?? this.newId('c'));
          kept.delete(existing.id);
          const before = existing.payee;
          Object.assign(existing, {
            amount: l.amount,
            payee: l.payee ?? row.payee,
            category: l.category,
            notes: l.notes,
          });
          this.syncTransfer(b, existing, before);
          return existing;
        });
        // Dropped lines' mirrors are unlinked, not deleted (04 §3).
        for (const gone of kept.values()) {
          const mirror = gone.transferId ? this.locate(b, gone.transferId)?.row : undefined;
          if (mirror) mirror.transferId = null;
          this.deletedIds.add(gone.id);
        }
        row.subtransactions = next;
        row.isParent = next.length > 0;
        if (row.isParent) row.category = null;
        for (const c of next) if (!c.transferId) this.syncTransfer(b, c, null);
      }
      if (row.account !== oldAccount) {
        // Actual's batch writes each line's account too, so a move off-budget clears theirs as well.
        if (this.offBudget(b, row.account))
          for (const r of [row, ...row.subtransactions]) r.category = null;
        const mirror = row.transferId ? this.locate(b, row.transferId)?.row : undefined;
        if (mirror) mirror.payee = `tp-${row.account}`;
      }
      if (!row.isParent) this.syncTransfer(b, row, oldPayee);
    });
  }

  async deleteTransactions(ids: readonly string[]): Promise<void> {
    this.calls.push(`deleteTransactions:${String(ids.length)}`);
    for (const id of ids) await this.deleteTransaction(id);
  }

  deleteTransaction(id: string): Promise<void> {
    return this.write(['transactions'], (b) => {
      const found = this.locate(b, id);
      if (!found) return;
      const { row } = found;
      // A split's lines go with it; their mirrors are unlinked (04 §3).
      for (const c of row.subtransactions) {
        const mirror = c.transferId ? this.locate(b, c.transferId)?.row : undefined;
        if (mirror) mirror.transferId = null;
      }
      const other = row.transferId ? this.locate(b, row.transferId) : undefined;
      this.removeRow(b, id);
      // Deleting either side of a transfer deletes the other; a split line's mirror is only unlinked.
      if (other && found.parent === null) this.removeRow(b, other.row.id);
      else if (other) other.row.transferId = null;
    });
  }

  /** Merge (X4): keeps the imported one, else the earlier one, and fills its empty fields. */
  mergeTransactions(a: string, b: string): Promise<string> {
    let kept = a;
    return this.write(['transactions'], (budget) => {
      const x = this.locate(budget, a)?.row;
      const y = this.locate(budget, b)?.row;
      if (!x || !y) throw new Error('Transaction not found');
      if (x.account !== y.account || x.amount !== y.amount)
        throw new Error('Transactions must have the same account and amount');
      const keep = x.importedId ? x : y.importedId ? y : x.date <= y.date ? x : y;
      const drop = keep === x ? y : x;
      keep.payee ??= drop.payee;
      keep.category ??= drop.category;
      if (!keep.notes) keep.notes = drop.notes;
      kept = keep.id;
      this.removeRow(budget, drop.id);
    }).then(() => kept);
  }

  getTransactionRows(filter: {
    ids?: readonly string[];
    parentIds?: readonly string[];
  }): Promise<RawRow[]> {
    const b = this.requireOpen();
    const ids = new Set(filter.ids ?? []);
    const parents = new Set(filter.parentIds ?? []);
    const out = this.rows(b)
      .filter(({ row }) => (filter.ids ? ids.has(row.id) : parents.has(row.parentId ?? '')))
      .map(({ row }) => toRawRow(row));
    return Promise.resolve(out);
  }

  lastTransactionForPayee(payeeId: string): Promise<RawRow | null> {
    const rows = this.requireOpen()
      .transactions.filter((t) => t.payee === payeeId && t.subtransactions.length === 0)
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.sortOrder - x.sortOrder));
    const [first] = rows;
    return Promise.resolve(first ? toRawRow(first) : null);
  }

  linkedTransactions(scheduleId: string): Promise<RawRow[]> {
    const rows = this.requireOpen()
      .transactions.filter((t) => t.schedule === scheduleId)
      .sort(byDateDesc);
    return Promise.resolve(rows.map(toRawRow));
  }

  /** A small model of Actual's schedule conditions (12 §3.1): `is` payee/account, amount, ±2 days. */
  scheduleMatches(conditions: readonly RawRuleCondition[], limit: number): Promise<RawRow[]> {
    if (this.missingHandlers.has('make-filters-from-conditions'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    this.matchConditions.push(structuredClone([...conditions]));
    const cond = (field: string) => conditions.find((c) => c.field === field);
    const payee = cond('payee');
    const account = cond('account');
    const amount = cond('amount');
    const date = cond('date');
    const dates =
      typeof date?.value === 'string'
        ? [date.value as ISODate]
        : occurrencesOf(date?.value as FakeRecur | undefined, 100);
    const near = (d: string): boolean =>
      dates.some((o) => d >= addDays(o, -2) && d <= addDays(o, 2));
    const amountOk = (a: number): boolean => {
      if (!amount) return true;
      if (amount.op === 'isbetween') {
        const { num1, num2 } = amount.value as { num1: number; num2: number };
        return a >= Math.min(num1, num2) && a <= Math.max(num1, num2);
      }
      const v = amount.value as number;
      if (amount.op === 'isapprox') return Math.abs(a - v) <= Math.abs(v) * 0.075;
      return a === v;
    };
    const rows = this.requireOpen()
      .transactions.filter(
        (t) =>
          t.schedule === null &&
          (!payee || t.payee === payee.value) &&
          (!account || t.account === account.value) &&
          amountOk(t.amount) &&
          near(t.date),
      )
      .sort(byDateDesc)
      .slice(0, limit);
    return Promise.resolve(rows.map(toRawRow));
  }

  /** The conditions each `scheduleMatches` call got. */
  readonly matchConditions: RawRuleCondition[][] = [];

  /**
   * A small model of Actual's rule conditions (23 §4): `is`, `isNot`, `contains` and `oneOf` on text and
   * ids, and the amount comparisons, over normal rows and split lines.
   */
  ruleMatches(
    conditions: readonly RawRuleCondition[],
    conditionsOp: 'and' | 'or',
    limit: number,
  ): Promise<RawRow[]> {
    if (this.missingHandlers.has('make-filters-from-conditions'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    this.ruleMatchCalls.push({ conditions: structuredClone([...conditions]), conditionsOp });
    const rows = this.requireOpen()
      .transactions.flatMap((t) => (t.subtransactions.length > 0 ? t.subtransactions : [t]))
      .filter((t) =>
        conditionsOp === 'or'
          ? conditions.some((c) => fakeCondition(c, t))
          : conditions.every((c) => fakeCondition(c, t)),
      )
      .sort(byDateDesc)
      .slice(0, limit);
    return Promise.resolve(rows.map(toRawRow));
  }

  /** The arguments of each `ruleMatches` call. */
  readonly ruleMatchCalls: { conditions: RawRuleCondition[]; conditionsOp: string }[] = [];

  /** `set` and the notes actions, applied to each row; `delete-transaction` removes it. */
  async applyRuleActions(ids: readonly string[], actions: readonly RawRuleAction[]): Promise<void> {
    if (this.missingHandlers.has('rule-apply-actions'))
      throw new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER });
    this.appliedActions.push({ ids: [...ids], actions: structuredClone([...actions]) });
    for (const id of ids) {
      const row = this.locate(this.requireOpen(), id)?.row;
      if (!row) continue;
      if (actions.some((a) => a.op === 'delete-transaction')) {
        await this.deleteTransaction(id);
        continue;
      }
      const patch: Record<string, unknown> = {};
      let notes = row.notes ?? '';
      for (const a of actions) {
        const text = typeof a.value === 'string' ? a.value : '';
        if (a.op === 'set' && a.field === 'notes') notes = text;
        else if (a.op === 'set' && a.field) patch[a.field] = a.value;
        else if (a.op === 'prepend-notes') notes = text + notes;
        else if (a.op === 'append-notes') notes = notes + text;
      }
      await this.updateTransaction(id, { ...patch, notes });
    }
  }

  /** The arguments of each `applyRuleActions` call. */
  readonly appliedActions: { ids: string[]; actions: RawRuleAction[] }[] = [];

  createPayee(name: string): Promise<string> {
    const id = this.newId('payee');
    return this.write(['payees'], (b) => {
      b.payees.push({ id, name, transferAcct: null });
    }).then(() => id);
  }

  updatePayee(id: string, patch: { name: string }): Promise<void> {
    return this.write(['payees'], (b) => {
      const p = b.payees.find((x) => x.id === id);
      if (!p) throw new Error(`No payee ${id}`);
      p.name = patch.name;
    });
  }

  mergePayees(targetId: string, ids: readonly string[]): Promise<void> {
    return this.write(['payees', 'transactions'], (b) => {
      const gone = new Set(ids.filter((id) => id !== targetId));
      for (const { row } of this.rows(b))
        if (row.payee && gone.has(row.payee)) row.payee = targetId;
      b.payees = b.payees.filter((p) => !gone.has(p.id));
    });
  }

  deletePayee(id: string): Promise<void> {
    return this.write(['payees'], (b) => {
      b.payees = b.payees.filter((p) => p.id !== id);
    });
  }

  createRule(rule: RuleInput): Promise<string> {
    const id = this.newId('rule');
    return this.write(['rules'], (b) => {
      b.rules.push({ id, ...structuredClone(rule) });
    }).then(() => id);
  }

  updateRule(rule: RawRule): Promise<void> {
    return this.write(['rules'], (b) => {
      const at = b.rules.findIndex((r) => r.id === rule.id);
      if (at === -1) throw new Error(`No rule ${rule.id}`);
      b.rules[at] = structuredClone(rule);
    });
  }

  deleteRule(id: string): Promise<void> {
    return this.write(['rules'], (b) => {
      b.rules = b.rules.filter((r) => r.id !== id);
    });
  }

  getBudgetMonths(): Promise<string[]> {
    return Promise.resolve([...this.months]);
  }

  setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
    if (!this.months.includes(month))
      return Promise.reject(new Error(`No budget exists for month: ${month}`));
    return this.write(['zero_budgets'], (b) => {
      this.carryoverCalls.push(`${month}:${categoryId}:${String(flag)}`);
      for (const m of this.months) if (m >= month) b.carryover.set(`${categoryId}:${m}`, flag);
    });
  }

  updateCategory(
    id: string,
    patch: { name: string; hidden?: boolean; groupId?: string },
  ): Promise<void> {
    return this.write(['categories'], (b) => {
      const { groupId, ...rest } = patch;
      const c = b.groups.flatMap((g) => g.categories).find((x) => x.id === id);
      if (!c) throw new Error(`No category ${id}`);
      Object.assign(c, rest);
      if (groupId === undefined || groupId === c.groupId) return;
      const target = b.groups.find((g) => g.id === groupId);
      if (!target) throw new Error(`No group ${groupId}`);
      for (const g of b.groups) g.categories = g.categories.filter((x) => x.id !== id);
      c.groupId = groupId;
      // Actual puts it somewhere in the new group: the fake puts it first.
      target.categories.unshift(c);
    });
  }

  // ------------------------------------------------------------------ budget

  /** Budget writes in a `batchBudgetUpdates`. */
  batches = 0;
  /**
   * Occurrences for `getUpcomingDates`: by default the fake model's dates from the config's start, from
   * today on, as Actual's handler does. A test can set its own.
   */
  upcomingDates: (config: unknown, count: number) => string[] = (config, count) => {
    const from = today(new Date());
    return occurrencesOf(config as FakeRecur, 400)
      .filter((d) => d >= from)
      .slice(0, count);
  };
  /**
   * Actual's rules on `addTransactions`: a test can link a new row to a schedule and apply its
   * template here, as Actual's `link-schedule` rules do.
   */
  onAdd: ((row: RawTransaction, budget: FakeBudget) => void) | null = null;

  /** Rows that count for the budget: on-budget, split lines rather than parents. */
  private budgetRows(b: FakeBudget): RawTransaction[] {
    return this.rows(b)
      .map((x) => x.row)
      .filter((r) => r.subtransactions.length === 0 && !this.offBudget(b, r.account));
  }

  private spentIn(b: FakeBudget, categoryId: string, month: string): number {
    return this.budgetRows(b)
      .filter((r) => r.category === categoryId && r.date.startsWith(month))
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * A small model of Actual's envelope sheet: balances roll forward, negative ones only
   * with carryover, and the rest of an overspend comes out of next month's To Budget.
   */
  getBudgetMonth(month: string): Promise<RawBudgetMonth> {
    if (!this.months.includes(month))
      return Promise.reject(new RpcError('validation', `No budget exists for month: ${month}`));
    const b = this.requireOpen();
    let prev: RawBudgetMonth | null = null;
    for (const m of this.months) {
      const groups: RawBudgetGroup[] = b.groups.map((g) => {
        const categories = g.categories.map((c) => {
          const budgeted = b.budgeted.get(`${c.id}:${m}`) ?? 0;
          const activity = this.spentIn(b, c.id, m);
          const carryover = b.carryover.get(`${c.id}:${m}`) === true;
          if (g.isIncome) return { id: c.id, is_income: true, received: activity };
          const before = prev?.categoryGroups
            .flatMap((x) => x.categories ?? [])
            .find((x) => x.id === c.id);
          const last = before?.balance ?? 0;
          const carried = last > 0 || before?.carryover === true ? last : 0;
          return {
            id: c.id,
            is_income: false,
            budgeted,
            spent: activity,
            balance: carried + budgeted + activity,
            carryover,
          };
        });
        const total = (f: 'budgeted' | 'spent' | 'received' | 'balance'): number =>
          categories.reduce(
            (sum, c) => sum + ((c as unknown as Record<string, number | undefined>)[f] ?? 0),
            0,
          );
        return g.isIncome
          ? {
              id: g.id,
              is_income: true,
              received: total('received'),
              categories,
            }
          : {
              id: g.id,
              is_income: false,
              budgeted: total('budgeted'),
              spent: total('spent'),
              balance: total('balance'),
              categories,
            };
      });
      const expense = groups.filter((g) => g.is_income !== true).flatMap((g) => g.categories ?? []);
      const totalIncome = groups
        .filter((g) => g.is_income === true)
        .reduce((s2, g) => s2 + (g.received ?? 0), 0);
      const budgeted = expense.reduce((s2, c) => s2 + (c.budgeted ?? 0), 0);
      const totalSpent = expense.reduce((s2, c) => s2 + (c.spent ?? 0), 0);
      const totalBalance = expense.reduce((s2, c) => s2 + (c.balance ?? 0), 0);
      const lastOverspent = (prev?.categoryGroups ?? [])
        .filter((g) => g.is_income !== true)
        .flatMap((g) => g.categories ?? [])
        .filter((c) => (c.balance ?? 0) < 0 && c.carryover !== true)
        .reduce((s2, c) => s2 + (c.balance ?? 0), 0);
      const hold = b.holds.get(m) ?? 0;
      const fromLastMonth = (prev?.toBudget ?? 0) + (prev?.forNextMonth ?? 0);
      const toBudget = fromLastMonth + totalIncome - budgeted + lastOverspent - hold;
      const view: RawBudgetMonth = {
        month: m,
        incomeAvailable: totalIncome + fromLastMonth,
        lastMonthOverspent: lastOverspent,
        forNextMonth: hold,
        totalBudgeted: -budgeted,
        toBudget,
        fromLastMonth,
        totalIncome,
        totalSpent,
        totalBalance,
        categoryGroups: groups,
      };
      if (m === month) return Promise.resolve(structuredClone(view));
      prev = view;
    }
    return Promise.reject(new Error('unreachable'));
  }

  setBudgetAmount(month: string, categoryId: string, amount: number): Promise<void> {
    return this.write(['zero_budgets'], (b) => {
      b.budgeted.set(`${categoryId}:${month}`, amount);
    });
  }

  async batchBudgetUpdates(fn: () => Promise<void>): Promise<void> {
    this.batches++;
    await fn();
  }

  holdBudgetForNextMonth(month: string, amount: number): Promise<boolean> {
    return this.write(['zero_budgets'], (b) => {
      b.holds.set(month, amount);
    }).then(() => amount > 0);
  }

  resetBudgetHold(month: string): Promise<void> {
    return this.write(['zero_budgets'], (b) => {
      b.holds.delete(month);
    });
  }

  deleteCategory(id: string): Promise<void> {
    return this.write(['categories', 'transactions'], (b) => {
      for (const g of b.groups) g.categories = g.categories.filter((c) => c.id !== id);
      for (const { row } of this.rows(b)) if (row.category === id) row.category = null;
      for (const key of [...b.budgeted.keys()])
        if (key.startsWith(`${id}:`)) b.budgeted.delete(key);
    });
  }

  async deleteCategoryGroup(id: string): Promise<void> {
    const group = this.requireOpen().groups.find((g) => g.id === id);
    for (const c of group?.categories ?? []) await this.deleteCategory(c.id);
    await this.write(['category_groups'], (b) => {
      b.groups = b.groups.filter((g) => g.id !== id);
    });
  }

  categoryCountsInMonth(month: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const r of this.budgetRows(this.requireOpen()))
      if (r.category && r.date.startsWith(month))
        counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return Promise.resolve(counts);
  }

  private uncategorizedRows(b: FakeBudget, month: string | null): RawTransaction[] {
    return this.budgetRows(b).filter((r) => {
      if (r.category !== null || (month !== null && !r.date.startsWith(month))) return false;
      const target = this.transferTarget(b, r.payee);
      return target === null || this.offBudget(b, target);
    });
  }

  uncategorizedSummary(month: string | null): Promise<{ count: number; total: number }> {
    const rows = this.uncategorizedRows(this.requireOpen(), month);
    return Promise.resolve({
      count: rows.length,
      total: month === null ? 0 : rows.reduce((sum, r) => sum + r.amount, 0),
    });
  }

  monthRows(
    month: string,
    filter: { categoryIds: readonly string[] } | 'uncategorized',
  ): Promise<RawRow[]> {
    const b = this.requireOpen();
    const rows =
      filter === 'uncategorized'
        ? this.uncategorizedRows(b, month)
        : this.budgetRows(b).filter(
            (r) =>
              r.date.startsWith(month) &&
              r.category !== null &&
              filter.categoryIds.includes(r.category),
          );
    return Promise.resolve(rows.map(toRawRow));
  }

  categoryUsage(categoryIds: readonly string[]): Promise<{ count: number; total: number }> {
    const rows = this.rows(this.requireOpen())
      .map((x) => x.row)
      .filter((r) => r.category !== null && categoryIds.includes(r.category));
    return Promise.resolve({
      count: rows.length,
      total: rows.reduce((sum, r) => sum + r.amount, 0),
    });
  }

  reportSides(): Promise<RawReportSide[]> {
    return Promise.resolve(
      this.requireOpen().transactions.flatMap((t) => {
        const own = (r: RawTransaction, line: number): RawReportSide => ({
          id: r.id,
          transactionId: t.id,
          line,
          account: r.account,
          date: r.date,
          amount: r.amount,
          payee: r.payee ?? t.payee,
          category: r.category,
          startingBalance: t.startingBalance,
        });
        return t.subtransactions.length > 0 ? t.subtransactions.map(own) : [own(t, 0)];
      }),
    );
  }

  getUpcomingDates(config: unknown, count: number): Promise<string[]> {
    if (this.missingHandlers.has('schedule/get-upcoming-dates'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    return Promise.resolve(this.upcomingDates(config, count));
  }

  updateCategoryGroup(id: string, patch: { name: string; hidden?: boolean }): Promise<void> {
    return this.write(['category_groups'], (b) => {
      const g = b.groups.find((x) => x.id === id);
      if (!g) throw new Error(`No group ${id}`);
      Object.assign(g, patch);
    });
  }

  moveCategoryGroup(id: string, targetId: string | null): Promise<void> {
    if (this.missingHandlers.has('category-group-move'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    return this.write(['category_groups'], (b) => {
      const sorted = [...b.groups].sort((x, y) => x.sortOrder - y.sortOrder);
      const moved = sorted.find((g) => g.id === id);
      if (!moved) throw new Error(`No group ${id}`);
      const rest = sorted.filter((g) => g.id !== id);
      const at = targetId === null ? -1 : rest.findIndex((g) => g.id === targetId);
      rest.splice(at === -1 ? rest.length : at, 0, moved);
      rest.forEach((g, i) => {
        g.sortOrder = (i + 1) * 16384;
      });
      b.groups = rest;
    });
  }

  moveCategory(id: string, groupId: string, targetId: string | null): Promise<void> {
    if (this.missingHandlers.has('category-move'))
      return Promise.reject(new RpcError('actual', 'missing', { code: UNAVAILABLE_HANDLER }));
    return this.write(['categories'], (b) => {
      const all = b.groups.flatMap((g) => g.categories);
      const moved = all.find((c) => c.id === id);
      const group = b.groups.find((g) => g.id === groupId);
      if (!moved || !group) throw new Error(`No category ${id} or group ${groupId}`);
      for (const g of b.groups) g.categories = g.categories.filter((c) => c.id !== id);
      moved.groupId = groupId;
      const at = targetId === null ? -1 : group.categories.findIndex((c) => c.id === targetId);
      group.categories.splice(at === -1 ? group.categories.length : at, 0, moved);
      group.categories.forEach((c, i) => {
        c.sortOrder = (i + 1) * 16384;
      });
    });
  }

  onSync(handler: (event: SyncEvent) => void): void {
    this.listeners.push(handler);
  }

  setOfflineFallback(on: boolean): void {
    this.offlineFallback = on;
  }

  get openBudget(): string | null {
    return this.open?.cloudFileId ?? null;
  }
}

type FakeRecur = { frequency: string; interval?: number; start: string };

const byDateDesc = (x: RawTransaction, y: RawTransaction): number =>
  x.date < y.date ? 1 : x.date > y.date ? -1 : y.sortOrder - x.sortOrder;

/** The first `n` occurrences from a config's start. */
function occurrencesOf(config: FakeRecur | undefined, n: number): ISODate[] {
  if (!config) return [];
  const out: ISODate[] = [config.start as ISODate];
  while (out.length < n) out.push(nextOccurrence(config, out.at(-1) as ISODate));
  return out;
}

/** A schedule's first date: a plain date, or the config's start. */
function firstDate(date: unknown): string | null {
  if (typeof date === 'string') return date;
  if (date && typeof date === 'object' && 'start' in date) return String(date.start);
  return null;
}

/** The occurrence after `from` (a small model of Actual's rules, enough for tests). */
function nextOccurrence(config: FakeRecur, from: ISODate): ISODate {
  const n = config.interval ?? 1;
  switch (config.frequency) {
    case 'daily':
      return addDays(from, n);
    case 'weekly':
      return addDays(from, 7 * n);
    case 'yearly': {
      const { y, m, d } = parts(from);
      return toISODate(y + n, m, d);
    }
    default: {
      const { d } = parts(from);
      const month = addMonths(monthOf(from), n);
      const [y, m] = month.split('-').map(Number) as [number, number];
      return toISODate(y, m, Math.min(d, daysInMonth(y, m)));
    }
  }
}
