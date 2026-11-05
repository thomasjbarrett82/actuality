// Device settings files (19), owned by main: {userData}/settings.json and budgets/{cloudFileId}.json.
// Written atomically (temp file + rename), read tolerantly (every bad key falls back to its default),
// schema-versioned. Change listeners broadcast settings changes to the renderer.
import {
  parseAppSettings,
  parseBudgetSettings,
  SETTINGS_SCHEMA_VERSION,
  type AppSettings,
  type AppSettingsPatch,
  type BudgetSettings,
  type BudgetSettingsPatch,
} from '@shared/settings';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Upgrades older files. Version 1 is the first; later versions add steps here. */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version > SETTINGS_SCHEMA_VERSION) return raw;
  return { ...raw, schemaVersion: SETTINGS_SCHEMA_VERSION };
}

/** Waits between rename attempts: about 0.4 s in all. */
const RENAME_WAITS_MS = [10, 20, 50, 100, 200];
/** What Windows reports while antivirus or the search indexer holds the target open. */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** `rename`, tried again for a moment while the target is locked (Windows). */
export function renameRetrying(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  wait: (ms: number) => void = sleepSync,
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const delay = RENAME_WAITS_MS[attempt];
      if (delay === undefined || !LOCKED.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      wait(delay);
    }
  }
}

/** Writes a file atomically: a crash leaves either the old or the new content, never a mix. */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    renameRetrying(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export type SettingsChange =
  | { scope: 'app'; settings: AppSettings }
  | { scope: 'budget'; cloudFileId: string; settings: BudgetSettings | null };

export class SettingsStore {
  private app: AppSettings;
  private readonly budgetsDir: string;
  private readonly listeners = new Set<(change: SettingsChange) => void>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.budgetsDir = join(dir, 'budgets');
    mkdirSync(this.budgetsDir, { recursive: true });
    this.app = parseAppSettings(migrate(readJson(this.appPath)));
  }

  private get appPath(): string {
    return join(this.dir, 'settings.json');
  }

  private budgetPath(cloudFileId: string): string {
    if (!SAFE_ID.test(cloudFileId)) throw new Error(`Invalid budget id: ${cloudFileId}`);
    return join(this.budgetsDir, `${cloudFileId}.json`);
  }

  onChange(listener: (change: SettingsChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: SettingsChange): void {
    for (const l of this.listeners) l(change);
  }

  getApp(): AppSettings {
    return structuredClone(this.app);
  }

  patchApp(patch: AppSettingsPatch): AppSettings {
    this.app = parseAppSettings({ ...this.app, ...patch });
    writeJsonAtomic(this.appPath, this.app);
    this.notify({ scope: 'app', settings: this.getApp() });
    return this.getApp();
  }

  getBudget(cloudFileId: string): BudgetSettings {
    return parseBudgetSettings(migrate(readJson(this.budgetPath(cloudFileId))));
  }

  patchBudget(cloudFileId: string, patch: BudgetSettingsPatch): BudgetSettings {
    const next = parseBudgetSettings({ ...this.getBudget(cloudFileId), ...patch });
    writeJsonAtomic(this.budgetPath(cloudFileId), next);
    this.notify({ scope: 'budget', cloudFileId, settings: next });
    return next;
  }

  deleteBudget(cloudFileId: string): void {
    rmSync(this.budgetPath(cloudFileId), { force: true });
    this.notify({ scope: 'budget', cloudFileId, settings: null });
  }

  /** Every budget settings file, by cloudFileId. */
  budgetIds(): string[] {
    return readdirSync(this.budgetsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((id) => SAFE_ID.test(id));
  }

  patchAllBudgets(patch: BudgetSettingsPatch): void {
    for (const id of this.budgetIds()) this.patchBudget(id, patch);
  }

  deleteAllBudgets(): void {
    for (const id of this.budgetIds()) this.deleteBudget(id);
  }
}
