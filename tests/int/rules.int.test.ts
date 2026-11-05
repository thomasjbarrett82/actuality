// Rules against a real server (23 §6): a rule created through the app is in Actual and fires
// on import, with the check number and review tag kept; the list is in run order; a split rule applied to
// an outflow; Apply Actions keeps the note metadata; a template action survives an update; matching uses
// Actual's own conditions; every rule write is refused offline.
import { APP_NAME } from '@shared/app';
import { today } from '@shared/dates';
import { decode } from '@shared/metadata/notes-codec';
import type { CommitEdit, ImportTexts } from '@shared/rpc/host-api';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const IMPORT_TEXTS: ImportTexts = {
  transferPrefixes: ['Transfer :'],
  plainTransfer: 'Transfer ({account})',
};

describe.skipIf(!HAS_SERVER)('rules against a real server (23 §6)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let budgetId: string;
  let host: HostStack;
  let checking: string;
  let food: string;
  let amazon: string;
  let corner: string;

  type Row = {
    id: string;
    amount: number;
    notes: string | null;
    payee: string | null;
    category: string | null;
    is_parent: boolean;
    parent_id: string | null;
    imported_payee: string | null;
  };
  const rows = async (filter: Record<string, unknown>): Promise<Row[]> =>
    (
      (await fixtures.api.aqlQuery(
        fixtures.api
          .q('transactions')
          .filter(filter)
          .select([
            'id',
            'amount',
            'notes',
            'payee',
            'category',
            'is_parent',
            'parent_id',
            'imported_payee',
          ])
          .options({ splits: 'all' }),
      )) as { data: Row[] }
    ).data;
  const commit = (e: Partial<CommitEdit>): CommitEdit => ({
    accountId: checking,
    date: today(new Date()),
    amount: -5000,
    payee: { kind: 'existing', id: corner },
    categoryId: null,
    notes: '',
    checkNumber: null,
    needsReview: false,
    cleared: 'U',
    ...e,
  });

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    token = await loginWithPassword(SERVER, PASSWORD);
    budgetId =
      (await fixtures.createServerBudget(SERVER, token, `${APP_NAME} rules ${String(Date.now())}`))
        .cloudFileId ?? '';
    cleanup.push(async () => {
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, budgetId);
    });
    host = hostStack(actual, join(dir, 'a'), { probe: (url) => net.probe(url) });
    await host.connection.connect(SERVER, PASSWORD, false);
    await host.connection.openBudget(budgetId);
    checking = (
      await host.accounts.create({
        name: 'Checking',
        onBudget: true,
        balance: 0,
      })
    ).id;
    const group = await host.categories.createGroup('Everyday');
    food = (await host.categories.create({ groupId: group.id, name: 'Food' })).id;
    amazon = await host.queue.run('payee', () => actual.createPayee('Amazon'), { kind: 'write' });
    corner = await host.queue.run('payee', () => actual.createPayee('Corner shop'), {
      kind: 'write',
    });
  });

  afterAll(async () => {
    host.connection.dispose();
    for (const c of cleanup.reverse()) await c();
  });

  it('creates a rule that fires on import, keeping the check number and review tag (criteria 1, 2)', async () => {
    const { id } = await host.rules.save({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'AMZN', type: 'string' }],
      actions: [
        { op: 'set', field: 'payee', value: amazon, type: 'id' },
        { op: 'set', field: 'notes', value: 'Online', type: 'string' },
      ],
    });
    const listed = await host.rules.list();
    expect(listed.find((r) => r.id === id)).toMatchObject({ stage: 'pre', schedule: null });
    expect(listed[0]?.id).toBe(id);

    const d = today(new Date());
    const qif = join(dir, 'amzn.qif');
    writeFileSync(
      qif,
      `!Type:Bank\nD${d.slice(5, 7)}/${d.slice(8)}/${d.slice(0, 4)}\nT-12.34\nPAMZN Mktp US\nN1234\n^\n`,
    );
    const parsed = await host.importer.parse(qif);
    const [result] = await host.importer.run(
      parsed.token,
      [
        {
          index: 0,
          accountId: checking,
          importNotes: true,
          swapPayeeNotes: false,
          dateOrder: 'MDY',
          includeBeforeStart: true,
        },
      ],
      IMPORT_TEXTS,
    );
    expect(result).toMatchObject({ added: 1 });
    const [row] = await rows({ account: checking, imported_payee: 'AMZN Mktp US' });
    expect(row?.payee).toBe(amazon);
    expect(decode(row?.notes)).toEqual({ notes: 'Online', checkNumber: '1234', needsReview: true });
  });

  it('lists the matching transactions with Actual’s own conditions', async () => {
    const tx = await host.transactions.commit(commit({ amount: -4321 }));
    const found = await host.rules.matches({
      conditionsOp: 'or',
      conditions: [
        { field: 'payee', op: 'is', value: corner, type: 'id' },
        { field: 'amount', op: 'is', value: 999_999, type: 'number' },
      ],
    });
    expect(found?.rows.map((r) => r.id)).toContain(tx.id);
    const none = await host.rules.matches({
      conditionsOp: 'and',
      conditions: [
        { field: 'payee', op: 'is', value: corner, type: 'id' },
        { field: 'amount', op: 'is', value: 999_999, type: 'number' },
      ],
    });
    expect(none?.rows).toEqual([]);
  });

  it('splits an outflow with a fixed amount and the remainder (criterion 4)', async () => {
    const tx = await host.transactions.commit(commit({ amount: -5000 }));
    await host.rules.applyActions(
      [tx.id],
      [
        {
          op: 'set-split-amount',
          value: -2000,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        { op: 'set', field: 'category', value: food, type: 'id', options: { splitIndex: 1 } },
        { op: 'set-split-amount', value: null, options: { splitIndex: 2, method: 'remainder' } },
      ],
    );
    const [parent] = await rows({ id: tx.id });
    expect(parent?.is_parent).toBe(true);
    const lines = await rows({ parent_id: tx.id });
    expect(lines.map((l) => [l.amount, l.category]).sort()).toEqual(
      [
        [-2000, food],
        [-3000, null],
      ].sort(),
    );
  });

  it('applies actions and keeps the check number and review tag (criterion 5)', async () => {
    const tx = await host.transactions.commit(
      commit({ amount: -777, notes: 'Weekly', checkNumber: '1234', needsReview: true }),
    );
    await expect(
      host.rules.applyActions([tx.id], [{ op: 'set', field: 'notes', value: 'Groceries' }]),
    ).resolves.toEqual({ count: 1 });
    expect((await rows({ id: tx.id }))[0]?.notes).toBe('Groceries ⟦chk 1234⟧ #needs-review');
  });

  it('keeps a template action through an update (criterion 3)', async () => {
    const template = {
      op: 'set',
      field: 'notes',
      value: '',
      type: 'string',
      options: { template: '{{imported_payee}}' },
    };
    const { id } = await host.rules.save({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: corner, type: 'id' }],
      actions: [template],
    });
    await host.rules.save({
      id,
      stage: 'post',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: corner, type: 'id' }],
      actions: [template, { op: 'set', field: 'category', value: food, type: 'id' }],
    });
    const saved = (await actual.getRules()).find((r) => r.id === id);
    expect(saved?.stage).toBe('post');
    expect(saved?.actions[0]).toMatchObject({ options: { template: '{{imported_payee}}' } });
    await host.rules.delete([id]);
    expect((await actual.getRules()).some((r) => r.id === id)).toBe(false);
  });

  it('rejects every rule write while offline (03 §5)', async () => {
    const tx = await host.transactions.commit(commit({ amount: -100 }));
    const { id } = await host.rules.save({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: corner, type: 'id' }],
      actions: [{ op: 'set', field: 'category', value: food, type: 'id' }],
    });
    net.down();
    await host.connection.syncNow().catch(() => undefined);
    expect(host.connection.state.state).toBe('OfflineReadOnly');
    const writes = [
      () =>
        host.rules.save({
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'payee', op: 'is', value: corner, type: 'id' }],
          actions: [{ op: 'delete-transaction', value: null }],
        }),
      () => host.rules.delete([id]),
      () => host.rules.applyActions([tx.id], [{ op: 'set', field: 'notes', value: 'x' }]),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'offline' });
    net.up();
    await host.connection.retry('manual');
    expect((await actual.getRules()).some((r) => r.id === id)).toBe(true);
    expect((await rows({ id: tx.id }))[0]?.notes ?? '').toBe('');
  });
});
