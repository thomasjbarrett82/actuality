// The modal service for standard dialogs (17 §2): `open(component, props)` shows a dialog component in
// ModalHost and resolves with what it emits as `close` (null for Cancel / Esc). Dialogs stack LIFO.
import { defineStore } from 'pinia';
import { markRaw, ref, type Component } from 'vue';

interface OpenModal {
  id: number;
  component: Component;
  props: Record<string, unknown>;
  resolve: (result: unknown) => void;
}

export const useModals = defineStore('modals', () => {
  const stack = ref<OpenModal[]>([]);
  let nextId = 1;

  function open<R>(component: Component, props: Record<string, unknown> = {}): Promise<R | null> {
    return new Promise((resolve) => {
      stack.value.push({
        id: nextId++,
        component: markRaw(component),
        props,
        resolve: resolve as (result: unknown) => void,
      });
    });
  }

  function close(id: number, result: unknown): void {
    const i = stack.value.findIndex((m) => m.id === id);
    if (i === -1) return;
    const [modal] = stack.value.splice(i, 1);
    modal?.resolve(result ?? null);
  }

  return { stack, open, close };
});
