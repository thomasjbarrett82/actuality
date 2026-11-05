// Budget files (03 §8 `budgetFile.*`, `prefs.*`; 07 §4): creating a budget from a starting template with
// `runImport`, reading and saving Budget Properties (formats, the name through `save-prefs`, and end-to-end
// encryption through `key-make`), and the synced prefs. Creation is one host job in Connection; the rest are read jobs and gated write jobs.
import { errorCode } from '@shared/aspects/log-entry';
import { weekDayOf } from '@shared/budget-format';
import type { OpenBudgetInfo } from '@shared/connection';
import type { DateFormat } from '@shared/dates';
import { DATE_FORMATS } from '@shared/dates';
import type { NumberFormat } from '@shared/money';
import { NUMBER_FORMATS } from '@shared/money';
import type {
  BudgetFileType,
  BudgetFormats,
  BudgetProperties,
  BudgetPropertiesPatch,
  BudgetTemplate,
  EncryptionKeyResult,
  SyncedPrefKey,
} from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ActualApi } from '../actual';
import type { Connection } from '../connection';
import { toRpcError } from '../connection';
import type { JobQueue } from '../queue';
import { zipFolder } from '../zip';

/** Server answers to a refused rename that mean "not allowed", not "signed out" (03 §7.1). */
const PERMISSION_REASONS = new Set(['forbidden', 'unauthorized', 'permission-denied', 'not-owner']);

const asNumberFormat = (v: string | undefined): NumberFormat =>
  NUMBER_FORMATS.find((f) => f === v) ?? 'comma-dot';
const asDateFormat = (v: string | undefined): DateFormat =>
  DATE_FORMATS.find((f) => f === v) ?? 'MM/dd/yyyy';

/** A budget name as saved: trimmed and non-empty (07 §4). */
function budgetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed)
    throw new RpcError('validation', 'The budget needs a name.', { code: 'empty-name' });
  return trimmed;
}

/**
 * The synced prefs for these formats (04 §3): strings, `hideFraction` as "true"/"false" and the first day
 * of the week as "0" (Sunday) to "6".
 */
function prefsFor(formats: BudgetPropertiesPatch): [SyncedPrefKey | 'flags.currency', string][] {
  const out: [SyncedPrefKey | 'flags.currency', string][] = [];
  if (formats.currency !== undefined) {
    out.push(['defaultCurrencyCode', formats.currency]);
    // Actual web shows a currency only with this flag, which it writes itself when one is chosen (04 §3).
    if (formats.currency !== '') out.push(['flags.currency', 'true']);
  }
  if (formats.numberFormat !== undefined) out.push(['numberFormat', formats.numberFormat]);
  if (formats.dateFormat !== undefined) out.push(['dateFormat', formats.dateFormat]);
  if (formats.hideFraction !== undefined)
    out.push(['hideFraction', formats.hideFraction ? 'true' : 'false']);
  if (formats.firstDayOfWeek !== undefined)
    out.push(['firstDayOfWeekIdx', String(formats.firstDayOfWeek)]);
  return out;
}

/** Writes a backup zip (07 §6, 18 §2). Errors keep their Node code for the message. */
export async function writeBackup(path: string, zip: Uint8Array): Promise<void> {
  try {
    await writeFile(path, zip);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    throw new RpcError('internal', `The backup could not be saved (${code}).`, {
      code: 'backup-failed',
      errno: code,
    });
  }
}

export class BudgetFileService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
  ) {}

  /**
   * `budgetFile.create` (07 §4): the template's groups and categories and the formats are written inside
   * `runImport`, so the budget is uploaded in its final state.
   */
  async create(
    name: string,
    template: BudgetTemplate,
    formats: BudgetFormats,
    force: boolean,
  ): Promise<OpenBudgetInfo> {
    const fill = async (): Promise<void> => {
      for (const group of template.groups) {
        const groupId = await this.actual.createCategoryGroup(group.name);
        // createCategory puts each new category at the top of its group: add them last to first.
        for (const category of [...group.categories].reverse())
          await this.actual.createCategory(groupId, category);
      }
      // runImport keeps Actual's income group with its two categories. Should it ever be empty,
      // give it one income category (07 §4.1).
      const income = (await this.actual.getCategoryGroups()).find((g) => g.isIncome);
      if (income && income.categories.length === 0)
        await this.actual.createCategory(income.id, template.incomeCategory, true);
      for (const [key, value] of prefsFor(formats)) await this.actual.setPreference(key, value);
    };
    return await this.connection.createBudget(budgetName(name), fill, force);
  }

  /**
   * `budgetFile.exportBackup` (07 §6): Actual's export zip of the open budget, written to `path` by the
   * host. It only reads the budget, so it works offline.
   */
  async exportBackup(path: string): Promise<null> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    await this.queue.run(
      'budgetFile.exportBackup',
      async () => {
        await writeBackup(path, await this.actual.exportBudget());
      },
      { kind: 'read' },
    );
    return null;
  }

  /**
   * `budgetFile.importFile` (07 §3.4): a new server budget from an Actual export, a YNAB 4 budget (its zip
   * or its `.ynab4` folder) or an nYNAB export, then opened.
   */
  async importFile(
    path: string,
    type: BudgetFileType,
    importedSuffix: string,
    force: boolean,
  ): Promise<OpenBudgetInfo> {
    // A YNAB 4 budget is chosen by its folder, or by the Budget.ymeta file inside it: file dialogs on
    // Windows and Linux can't pick a file or a folder in one go.
    const target = type === 'ynab4' && /\.ymeta$/i.test(path) ? dirname(path) : path;
    const read = async (): Promise<{ data: Uint8Array; filename: string }> => {
      const info = await stat(target).catch(() => null);
      if (!info) throw new RpcError('not-found', 'The file no longer exists.');
      if (info.isDirectory()) {
        if (type !== 'ynab4')
          throw new RpcError('validation', 'Only a YNAB 4 budget can be a folder.', {
            code: 'bad-file',
          });
        // Actual's YNAB 4 importer takes the budget name from a zip's file name.
        return { data: await zipFolder(target), filename: `${basename(target)}.zip` };
      }
      return { data: new Uint8Array(await readFile(target)), filename: basename(target) };
    };
    return await this.connection.importBudget(read, type, importedSuffix, force);
  }

  /** `budgetFile.properties` (07 §4): the open budget's name, formats and first day of the week. */
  async properties(): Promise<BudgetProperties> {
    const budget = this.connection.state.budget;
    if (!budget) throw new RpcError('validation', 'No budget is open.');
    return await this.queue.run(
      'budgetFile.properties',
      async () => {
        const prefs = await this.actual.getPreferences();
        let shared = false;
        // Offline, or with no server entry, the status is unknown, never "not enabled" (07 §4).
        let encryption: BudgetProperties['encryption'] = 'unknown';
        if (!budget.localOnly) {
          const userId = this.connection.serverUserId;
          const remote = (await this.actual.getBudgets()).find(
            (b) => b.state === 'remote' && b.cloudFileId === budget.cloudFileId,
          );
          shared =
            userId !== null &&
            typeof remote?.owner === 'string' &&
            remote.owner !== '' &&
            remote.owner !== userId;
          if (remote) encryption = remote.hasKey === true ? 'enabled' : 'disabled';
        }
        return {
          name: budget.name,
          currency: prefs['defaultCurrencyCode'] ?? '',
          numberFormat: asNumberFormat(prefs['numberFormat']),
          dateFormat: asDateFormat(prefs['dateFormat']),
          hideFraction: prefs['hideFraction'] === 'true',
          renameAvailable: this.actual.internalHandlerAvailable('save-prefs'),
          shared,
          firstDayOfWeek: weekDayOf(prefs['firstDayOfWeekIdx']),
          encryption,
          encryptionKeyAvailable: this.actual.internalHandlerAvailable('key-make'),
        };
      },
      { kind: 'read' },
    );
  }

  /** `budgetFile.updateProperties` (07 §4): formats, and a new name renames on the server too. */
  async updateProperties(patch: BudgetPropertiesPatch): Promise<null> {
    const current = this.connection.state.budget;
    if (!current) throw new RpcError('validation', 'No budget is open.');
    const name = patch.name === undefined ? undefined : budgetName(patch.name);
    const rename = name !== undefined && name !== current.name;
    await this.connection.write('budgetFile.updateProperties', ['preferences'], async () => {
      if (rename) await this.rename(name);
      for (const [key, value] of prefsFor(patch)) await this.actual.setPreference(key, value);
    });
    if (rename) await this.connection.budgetRenamed(name);
    return null;
  }

  /**
   * `budgetFile.setEncryptionKey` (03 §7, 07 §4): enables end-to-end encryption or replaces the key, apart
   * from Save Changes. Connection runs it as one gated write job.
   */
  async setEncryptionKey(password: string, remember: boolean): Promise<EncryptionKeyResult> {
    return await this.connection.setEncryptionKey(password, remember);
  }

  private async rename(name: string): Promise<void> {
    try {
      await this.actual.renameBudget(name);
    } catch (e) {
      if (e instanceof RpcError) throw e;
      const code = errorCode(e);
      if (code && PERMISSION_REASONS.has(code))
        throw new RpcError('actual', "The server didn't allow the rename.", {
          code: 'permission-denied',
        });
      throw toRpcError(e);
    }
  }

  /** `prefs.synced` (04 §3): every synced pref of the open budget, as Actual stores them (strings). */
  async synced(): Promise<Record<string, string>> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return await this.queue.run(
      'prefs.synced',
      async () => {
        const prefs = await this.actual.getPreferences();
        return Object.fromEntries(
          Object.entries(prefs).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])),
        );
      },
      { kind: 'read' },
    );
  }

  /** `prefs.setSynced` (04 §3): one of the format prefs. `budgetType` is read-only in this app. */
  async setSynced(key: SyncedPrefKey, value: string): Promise<null> {
    await this.connection.write('prefs.setSynced', ['preferences'], () =>
      this.actual.setPreference(key, value),
    );
    return null;
  }
}
