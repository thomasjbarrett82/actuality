// The loading overlay service (17 §6): `during(label, promise)` shows the overlay only if the operation
// takes more than 150 ms. It never takes focus; input is blocked while it shows (22 §3).
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const SHOW_AFTER_MS = 150;

export const useLoadingOverlay = defineStore('loading', () => {
  const label = ref<string | null>(null);
  let active = 0;

  /** The text of the operation in progress, shown once the delay has passed. */
  let text: string | null = null;

  async function during<T>(initial: string, work: Promise<T>): Promise<T> {
    const ticket = ++active;
    text = initial;
    const timer = setTimeout(() => {
      if (active === ticket) label.value = text;
    }, SHOW_AFTER_MS);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      if (active === ticket) {
        label.value = null;
        text = null;
      }
    }
  }

  /** New text for the operation in progress: a long job's progress (03 §3, 18 §2). */
  function update(next: string): void {
    if (text === null) return;
    text = next;
    if (label.value !== null) label.value = next;
  }

  return { label, during, update };
});
