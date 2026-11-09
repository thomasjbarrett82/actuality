// The toast stack (24 §5): non-modal messages at the bottom right of the window, oldest at the bottom.
// Each has a stable id, so showing it again replaces it instead of stacking a duplicate. None times out
// (WCAG 2.2.1): a toast stays until it is closed (✕ or Esc, which run its `onClose`) or removed (which
// doesn't). A new toast is announced politely and never takes focus (22 §3).
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { announce } from '../a11y/announcer';

export interface ToastAction {
  /** Already translated. */
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  /** Already translated. */
  title: string;
  message: string;
  action: ToastAction;
  /** Runs when the user closes the toast, not when the app removes it. */
  onClose?: () => void | Promise<void>;
}

export const useToasts = defineStore('toasts', () => {
  const list = ref<Toast[]>([]);

  function show(toast: Toast): void {
    const i = list.value.findIndex((t) => t.id === toast.id);
    const previous = list.value[i];
    if (previous && i !== -1) list.value.splice(i, 1, toast);
    else list.value.push(toast);
    if (previous?.title !== toast.title || previous.message !== toast.message)
      announce(`${toast.title} ${toast.message}`);
  }

  /** Takes a toast away without running its `onClose`. */
  function remove(id: string): void {
    const i = list.value.findIndex((t) => t.id === id);
    if (i !== -1) list.value.splice(i, 1);
  }

  /** The user closed it: ✕ or Esc. */
  async function close(id: string): Promise<void> {
    const toast = list.value.find((t) => t.id === id);
    if (!toast) return;
    remove(id);
    await toast.onClose?.();
  }

  return { list, show, remove, close };
});
