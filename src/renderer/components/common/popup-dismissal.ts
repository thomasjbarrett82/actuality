// Closes a field's teleported popup once the user has moved on (09 §5.4). Popups sit at the end of the body,
// so their field can't see this through its own blur, which it ignores while the popup has the focus.
import { nextTick, type Ref } from 'vue';

export interface PopupDismissalOptions {
  popup: Readonly<Ref<HTMLElement | null>>;
  /** The field or cell the popup belongs to: pressing it isn't leaving. */
  anchor: Readonly<Ref<HTMLElement | null>>;
  isOpen: () => boolean;
  /** Focus moved from the popup to the anchor. */
  onReturn: () => void;
  /** A press or focus went somewhere else, including another application. */
  onLeave: () => void;
}

export interface PopupDismissal {
  /** Bind to the popup's `focusout`. */
  onFocusout: (e: FocusEvent) => void;
  /** Call while the popup is open; returns the function that stops listening. */
  listen: () => () => void;
}

export function usePopupDismissal(options: PopupDismissalOptions): PopupDismissal {
  const { popup, anchor, isOpen, onReturn, onLeave } = options;

  function onPointer(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (!target || popup.value?.contains(target) || anchor.value?.contains(target)) return;
    onLeave();
  }

  /**
   * Without a relatedTarget, focus may have left the app or only a replaced element (a list giving way to
   * the calculator), so that case reads where focus is once the swap has rendered. Switching apps keeps
   * activeElement, which is why hasFocus() is checked too.
   */
  function onFocusout(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    void nextTick(() => {
      if (!isOpen()) return;
      const at = to ?? (document.hasFocus() ? document.activeElement : null);
      if (at && popup.value?.contains(at)) return;
      if (at && anchor.value?.contains(at)) onReturn();
      else onLeave();
    });
  }

  return {
    onFocusout,
    listen() {
      document.addEventListener('pointerdown', onPointer, true);
      return () => {
        document.removeEventListener('pointerdown', onPointer, true);
      };
    },
  };
}
