// The announcer (22 §4.5): two visually hidden live regions, polite and assertive, mounted once in
// App.vue. Unprompted changes are announced, never focused (22 §3). The same message isn't repeated
// within 2 s.
import { reactive } from 'vue';

export type Politeness = 'polite' | 'assertive';

export const REPEAT_WINDOW_MS = 2_000;

export const liveRegions = reactive({ polite: '', assertive: '' });

const lastSaid = new Map<string, number>();

/**
 * Announces already-translated text. Clearing first and setting on the next frame makes screen readers
 * read a message even when it equals the previous one.
 */
export function announce(
  text: string,
  politeness: Politeness = 'polite',
  now = Date.now(),
): boolean {
  if (!text) return false;
  const last = lastSaid.get(text);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  lastSaid.set(text, now);
  liveRegions[politeness] = '';
  queueMicrotask(() => {
    liveRegions[politeness] = text;
  });
  return true;
}

/** Test seam. */
export function resetAnnouncer(): void {
  lastSaid.clear();
  liveRegions.polite = '';
  liveRegions.assertive = '';
}
