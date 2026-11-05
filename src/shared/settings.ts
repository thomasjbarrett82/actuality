// Device settings files (19 §1–2), owned by main. Reading is tolerant: every missing or invalid key falls
// back to its default, so a damaged file still yields complete settings. Patches are validated strictly.
// Files carry a `schemaVersion` for migrations.
import { z } from 'zod';
import { DATE_FORMATS } from './dates';
import { NUMBER_FORMATS } from './money';
import { parseSavedFilters, REPORT_PAGES, type SavedFilter } from './reporting/model';

export const SETTINGS_SCHEMA_VERSION = 1;

const budgetRef = z.object({ cloudFileId: z.string(), groupId: z.string(), name: z.string() });

/** `{userData}/settings.json` (19 §1). */
export const appSettingsSchema = z.object({
  schemaVersion: z.number().int(),
  serverUrl: z.string().nullable(),
  openLastBudgetOnStartup: z.boolean(),
  lastBudget: budgetRef.nullable(),
  recentBudgets: z.array(budgetRef.extend({ lastOpenedAt: z.number() })).max(10),
  lastPickedCurrency: z.string().nullable(),
  lastPickedNumberFormat: z.enum(NUMBER_FORMATS).nullable(),
  lastPickedDateFormat: z.enum(DATE_FORMATS).nullable(),
  sidebarExpanded: z.boolean(),
  zoomFactor: z.number().min(0.8).max(2),
  budgetHeaderExpanded: z.boolean(),
  /** Masks every money amount on screen (06 §7). */
  privacyMode: z.boolean(),
  appearance: z.enum(['system', 'light', 'dark']),
  colorVision: z.enum(['standard', 'cvd']),
  /** 'system' or a shipped locale tag; an unknown tag counts as 'system' (20 §3.3). */
  language: z.string(),
  autofillCategory: z.boolean(),
  autofillNotes: z.boolean(),
  autofillAmount: z.boolean(),
  clearCacheOnExit: z.boolean(),
  fileAssociations: z.boolean(),
  /** The log level of all three processes: off = `info`, on = `debug` (02 §8). */
  debugLogging: z.boolean(),
  extraCaCertPath: z.string().nullable(),
  serverUsers: z.record(z.string(), z.string()),
  window: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      isMaximized: z.boolean(),
    })
    .nullable(),
  lastExportFolder: z.string().nullable(),
  firstRunVersion: z.string().nullable(),
  lastRunVersion: z.string().nullable(),
  hints: z.record(z.string(), z.literal(true)),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  serverUrl: null,
  openLastBudgetOnStartup: true,
  lastBudget: null,
  recentBudgets: [],
  lastPickedCurrency: null,
  lastPickedNumberFormat: null,
  lastPickedDateFormat: null,
  sidebarExpanded: true,
  zoomFactor: 1,
  budgetHeaderExpanded: true,
  privacyMode: false,
  appearance: 'system',
  colorVision: 'standard',
  language: 'system',
  autofillCategory: true,
  autofillNotes: false,
  autofillAmount: false,
  clearCacheOnExit: false,
  fileAssociations: false,
  debugLogging: false,
  extraCaCertPath: null,
  serverUsers: {},
  window: null,
  lastExportFolder: null,
  firstRunVersion: null,
  lastRunVersion: null,
  hints: {},
};

const column = z.object({ field: z.string(), visible: z.boolean(), width: z.number() });
const sort = z.object({ field: z.string(), desc: z.boolean() });

/** `{userData}/budgets/{cloudFileId}.json` (19 §2). */
export const budgetSettingsSchema = z.object({
  schemaVersion: z.number().int(),
  localId: z.string().nullable(),
  lastSyncAt: z.number().nullable(),
  lastScreen: z.string().nullable(),
  onBudgetGroupCollapsed: z.boolean(),
  offBudgetGroupCollapsed: z.boolean(),
  budget: z.object({
    lastSelectedMonth: z.string().nullable(),
    categoryColumnWidth: z.number(),
    showEmptyOutflowTooltip: z.boolean(),
    collapsedGroups: z.array(z.string()),
  }),
  register: z.object({
    showPreImportDialog: z.boolean(),
    accounts: z.record(
      z.string(),
      z.object({
        mainColumns: z.array(column).optional(),
        scheduleColumns: z.array(column).optional(),
        // 1–4 keys, primary first (10 §2); a single key object is read as one key.
        mainSort: z.union([z.array(sort), sort]).optional(),
        scheduleSort: sort.optional(),
        dateFilter: z.object({ label: z.string(), start: z.string(), end: z.string() }).optional(),
        showReconciled: z.boolean().optional(),
        schedulerVisible: z.boolean().optional(),
        schedulerHeight: z.number().optional(),
      }),
    ),
  }),
  /**
   * Saved report filters by page (15 §3, 19 §2): named snapshots only. Each definition is validated on
   * its own; a bad one, or one filed under the wrong page, is dropped and the rest are kept.
   */
  reports: z.object({
    savedFiltersByPage: z.record(z.string(), z.unknown()).transform((raw) => {
      const out: Partial<Record<(typeof REPORT_PAGES)[number], SavedFilter[]>> = {};
      for (const page of REPORT_PAGES) {
        const list = parseSavedFilters(raw[page]).filter((f) => f.page === page);
        if (list.length > 0) out[page] = list;
      }
      return out;
    }),
  }),
  payeeSettings: z.object({ lastPayeeId: z.string().nullable() }),
});

export type BudgetSettings = z.infer<typeof budgetSettingsSchema>;

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  localId: null,
  lastSyncAt: null,
  lastScreen: null,
  onBudgetGroupCollapsed: false,
  offBudgetGroupCollapsed: false,
  budget: {
    lastSelectedMonth: null,
    categoryColumnWidth: 14.5,
    showEmptyOutflowTooltip: true,
    collapsedGroups: [],
  },
  register: { showPreImportDialog: true, accounts: {} },
  reports: { savedFiltersByPage: {} },
  payeeSettings: { lastPayeeId: null },
};

/** Tolerant read: each top-level key is validated on its own and replaced by its default if invalid. */
function tolerant<T extends Record<string, unknown>>(
  schema: z.ZodObject,
  defaults: T,
  raw: unknown,
): T {
  const src = isObject(raw) ? raw : {};
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, keySchema] of Object.entries(schema.shape)) {
    if (!(key in src)) continue;
    const parsed = (keySchema as z.ZodType).safeParse(src[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as T;
}

export function parseAppSettings(raw: unknown): AppSettings {
  return tolerant(appSettingsSchema, DEFAULT_APP_SETTINGS, raw);
}

export function parseBudgetSettings(raw: unknown): BudgetSettings {
  return tolerant(budgetSettingsSchema, DEFAULT_BUDGET_SETTINGS, raw);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strict partial schemas for patches. */
export const appSettingsPatchSchema = appSettingsSchema.partial().strict();
export const budgetSettingsPatchSchema = budgetSettingsSchema.partial().strict();
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
export type BudgetSettingsPatch = z.infer<typeof budgetSettingsPatchSchema>;

/** Keys the renderer may change through `shell.settings`. Main and the host own the rest. */
export const RENDERER_WRITABLE_APP_KEYS = [
  'openLastBudgetOnStartup',
  'lastPickedCurrency',
  'lastPickedNumberFormat',
  'lastPickedDateFormat',
  'sidebarExpanded',
  'zoomFactor',
  'budgetHeaderExpanded',
  'privacyMode',
  'appearance',
  'colorVision',
  'language',
  'autofillCategory',
  'autofillNotes',
  'autofillAmount',
  'clearCacheOnExit',
  'fileAssociations',
  'debugLogging',
  'lastExportFolder',
  'hints',
] as const satisfies readonly (keyof AppSettings)[];

export type RendererWritableAppKey = (typeof RENDERER_WRITABLE_APP_KEYS)[number];
