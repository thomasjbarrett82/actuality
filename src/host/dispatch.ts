// RPC dispatch for renderer calls (02 §4): find the method, validate params with zod, run the handler.
// Handlers that touch the API run inside queue jobs; writes go through the write gate (03 §5).
import type { ISODate, Month } from '@shared/domain/types';
import { hostMethods, type HostMethod, type HostResult } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import type { z } from 'zod';
import type { Connection } from './connection';
import type { AccountsService } from './services/accounts';
import type { BudgetService } from './services/budget';
import type { BudgetFileService } from './services/budget-file';
import type { CategoriesService } from './services/categories';
import type { ExportService } from './services/export';
import type { ImportService } from './services/import';
import type { NotesService } from './services/notes';
import type { PayeesService } from './services/payees';
import type { ReadService } from './services/read';
import type { ReconcileService } from './services/reconcile';
import type { ReportsService } from './services/reports';
import type { RuleEdit, RulesService } from './services/rules';
import type { SchedulesService } from './services/schedules';
import type { SlateWipeService } from './services/slate-wipe';
import type { TagsService } from './services/tags';
import type { TransactionsService } from './services/transactions';

/** The services the RPC methods route to. */
export interface Services {
  connection: Connection;
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
}

type Handlers = {
  [M in HostMethod]: (
    params: z.output<(typeof hostMethods)[M]['params']>,
  ) => Promise<HostResult<M>>;
};

export function createHandlers({
  connection,
  accounts,
  budgetFile,
  notes,
  read,
  transactions,
  payees,
  rules,
  categories,
  budget,
  schedules,
  reconcile,
  importer,
  exporter,
  reports,
  slateWipe,
  tags,
}: Services): Handlers {
  return {
    'session.state': () => Promise.resolve(connection.state),
    'session.connect': (p) => connection.connect(p.serverURL, p.password, p.remember, p.force),
    'session.probeLogin': (p) => connection.probeLogin(p.serverURL),
    'session.connectOpenId': (p) => connection.connectOpenId(p.serverURL, p.remember, p.force),
    'session.cancelOpenId': () => Promise.resolve(connection.cancelOpenId()),
    'session.serverVersion': () => connection.serverVersion(),
    'session.setStaySignedIn': (p) => connection.setStaySignedIn(p.on),
    'session.clearCache': (p) => connection.clearCache(p.force),
    'session.signOut': (p) => connection.signOut(p.force),
    'session.forgetServer': (p) => connection.forgetServer(p.force),
    'session.listBudgets': () => connection.listBudgets(),
    'session.openBudget': (p) => connection.openBudget(p.cloudFileId, p.e2ePassword, p.remember),
    'session.closeBudget': (p) => connection.closeBudget(p.force),
    'session.syncNow': () => connection.syncNow(),
    'session.retryConnection': () => connection.retry('manual'),
    'session.cancelSignIn': () => Promise.resolve(connection.cancelSignIn()),
    'budgetFile.create': (p) => budgetFile.create(p.name, p.template, p.formats, p.force ?? false),
    'budgetFile.properties': () => budgetFile.properties(),
    'budgetFile.updateProperties': (p) => budgetFile.updateProperties(p),
    'budgetFile.setEncryptionKey': (p) => budgetFile.setEncryptionKey(p.password, p.remember),
    'budgetFile.exportBackup': (p) => budgetFile.exportBackup(p.path),
    'budgetFile.importFile': (p) =>
      budgetFile.importFile(p.path, p.type, p.importedSuffix, p.force ?? false),
    'slateWipe.impact': (p) => slateWipe.impact(p.cutoffMonth as Month | null),
    'slateWipe.run': (p) => slateWipe.run({ ...p, cutoffMonth: p.cutoffMonth as Month | null }),
    'prefs.synced': () => budgetFile.synced(),
    'prefs.setSynced': (p) => budgetFile.setSynced(p.key, p.value),
    'notes.get': (p) => notes.get(p.id),
    'notes.set': (p) => notes.set(p.id, p.text),
    'accounts.list': () => read.accounts(),
    'accounts.create': (p) => accounts.create(p),
    'accounts.update': ({ id, ...patch }) => accounts.update(id, patch),
    'accounts.close': (p) => accounts.close(p.id, p.transferAccountId, p.transferCategoryId),
    'accounts.reopen': (p) => accounts.reopen(p.id),
    'accounts.delete': (p) => accounts.delete(p.id),
    'accounts.reorder': (p) => accounts.reorder(p.id, p.beforeId, p.group),
    'categories.tree': () => read.categories(),
    'payees.list': () => read.payees(),
    'transactions.list': (p) => read.transactions(p.accountId),
    'transactions.get': (p) => read.transaction(p.id),
    'transactions.commit': (p) => transactions.commit(p),
    'transactions.setCleared': (p) => transactions.setCleared(p.ids, p.state),
    'transactions.approve': (p) => transactions.approve(p.ids),
    'tags.list': () => tags.list(),
    'tags.create': (p) => tags.create(p),
    'tags.update': ({ id, ...fields }) => tags.update(id, fields),
    'tags.delete': (p) => tags.delete(p.id),
    'tags.discover': () => tags.discover(),
    'transactions.categorize': (p) => transactions.categorize(p.ids, p.categoryId),
    'transactions.delete': (p) => transactions.delete(p.ids),
    'transactions.undo': (p) => transactions.undo(p.token),
    'transactions.moveToAccount': (p) => transactions.moveToAccount(p.ids, p.accountId),
    'transactions.setDate': (p) => transactions.setDate(p.ids, p.date, p.clearReconciled ?? []),
    'transactions.merge': (p) => transactions.merge(p.a, p.b),
    'transactions.lastForPayee': (p) => transactions.lastForPayee(p.payeeId),
    'transactions.nextCheckNumber': (p) => transactions.nextCheckNumber(p.accountId),
    'payees.rename': ({ id, name, ...opts }) => payees.rename(id, name, opts),
    'payees.renameImpact': (p) => payees.renameImpact(p.id, p.transferAccountId, p.excludeId),
    'payees.combine': (p) => payees.combine(p.ids, p.name),
    'payees.setEnabled': (p) => payees.setEnabled(p.ids, p.enabled),
    'payees.rules': (p) => payees.rules(p.id),
    'payees.setRenameRules': (p) => payees.setRenameRules(p.id, p.conditions),
    'payees.applyRenameRules': (p) => payees.applyRenameRules(p.id, p.dryRun),
    'payees.setAutoCategory': (p) => payees.setAutoCategory(p.id, p.categoryId),
    'rules.list': () => rules.list(),
    'rules.save': (p) => rules.save(p as RuleEdit),
    'rules.delete': (p) => rules.delete(p.ids),
    'rules.matches': (p) =>
      rules.matches({ ...p, conditions: p.conditions as RuleEdit['conditions'] }),
    'rules.applyActions': (p) => rules.applyActions(p.ids, p.actions as RuleEdit['actions']),
    'categories.create': (p) => categories.create(p),
    'categories.createGroup': (p) => categories.createGroup(p.name),
    'categories.update': ({ id, ...patch }) => categories.update(id, patch),
    'categories.updateGroup': ({ id, ...patch }) => categories.updateGroup(id, patch),
    'categories.setHidden': (p) => categories.setHidden(p.categoryIds, p.groupIds, p.hidden),
    'categories.delete': (p) => categories.delete(p.id),
    'categories.deleteGroup': (p) => categories.deleteGroup(p.id),
    'categories.deleteImpact': (p) => categories.deleteImpact(p.id),
    'categories.move': (p) => categories.move(p.id, p.groupId, p.beforeId),
    'categories.moveGroup': (p) => categories.moveGroup(p.id, p.beforeId),
    'categories.moveSupport': () => categories.moveSupport(),
    'budget.months': () => budget.months(),
    'budget.month': (p) => budget.month(p.month),
    'budget.uncategorized': () => budget.uncategorized(),
    'budget.setAmount': (p) => budget.setAmount(p.month, p.categoryId, p.amount),
    'budget.setAmounts': (p) => budget.setAmounts(p.month, p.entries),
    'budget.setCarryover': (p) => budget.setCarryover(p.month, p.categoryId, p.flag),
    'budget.hold': (p) => budget.hold(p.month, p.amount),
    'budget.resetHold': (p) => budget.resetHold(p.month),
    'budget.quickBudgetStats': (p) => budget.quickBudgetStats(p.month),
    'notes.cellNotes': (p) => notes.cellNotes(p.month),
    'notes.setCellNote': (p) => notes.setCellNote(p.month, p.categoryId, p.text),
    'notes.monthNote': (p) => notes.monthNote(p.month),
    'notes.setMonthNote': (p) => notes.setMonthNote(p.month, p.text),
    'transactions.forCategoryMonth': (p) => read.forCategoryMonth(p.target, p.month),
    'transactions.incomeForMonth': (p) => read.incomeForMonth(p.month),
    'schedules.list': (p) => schedules.list(p.accountId),
    'schedules.save': (p) => schedules.save(p),
    'schedules.delete': (p) => schedules.delete(p.ids),
    'schedules.enterNow': (p) => schedules.enterNow(p.ids),
    'schedules.skip': (p) => schedules.skip(p.ids),
    'schedules.moveToAccount': (p) => schedules.moveToAccount(p.ids, p.accountId),
    'schedules.draftFromTransaction': (p) => schedules.draftFromTransaction(p.id, p.mode),
    'schedules.preview': (p) => schedules.preview(p),
    'schedules.linked': (p) => schedules.linked(p.id),
    'schedules.matches': (p) => schedules.matches(p),
    'schedules.support': () => schedules.support(),
    'reports.get': (p) => reports.get(p),
    'export.data': (p) => exporter.data(p),
    'export.reportCsv': (p) => exporter.reportCsv(p.path, p.content),
    'import.parse': (p) => importer.parse(p.path),
    'import.run': (p) => importer.run(p.token, p.accounts, p.texts),
    'reconcile.clearedThrough': (p) => reconcile.clearedThrough(p.accountId, p.date as ISODate),
    'reconcile.finish': (p) =>
      reconcile.finish({ ...p, statementDate: p.statementDate as ISODate }),
  };
}

const isMethod = (m: string): m is HostMethod => Object.hasOwn(hostMethods, m);

/** Validates and routes one request. Throws RpcError `validation` for unknown methods and bad params. */
export async function dispatch(
  handlers: Handlers,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (!isMethod(method)) throw new RpcError('validation', `Unknown method ${method}.`);
  const schema: z.ZodType = hostMethods[method].params;
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.'),
      message: i.message,
    }));
    throw new RpcError('validation', `Invalid parameters for ${method}.`, { issues });
  }
  const handler = handlers[method] as (p: unknown) => Promise<unknown>;
  return handler(parsed.data);
}
