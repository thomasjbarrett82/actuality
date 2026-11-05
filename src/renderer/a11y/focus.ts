// Focus rules (22 §3): modals trap focus and return it on close; focus never falls to <body>.
import { focusables } from '../keyboard/dispatcher';

/**
 * Traps Tab inside `container` and focuses `initial` (or the first focusable element). Returns a release
 * function that restores focus to the element that had it before, or to `fallback` if that one is gone.
 */
export function trapFocus(
  container: HTMLElement,
  initial?: HTMLElement | null,
): (fallback?: () => HTMLElement | null) => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const items = focusables(container);
    if (items.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && (active === last || !container.contains(active))) {
      e.preventDefault();
      first?.focus();
    }
  };
  container.addEventListener('keydown', onKey);
  const target = initial ?? focusables(container)[0] ?? container;
  if (target === container && !container.hasAttribute('tabindex')) container.tabIndex = -1;
  target.focus();

  return (fallback) => {
    container.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
    else fallback?.()?.focus();
  };
}
