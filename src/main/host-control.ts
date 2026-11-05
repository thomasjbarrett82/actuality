// Main's side of the control channel (02 §4.1), without Electron: request handling, the session record
// for crash recovery, and the restart policy. host-supervisor.ts wires these to the utility process.
import type { ConnectionInfo, OpenBudgetInfo } from '@shared/connection';
import {
  controlMethods,
  type ControlMethod,
  type HostToMainEvents,
  type SessionRestore,
} from '@shared/rpc/control-api';
import { RpcError } from '@shared/rpc/protocol';
import type { z } from 'zod';
import type { SecretsStore } from './secrets';
import type { SettingsStore } from './settings-store';

/** After this many crashes within the window, main stops restarting the host (03 §6.5). */
export const MAX_CRASHES = 3;
export const CRASH_WINDOW_MS = 5 * 60_000;

export class CrashPolicy {
  private crashes: number[] = [];

  /** Records a crash and says whether to restart. */
  recordCrash(now: number): boolean {
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    return this.crashes.length < MAX_CRASHES;
  }
}

/** What main tracks from the host's notifications, to restore after a crash (03 §6.5). */
export class SessionRecord {
  private connection: ConnectionInfo | null = null;
  private budget: OpenBudgetInfo | null = null;
  private slateWipe: { backupPath: string } | null = null;

  onEvent<E extends keyof HostToMainEvents>(event: E, payload: HostToMainEvents[E]): void {
    if (event === 'connection:state') {
      this.connection = payload as ConnectionInfo;
      if (!this.connection.budget) this.budget = null;
    } else if (event === 'budget:opened') {
      this.budget = payload as OpenBudgetInfo;
    } else if (event === 'job:slateWipe') {
      const p = payload as HostToMainEvents['job:slateWipe'];
      this.slateWipe = p.phase === 'started' ? { backupPath: p.backupPath ?? '' } : null;
    }
  }

  /**
   * The session to reopen, or null if there was none. It carries an interrupted slate wipe's backup path,
   * which the restarted host reports after the reopen (03 §6.5 step 5).
   */
  restore(): SessionRestore | null {
    const serverUrl = this.connection?.serverUrl;
    if (!serverUrl) return null;
    const state = this.connection?.state;
    if (!this.budget && (state === 'Disconnected' || state === 'AuthRequired')) return null;
    const slateWipe = this.takeInterruptedSlateWipe();
    return {
      serverUrl,
      cloudFileId: this.budget?.cloudFileId ?? null,
      localOnly: this.budget?.localOnly ?? false,
      ...(slateWipe ? { interruptedSlateWipe: slateWipe.backupPath } : {}),
    };
  }

  /** Changes the host hasn't pushed to the server yet (03 §5.2): the cache must survive quit (06 §5). */
  get unsyncedChanges(): boolean {
    return this.connection?.unsyncedChanges ?? false;
  }

  /** A slate wipe that was running when the host died (03 §6.5 step 5). Read once. */
  takeInterruptedSlateWipe(): { backupPath: string } | null {
    const f = this.slateWipe;
    this.slateWipe = null;
    return f;
  }
}

/** External links open only for http: and https: (02 §6). */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ControlContext {
  settings: SettingsStore;
  secrets: SecretsStore;
  openExternal: (url: string) => Promise<void>;
  focusWindow: () => void;
  /** The UI language's text for a message key (20 §3.4). */
  translate: (key: string, params?: Record<string, string>) => string;
}

const isMethod = (m: string): m is ControlMethod => Object.hasOwn(controlMethods, m);

/** Serves one control request from the host. Params are validated with zod (02 §4.1). */
export async function handleControl(
  ctx: ControlContext,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (!isMethod(method)) throw new RpcError('validation', `Unknown control method ${method}.`);
  const schema: z.ZodType = controlMethods[method].params;
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) throw new RpcError('validation', `Invalid parameters for ${method}.`);
  const p = parsed.data as Record<string, unknown>;
  const str = (k: string): string => String(p[k]);
  switch (method) {
    case 'secrets.get':
      return ctx.secrets.get(str('key'));
    case 'secrets.set':
      ctx.secrets.set(str('key'), str('value'));
      return null;
    case 'secrets.delete':
      ctx.secrets.delete(str('key'));
      return null;
    case 'secrets.clear':
      ctx.secrets.clear(p['prefix'] === undefined ? undefined : str('prefix'));
      return null;
    case 'settings.getApp':
      return ctx.settings.getApp();
    case 'settings.patchApp':
      return ctx.settings.patchApp(p['patch'] as Parameters<SettingsStore['patchApp']>[0]);
    case 'settings.getBudget':
      return ctx.settings.getBudget(str('cloudFileId'));
    case 'settings.patchBudget':
      return ctx.settings.patchBudget(
        str('cloudFileId'),
        p['patch'] as Parameters<SettingsStore['patchBudget']>[1],
      );
    case 'settings.deleteBudget':
      ctx.settings.deleteBudget(str('cloudFileId'));
      return null;
    case 'settings.patchAllBudgets':
      ctx.settings.patchAllBudgets(p['patch'] as Parameters<SettingsStore['patchAllBudgets']>[0]);
      return null;
    case 'settings.deleteAllBudgets':
      ctx.settings.deleteAllBudgets();
      return null;
    case 'shell.openExternal':
      if (!isSafeExternalUrl(str('url')))
        throw new RpcError('validation', 'Only http and https links can be opened.');
      await ctx.openExternal(str('url'));
      return null;
    case 'window.focus':
      ctx.focusWindow();
      return null;
    case 'i18n.translate':
      return ctx.translate(str('key'), (p['params'] ?? {}) as Record<string, string>);
  }
}
