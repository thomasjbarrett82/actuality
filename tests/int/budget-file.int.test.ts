// Budget Setup and Budget Properties against a real server (07 §4, 03 §3): create from a
// template with runImport and confirm the upload, rename with save-prefs (visible in the server's list),
// formats that persist to a fresh device, and the write gate offline (Budget Setup included).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { installNetworkSwitch } from './network';
import {
  bootstrap,
  HAS_SERVER,
  hostStack,
  PASSWORD,
  SERVER,
  tempDir,
  type HostStack,
} from './setup';

describe.skipIf(!HAS_SERVER)('budget files on a real server (07 §4)', () => {
  const dir = tempDir();
  const cleanup: (() => Promise<void> | void)[] = [];
  const net = installNetworkSwitch();
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let host: HostStack;
  let cloudFileId = '';
  const name = `Setup test ${String(Date.now())}`;
  const offlineName = `${name} offline`;

  beforeAll(async () => {
    await bootstrap();
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    host = hostStack(actual, join(dir, 'device-a'), { probe: (url) => net.probe(url) });
    cleanup.push(() => {
      host.connection.dispose();
    });
    await host.connection.connect(SERVER, PASSWORD, false);
  });

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
    if (cloudFileId) {
      const token = await loginWithPassword(SERVER, PASSWORD);
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, cloudFileId);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the template with runImport, uploads it and opens it Online', async () => {
    const opened = await host.budgetFile.create(
      name,
      {
        groups: [
          { name: 'Giving', categories: ['Tithing', 'Charitable'] },
          { name: 'Debt', categories: ['Car Payment', 'Student Loan Payment'] },
        ],
        incomeCategory: 'Income',
      },
      { currency: 'EUR', numberFormat: 'dot-comma', dateFormat: 'dd.MM.yyyy', hideFraction: true },
      false,
    );
    cloudFileId = opened.cloudFileId;
    expect(host.connection.state).toMatchObject({ state: 'Online', budget: { name } });
    const listed = await host.connection.listBudgets();
    expect(listed.some((b) => b.cloudFileId === cloudFileId && b.name === name)).toBe(true);
    const groups = await host.read.categories();
    expect(groups.filter((g) => !g.isIncome).map((g) => g.name)).toEqual(['Giving', 'Debt']);
    expect(groups.find((g) => g.name === 'Giving')?.categories.map((c) => c.name)).toEqual([
      'Tithing',
      'Charitable',
    ]);
    expect(groups.find((g) => g.isIncome)?.categories.length).toBeGreaterThan(0);
    await expect(host.budgetFile.properties()).resolves.toMatchObject({
      currency: 'EUR',
      numberFormat: 'dot-comma',
      dateFormat: 'dd.MM.yyyy',
      hideFraction: true,
      renameAvailable: true,
      shared: false,
    });
  });

  it('refuses a name the server already has', async () => {
    await expect(
      host.budgetFile.create(
        name,
        { groups: [], incomeCategory: 'Income' },
        { currency: '', numberFormat: 'comma-dot', dateFormat: 'MM/dd/yyyy', hideFraction: false },
        false,
      ),
    ).rejects.toMatchObject({ details: { code: 'duplicate-name' } });
    expect(host.connection.state.budget?.cloudFileId).toBe(cloudFileId);
  });

  it('renames with save-prefs, visible in the server list, and saves formats for every device', async () => {
    await host.budgetFile.updateProperties({
      name: `${name} renamed`,
      numberFormat: 'space-comma',
      firstDayOfWeek: 1,
    });
    await host.connection.syncNow();
    expect(host.connection.state.budget?.name).toBe(`${name} renamed`);
    const listed = await host.connection.listBudgets();
    expect(listed.find((b) => b.cloudFileId === cloudFileId)?.name).toBe(`${name} renamed`);

    await host.connection.closeBudget(false);
    host.connection.dispose();
    host = hostStack(actual, join(dir, 'device-b'), { probe: (url) => net.probe(url) });
    await host.connection.connect(SERVER, PASSWORD, false);
    await host.connection.openBudget(cloudFileId);
    await expect(host.budgetFile.properties()).resolves.toMatchObject({
      name: `${name} renamed`,
      currency: 'EUR',
      numberFormat: 'space-comma',
      firstDayOfWeek: 1,
    });
  });

  it('rejects property and pref writes while offline (03 §5)', async () => {
    net.down();
    try {
      await host.connection.syncNow().catch(() => undefined);
      expect(host.connection.state.state).toBe('OfflineReadOnly');
      await expect(host.budgetFile.updateProperties({ hideFraction: false })).rejects.toMatchObject(
        {
          code: 'offline',
        },
      );
      await expect(host.budgetFile.setSynced('dateFormat', 'yyyy-MM-dd')).rejects.toMatchObject({
        code: 'offline',
      });
      // Budget Setup is refused too, before it closes the open budget (06 §4, 07 §4).
      await expect(
        host.budgetFile.create(
          offlineName,
          { groups: [{ name: 'Giving', categories: ['Tithing'] }], incomeCategory: 'Income' },
          {
            currency: '',
            numberFormat: 'comma-dot',
            dateFormat: 'MM/dd/yyyy',
            hideFraction: false,
          },
          false,
        ),
      ).rejects.toMatchObject({ code: 'offline' });
      expect(host.connection.state.budget?.cloudFileId).toBe(cloudFileId);
    } finally {
      net.up();
    }
    await host.connection.retry('manual');
    await expect(host.budgetFile.properties()).resolves.toMatchObject({ hideFraction: true });
    const listed = await host.connection.listBudgets();
    expect(listed.some((b) => b.name === offlineName)).toBe(false);
    await host.connection.closeBudget(false);
  });
});
