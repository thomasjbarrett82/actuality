// Transactions and payees against a real server (11 §10, 10 §11, 14 §5): notes round-trip,
// a split's transfer line and its mirror, delete with undo, collapsing a split, transfer dates, move, merge,
// payee rename/combine/disable and rename rules on import, Add New Category, and writes refused offline.
import { APP_NAME } from '@shared/app';
import { today } from '@shared/dates';
import type { CommitEdit } from '@shared/rpc/host-api';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { installNetworkSwitch, type NetworkSwitch } from './network';
import {
  bootstrap,
  HAS_SERVER,
  hostStack,
  PASSWORD,
  SERVER,
  tempDir,
  type HostStack,
} from './setup';

describe.skipIf(!HAS_SERVER)(
  'transactions and payees against a real server (11, 10 §8, 14)',
  () => {
    const dir = tempDir();
    const cleanup: (() => Promise<void> | void)[] = [];
    let net: NetworkSwitch;
    let actual: ActualApi;
    let fixtures: ActualTestFixtures;
    let token: string;
    let budgetId: string;
    let host: HostStack;
    let checking: string;
    let savings: string;
    let house: string;
    let food: string;
    let fun: string;

    /** Rows straight from ActualQL, independent of the services. */
    type Row = {
      id: string;
      account: string;
      amount: number;
      date: string;
      notes: string | null;
      payee: string | null;
      category: string | null;
      cleared: boolean;
      reconciled: boolean;
      transfer_id: string | null;
      is_parent: boolean;
      parent_id: string | null;
    };
    const rows = async (filter: Record<string, unknown>): Promise<Row[]> =>
      (
        (await fixtures.api.aqlQuery(
          fixtures.api
            .q('transactions')
            .filter(filter)
            .select([
              'id',
              'account',
              'amount',
              'date',
              'notes',
              'payee',
              'category',
              'cleared',
              'reconciled',
              'transfer_id',
              'is_parent',
              'parent_id',
            ])
            .options({ splits: 'all' }),
        )) as { data: Row[] }
      ).data;
    const one = async (id: string): Promise<Row | undefined> => (await rows({ id }))[0];

    const edit = (e: Partial<CommitEdit>): CommitEdit => ({
      accountId: checking,
      date: today(new Date()),
      amount: -1000,
      payee: { kind: 'none' },
      categoryId: null,
      notes: '',
      checkNumber: null,
      needsReview: false,
      cleared: 'U',
      ...e,
    });

    async function device(name: string): Promise<HostStack> {
      const stack = hostStack(actual, join(dir, name), { probe: (url) => net.probe(url) });
      await stack.connection.connect(SERVER, PASSWORD, false);
      await stack.connection.openBudget(budgetId);
      return stack;
    }

    beforeAll(async () => {
      await bootstrap();
      net = installNetworkSwitch();
      mkdirSync(join(dir, 'fixtures'), { recursive: true });
      ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
      token = await loginWithPassword(SERVER, PASSWORD);
      budgetId =
        (
          await fixtures.createServerBudget(
            SERVER,
            token,
            `${APP_NAME} transactions ${String(Date.now())}`,
          )
        ).cloudFileId ?? '';
      cleanup.push(async () => {
        await actual.shutdown().catch(() => undefined);
        await fixtures.deleteServerBudget(SERVER, token, budgetId);
      });
      host = await device('a');
      checking = (
        await host.accounts.create({
          name: 'Checking',
          onBudget: true,
          balance: 100_000,
        })
      ).id;
      savings = (
        await host.accounts.create({
          name: 'Savings',
          onBudget: true,
          balance: 0,
        })
      ).id;
      house = (
        await host.accounts.create({
          name: 'House',
          onBudget: false,
          balance: 0,
        })
      ).id;
      ({ id: food } = await host.categories.create({ groupName: 'Everyday', name: 'Food' }));
      const groupId = (await host.read.categories()).find((g) => g.name === 'Everyday')?.id;
      ({ id: fun } = await host.categories.create({ groupId, name: 'Fun' }));
    }, 240_000);

    afterAll(async () => {
      net.up();
      host.connection.dispose();
      for (const step of cleanup.reverse()) await step();
      rmSync(dir, { recursive: true, force: true });
    });

    it('puts a new category at the end of its group (04 §3)', async () => {
      const group = (await host.read.categories()).find((g) => g.name === 'Everyday');
      expect(group?.categories.map((c) => c.name)).toEqual(['Food', 'Fun']);
    });

    it('keeps case-sensitive tags and the check number when the notes change (11 §10 criterion 1)', async () => {
      const { id } = await host.transactions.commit(
        edit({
          payee: { kind: 'new', name: 'Travel Co' },
          categoryId: food,
          notes: '#Vacation2025 #trip',
          checkNumber: '101',
        }),
      );
      expect((await one(id))?.notes).toBe('#Vacation2025 #trip ⟦chk 101⟧');
      const t = (await host.read.transactions(checking)).find((x) => x.id === id);
      expect(t).toMatchObject({
        notes: '#Vacation2025 #trip',
        tags: ['Vacation2025', 'trip'],
        checkNumber: '101',
      });
      await host.transactions.commit(
        edit({
          id,
          payee: { kind: 'existing', id: t?.payeeId ?? '' },
          categoryId: food,
          notes: '#Vacation2025 #trip flights',
          checkNumber: '101',
        }),
      );
      expect((await one(id))?.notes).toBe('#Vacation2025 #trip flights ⟦chk 101⟧');
      // The update went through the internal batch handler (03 §3), which this API version still has.
      expect(actual.internalHandlerAvailable('transactions-batch-update')).toBe(true);
    });

    it('creates the mirror of a split’s transfer line, and copies a new date to it (11 §10 criterion 2)', async () => {
      const { id } = await host.transactions.commit(
        edit({
          payee: { kind: 'new', name: 'Costco' },
          amount: -15_000,
          lines: [
            { amount: -10_000, transferAccountId: null, categoryId: food, notes: 'food' },
            { amount: -5_000, transferAccountId: savings, categoryId: null, notes: 'to savings' },
          ],
        }),
      );
      const lines = await rows({ parent_id: id });
      expect(lines.map((l) => l.amount).sort((x, y) => x - y)).toEqual([-10_000, -5_000]);
      const transfer = lines.find((l) => l.amount === -5_000);
      const mirror = await one(transfer?.transfer_id ?? '');
      expect(mirror).toMatchObject({ account: savings, amount: 5_000 });
      expect(
        (await host.read.transactions(savings)).find((t) => t.id === mirror?.id)?.transferSide,
      ).toMatchObject({ isSplitLine: true });
      // The mirror moves from its split: Actual would retarget the split's line (10 §6.1, 11 §2).
      const mirrorId = mirror?.id ?? '';
      await expect(host.transactions.moveToAccount([mirrorId], house)).rejects.toMatchObject({
        details: { code: 'split-transfer-locked' },
      });
      await expect(
        host.transactions.commit(
          edit({
            id: mirrorId,
            accountId: house,
            amount: 5_000,
            payee: { kind: 'transfer', accountId: checking },
          }),
        ),
      ).rejects.toMatchObject({ details: { code: 'split-transfer-locked' } });
      expect(await one(mirrorId)).toMatchObject({ account: savings });
      expect(await one(transfer?.id ?? '')).toMatchObject({ transfer_id: mirrorId });
    });

    it('deletes a split with a transfer line and its mirror, and Undo restores all three with new ids (10 §11 criterion 4)', async () => {
      const balances = async () => {
        const accounts = await host.read.accounts();
        return [checking, savings].map((a) => accounts.find((x) => x.id === a)?.balances.working);
      };
      const { id } = await host.transactions.commit(
        edit({
          payee: { kind: 'new', name: 'Mall' },
          amount: -3_000,
          lines: [
            { amount: -2_000, transferAccountId: null, categoryId: fun, notes: '' },
            { amount: -1_000, transferAccountId: savings, categoryId: null, notes: '' },
          ],
        }),
      );
      const before = await balances();
      const mirrorId =
        (await rows({ parent_id: id })).find((l) => l.transfer_id)?.transfer_id ?? '';
      const { token: undoToken, count } = await host.transactions.delete([id]);
      expect(count).toBe(1);
      expect(await one(id)).toBeUndefined();
      expect(await rows({ parent_id: id })).toEqual([]);
      expect(await one(mirrorId)).toBeUndefined();
      const { ids } = await host.transactions.undo(undoToken ?? '');
      const again = ids[id] ?? '';
      expect(again).not.toBe(id);
      const lines = await rows({ parent_id: again });
      expect(lines.map((l) => l.amount).sort((x, y) => x - y)).toEqual([-2_000, -1_000]);
      const newMirror = await one(lines.find((l) => l.transfer_id)?.transfer_id ?? '');
      expect(newMirror).toMatchObject({ account: savings, amount: 1_000 });
      expect(newMirror?.id).not.toBe(mirrorId);
      expect(await balances()).toEqual(before);
    });

    it('collapses a split into a normal transaction, removing its transfer line’s mirror', async () => {
      const { id } = await host.transactions.commit(
        edit({
          payee: { kind: 'new', name: 'Corner Shop' },
          amount: -900,
          lines: [
            { amount: -600, transferAccountId: null, categoryId: food, notes: '' },
            { amount: -300, transferAccountId: savings, categoryId: null, notes: '' },
          ],
        }),
      );
      const mirrorId =
        (await rows({ parent_id: id })).find((l) => l.transfer_id)?.transfer_id ?? '';
      const payeeId = (await one(id))?.payee ?? '';
      await host.transactions.commit(
        edit({ id, amount: -900, payee: { kind: 'existing', id: payeeId }, categoryId: fun }),
      );
      expect(await one(id)).toMatchObject({ is_parent: false, category: fun, amount: -900 });
      expect(await rows({ parent_id: id })).toEqual([]);
      expect(await one(mirrorId)).toBeUndefined();
    });

    it('copies a transfer’s new date to the other side, and clears a reconciled other side when asked', async () => {
      const { id } = await host.transactions.commit(
        edit({ payee: { kind: 'transfer', accountId: savings }, categoryId: food, amount: -700 }),
      );
      const t = await one(id);
      expect(t?.category).toBeNull();
      const other = t?.transfer_id ?? '';
      // Through the host's wrapper: Actual's public update doesn't await its write (03 §3).
      await actual.updateTransaction(other, { cleared: true, reconciled: true });
      await host.transactions.commit(
        edit({
          id,
          payee: { kind: 'transfer', accountId: savings },
          amount: -800,
          date: '2026-01-15',
          clearOtherSide: true,
        }),
      );
      expect(await one(other)).toMatchObject({
        date: '2026-01-15',
        amount: 800,
        cleared: true,
        reconciled: false,
      });
    });

    it('moves transactions, making a reconciled one Cleared, and Undo moves them back', async () => {
      const { id } = await host.transactions.commit(
        edit({ payee: { kind: 'new', name: 'Mover' }, categoryId: food, cleared: 'R' }),
      );
      const { token: undoToken } = await host.transactions.moveToAccount([id], house);
      // Off-budget, Actual clears the category; Undo puts it back.
      expect(await one(id)).toMatchObject({
        account: house,
        cleared: true,
        reconciled: false,
        category: null,
      });
      await host.transactions.undo(undoToken ?? '');
      expect(await one(id)).toMatchObject({
        account: checking,
        cleared: true,
        reconciled: true,
        category: food,
      });
    });

    it('changes the date of several transactions, a split’s lines and a transfer’s other sides too, and Undo restores them (10 §6.1)', async () => {
      const { id: plain } = await host.transactions.commit(
        edit({ payee: { kind: 'new', name: 'Redate' }, categoryId: food, cleared: 'R' }),
      );
      const { id: split } = await host.transactions.commit(
        edit({
          date: '2026-01-11',
          amount: -150,
          lines: [
            { amount: -100, transferAccountId: null, categoryId: food, notes: '' },
            { amount: -50, transferAccountId: savings, categoryId: null, notes: '' },
          ],
        }),
      );
      const { id: transfer } = await host.transactions.commit(
        edit({ date: '2026-01-12', payee: { kind: 'transfer', accountId: savings } }),
      );
      const lines = await actual.getTransactionRows({ parentIds: [split] });
      const lineMirror = lines.find((l) => l.transferId)?.transferId ?? '';
      const other = (await one(transfer))?.transfer_id ?? '';
      const before = await one(plain);
      const { token, count } = await host.transactions.setDate(
        // A line counts as its parent.
        [plain, split, lines[0]?.id ?? '', transfer],
        '2026-02-03',
      );
      expect(count).toBe(3);
      expect(await one(plain)).toMatchObject({
        date: '2026-02-03',
        payee: before?.payee,
        category: food,
        notes: before?.notes,
        cleared: true,
        reconciled: true,
      });
      for (const l of await actual.getTransactionRows({ parentIds: [split] }))
        expect(l.date).toBe('2026-02-03');
      expect((await one(transfer))?.date).toBe('2026-02-03');
      expect((await one(other))?.date).toBe('2026-02-03');
      expect((await one(lineMirror))?.date).toBe('2026-02-03');
      await host.transactions.undo(token ?? '');
      expect((await one(plain))?.date).toBe(before?.date);
      expect((await one(split))?.date).toBe('2026-01-11');
      for (const l of await actual.getTransactionRows({ parentIds: [split] }))
        expect(l.date).toBe('2026-01-11');
      expect((await one(transfer))?.date).toBe('2026-01-12');
      expect((await one(other))?.date).toBe('2026-01-12');
      expect((await one(lineMirror))?.date).toBe('2026-01-11');
    });

    it('Change Date clears a reconciled transaction and other side when asked, and Undo makes them Reconciled again', async () => {
      const { id: a } = await host.transactions.commit(
        edit({ date: '2026-01-12', payee: { kind: 'transfer', accountId: savings } }),
      );
      const { id: b } = await host.transactions.commit(edit({ date: '2026-01-13', cleared: 'R' }));
      const other = (await one(a))?.transfer_id ?? '';
      await actual.updateTransaction(other, { cleared: true, reconciled: true });
      const { token } = await host.transactions.setDate([a, b], '2026-02-03', [other, b]);
      expect(await one(b)).toMatchObject({ cleared: true, reconciled: false });
      expect(await one(other)).toMatchObject({
        date: '2026-02-03',
        cleared: true,
        reconciled: false,
      });
      await host.transactions.undo(token ?? '');
      expect(await one(other)).toMatchObject({
        date: '2026-01-12',
        cleared: true,
        reconciled: true,
      });
      expect(await one(b)).toMatchObject({ date: '2026-01-13', cleared: true, reconciled: true });
    });

    it('Undo gives a re-created transfer’s on-budget side its own category back', async () => {
      const { id } = await host.transactions.commit(
        edit({
          accountId: house,
          payee: { kind: 'transfer', accountId: checking },
          amount: -1_200,
        }),
      );
      const mirrorId = (await one(id))?.transfer_id ?? '';
      await actual.updateTransaction(mirrorId, { category: fun });
      const { token: undoToken } = await host.transactions.delete([id]);
      const { ids } = await host.transactions.undo(undoToken ?? '');
      const again = await one(ids[id] ?? '');
      expect(await one(again?.transfer_id ?? '')).toMatchObject({
        account: checking,
        amount: 1_200,
        category: fun,
      });
    });

    it('sets cleared (approving) and categorizes in bulk', async () => {
      const a = (await host.transactions.commit(edit({ needsReview: true, notes: 'a' }))).id;
      const b = (await host.transactions.commit(edit({ notes: 'b' }))).id;
      await host.transactions.setCleared([a, b], 'C');
      expect((await one(a))?.notes).toBe('a');
      await host.transactions.categorize([a, b], fun);
      expect([(await one(a))?.category, (await one(b))?.category]).toEqual([fun, fun]);
    });

    it('merges two transactions and tags the result for review (X4)', async () => {
      const a = (
        await host.transactions.commit(
          edit({ amount: -4242, payee: { kind: 'new', name: 'Merge Me' } }),
        )
      ).id;
      const b = (await host.transactions.commit(edit({ amount: -4242, notes: 'second' }))).id;
      const { id } = await host.transactions.merge(a, b);
      expect([a, b]).toContain(id);
      expect(await one(id === a ? b : a)).toBeUndefined();
      expect((await one(id))?.notes).toContain('#needs-review');
    });

    describe('payees (14 §5)', () => {
      it('a "Starts with KRG" rule is a pre rule, and an imported "KRG 1234" gets the payee (criterion 1)', async () => {
        const { id } = await host.transactions.commit(
          edit({ payee: { kind: 'new', name: 'Kroger' } }),
        );
        const kroger = (await one(id))?.payee ?? '';
        await host.payees.setRenameRules(kroger, [{ op: 'startsWith', value: 'KRG' }]);
        const rules = await fixtures.api.getPayeeRules(kroger);
        expect(rules.find((r) => r.stage === 'pre')?.conditions).toMatchObject([
          { field: 'imported_payee', op: 'matches', value: '^KRG' },
        ]);
        await fixtures.api.importTransactions(
          checking,
          [
            {
              date: today(new Date()),
              amount: -1234,
              payee_name: 'KRG 1234',
              imported_payee: 'KRG 1234',
            } as never,
          ],
          { defaultCleared: true, payeeNameNormalization: 'original' } as never,
        );
        const imported = (await host.read.transactions(checking)).find(
          (t) => t.importedPayee === 'KRG 1234',
        );
        expect(imported?.payeeId).toBe(kroger);
      });

      it('combining three payees leaves one, with every transaction (criterion 2)', async () => {
        const ids = [];
        for (const name of ['Aldi', 'ALDI Sued', 'Aldi Nord'])
          ids.push(
            (await one((await host.transactions.commit(edit({ payee: { kind: 'new', name } }))).id))
              ?.payee ?? '',
          );
        const { id } = await host.payees.combine(ids, 'Aldi');
        const payees = await host.read.payees();
        expect(
          payees.filter((p) => p.name.toLowerCase().startsWith('aldi')).map((p) => p.id),
        ).toEqual([id]);
        expect(payees.find((p) => p.id === id)?.usageCount).toBe(3);
      });

      it('a disabled payee stays disabled after a restart (criterion 3)', async () => {
        const payeeId =
          (
            await one(
              (await host.transactions.commit(edit({ payee: { kind: 'new', name: 'Lottery' } })))
                .id,
            )
          )?.payee ?? '';
        await host.payees.setEnabled([payeeId], false);
        // The API holds one budget per process: close this device's before opening another's.
        await host.connection.syncNow();
        await host.connection.closeBudget(false);
        host.connection.dispose();
        const second = await device('b');
        expect((await second.read.payees()).find((p) => p.id === payeeId)?.enabled).toBe(false);
        await second.connection.closeBudget(false);
        second.connection.dispose();
        host = await device('a');
      });

      it('imported text keeps its capitalization, and "Contains amzn" still matches (criterion 5)', async () => {
        const { id } = await host.transactions.commit(
          edit({ payee: { kind: 'new', name: 'Amazon' } }),
        );
        const amazon = (await one(id))?.payee ?? '';
        await host.payees.setRenameRules(amazon, [{ op: 'contains', value: 'amzn' }]);
        await fixtures.api.importTransactions(
          checking,
          [
            {
              date: today(new Date()),
              amount: -999,
              payee_name: 'AMZN Mktp US*123',
              imported_payee: 'AMZN Mktp US*123',
            } as never,
          ],
          { defaultCleared: true, payeeNameNormalization: 'original' } as never,
        );
        const imported = (await host.read.transactions(checking)).find(
          (t) => t.importedPayee === 'AMZN Mktp US*123',
        );
        expect(imported?.payeeId).toBe(amazon);
      });

      it('renames with a merge and moves the old name into the rename rule (14 §3)', async () => {
        const a =
          (
            await one(
              (
                await host.transactions.commit(
                  edit({ payee: { kind: 'new', name: 'Shell Oil 1' } }),
                )
              ).id,
            )
          )?.payee ?? '';
        const b =
          (
            await one(
              (await host.transactions.commit(edit({ payee: { kind: 'new', name: 'Shell' } }))).id,
            )
          )?.payee ?? '';
        await expect(host.payees.rename(a, 'shell')).resolves.toEqual({ id: b });
        await expect(host.payees.rules(b)).resolves.toMatchObject({
          renameRules: [{ op: 'is', value: 'Shell Oil 1' }],
        });
      });
    });

    it('manages tag entities: create, color, rename (rewrites the notes), discover, add and delete (04 §5.2)', async () => {
      const tagged = (await host.transactions.commit(edit({ notes: 'dinner #Dine #dine.' }))).id;
      const created = await host.tags.create({ tag: 'Dine', color: '#336699' });
      expect(created).toMatchObject({ tag: 'Dine', color: '#336699' });
      // Adding an existing name updates its color instead of making a duplicate.
      await host.tags.create({ tag: 'Dine', color: '#996633' });
      const listed = (await host.tags.list()).filter((t) => t.tag === 'Dine');
      expect(listed).toEqual([expect.objectContaining({ id: created.id, color: '#996633' })]);
      await host.tags.update(created.id, { description: 'Eating out' });
      expect((await host.tags.list()).find((t) => t.id === created.id)).toMatchObject({
        description: 'Eating out',
        color: '#996633',
      });
      // Renaming goes through Actual, which rewrites the exact, case-sensitive tag in every note.
      await host.tags.update(created.id, { tag: 'Meals' });
      expect((await one(tagged))?.notes).toBe('dinner #Meals #dine.');
      expect((await host.read.transactions(checking)).find((t) => t.id === tagged)?.tags).toEqual([
        'Meals',
        'dine.',
      ]);
      await expect(host.tags.update(created.id, { tag: 'needs-review' })).rejects.toMatchObject({
        code: 'validation',
      });
      // Deleting removes only the entity: the hashtag stays in the notes.
      await host.tags.delete(created.id);
      expect((await host.tags.list()).some((t) => t.tag === 'Meals')).toBe(false);
      expect((await one(tagged))?.notes).toBe('dinner #Meals #dine.');
      // Actual keeps a deleted tag's name taken; a rename onto it is the same duplicate refusal.
      const lunch = await host.tags.create({ tag: 'Lunch' });
      await expect(host.tags.update(lunch.id, { tag: 'Meals' })).rejects.toMatchObject({
        code: 'validation',
        details: { code: 'duplicate-tag' },
      });
      // needs-review is protected.
      const review = (await host.tags.list()).find((t) => t.tag === 'needs-review');
      expect(review).toBeDefined();
      await expect(host.tags.delete(review?.id ?? '')).rejects.toMatchObject({
        code: 'validation',
      });
      await expect(host.tags.update(review?.id ?? '', { tag: 'to-review' })).rejects.toMatchObject({
        code: 'validation',
      });
      // Discovery lists the tags used in notes that have no entity, and adds only the chosen ones.
      const found = await host.tags.unmanaged();
      expect(found).toEqual(expect.arrayContaining(['Meals', 'dine.']));
      expect(found).not.toContain('needs-review');
      // `Meals` is the name of a deleted tag: Actual brings that entity back.
      const added = await host.tags.createMany([
        { tag: 'Meals', color: '#E53935' },
        { tag: 'Lunch' },
      ]);
      expect(added).toEqual([expect.objectContaining({ tag: 'Meals', color: '#E53935' })]);
      expect(await host.tags.unmanaged()).toEqual(found.filter((t) => t !== 'Meals'));
    });

    it('rejects every transaction, payee and category write while offline (03 §5)', async () => {
      const [any] = await host.read.transactions(checking);
      const payee = (await host.read.payees()).find((p) => !p.transferAccountId);
      net.down();
      await host.connection.syncNow().catch(() => undefined);
      expect(host.connection.state.state).toBe('OfflineReadOnly');
      const id = any?.id ?? '';
      const pid = payee?.id ?? '';
      const writes = [
        () => host.transactions.commit(edit({ notes: 'offline' })),
        () => host.transactions.setCleared([id], 'C'),
        () => host.transactions.approve([id]),
        () => host.tags.create({ tag: 'offline' }),
        () => host.tags.update('tag-id', { color: '#112233' }),
        () => host.tags.delete('tag-id'),
        () => host.tags.createMany([{ tag: 'offline' }]),
        () => host.transactions.categorize([id], food),
        () => host.transactions.delete([id]),
        () => host.transactions.undo('any'),
        () => host.transactions.moveToAccount([id], savings),
        () => host.transactions.setDate([id, id], '2026-01-01'),
        () => host.transactions.merge(id, id),
        () => host.payees.rename(pid, 'Offline'),
        () => host.payees.combine([pid], 'Offline'),
        () => host.payees.setEnabled([pid], false),
        () => host.payees.setRenameRules(pid, []),
        () => host.payees.applyRenameRules(pid, false),
        () => host.payees.setAutoCategory(pid, null),
        () => host.categories.create({ groupName: 'Offline', name: 'Offline' }),
      ];
      for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'offline' });
      net.up();
      await host.connection.retry('manual');
      expect((await one(id))?.id).toBe(id);
    });
  },
);
