import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import type { RendererBudgetPatch } from '@shared/shell-api';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBudgetSettings } from './budget-settings';

// A stand-in for main: patches take a moment and merge into one "disk" copy.
let disk: BudgetSettings;
const patchBudget = vi.fn(async (_id: string, p: RendererBudgetPatch) => {
  await new Promise((r) => setTimeout(r, 5));
  disk = structuredClone({ ...disk, ...(p as Partial<BudgetSettings>) });
  return structuredClone(disk);
});
const getBudget = vi.fn(() => Promise.resolve(structuredClone(disk)));

beforeEach(() => {
  disk = structuredClone(DEFAULT_BUDGET_SETTINGS);
  patchBudget.mockClear();
  setActivePinia(createPinia());
  (globalThis as unknown as { window: unknown }).window = {
    app: { shell: { settings: { getBudget, patchBudget, onChange: () => () => undefined } } },
  };
});

const view = (s: BudgetSettings) => s.register.accounts['a1'];

describe('budget settings patches', () => {
  it('keeps every change when several patches overlap', async () => {
    const store = useBudgetSettings();
    await store.load('c1');
    const add = (patch: Partial<NonNullable<ReturnType<typeof view>>>) =>
      store.patch(({ register }) => ({
        register: {
          ...register,
          accounts: { ...register.accounts, a1: { ...register.accounts['a1'], ...patch } },
        },
      }));
    await Promise.all([
      add({ showReconciled: false }),
      add({ mainSort: { field: 'payee', desc: true } }),
      store.patch({ lastScreen: 'account:a1' }),
      add({ dateFilter: { label: 'thisMonth', start: '2026-10', end: '2026-10' } }),
    ]);
    expect(view(disk)).toEqual({
      showReconciled: false,
      mainSort: { field: 'payee', desc: true },
      dateFilter: { label: 'thisMonth', start: '2026-10', end: '2026-10' },
    });
    expect(view(store.settings)).toEqual(view(disk));
    expect(store.settings.lastScreen).toBe('account:a1');
  });

  it('shows what is on disk when a write fails', async () => {
    const store = useBudgetSettings();
    await store.load('c1');
    patchBudget.mockRejectedValueOnce(new Error('refused'));
    await expect(store.patch({ lastScreen: 'budget' })).rejects.toThrow('refused');
    expect(store.settings.lastScreen).toBeNull();
  });
});
