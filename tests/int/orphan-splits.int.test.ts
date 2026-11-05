// Orphaned split lines (18 §1.1) on a local-only, never-uploaded budget: lines whose parent was deleted
// without them, the state Actual's Repair split transactions tool deletes. Records what Actuality shows
// for them (register, account balances, budget month), and what Actual's repair tools change.
import { today } from '@shared/dates';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createRealActualForTests } from '../../src/host/actual';
import type { Connection } from '../../src/host/connection';
import { JobQueue } from '../../src/host/queue';
import type { MetadataRepository } from '../../src/host/services/metadata';
import { ReadService } from '../../src/host/services/read';

describe('orphaned split lines on a local budget (18 §1.1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-orphans-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves them out of the register and balances, and out of the budget once its cache is reset', async () => {
    const { actual, fixtures } = await createRealActualForTests(dir);
    const api = fixtures.api;
    // No server: nothing can be uploaded or synced. The API's own init, for the handle to its internal
    // handlers (the repair tools aren't wrapped by the host).
    const lib = await api.init({ dataDir: dir });
    try {
      const date = today(new Date());
      const month = date.slice(0, 7);
      let account = '';
      let food = '';
      let split = '';
      await actual.createBudget(`Orphans ${String(Date.now())}`, async () => {
        account = await api.createAccount({ name: 'Checking', offbudget: false }, 0);
        const group = await api.createCategoryGroup({
          name: 'Living',
          is_income: false,
          hidden: false,
        });
        food = await api.createCategory({
          name: 'Food',
          group_id: group,
          is_income: false,
          hidden: false,
        });
        await api.addTransactions(account, [
          { date, amount: -500, category: food, cleared: false },
          {
            date,
            amount: -3000,
            cleared: false,
            subtransactions: [
              { amount: -1000, category: food },
              { amount: -2000, category: food },
            ],
          },
        ]);
        const { data } = (await api.aqlQuery(
          api
            .q('transactions')
            .filter({ is_parent: true })
            .select(['id'])
            .options({ splits: 'all' }),
        )) as { data: { id: string }[] };
        split = data[0]?.id ?? '';
      });

      // The read services only check that a budget is open; they don't use the metadata.
      const connection = { state: { budget: {} } } as Connection;
      const read = new ReadService(actual, new JobQueue(), connection, {} as MetadataRepository);
      const seen = async (): Promise<{ rows: number[]; working: number; spent: number }> => {
        const rows = (await read.transactions(account)).map((t) => t.amount).sort((a, b) => a - b);
        const working =
          (await read.accounts()).find((a) => a.id === account)?.balances.working ?? NaN;
        const spent =
          (await actual.getBudgetMonth(month)).categoryGroups
            .flatMap((g) => g.categories ?? [])
            .find((c) => c.id === food)?.spent ?? NaN;
        return { rows, working, spent };
      };
      expect(await seen()).toEqual({ rows: [-3000, -500], working: -3500, spent: -3500 });

      // Delete the parent alone: its lines stay alive, with no parent.
      await lib.send('transactions-batch-update', {
        updated: [{ id: split, tombstone: true }],
        runTransfers: false,
      });
      const alive = (await api.aqlQuery(
        api
          .q('transactions')
          .filter({ parent_id: split, tombstone: false })
          .select(['id'])
          .options({ splits: 'all', withDead: true }),
      )) as { data: { id: string }[] };
      expect(alive.data).toHaveLength(2);
      const orphaned = { rows: [-500], working: -500, spent: -500 };
      // The register and balances leave the lines out: ActualQL reads live rows through a view that drops
      // lines whose parent is deleted. The budget's spending query uses that view too, but deleting a
      // parent (which has no category) doesn't recompute any category's cell, so the cache still counts
      // them (26.10.0).
      expect(await seen()).toEqual({ ...orphaned, spent: -3500 });

      // Actual's Reset budget cache recomputes it, and everything agrees.
      await lib.send('reset-budget-cache');
      expect(await seen()).toEqual(orphaned);

      // Actual's Repair split transactions deletes both lines. What Actuality shows doesn't change.
      const repair = (await lib.send('tools/fix-split-transactions')) as { numDeleted: number };
      expect(repair.numDeleted).toBe(2);
      expect(await seen()).toEqual(orphaned);
    } finally {
      await actual.shutdown();
    }
  });
});
