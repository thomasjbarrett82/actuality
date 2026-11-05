// The open budget's device settings (19 §2): `budgets/{cloudFileId}.json`, read and written through main.
// Loaded when a budget opens; patches go straight to main, which notifies every window of the result.
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import type { RendererBudgetPatch } from '@shared/shell-api';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useBudgetSettings = defineStore('budgetSettings', () => {
  const cloudFileId = ref<string | null>(null);
  const settings = ref<BudgetSettings>({ ...DEFAULT_BUDGET_SETTINGS });
  let unsubscribe: (() => void) | null = null;

  async function load(id: string): Promise<BudgetSettings> {
    cloudFileId.value = id;
    settings.value = await window.app.shell.settings.getBudget(id);
    unsubscribe ??= window.app.shell.settings.onChange((change) => {
      if (change.scope !== 'budget' || change.cloudFileId !== cloudFileId.value) return;
      settings.value = change.settings ?? { ...DEFAULT_BUDGET_SETTINGS };
    });
    return settings.value;
  }

  // Patches run one at a time and an updater form builds each patch from the settings as they are when
  // it runs. A patch replaces whole top-level keys (`register`, `budget`, …), so one built from a stale
  // snapshot would silently undo an earlier change.
  let queue: Promise<unknown> | null = null;

  function patch(
    p: RendererBudgetPatch | ((current: BudgetSettings) => RendererBudgetPatch),
  ): Promise<void> {
    const send = async (): Promise<void> => {
      const id = cloudFileId.value;
      if (!id) return;
      // Plain data only: the patch crosses the context bridge and must not carry reactive proxies.
      const body = JSON.parse(
        JSON.stringify(typeof p === 'function' ? p(settings.value) : p),
      ) as RendererBudgetPatch;
      settings.value = { ...settings.value, ...(body as Partial<BudgetSettings>) };
      try {
        settings.value = await window.app.shell.settings.patchBudget(id, body);
      } catch (e) {
        // The write failed: show what is on disk instead of a change that would vanish later.
        settings.value = await window.app.shell.settings.getBudget(id);
        throw e;
      }
    };
    // Idle: start now. Busy: after everything queued before it.
    const run: Promise<void> = queue ? queue.then(send) : send();
    const tail = run.catch(() => undefined);
    queue = tail;
    void tail.then(() => {
      if (queue === tail) queue = null;
    });
    return run;
  }

  return { cloudFileId, settings, load, patch };
});
