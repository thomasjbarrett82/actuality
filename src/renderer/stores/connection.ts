// The renderer's mirror of the host's connection state (03 §4), and `useCanEdit()` (03 §5.3).
import {
  INITIAL_CONNECTION,
  canEdit as stateAllowsEdits,
  type ConnectionInfo,
} from '@shared/connection';
import type { HostStatus } from '@shared/shell-api';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { host } from '../rpc/host-client';

export const useConnection = defineStore('connection', () => {
  const info = ref<ConnectionInfo>({ ...INITIAL_CONNECTION });
  /** The API host process: "restarting" shows "Reconnecting…" and blocks writes (03 §6.5). */
  const hostStatus = ref<HostStatus>('running');

  /** True only in Online/Syncing, with the host running (03 §5.3). */
  const canEdit = computed(
    () => hostStatus.value === 'running' && stateAllowsEdits(info.value.state),
  );

  /** The current host has answered session.state since it (re)started. */
  const hostReady = ref(false);

  function refresh(): void {
    hostReady.value = false;
    void host.call('session.state', {}).then(
      (next) => {
        info.value = next;
        hostReady.value = true;
      },
      // The port closed under the call (the host restarted): the next attach asks again.
      () => undefined,
    );
  }

  let started = false;
  function start(): void {
    if (started) return;
    started = true;
    host.on('connection:state', (next) => {
      info.value = next;
    });
    window.app.shell.onHostStatus((status) => {
      hostStatus.value = status;
      if (status !== 'running') hostReady.value = false;
      // Main gave up restarting the host (03 §6.5): no call may wait for a port that never comes.
      if (status === 'failed') host.fail();
    });
    // Each new port is a new host (or a reloaded page): ask it for the state again.
    host.onAttach(refresh);
  }

  return { info, hostStatus, hostReady, canEdit, start };
});

/** Every editing affordance binds to this (03 §5.3). */
export function useCanEdit(): Readonly<{ value: boolean }> {
  const store = useConnection();
  return computed(() => store.canEdit);
}
