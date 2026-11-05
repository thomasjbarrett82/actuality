// The callout service (17 §3): `open(component, props, opts)` shows a component inside a Callout anchored
// to an element, and resolves with the result id when it closes.
import { defineStore } from 'pinia';
import { markRaw, ref, type Component } from 'vue';
import type { Tail } from '../components/common/callout-placement';

export interface CalloutOptions {
  anchor: HTMLElement;
  title?: string;
  variant?: 'gradient' | 'opaque' | 'help';
  placements?: readonly Tail[];
  closeOnRollOut?: boolean;
  closeOnClickOutside?: boolean;
  closeOnEsc?: boolean;
  width?: string;
  buttons?: boolean;
}

export interface OpenCallout {
  id: number;
  component: Component;
  props: Record<string, unknown>;
  options: CalloutOptions;
  resolve: (result: string) => void;
}

export const useCallouts = defineStore('callouts', () => {
  const open = ref<OpenCallout[]>([]);
  let nextId = 1;

  function show(
    component: Component,
    props: Record<string, unknown>,
    options: CalloutOptions,
  ): Promise<string> {
    return new Promise((resolve) => {
      open.value.push({
        id: nextId++,
        component: markRaw(component),
        props,
        options: markRaw(options),
        resolve,
      });
    });
  }

  function close(id: number, result: string): void {
    const i = open.value.findIndex((c) => c.id === id);
    if (i === -1) return;
    const [callout] = open.value.splice(i, 1);
    callout?.resolve(result);
  }

  return { open, show, close };
});
