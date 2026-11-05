// Main ↔ host control channel over the utility process's parentPort (02 §4.1). Same request/response shape
// as HostApi. Main validates the host's params with these schemas; secrets never leave main and the host.
import { z } from 'zod';
import type { LogEntry } from '../aspects/log-entry';
import type { ConnectionInfo, OpenBudgetInfo } from '../connection';
import {
  appSettingsPatchSchema,
  budgetSettingsPatchSchema,
  type AppSettings,
  type BudgetSettings,
} from '../settings';

/** Secret keys: `server:{url}` (session token) and `e2e:{cloudFileId}` (encryption password) (19 §4). */
export const secretKey = z.string().regex(/^(server|e2e):.+$/);

/** Requests the host sends to main. */
export const controlMethods = {
  'secrets.get': { params: z.object({ key: secretKey }).strict() },
  'secrets.set': { params: z.object({ key: secretKey, value: z.string().min(1) }).strict() },
  'secrets.delete': { params: z.object({ key: secretKey }).strict() },
  /** Deletes every secret, or every secret with a prefix ("e2e:"). */
  'secrets.clear': {
    params: z.object({ prefix: z.enum(['server:', 'e2e:']).optional() }).strict(),
  },
  'settings.getApp': { params: z.object({}).strict() },
  'settings.patchApp': { params: z.object({ patch: appSettingsPatchSchema }).strict() },
  'settings.getBudget': { params: z.object({ cloudFileId: z.string().min(1) }).strict() },
  'settings.patchBudget': {
    params: z.object({ cloudFileId: z.string().min(1), patch: budgetSettingsPatchSchema }).strict(),
  },
  'settings.deleteBudget': { params: z.object({ cloudFileId: z.string().min(1) }).strict() },
  'settings.patchAllBudgets': { params: z.object({ patch: budgetSettingsPatchSchema }).strict() },
  'settings.deleteAllBudgets': { params: z.object({}).strict() },
  'shell.openExternal': { params: z.object({ url: z.string() }).strict() },
  'window.focus': { params: z.object({}).strict() },
  /** Text the host must show outside the renderer (the OpenID tab page), in the UI language (20 §3.4). */
  'i18n.translate': {
    params: z
      .object({
        key: z.string().regex(/^[a-zA-Z]+.[A-Za-z0-9_]+$/),
        params: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
  },
} as const satisfies Record<string, { params: z.ZodType }>;

export interface ControlResults {
  'secrets.get': string | null;
  'secrets.set': null;
  'secrets.delete': null;
  'secrets.clear': null;
  'settings.getApp': AppSettings;
  'settings.patchApp': AppSettings;
  'settings.getBudget': BudgetSettings;
  'settings.patchBudget': BudgetSettings;
  'settings.deleteBudget': null;
  'settings.patchAllBudgets': null;
  'settings.deleteAllBudgets': null;
  'shell.openExternal': null;
  'window.focus': null;
  'i18n.translate': string;
}

export type ControlMethod = keyof typeof controlMethods;
export type ControlParams<M extends ControlMethod> = z.input<(typeof controlMethods)[M]['params']>;
export type ControlResult<M extends ControlMethod> = ControlResults[M];

/** Notifications the host sends to main: copies of renderer events main tracks for crash recovery (03 §6.5). */
export interface HostToMainEvents {
  'connection:state': ConnectionInfo;
  'budget:opened': OpenBudgetInfo;
  'job:slateWipe': { phase: 'started' | 'ended'; backupPath?: string };
  /** Host log entries: main writes the single rotating log file (02 §8.1). */
  log: LogEntry;
}

/** The message main sends with the renderer's MessagePort attached (02 §4). */
export const RENDERER_PORT_MESSAGE = 'host:renderer-port';

/** What main asks a restarted host to restore (03 §6.5). */
export interface SessionRestore {
  serverUrl: string;
  cloudFileId: string | null;
  localOnly: boolean;
  /** The backup path of a slate wipe the crash interrupted (03 §6.5 step 5), reported after the reopen. */
  interruptedSlateWipe?: string;
}

/** Requests main sends to the host. */
export interface MainToHostRequests {
  /** Run shutdown(), then reply (06 §5). */
  'app:quit': { params: Record<string, never>; result: null };
  /**
   * Reopen a crashed host's session (03 §6.5). The reply comes once the attempt has ended, failed or not,
   * so main keeps the session to restore until then.
   */
  'session:restore': { params: SessionRestore; result: null };
}

/** Notifications main sends to the host. */
export interface MainToHostEvents {
  /** Forwarded `browser-window-focus`: sync on focus (03 §4.1). */
  'window:focus': Record<string, never>;
  /** The debug logging preference: sent on change and after every host start (02 §8.3). */
  'log:level': { debug: boolean };
}
