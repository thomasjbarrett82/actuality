// Bank import against a real server (16 §1.5, §4 criterion 2): importing an OFX file twice
// adds nothing the second time and reports every row as already imported; QIF categories and splits
// land; rows Actual matches get the review tag; the import is refused offline.
import { APP_NAME } from '@shared/app';
import { today } from '@shared/dates';
import { decode } from '@shared/metadata/notes-codec';
import type { ImportTexts } from '@shared/rpc/host-api';
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
const FIXTURES = join(import.meta.dirname, '../../src/host/parsers/fixtures');

describe.skipIf(!HAS_SERVER)('bank import against a real server (16 §1.5)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let budgetId: string;
  let host: HostStack;
  let checking: string;

  type Row = {
    id: string;
    amount: number;
    notes: string | null;
    category: string | null;
    imported_id: string | null;
    is_parent: boolean;
    parent_id: string | null;
  };
  const rows = async (filter: Record<string, unknown>): Promise<Row[]> =>
    (
      (await fixtures.api.aqlQuery(
        fixtures.api
          .q('transactions')
          .filter(filter)
          .select(['id', 'amount', 'notes', 'category', 'imported_id', 'is_parent', 'parent_id'])
          .options({ splits: 'all' }),
      )) as { data: Row[] }
    ).data;

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    token = await loginWithPassword(SERVER, PASSWORD);
    budgetId =
      (await fixtures.createServerBudget(SERVER, token, `${APP_NAME} import ${String(Date.now())}`))
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
  });

  afterAll(async () => {
    host.connection.dispose();
    for (const c of cleanup.reverse()) await c();
  });

  const run = async (file: string) => {
    const parsed = await host.importer.parse(join(FIXTURES, file));
    return host.importer.run(
      parsed.token,
      parsed.accounts.map((_, index) => ({
        index,
        accountId: checking,
        importNotes: true,
        swapPayeeNotes: false,
        dateOrder: parsed.format === 'ofx' ? null : 'MDY',
        includeBeforeStart: true,
      })),
      IMPORT_TEXTS,
    );
  };

  it('adds nothing the second time and reports them as already imported (criterion 2)', async () => {
    const [first] = await run('bank-sgml.ofx');
    expect(first).toMatchObject({ status: 'imported', added: 3, updated: 0, ignored: 0 });
    const imported = await rows({ account: checking, imported_id: { $ne: null } });
    expect(imported.map((r) => r.imported_id).sort()).toEqual(
      ['2026100301', '2026100502', '2026101003'].sort(),
    );
    for (const r of imported) expect(decode(r.notes).needsReview).toBe(true);
    const [second] = await run('bank-sgml.ofx');
    expect(second).toMatchObject({ status: 'imported', added: 0, updated: 0, ignored: 3 });
    expect(await rows({ account: checking, imported_id: { $ne: null } })).toHaveLength(3);
  });

  it('remembers the mapping by FID and account number (16 §1.4)', async () => {
    const parsed = await host.importer.parse(join(FIXTURES, 'bank-sgml.ofx'));
    expect(parsed.mappings['12345|000111222333']).toMatchObject({ accountId: checking });
  });

  it('imports QIF categories and splits; unknown categories go into the notes', async () => {
    const group = await host.categories.createGroup('Household');
    await host.categories.create({ groupId: group.id, name: 'Cleaning- Supplies' });
    const groceries = (await host.categories.create({ groupName: 'Food', name: 'Groceries' })).id;
    const [result] = await run('accounts.qif');
    expect(result).toMatchObject({ status: 'imported', added: 2 });
    const parent = (await rows({ account: checking, amount: 4200 })).find((r) => r.is_parent);
    const lines = await rows({ parent_id: parent?.id });
    expect(lines.map((l) => l.category)).toContain(groceries);
    const rent = (await rows({ account: checking, amount: -123_456 }))[0];
    expect(rent?.category).toBeNull();
    expect(decode(rent?.notes).notes).toBe('Bills:Rent - January rent');
    expect(decode(rent?.notes).checkNumber).toBe('101');
  });

  it('tags rows Actual matches to an existing transaction for review (16 §1.5 step 3)', async () => {
    const own = await host.transactions.commit({
      accountId: checking,
      date: today(new Date()),
      amount: -777,
      payee: { kind: 'new', name: 'Corner shop' },
      categoryId: null,
      notes: 'mine',
      checkNumber: null,
      needsReview: false,
      cleared: 'U',
    });
    const csv = join(dir, 'match.csv');
    const d = today(new Date());
    writeFileSync(
      csv,
      `Date,Payee,Amount\n${d.slice(5, 7)}/${d.slice(8)}/${d.slice(0, 4)},Corner shop,-7.77\n`,
    );
    const parsed = await host.importer.parse(csv);
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
    expect(result).toMatchObject({ added: 0, updated: 1 });
    const [row] = await rows({ id: own.id });
    expect(decode(row?.notes)).toMatchObject({ notes: 'mine', needsReview: true });
  });

  it('refuses the import while offline (03 §5)', async () => {
    const parsed = await host.importer.parse(join(FIXTURES, 'card-xml.ofx'));
    net.down();
    await host.connection.syncNow().catch(() => undefined);
    await expect(
      host.importer.run(
        parsed.token,
        [
          {
            index: 0,
            accountId: checking,
            importNotes: true,
            swapPayeeNotes: false,
            dateOrder: null,
            includeBeforeStart: true,
          },
        ],
        IMPORT_TEXTS,
      ),
    ).rejects.toMatchObject({ code: 'offline' });
    net.up();
    await host.connection.retry('manual');
  });
});
