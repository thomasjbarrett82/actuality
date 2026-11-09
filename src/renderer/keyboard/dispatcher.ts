// The in-app keyboard dispatcher (06 §6, 22 §2): one capture-phase keydown listener on window, routing
// keys to a stack of handler scopes. While a modal is open only the modal's scope gets keys. Regions are
// cycled with F6 / Shift+F6; Shift+F10 and the Menu key open the focused item's context menu.
import { shallowRef } from 'vue';

export type KeyHandler = (e: KeyboardEvent) => boolean | undefined;

interface Scope {
  handler: KeyHandler;
  modal: boolean;
}

export interface Region {
  name: string;
  order: number;
  element: HTMLElement;
  /** The element focused last inside the region, to return to it (22 §2.1). */
  lastFocused: HTMLElement | null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Elements that take keyboard focus inside a container, in DOM order. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute('inert') &&
      el.closest('[inert]') === null &&
      el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Typing in a text field doesn't trigger single-key shortcuts (06 §6). @public: for the screen key tables. */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(
      target.type,
    );
  }
  return false;
}

/**
 * In a popup that a field opened, such as the calculator (09 §5.4). It is teleported out of whatever holds
 * the field, so a dialog or callout can't tell by containment that its keys and clicks aren't for it.
 */
export function inFieldPopup(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-field-popup]') !== null;
}

/** Inside a part of the page that handles its own keys, such as the toast stack (24 §5). */
function ownsKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-own-keys]') !== null;
}

export class KeyboardDispatcher {
  private readonly scopes: Scope[] = [];
  private readonly regions: Region[] = [];
  /** Reactive, so the toast stack can follow it (24 §5). */
  private readonly modalCount = shallowRef(0);
  private detach: (() => void) | null = null;

  install(target: Window): void {
    const onKey = (e: KeyboardEvent): void => {
      this.handle(e);
    };
    const onFocus = (e: FocusEvent): void => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      for (const r of this.regions) if (r.element.contains(el)) r.lastFocused = el;
    };
    target.addEventListener('keydown', onKey, { capture: true });
    target.addEventListener('focusin', onFocus);
    this.detach = () => {
      target.removeEventListener('keydown', onKey, { capture: true });
      target.removeEventListener('focusin', onFocus);
    };
  }

  uninstall(): void {
    this.detach?.();
    this.detach = null;
  }

  /** Adds a handler scope on top of the stack. A modal scope hides every scope below it. */
  push(handler: KeyHandler, opts: { modal?: boolean } = {}): () => void {
    const scope: Scope = { handler, modal: opts.modal === true };
    this.scopes.push(scope);
    if (scope.modal) this.modalCount.value++;
    return () => {
      const i = this.scopes.indexOf(scope);
      if (i === -1) return;
      this.scopes.splice(i, 1);
      if (scope.modal) this.modalCount.value--;
    };
  }

  /** Whether a modal scope is open. Reactive. */
  get modalOpen(): boolean {
    return this.modalCount.value > 0;
  }

  registerRegion(name: string, order: number, element: HTMLElement): () => void {
    const region: Region = { name, order, element, lastFocused: null };
    this.regions.push(region);
    this.regions.sort((a, b) => a.order - b.order);
    return () => {
      const i = this.regions.indexOf(region);
      if (i !== -1) this.regions.splice(i, 1);
    };
  }

  handle(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (e.key === 'F6' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // F6 does nothing while a modal is open: focus stays trapped (22 §2.1).
      if (!this.modalOpen && this.cycleRegion(e.shiftKey ? -1 : 1)) e.preventDefault();
      return;
    }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      if (this.openContextMenu()) e.preventDefault();
      return;
    }
    // This listener runs first, so a modal's Enter or Esc would otherwise beat the popup's own.
    if (inFieldPopup(e.target) || ownsKeys(e.target)) return;
    const top = [...this.scopes].reverse();
    const modalIndex = top.findIndex((s) => s.modal);
    const active = modalIndex === -1 ? top : top.slice(0, modalIndex + 1);
    for (const scope of active) {
      if (scope.handler(e) === true) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  }

  /** Moves focus to the next/previous region, wrapping round (22 §2.1). */
  cycleRegion(direction: 1 | -1): boolean {
    const visible = this.regions.filter((r) => r.element.isConnected && !r.element.hidden);
    if (visible.length === 0) return false;
    const active = document.activeElement;
    const current = visible.findIndex((r) => active instanceof Node && r.element.contains(active));
    const next = visible[(current + direction + visible.length) % visible.length] ?? visible[0];
    if (!next) return false;
    const target = next.lastFocused?.isConnected
      ? next.lastFocused
      : (focusables(next.element)[0] ?? next.element);
    if (target === next.element && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus();
    return true;
  }

  /** Shift+F10 / Menu key: the same menu as a right-click on the focused item (22 §2.2). */
  private openContextMenu(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return false;
    const rect = el.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 4,
      clientY: rect.bottom - 4,
    });
    el.dispatchEvent(event);
    return true;
  }
}

export const keyboard = new KeyboardDispatcher();
