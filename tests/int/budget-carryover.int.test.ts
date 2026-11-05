// The carryover extension (09 §6.4) on a local-only, never-uploaded budget with the process
// clock shifted forward 2 months (21 §1): a category with carryover on keeps it in the months
// Actual creates later, and a category explicitly turned off in an existing month stays off there. Never
// against the server: a shifted clock would sync future-dated changes.
import { addMonths } from '@shared/dates';
import { RESERVED, reservedIds, type BudgetMeta } from '@shared/metadata/reserved';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createRealActualForTests } from '../../src/host/actual';
import type { Connection } from '../../src/host/connection';
import type { JobQueue } from '../../src/host/queue';
import { BudgetService } from '../../src/host/services/budget';
import { MetadataRepository } from '../../src/host/services/metadata';

const RealDate = Date;
let offsetMs = 0;
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as ConstructorParameters<DateConstructor>));
  }
  static override now(): number {
    return RealDate.now() + offsetMs;
  }
}

describe('the carryover extension on a local budget with a shifted clock (09 §6.4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-carryover-'));
  globalThis.Date = ShiftedDate as DateConstructor;

  afterAll(() => {
    globalThis.Date = RealDate;
    rmSync(dir, { recursive: true, force: true });
  });

  it('extends carryover into new months and leaves an explicit off alone', async () => {
    const { actual, fixtures } = await createRealActualForTests(dir);
    const api = fixtures.api;
    // No server: nothing can be uploaded or synced.
    await actual.init({ dataDir: dir });
    try {
      let on = '';
      let off = '';
      await actual.createBudget(`Carryover ${String(RealDate.now())}`, async () => {
        const group = await api.createCategoryGroup({
          name: 'Bills',
          is_income: false,
          hidden: false,
        });
        on = await api.createCategory({
          name: 'Debt',
          group_id: group,
          is_income: false,
          hidden: false,
        });
        off = await api.createCategory({
          name: 'Rent',
          group_id: group,
          is_income: false,
          hidden: false,
        });
      });
      const metadata = new MetadataRepository(actual);
      // The service's queue and connection aren't used by the extension itself.
      const service = new BudgetService(actual, {} as JobQueue, {} as Connection, metadata);
      const before = await actual.getBudgetMonths();
      const current =
        before.find((m) => m === new Date().toISOString().slice(0, 7)) ?? before[0] ?? '';
      const explicitOff = addMonths(current as never, 2);
      await actual.setBudgetCarryover(current, on, true);
      await actual.setBudgetCarryover(current, off, true);
      await actual.setBudgetCarryover(explicitOff, off, false);

      // First run: just remembers bounds.end.
      await service.extendCarryover();
      const end = addMonths(before.at(-1) as never, 1);
      expect(
        (await metadata.read<BudgetMeta>(reservedIds.budget, RESERVED.budget)).carryoverSeenEnd,
      ).toBe(end);

      // Two months later Actual has created new months, with carryover off.
      offsetMs = 63 * 24 * 3600 * 1000;
      const after = await actual.getBudgetMonths();
      const created = after.filter((m) => m > end);
      expect(created.length).toBeGreaterThan(0);
      const carry = async (m: string, id: string): Promise<boolean | undefined> =>
        (await actual.getBudgetMonth(m)).categoryGroups
          .flatMap((g) => g.categories ?? [])
          .find((c) => c.id === id)?.carryover ?? undefined;
      expect(await carry(created[0] ?? '', on)).toBe(false);

      await service.extendCarryover();
      for (const m of created) {
        expect(await carry(m, on), m).toBe(true);
        expect(await carry(m, off), m).toBe(false);
      }
      expect(await carry(explicitOff, off)).toBe(false);
      expect(await carry(current, off)).toBe(true);
      expect(
        (await metadata.read<BudgetMeta>(reservedIds.budget, RESERVED.budget)).carryoverSeenEnd,
      ).toBe(addMonths(after.at(-1) as never, 1));
    } finally {
      offsetMs = 0;
      await actual.shutdown();
    }
  });
});
