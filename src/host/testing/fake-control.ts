// In-memory main side of the control channel, for host unit tests.
import type {
  ControlMethod,
  ControlParams,
  ControlResult,
  HostToMainEvents,
} from '@shared/rpc/control-api';
import {
  parseAppSettings,
  parseBudgetSettings,
  type AppSettings,
  type BudgetSettings,
} from '@shared/settings';
import type { ControlPort } from '../connection';

export class FakeControl implements ControlPort {
  readonly secrets = new Map<string, string>();
  app: AppSettings = parseAppSettings({});
  readonly budgets = new Map<string, BudgetSettings>();
  readonly notified: { event: keyof HostToMainEvents; payload: unknown }[] = [];
  readonly opened: string[] = [];
  focused = 0;

  call<M extends ControlMethod>(method: M, params: ControlParams<M>): Promise<ControlResult<M>> {
    return Promise.resolve(
      this.handle(method, params as Record<string, unknown>) as ControlResult<M>,
    );
  }

  notify<E extends keyof HostToMainEvents>(event: E, payload: HostToMainEvents[E]): void {
    this.notified.push({ event, payload });
  }

  private budget(id: string): BudgetSettings {
    return this.budgets.get(id) ?? parseBudgetSettings({});
  }

  private handle(method: ControlMethod, p: Record<string, unknown>): unknown {
    const key = p['key'] as string;
    const id = p['cloudFileId'] as string;
    switch (method) {
      case 'secrets.get':
        return this.secrets.get(key) ?? null;
      case 'secrets.set':
        this.secrets.set(key, p['value'] as string);
        return null;
      case 'secrets.delete':
        this.secrets.delete(key);
        return null;
      case 'secrets.clear':
        for (const k of [...this.secrets.keys()]) {
          if (!p['prefix'] || k.startsWith(p['prefix'] as string)) this.secrets.delete(k);
        }
        return null;
      case 'settings.getApp':
        return this.app;
      case 'settings.patchApp':
        this.app = { ...this.app, ...(p['patch'] as Partial<AppSettings>) };
        return this.app;
      case 'settings.getBudget':
        return this.budget(id);
      case 'settings.patchBudget': {
        const next = { ...this.budget(id), ...(p['patch'] as Partial<BudgetSettings>) };
        this.budgets.set(id, next);
        return next;
      }
      case 'settings.deleteBudget':
        this.budgets.delete(id);
        return null;
      case 'settings.patchAllBudgets':
        for (const [k, v] of this.budgets)
          this.budgets.set(k, { ...v, ...(p['patch'] as Partial<BudgetSettings>) });
        return null;
      case 'settings.deleteAllBudgets':
        this.budgets.clear();
        return null;
      case 'shell.openExternal':
        this.opened.push(p['url'] as string);
        return null;
      case 'window.focus':
        this.focused++;
        return null;
      case 'i18n.translate':
        return `[${p['key'] as string}]`;
    }
  }
}
