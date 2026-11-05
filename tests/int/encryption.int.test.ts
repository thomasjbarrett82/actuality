// Per-budget end-to-end encryption against a real server (03 §7, 07 §4): the write gate
// offline, enabling encryption with key-make (sync reset, new groupId, status refresh), opening the
// encrypted budget on another device with and without the password, the remembered password, and a new
// key that replaces the old password.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { loginWithPassword } from '../../src/host/server-api';
import { FakeControl } from '../../src/host/testing/fake-control';
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

describe.skipIf(!HAS_SERVER)('end-to-end encryption on a real server (03 §7)', () => {
  const dir = tempDir();
  const net = installNetworkSwitch();
  const control = new FakeControl();
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let host: HostStack;
  let cloudFileId = '';
  let device = 0;
  const name = `Encryption test ${String(Date.now())}`;

  /** A fresh device (its own data folder) signed in to the server. */
  async function newDevice(deviceControl = new FakeControl()): Promise<HostStack> {
    host.connection.dispose();
    device += 1;
    host = hostStack(actual, join(dir, `device-${String(device)}`), {
      control: deviceControl,
      probe: (url) => net.probe(url),
    });
    await host.connection.connect(SERVER, PASSWORD, false);
    return host;
  }

  beforeAll(async () => {
    await bootstrap();
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    host = hostStack(actual, join(dir, 'device-0'), { control, probe: (url) => net.probe(url) });
    await host.connection.connect(SERVER, PASSWORD, false);
    const opened = await host.budgetFile.create(
      name,
      { groups: [{ name: 'Giving', categories: ['Tithing'] }], incomeCategory: 'Income' },
      { currency: '', numberFormat: 'comma-dot', dateFormat: 'MM/dd/yyyy', hideFraction: false },
      false,
    );
    cloudFileId = opened.cloudFileId;
  });

  afterAll(async () => {
    host.connection.dispose();
    if (cloudFileId) {
      const token = await loginWithPassword(SERVER, PASSWORD);
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, cloudFileId);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts unencrypted and refuses to make a key while offline (03 §5)', async () => {
    await expect(host.budgetFile.properties()).resolves.toMatchObject({
      encryption: 'disabled',
      encryptionKeyAvailable: true,
    });
    net.down();
    try {
      await host.connection.syncNow().catch(() => undefined);
      expect(host.connection.state.state).toBe('OfflineReadOnly');
      await expect(host.budgetFile.setEncryptionKey('first secret', true)).rejects.toMatchObject({
        code: 'offline',
      });
    } finally {
      net.up();
    }
    await host.connection.retry('manual');
    await expect(host.budgetFile.properties()).resolves.toMatchObject({ encryption: 'disabled' });
    expect(control.secrets.has(`e2e:${cloudFileId}`)).toBe(false);
  });

  it('enables encryption: resets sync to a new group, keeps the budget open and remembers', async () => {
    const before = host.connection.state.budget?.groupId;
    await host.budgetFile.setEncryptionKey('first secret', true);
    const listed = (await host.connection.listBudgets()).find((b) => b.cloudFileId === cloudFileId);
    expect(listed?.encrypted).toBe(true);
    expect(listed?.groupId).not.toBe(before);
    expect(host.connection.state).toMatchObject({
      state: 'Online',
      budget: { cloudFileId, groupId: listed?.groupId },
    });
    expect(control.app.lastBudget).toMatchObject({ cloudFileId, groupId: listed?.groupId });
    expect(control.secrets.get(`e2e:${cloudFileId}`)).toBe('first secret');
    await expect(host.budgetFile.properties()).resolves.toMatchObject({ encryption: 'enabled' });
    await host.connection.syncNow();
  });

  it('opens the encrypted budget on another device only with the password', async () => {
    await host.connection.closeBudget(false);
    await newDevice();
    await expect(host.connection.openBudget(cloudFileId)).rejects.toMatchObject({
      details: { code: 'missing-key' },
    });
    await expect(host.connection.openBudget(cloudFileId, 'wrong')).rejects.toMatchObject({
      details: { code: 'decrypt-failure' },
    });
    await host.connection.openBudget(cloudFileId, 'first secret');
    expect(host.connection.state.state).toBe('Online');
    await expect(host.read.categories()).resolves.toContainEqual(
      expect.objectContaining({ name: 'Giving' }),
    );
    await host.connection.closeBudget(false);
  });

  it('opens with the remembered password on the device that enabled it', async () => {
    await newDevice(control);
    await host.connection.openBudget(cloudFileId);
    expect(host.connection.state.state).toBe('Online');
  });

  it('generates a new key: the old password stops working and an unremembered one is forgotten', async () => {
    const before = host.connection.state.budget?.groupId;
    await host.budgetFile.setEncryptionKey('second secret', false);
    expect(host.connection.state.budget?.groupId).not.toBe(before);
    expect(control.secrets.has(`e2e:${cloudFileId}`)).toBe(false);
    await expect(host.budgetFile.properties()).resolves.toMatchObject({ encryption: 'enabled' });
    await host.connection.syncNow();
    await host.connection.closeBudget(false);

    await newDevice();
    await expect(host.connection.openBudget(cloudFileId, 'first secret')).rejects.toMatchObject({
      details: { code: 'decrypt-failure' },
    });
    await host.connection.openBudget(cloudFileId, 'second secret');
    expect(host.connection.state.state).toBe('Online');
    await host.connection.closeBudget(false);
  });
});
