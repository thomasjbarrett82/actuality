import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { host } from './rpc/host-client';
import { quit } from './session-flows';
import { useConnection } from './stores/connection';
import { useDialogs } from './stores/dialogs';
import { useSettings } from './stores/settings';

const budget = {
  cloudFileId: 'c1',
  groupId: 'g1',
  name: 'Home',
  budgetType: 'envelope' as const,
  localOnly: false,
};
const unsynced: ConnectionInfo = {
  ...INITIAL_CONNECTION,
  state: 'OfflineReadOnly',
  budget,
  unsyncedChanges: true,
};

async function answer(button: string | null): Promise<void> {
  await flushPromises();
  const dialogs = useDialogs();
  const top = dialogs.stack.at(-1);
  if (!top) throw new Error('no dialog open');
  dialogs.close(top.id, { button, checkboxChecked: false });
  await flushPromises();
}

describe('quit and close with unsynced changes (06 §5, 03 §5.4)', () => {
  let call: MockInstance<typeof host.call>;
  let quitApp: MockInstance<typeof window.app.shell.quit>;
  beforeEach(() => {
    call = vi.spyOn(host, 'call').mockResolvedValue({ ...INITIAL_CONNECTION });
    quitApp = vi.spyOn(window.app.shell, 'quit');
  });

  it('quits at once when everything has reached the server', async () => {
    useConnection().info = { ...unsynced, unsyncedChanges: false };
    await quit();
    expect(useDialogs().stack).toHaveLength(0);
    expect(quitApp).toHaveBeenCalledOnce();
  });

  it('asks first; Cancel keeps the app open and Quit anyway quits', async () => {
    useConnection().info = unsynced;
    const cancelled = quit();
    await flushPromises();
    const dialog = useDialogs().stack[0]?.options;
    expect(dialog?.instruction).toBe("Some changes haven't reached your server");
    expect(dialog?.buttons.map((b) => (typeof b === 'string' ? b : b.label))).toEqual([
      'Try again',
      'Quit anyway',
      'cancel',
    ]);
    await answer('cancel');
    await cancelled;
    expect(quitApp).not.toHaveBeenCalled();

    const anyway = quit();
    await answer('anyway');
    await anyway;
    expect(quitApp).toHaveBeenCalledOnce();
  });

  it('Try again syncs, and quits once nothing is left unsynced', async () => {
    const connection = useConnection();
    connection.info = unsynced;
    call.mockImplementation(() => {
      connection.info = { ...unsynced, state: 'Online', unsyncedChanges: false };
      return Promise.resolve(connection.info);
    });
    const done = quit();
    await answer('retry');
    await done;
    expect(call).toHaveBeenCalledWith('session.syncNow', {});
    expect(quitApp).toHaveBeenCalledOnce();
  });

  it('says the offline copy is kept when clearCacheOnExit is on', async () => {
    useConnection().info = unsynced;
    useSettings().app.clearCacheOnExit = true;
    void quit();
    await flushPromises();
    expect(useDialogs().stack[0]?.options.content).toContain("won't be removed");
    await answer(null);
  });
});
