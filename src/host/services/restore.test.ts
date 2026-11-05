// Putting back what Actual's rules changed on added transactions (12 §2, 16 §1.5),
// on the fake API.
import { decode, encode } from '@shared/metadata/notes-codec';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NewTransaction, RawRow } from '../actual';
import { FakeActual, rawTransaction, type FakeBudget } from '../testing/fake-actual';
import { addRestoring, importedRowPatch } from './restore';

const entered = (over: Partial<NewTransaction> = {}): NewTransaction => ({
  id: 't-new',
  date: '2026-10-10',
  amount: -3_000,
  payee: 'p-shop',
  category: 'c-fun',
  notes: 'mine',
  cleared: false,
  reconciled: false,
  ...over,
});

describe('addRestoring (12 §2)', () => {
  let actual: FakeActual;
  let budget: FakeBudget;
  const find = (id: string) => budget.transactions.find((t) => t.id === id);

  beforeEach(async () => {
    actual = new FakeActual();
    budget = actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      payees: [{ id: 'p-shop', name: 'Shop', transferAcct: null }],
      transactions: [rawTransaction({ id: 't-old', account: 'a1' })],
    });
    await actual.downloadBudget(budget.groupId);
  });

  it('adds the row as entered when no rule changes it, without an update', async () => {
    const updated: string[] = [];
    const update = actual.updateTransaction.bind(actual);
    actual.updateTransaction = (id, patch) => {
      updated.push(id);
      return update(id, patch);
    };
    await expect(addRestoring(actual, 'a1', entered())).resolves.toEqual({ linkedSchedule: null });
    expect(find('t-new')).toMatchObject({ category: 'c-fun', notes: 'mine', payee: 'p-shop' });
    expect(updated).toEqual([]);
  });

  it("reports no link when Actual didn't keep the row (a reused id is dropped)", async () => {
    await actual.deleteTransaction('t-old');
    await expect(addRestoring(actual, 'a1', entered({ id: 't-old' }))).resolves.toEqual({
      linkedSchedule: null,
    });
    expect(find('t-old')).toBeUndefined();
  });

  it("doesn't report a link the app made itself", async () => {
    const result = await addRestoring(actual, 'a1', entered({ schedule: 's1' }));
    expect(result).toEqual({ linkedSchedule: null });
    expect(find('t-new')?.schedule).toBe('s1');
  });

  it("puts back the user's split lines when a schedule's template replaced them", async () => {
    actual.onAdd = (row) => {
      row.schedule = 's1';
      row.subtransactions = [
        rawTransaction({
          id: 'c-tmpl',
          account: row.account,
          amount: row.amount,
          category: 'c-food',
          notes: 'template',
          parentId: row.id,
        }),
      ];
    };
    const lines = [
      { amount: -1_000, payee: null, category: 'c-fun', notes: 'a' },
      { amount: -2_000, payee: null, category: 'c-food', notes: 'b' },
    ];
    const result = await addRestoring(
      actual,
      'a1',
      entered({ category: null, subtransactions: lines }),
    );
    expect(result).toEqual({ linkedSchedule: 's1' });
    const row = find('t-new');
    expect(row?.schedule).toBe('s1');
    expect(
      row?.subtransactions.map((l) => ({ amount: l.amount, category: l.category, notes: l.notes })),
    ).toEqual([
      { amount: -1_000, category: 'c-fun', notes: 'a' },
      { amount: -2_000, category: 'c-food', notes: 'b' },
    ]);
  });

  it("leaves the user's split alone when the rules kept its lines", async () => {
    actual.onAdd = (row) => {
      row.schedule = 's1';
    };
    const updated: unknown[] = [];
    const update = actual.updateTransaction.bind(actual);
    actual.updateTransaction = (id, patch) => {
      updated.push(patch);
      return update(id, patch);
    };
    await addRestoring(
      actual,
      'a1',
      entered({
        category: null,
        subtransactions: [
          { amount: -1_000, payee: null, category: 'c-fun', notes: 'a' },
          { amount: -2_000, payee: null, category: 'c-food', notes: 'b' },
        ],
      }),
    );
    expect(updated).toEqual([]);
  });

  it('turns a split the rules made back into the one category the user entered', async () => {
    actual.onAdd = (row) => {
      row.isParent = true;
      row.category = null;
      row.subtransactions = [
        rawTransaction({ id: 'c-1', account: row.account, amount: -1_500, parentId: row.id }),
        rawTransaction({ id: 'c-2', account: row.account, amount: -1_500, parentId: row.id }),
      ];
    };
    await addRestoring(actual, 'a1', entered());
    const row = find('t-new');
    expect(row).toMatchObject({ isParent: false, category: 'c-fun' });
    expect(row?.subtransactions).toEqual([]);
  });

  it("restores a payee and notes a rule changed, keeping the schedule's category for an empty one", async () => {
    budget.payees.push({ id: 'p-other', name: 'Other', transferAcct: null });
    actual.onAdd = (row) => {
      row.schedule = 's1';
      row.payee = 'p-other';
      row.category = 'c-food';
      row.notes = 'template #needs-review';
    };
    const result = await addRestoring(actual, 'a1', entered({ category: null }));
    expect(result).toEqual({ linkedSchedule: 's1' });
    expect(find('t-new')).toMatchObject({
      payee: 'p-shop',
      notes: 'mine',
      category: 'c-food',
      schedule: 's1',
    });
  });
});

describe('importedRowPatch (16 §1.5)', () => {
  const row = (over: Partial<RawRow>): RawRow => ({
    id: 'r1',
    account: 'a1',
    date: '2026-10-01',
    amount: -500,
    payee: null,
    category: null,
    notes: null,
    cleared: true,
    reconciled: false,
    transferId: null,
    importedId: 'imp-1',
    importedPayee: 'SHOP',
    schedule: null,
    isParent: false,
    isChild: false,
    parentId: null,
    ...over,
  });
  const wrote = encode({ notes: 'memo', checkNumber: '101', needsReview: true });

  it('is empty when the row is as imported', () => {
    expect(importedRowPatch({ notes: wrote, category: 'c1' }, row({ notes: wrote }))).toEqual({});
  });

  it("brings back the check number and review tag a rule's notes action dropped (23 §5)", () => {
    const patch = importedRowPatch(
      { notes: wrote, category: null },
      row({ notes: 'rewritten by rule' }),
    );
    expect(decode(patch.notes)).toEqual({
      notes: 'rewritten by rule',
      checkNumber: '101',
      needsReview: true,
    });
    expect(patch).not.toHaveProperty('category');
  });

  it("restores the imported notes on a row a schedule's rule linked, keeping the review tag", () => {
    const patch = importedRowPatch(
      { notes: encode({ notes: 'memo', checkNumber: '101', needsReview: false }), category: null },
      row({ schedule: 's1', notes: 'template', category: 'c-sched' }),
    );
    expect(patch).toEqual({ notes: wrote });
  });

  it("puts back an imported category over the schedule's, but not on a split", () => {
    const linked = row({ schedule: 's1', notes: wrote, category: 'c-sched' });
    expect(importedRowPatch({ notes: wrote, category: 'c1' }, linked)).toEqual({ category: 'c1' });
    expect(
      importedRowPatch({ notes: wrote, category: 'c1' }, { ...linked, isParent: true }),
    ).toEqual({});
  });
});
