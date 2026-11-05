// The host's connection backbone against a real Actual server (03 §4–6): sign in,
// open, write through the gate, lose the server, reject writes, retry back online, an offline open of the
// local copy followed by a re-init in the same process, and delete-budget on a local copy. Uses a
// throwaway budget it creates and deletes.
import { APP_NAME } from '@shared/app';
import type { HostEvents } from '@shared/rpc/host-api';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRealActualForTests,
  type ActualApi,
  type ActualTestFixtures,
} from '../../src/host/actual';
import { Connection } from '../../src/host/connection';
import { JobQueue } from '../../src/host/queue';
import { loginWithPassword } from '../../src/host/server-api';
import { MetadataRepository } from '../../src/host/services/metadata';
import { NotesService } from '../../src/host/services/notes';
import { FakeControl } from '../../src/host/testing/fake-control';
import { installNetworkSwitch, type NetworkSwitch } from './network';
import { bootstrap, PASSWORD, SERVER } from './setup';

describe.skipIf(!SERVER || !PASSWORD)('connection against a real server (03 §4–6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'actual-desktop-int-'));
  const events: { event: keyof HostEvents; payload: unknown }[] = [];
  /** Undo steps, added as setup gets further, so a failed setup tears down only what it built. */
  const cleanup: (() => Promise<void> | void)[] = [];
  let net: NetworkSwitch;
  let actual: ActualApi;
  let fixtures: ActualTestFixtures;
  let token: string;
  let cloudFileId: string;
  let control: FakeControl;
  let queue: JobQueue;
  let conn: Connection;
  let notes: NotesService;

  const newConnection = (): Connection =>
    new Connection({
      actual,
      queue,
      control,
      emit: (event, payload) => events.push({ event, payload }),
      dataDir: join(dir, 'actual-cache'),
      probe: (url) => net.probe(url),
      login: loginWithPassword,
    });

  beforeAll(async () => {
    await bootstrap();
    net = installNetworkSwitch();
    // The API creates budget folders inside its data directory, but not the directory itself.
    for (const sub of ['fixtures', 'actual-cache']) mkdirSync(join(dir, sub), { recursive: true });
    ({ actual, fixtures } = await createRealActualForTests(join(dir, 'fixtures')));
    cleanup.push(() => actual.shutdown().catch(() => undefined));
    token = await loginWithPassword(SERVER, PASSWORD);
    const file = await fixtures.createServerBudget(
      SERVER,
      token,
      `${APP_NAME} int ${String(Date.now())}`,
    );
    cloudFileId = file.cloudFileId ?? '';
    cleanup.push(async () => {
      // The delete runs its own API session, so the test's session ends first.
      await actual.shutdown().catch(() => undefined);
      await fixtures.deleteServerBudget(SERVER, token, cloudFileId);
    });
    control = new FakeControl();
    queue = new JobQueue();
    conn = newConnection();
    cleanup.push(() => {
      conn.dispose();
    });
    notes = new NotesService(actual, queue, conn, new MetadataRepository(actual));
  });

  afterAll(async () => {
    net.up();
    // Newest first: close the connection, then delete the test budget.
    for (const step of cleanup.reverse()) await step();
    rmSync(dir, { recursive: true, force: true });
  });

  it('signs in, stores the token, lists the budget and opens it Online', async () => {
    const info = await conn.connect(SERVER, PASSWORD, true);
    expect(info.state).toBe('SignedIn');
    expect(control.secrets.get(`server:${SERVER}`)).toBeTruthy();
    const budgets = await conn.listBudgets();
    expect(budgets.some((b) => b.cloudFileId === cloudFileId)).toBe(true);
    const opened = await conn.openBudget(cloudFileId);
    expect(opened.localOnly).toBe(false);
    expect(conn.state.state).toBe('Online');
  });

  it('writes through the gate and reports the changed tables', async () => {
    events.length = 0;
    await notes.set('int-test-note', 'online write');
    await expect(notes.get('int-test-note')).resolves.toBe('online write');
    expect(events.some((e) => e.event === 'data:changed')).toBe(true);
  });

  it('goes OfflineReadOnly when the server is unreachable and rejects writes', async () => {
    net.down();
    await conn.syncNow().catch(() => undefined);
    expect(conn.state.state).toBe('OfflineReadOnly');
    await expect(notes.set('int-test-note', 'offline write')).rejects.toMatchObject({
      code: 'offline',
    });
    // Reads still work from the local copy.
    await expect(notes.get('int-test-note')).resolves.toBe('online write');
  });

  it('a retry while the server is still down queues nothing and stays offline', async () => {
    const result = await conn.retry('manual');
    expect(result.connection.state).toBe('OfflineReadOnly');
    expect(queue.running).toBeNull();
  });

  it('comes back Online through a retry once the server answers, and writes again', async () => {
    net.up();
    const result = await conn.retry('manual');
    expect(result.connection.state).toBe('Online');
    await notes.set('int-test-note', 'after reconnect');
    await expect(notes.get('int-test-note')).resolves.toBe('after reconnect');
  });

  it('opens the local copy read-only when started offline, then re-inits Online in the same process', async () => {
    await conn.closeBudget(false);
    conn.dispose();
    // A slate wipe of the host with the stored token, while the server is down (03 §6.2).
    net.down();
    conn = newConnection();
    notes = new NotesService(actual, queue, conn, new MetadataRepository(actual));
    await conn.connect(SERVER, undefined, true).catch(() => undefined);
    const opened = await conn.openBudget(cloudFileId);
    expect(opened.localOnly).toBe(true);
    expect(conn.state.state).toBe('OfflineReadOnly');
    await expect(notes.set('int-test-note', 'local-only write')).rejects.toMatchObject({
      code: 'offline',
    });

    net.up();
    const result = await conn.retry('manual');
    expect(result.connection.state).toBe('Online');
    await notes.set('int-test-note', 'after re-init');
    await expect(notes.get('int-test-note')).resolves.toBe('after re-init');
  });

  it('deletes only the local copy with delete-budget and a local id (03 §3, §7.1 user switch)', async () => {
    await conn.closeBudget(false);
    const cache = join(dir, 'actual-cache');
    await actual.init({ dataDir: cache, serverURL: SERVER, sessionToken: token });
    try {
      const before = await actual.getBudgets();
      const local = before.find((b) => b.state !== 'remote' && b.cloudFileId === cloudFileId);
      expect(local?.id).toBeTruthy();
      await actual.deleteLocalBudget(local?.id ?? '');
      const after = await actual.getBudgets();
      expect(after.some((b) => b.id === local?.id)).toBe(false);
      // The server's copy stays.
      expect(after.some((b) => b.state === 'remote' && b.cloudFileId === cloudFileId)).toBe(true);
      expect(existsSync(join(cache, local?.id ?? ''))).toBe(false);
    } finally {
      await actual.shutdown();
    }
  });
});
