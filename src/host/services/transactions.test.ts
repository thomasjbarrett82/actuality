// Transaction writes on the fake API (11 §6–7; 10 §6, §8; 04 §3, §5.1): the commit pipeline's write
// (payees, transfers, splits and their mirrors, dates copied to the other side), the bulk register
// actions, delete with undo, move to account and merge.
import { decode } from '@shared/metadata/notes-codec';
import type { CommitEdit } from '@shared/rpc/host-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawCategoryGroup, RawTransaction } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { MetadataRepository } from './metadata';
import { TransactionsService } from './transactions';

const account = (a: Partial<RawAccount> & { id: string; name: string }): RawAccount => ({
  offbudget: false,
  closed: false,
  sortOrder: 0,
  accountGroupId: null,
  ...a,
});

const GROUPS = (): RawCategoryGroup[] => [
  {
    id: 'g-everyday',
    name: 'Everyday',
    isIncome: false,
    hidden: false,
    sortOrder: 1,
    categories: [
      {
        id: 'c-food',
        name: 'Food',
        groupId: 'g-everyday',
        isIncome: false,
        hidden: false,
        sortOrder: 1,
      },
      {
        id: 'c-fun',
        name: 'Fun',
        groupId: 'g-everyday',
        isIncome: false,
        hidden: false,
        sortOrder: 2,
      },
    ],
  },
];

const edit = (e: Partial<CommitEdit>): CommitEdit => ({
  accountId: 'a-check',
  date: '2026-10-10',
  amount: -1000,
  payee: { kind: 'none' },
  categoryId: null,
  notes: '',
  checkNumber: null,
  needsReview: false,
  cleared: 'U',
  ...e,
});

describe('TransactionsService (11 §6, 10 §6, §8)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: TransactionsService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };
  const rows = (): RawTransaction[] =>
    budget().transactions.flatMap((t) => [t, ...t.subtransactions]);
  const find = (id: string): RawTransaction => {
    const r = rows().find((x) => x.id === id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  };
  const inAccount = (accountId: string): RawTransaction[] =>
    budget().transactions.filter((t) => t.account === accountId);

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      groups: GROUPS(),
      accounts: [
        account({ id: 'a-check', name: 'Checking', sortOrder: 1 }),
        account({ id: 'a-save', name: 'Savings', sortOrder: 2 }),
        account({ id: 'a-house', name: 'House', offbudget: true, sortOrder: 3 }),
      ],
      payees: [
        { id: 'tp-a-check', name: '', transferAcct: 'a-check' },
        { id: 'tp-a-save', name: '', transferAcct: 'a-save' },
        { id: 'tp-a-house', name: '', transferAcct: 'a-house' },
        { id: 'p-kroger', name: 'Kroger', transferAcct: null },
      ],
      transactions: [
        rawTransaction({
          id: 't-kroger',
          account: 'a-check',
          amount: -5210,
          payee: 'p-kroger',
          category: 'c-food',
          notes: '#Vacation2025 #trip ⟦chk 101⟧',
          date: '2026-10-01',
        }),
        rawTransaction({
          id: 't-recon',
          account: 'a-check',
          amount: -700,
          payee: 'p-kroger',
          category: 'c-food',
          cleared: true,
          reconciled: true,
        }),
        rawTransaction({
          id: 't-review',
          account: 'a-check',
          amount: -300,
          payee: 'p-kroger',
          category: 'c-fun',
          notes: 'lunch #needs-review',
        }),
      ],
    });
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    service = new TransactionsService(actual, queue, conn, new MetadataRepository(actual));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  describe('commit: new transactions (11 §6 step 6)', () => {
    it('creates a new payee by name, encodes the notes and writes cleared explicitly', async () => {
      const { id } = await service.commit(
        edit({
          payee: { kind: 'new', name: 'Shell' },
          categoryId: 'c-fun',
          notes: ' fuel #Road ',
          checkNumber: '12',
        }),
      );
      const t = find(id);
      expect(budget().payees.find((p) => p.id === t.payee)?.name).toBe('Shell');
      expect(t).toMatchObject({
        amount: -1000,
        category: 'c-fun',
        cleared: false,
        reconciled: false,
      });
      expect(t.notes).toBe('fuel #Road ⟦chk 12⟧');
    });
    it("keeps the user's payee and category when Actual's rules change them on create", async () => {
      const addTransactions = actual.addTransactions.bind(actual);
      vi.spyOn(actual, 'addTransactions').mockImplementation(async (accountId, transactions) => {
        await addTransactions(accountId, transactions);
        const transaction = transactions[0];
        if (transaction)
          await actual.updateTransaction(transaction.id, { payee: 'p-kroger', category: 'c-food' });
      });

      const { id } = await service.commit(
        edit({
          payee: { kind: 'new', name: 'Shell' },
          categoryId: 'c-fun',
        }),
      );

      expect(budget().payees.find((p) => p.id === find(id).payee)?.name).toBe('Shell');
      expect(find(id)).toMatchObject({ category: 'c-fun' });
    });
    it("restores the user's entry when a schedule's rule links it (12 §2, §6 criterion 6)", async () => {
      budget().schedules.push({
        id: 's1',
        account: 'a-check',
        payee: 'p-kroger',
        completed: false,
      });
      // Actual's link-schedule rule: links the row and applies the schedule's template.
      actual.onAdd = (row) => {
        row.schedule = 's1';
        row.category = 'c-food';
        row.notes = 'groceries #needs-review';
      };
      const result = await service.commit(
        edit({
          payee: { kind: 'existing', id: 'p-kroger' },
          categoryId: 'c-fun',
          notes: 'mine #own',
          checkNumber: '7',
        }),
      );
      expect(result.matched).toEqual({ scheduleId: 's1', payeeId: 'p-kroger' });
      expect(find(result.id)).toMatchObject({
        schedule: 's1',
        category: 'c-fun',
        notes: 'mine #own ⟦chk 7⟧',
      });
      // With the category left empty, the schedule's category is kept.
      const blank = await service.commit(
        edit({ payee: { kind: 'existing', id: 'p-kroger' }, categoryId: null }),
      );
      expect(find(blank.id)).toMatchObject({ schedule: 's1', category: 'c-food' });
      expect(decode(find(blank.id).notes).needsReview).toBe(false);
    });
    it('uses an existing payee for a name in another case, without renaming it (14 §1)', async () => {
      const { id } = await service.commit(edit({ payee: { kind: 'new', name: 'kroger' } }));
      expect(find(id).payee).toBe('p-kroger');
      expect(budget().payees.find((p) => p.id === 'p-kroger')?.name).toBe('Kroger');
    });
    it('creates a bank-generic payee disabled (14 §1)', async () => {
      const { id } = await service.commit(edit({ payee: { kind: 'new', name: 'Check' } }));
      const payeeId = find(id).payee;
      expect(JSON.parse(budget().notes.get('ad:payees') ?? '{}')).toEqual({
        v: 1,
        disabled: [payeeId],
      });
    });
    it('makes an on↔on transfer with no category, and Actual creates the mirror', async () => {
      const { id } = await service.commit(
        edit({
          payee: { kind: 'transfer', accountId: 'a-save' },
          categoryId: 'c-food',
          amount: -2500,
        }),
      );
      const t = find(id);
      expect(t.category).toBeNull();
      const mirror = find(t.transferId ?? '');
      expect(mirror).toMatchObject({ account: 'a-save', amount: 2500, transferId: id });
    });
    it('keeps the category of an on→off transfer', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-house' }, categoryId: 'c-food' }),
      );
      expect(find(id).category).toBe('c-food');
    });
    it('creates a split whose transfer line gets its own mirror (11 §10 criterion 2)', async () => {
      const { id } = await service.commit(
        edit({
          payee: { kind: 'existing', id: 'p-kroger' },
          amount: -15000,
          lines: [
            { amount: -10000, transferAccountId: null, categoryId: 'c-food', notes: 'food' },
            { amount: -5000, transferAccountId: 'a-save', categoryId: null, notes: 'to savings' },
          ],
        }),
      );
      const parent = find(id);
      expect(parent.category).toBeNull();
      expect(parent.subtransactions).toHaveLength(2);
      const transferLine = parent.subtransactions.find((l) => l.payee === 'tp-a-save');
      expect(find(transferLine?.transferId ?? '')).toMatchObject({
        account: 'a-save',
        amount: 5000,
      });
    });
    it('refuses a transfer to its own account and an unbalanced split', async () => {
      await expect(
        service.commit(edit({ payee: { kind: 'transfer', accountId: 'a-check' } })),
      ).rejects.toMatchObject({
        details: { code: 'transfer-to-self' },
      });
      await expect(
        service.commit(
          edit({
            amount: -100,
            lines: [{ amount: -50, transferAccountId: null, categoryId: null, notes: '' }],
          }),
        ),
      ).rejects.toMatchObject({ details: { code: 'split-unbalanced' } });
    });
  });

  describe('commit: existing transactions', () => {
    it('keeps note text the app doesn’t understand (11 §10 criterion 1)', async () => {
      const t = decode(find('t-kroger').notes);
      await service.commit(
        edit({
          id: 't-kroger',
          payee: { kind: 'existing', id: 'p-kroger' },
          categoryId: 'c-food',
          amount: -5210,
          date: '2026-10-01',
          notes: `${t.notes} groceries`,
          checkNumber: t.checkNumber,
        }),
      );
      expect(find('t-kroger').notes).toBe('#Vacation2025 #trip groceries ⟦chk 101⟧');
    });
    it('creates a new payee on update', async () => {
      await service.commit(edit({ id: 't-kroger', payee: { kind: 'new', name: 'Aldi' } }));
      expect(budget().payees.find((p) => p.id === find('t-kroger').payee)?.name).toBe('Aldi');
    });
    it('copies a changed date to the other side of a transfer (S-3)', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const mirrorId = find(id).transferId ?? '';
      await service.commit(
        edit({ id, payee: { kind: 'transfer', accountId: 'a-save' }, date: '2026-10-15' }),
      );
      expect(find(mirrorId).date).toBe('2026-10-15');
    });
    it('clears a reconciled other side when asked', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const mirrorId = find(id).transferId ?? '';
      Object.assign(find(mirrorId), { cleared: true, reconciled: true });
      await service.commit(
        edit({
          id,
          payee: { kind: 'transfer', accountId: 'a-save' },
          amount: -2000,
          clearOtherSide: true,
        }),
      );
      expect(find(mirrorId)).toMatchObject({ cleared: true, reconciled: false, amount: 2000 });
    });
    it('deletes the mirror of a transfer line the split drops (04 §3)', async () => {
      const { id } = await service.commit(
        edit({
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: 'c-food', notes: '' },
            { amount: -50, transferAccountId: 'a-save', categoryId: null, notes: '' },
          ],
        }),
      );
      const keep = find(id).subtransactions.find((l) => l.category === 'c-food');
      expect(inAccount('a-save')).toHaveLength(1);
      await service.commit(
        edit({
          id,
          amount: -150,
          lines: [
            {
              id: keep?.id ?? '',
              amount: -100,
              transferAccountId: null,
              categoryId: 'c-food',
              notes: '',
            },
            { amount: -50, transferAccountId: null, categoryId: 'c-fun', notes: '' },
          ],
        }),
      );
      expect(inAccount('a-save')).toHaveLength(0);
      expect(
        find(id)
          .subtransactions.map((l) => l.category)
          .sort(),
      ).toEqual(['c-food', 'c-fun']);
    });
    it('collapses a split into a normal transaction', async () => {
      const { id } = await service.commit(
        edit({
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: 'c-food', notes: '' },
            { amount: -50, transferAccountId: 'a-save', categoryId: null, notes: '' },
          ],
        }),
      );
      await service.commit(edit({ id, amount: -150, categoryId: 'c-fun' }));
      const t = find(id);
      expect(t.subtransactions).toHaveLength(0);
      expect(t.category).toBe('c-fun');
      expect(inAccount('a-save')).toHaveLength(0);
    });
    it('moves a transaction to another account', async () => {
      await service.commit(
        edit({ id: 't-kroger', accountId: 'a-save', payee: { kind: 'existing', id: 'p-kroger' } }),
      );
      expect(find('t-kroger').account).toBe('a-save');
    });
    it('refuses to change the amount of a transfer a split elsewhere created (11 §2)', async () => {
      const { id } = await service.commit(
        edit({
          accountId: 'a-save',
          amount: -50,
          lines: [{ amount: -50, transferAccountId: 'a-check', categoryId: null, notes: '' }],
        }),
      );
      const mirrorId = find(id).subtransactions[0]?.transferId ?? '';
      await expect(
        service.commit(
          edit({ id: mirrorId, amount: 9999, payee: { kind: 'transfer', accountId: 'a-save' } }),
        ),
      ).rejects.toMatchObject({ details: { code: 'split-transfer-locked' } });
    });
    it('refuses to change the account of a transfer a split elsewhere created, or to move it (10 §6.1)', async () => {
      const { id } = await service.commit(
        edit({
          accountId: 'a-save',
          amount: -50,
          lines: [{ amount: -50, transferAccountId: 'a-check', categoryId: null, notes: '' }],
        }),
      );
      const mirrorId = find(id).subtransactions[0]?.transferId ?? '';
      const mirror = { ...find(mirrorId) };
      await expect(
        service.commit(
          edit({
            id: mirrorId,
            accountId: 'a-house',
            amount: mirror.amount,
            payee: { kind: 'transfer', accountId: 'a-save' },
          }),
        ),
      ).rejects.toMatchObject({ details: { code: 'split-transfer-locked' } });
      // The whole selection is refused, not just the locked row.
      await expect(service.moveToAccount(['t-kroger', mirrorId], 'a-house')).rejects.toMatchObject({
        details: { code: 'split-transfer-locked' },
      });
      expect(find(mirrorId).account).toBe('a-check');
      expect(find('t-kroger').account).toBe('a-check');
    });
  });

  describe('bulk actions (10 §6)', () => {
    it('sets cleared, skips reconciled rows, and approves on Cleared (04 §7)', async () => {
      await service.setCleared(['t-review', 't-recon'], 'C');
      expect(find('t-review')).toMatchObject({ cleared: true, notes: 'lunch' });
      expect(find('t-recon')).toMatchObject({ cleared: true, reconciled: true });
      await service.setCleared(['t-review'], 'U');
      expect(find('t-review').cleared).toBe(false);
    });
    it('approves through the notes, leaving user tags and the check number alone', async () => {
      await service.approve(['t-review']);
      expect(find('t-review').notes).toBe('lunch');
      await service.approve(['t-kroger']);
      expect(find('t-kroger').notes).toBe('#Vacation2025 #trip ⟦chk 101⟧');
    });
    it('categorizes, skipping splits and on↔on transfers, and can clear their categories', async () => {
      const { id: transfer } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      Object.assign(find(transfer), { category: 'c-food' });
      await service.categorize(['t-review', transfer], 'c-food');
      expect(find('t-review').category).toBe('c-food');
      await service.categorize([transfer], null);
      expect(find(transfer).category).toBeNull();
    });
  });

  describe('delete and undo (10 §8, §11 criterion 4)', () => {
    it('deletes a split with a transfer line and its mirror, then undoes both with new ids', async () => {
      const { id } = await service.commit(
        edit({
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: 'c-food', notes: '' },
            { amount: -50, transferAccountId: 'a-save', categoryId: null, notes: '' },
          ],
        }),
      );
      const mirror = find(find(id).subtransactions.find((l) => l.transferId)?.transferId ?? '');
      Object.assign(mirror, { date: '2026-10-11', cleared: true });
      const { token, count } = await service.delete([id]);
      expect(count).toBe(1);
      expect(rows().some((r) => r.id === id)).toBe(false);
      expect(inAccount('a-save')).toHaveLength(0);
      const { ids } = await service.undo(token ?? '');
      const again = find(ids[id] ?? '');
      expect(again.id).not.toBe(id);
      expect(again.subtransactions.map((l) => l.amount).sort()).toEqual([-100, -50]);
      const [newMirror] = inAccount('a-save');
      expect(newMirror).toMatchObject({ amount: 50, date: '2026-10-11', cleared: true });
    });
    it('deletes a transfer’s other side with it, once', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const other = find(id).transferId ?? '';
      const { count } = await service.delete([id, other]);
      expect(count).toBe(1);
      expect(inAccount('a-save')).toHaveLength(0);
    });
    it('skips a transfer a split elsewhere created', async () => {
      const { id } = await service.commit(
        edit({
          accountId: 'a-save',
          amount: -50,
          lines: [{ amount: -50, transferAccountId: 'a-check', categoryId: null, notes: '' }],
        }),
      );
      const mirrorId = find(id).subtransactions[0]?.transferId ?? '';
      expect((await service.delete([mirrorId])).count).toBe(0);
      expect(rows().some((r) => r.id === mirrorId)).toBe(true);
    });
    it('re-creates a deleted transaction with its fields, cleared state and imported id', async () => {
      Object.assign(find('t-kroger'), {
        importedId: 'bank-1',
        importedPayee: 'KROGER #1',
        cleared: true,
      });
      const { token } = await service.delete(['t-kroger']);
      const { ids } = await service.undo(token ?? '');
      expect(find(ids['t-kroger'] ?? '')).toMatchObject({
        amount: -5210,
        payee: 'p-kroger',
        category: 'c-food',
        notes: '#Vacation2025 #trip ⟦chk 101⟧',
        cleared: true,
        importedId: 'bank-1',
        importedPayee: 'KROGER #1',
      });
      await expect(service.undo(token ?? '')).rejects.toMatchObject({ code: 'not-found' });
    });
    it('gives the re-created mirror its own category back (an off→on transfer)', async () => {
      const { id } = await service.commit(
        edit({ accountId: 'a-house', payee: { kind: 'transfer', accountId: 'a-check' } }),
      );
      // The on-budget side is categorized in its own register.
      const onBudget = find(find(id).transferId ?? '');
      onBudget.category = 'c-fun';
      const { token } = await service.delete([id]);
      const { ids } = await service.undo(token ?? '');
      const mirror = find(find(ids[id] ?? '').transferId ?? '');
      expect(mirror).toMatchObject({ account: 'a-check', category: 'c-fun' });
    });
  });

  describe('move and merge (10 §6.1)', () => {
    it('undoing a move off-budget puts the cleared categories back, a split’s lines’ too', async () => {
      const { id } = await service.commit(
        edit({
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: 'c-food', notes: '' },
            { amount: -50, transferAccountId: null, categoryId: 'c-fun', notes: '' },
          ],
        }),
      );
      const { token } = await service.moveToAccount(['t-kroger', id], 'a-house');
      expect(find('t-kroger').category).toBeNull();
      expect(find(id).subtransactions.map((l) => l.category)).toEqual([null, null]);
      await service.undo(token ?? '');
      expect(find('t-kroger')).toMatchObject({ account: 'a-check', category: 'c-food' });
      expect(find(id).subtransactions.map((l) => l.category)).toEqual(['c-food', 'c-fun']);
    });
    it('moves, makes a reconciled row Cleared, and undoes the move', async () => {
      const { token, count } = await service.moveToAccount(['t-recon'], 'a-save');
      expect(count).toBe(1);
      expect(find('t-recon')).toMatchObject({
        account: 'a-save',
        cleared: true,
        reconciled: false,
      });
      await service.undo(token ?? '');
      expect(find('t-recon')).toMatchObject({
        account: 'a-check',
        cleared: true,
        reconciled: true,
      });
    });
    it('refuses to move into a closed account', async () => {
      const { id } = await service.commit(edit({}));
      const save = budget().accounts.find((a) => a.id === 'a-save');
      if (save) save.closed = true;
      await expect(service.moveToAccount([id], 'a-save')).rejects.toMatchObject({
        code: 'not-found',
      });
    });
    it('refuses to move a transfer into its own target', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      await expect(service.moveToAccount([id], 'a-save')).rejects.toMatchObject({
        details: { code: 'transfer-into-target' },
      });
    });
    it('changes only the date, a split’s lines and a transfer’s other sides with it, and undoes it', async () => {
      const { id: split } = await service.commit(
        edit({
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: 'c-food', notes: '' },
            { amount: -50, transferAccountId: 'a-save', categoryId: null, notes: '' },
          ],
        }),
      );
      const { id: transfer } = await service.commit(
        edit({ date: '2026-10-12', payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const other = find(transfer).transferId ?? '';
      const lineMirror = find(split).subtransactions[1]?.transferId ?? '';
      const line = find(split).subtransactions[0]?.id ?? '';
      const { token, count } = await service.setDate(
        ['t-kroger', 't-recon', split, line, transfer],
        '2026-11-05',
      );
      expect(count).toBe(4);
      expect(find('t-kroger')).toMatchObject({
        date: '2026-11-05',
        payee: 'p-kroger',
        category: 'c-food',
        notes: '#Vacation2025 #trip ⟦chk 101⟧',
      });
      expect(find('t-recon')).toMatchObject({ date: '2026-11-05', reconciled: true });
      expect(find(split).subtransactions.map((l) => l.date)).toEqual(['2026-11-05', '2026-11-05']);
      expect(find(transfer).date).toBe('2026-11-05');
      expect(find(other).date).toBe('2026-11-05');
      expect(find(lineMirror).date).toBe('2026-11-05');
      await service.undo(token ?? '');
      expect(find('t-kroger').date).toBe('2026-10-01');
      expect(find(split).subtransactions.map((l) => l.date)).toEqual(['2026-10-10', '2026-10-10']);
      expect(find(transfer).date).toBe('2026-10-12');
      expect(find(other).date).toBe('2026-10-12');
      expect(find(lineMirror).date).toBe('2026-10-10');
    });
    it('clears the reconciled rows and other sides it is told to, and Undo makes them Reconciled again', async () => {
      const { id: a } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const { id: b } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const [sideA, sideB] = [find(a).transferId ?? '', find(b).transferId ?? ''];
      for (const s of [sideA, sideB]) Object.assign(find(s), { cleared: true, reconciled: true });
      // An id that isn't one of their other sides is ignored.
      const { token } = await service.setDate([a, b, 't-recon'], '2026-11-05', [
        sideA,
        't-recon',
        't-kroger',
      ]);
      expect(find(sideA)).toMatchObject({ date: '2026-11-05', cleared: true, reconciled: false });
      expect(find('t-recon')).toMatchObject({
        date: '2026-11-05',
        cleared: true,
        reconciled: false,
      });
      expect(find(sideB)).toMatchObject({ date: '2026-11-05', cleared: true, reconciled: true });
      expect(find('t-kroger').cleared).toBe(false);
      await service.undo(token ?? '');
      expect(find(sideA)).toMatchObject({ date: '2026-10-10', cleared: true, reconciled: true });
      expect(find('t-recon')).toMatchObject({ cleared: true, reconciled: true });
    });
    it('changes a transfer once when both sides are selected', async () => {
      const { id } = await service.commit(
        edit({ payee: { kind: 'transfer', accountId: 'a-save' } }),
      );
      const other = find(id).transferId ?? '';
      const update = vi.spyOn(actual, 'updateTransaction');
      const { count } = await service.setDate([id, other], '2026-11-05');
      expect(count).toBe(2);
      expect(update).toHaveBeenCalledTimes(2);
      expect([find(id).date, find(other).date]).toEqual(['2026-11-05', '2026-11-05']);
    });
    it('puts back the dates it already changed when a write fails', async () => {
      const update = actual.updateTransaction.bind(actual);
      let calls = 0;
      vi.spyOn(actual, 'updateTransaction').mockImplementation((id, patch) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error('boom')) : update(id, patch);
      });
      await expect(service.setDate(['t-kroger', 't-review'], '2026-11-05')).rejects.toThrow();
      expect(find('t-kroger').date).toBe('2026-10-01');
      expect(find('t-review').date).not.toBe('2026-11-05');
    });
    it('reports a partial change when the rollback fails too', async () => {
      const update = actual.updateTransaction.bind(actual);
      let calls = 0;
      vi.spyOn(actual, 'updateTransaction').mockImplementation((id, patch) => {
        calls += 1;
        return calls >= 2 ? Promise.reject(new Error('boom')) : update(id, patch);
      });
      await expect(service.setDate(['t-kroger', 't-review'], '2026-11-05')).rejects.toMatchObject({
        details: { code: 'partial-change' },
      });
    });
    it('merges two transactions and tags the result for review', async () => {
      const a = (
        await service.commit(edit({ amount: -999, payee: { kind: 'existing', id: 'p-kroger' } }))
      ).id;
      const b = (await service.commit(edit({ amount: -999, date: '2026-10-12' }))).id;
      Object.assign(find(b), { importedId: 'bank-2' });
      const { id } = await service.merge(a, b);
      expect(id).toBe(b);
      expect(find(b)).toMatchObject({ payee: 'p-kroger' });
      expect(decode(find(b).notes).needsReview).toBe(true);
    });
  });

  describe('reads', () => {
    it('lastForPayee gives the latest non-split use and the auto-category rule (11 §4.3)', async () => {
      budget().rules.push({
        id: 'r1',
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-kroger' }],
        actions: [{ op: 'set', field: 'category', value: 'c-fun' }],
      });
      Object.assign(find('t-kroger'), { date: '2026-10-30' });
      await expect(service.lastForPayee('p-kroger')).resolves.toEqual({
        last: { categoryId: 'c-food', notes: '#Vacation2025 #trip', amount: -5210 },
        ruleCategoryId: 'c-fun',
      });
    });
    it('nextCheckNumber is the most recent numeric check number plus one (11 §2)', async () => {
      await expect(service.nextCheckNumber('a-check')).resolves.toBe('102');
      await expect(service.nextCheckNumber('a-save')).resolves.toBeNull();
    });
  });

  it('rejects writes while offline (03 §5)', async () => {
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    await expect(service.approve(['t-review'])).rejects.toMatchObject({ code: 'offline' });
    expect(find('t-review').notes).toBe('lunch #needs-review');
  });
});
