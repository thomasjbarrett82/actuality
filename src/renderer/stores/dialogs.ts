// The dialog service (17 §1): TaskDialogs stack LIFO in DialogHost; each call returns a promise with the
// button pressed (null for Esc / ✕) and the footer checkbox state.
import type { ISODate } from '@shared/domain/types';
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';

export type StandardButton = 'ok' | 'cancel' | 'close' | 'yes' | 'no' | 'retry';

export interface CustomButton {
  id: string;
  label: string;
  isDefault?: boolean;
}

export interface CommandLink {
  id: string;
  title: string;
  subLabel?: string;
  isDefault?: boolean;
}

export type TaskDialogIcon = 'none' | 'info' | 'warning' | 'error' | 'help' | 'logo';

/** One date field under the content (Change Date…, 10 §6.1). It starts empty. */
export interface TaskDialogDateField {
  label: string;
  placeholder?: string;
  dateFormat: string;
  today: ISODate;
  /** This button is disabled until the field holds a valid date, and returns it. */
  requiredBy: string;
}

/** Already-translated texts. `content` may hold rich text (17 §1). */
export interface TaskDialogOptions {
  instruction: string;
  content?: string;
  title?: string;
  footer?: string;
  icon?: TaskDialogIcon;
  buttons: (StandardButton | CustomButton)[];
  commandLinks?: CommandLink[];
  checkbox?: { text: string; checked?: boolean; tooltip?: string };
  dateField?: TaskDialogDateField;
  /** Shows ✕ and allows Esc even without a cancel-type button. */
  cancelable?: boolean;
}

export interface TaskDialogResult {
  /** The button or command link id, `link:{event}` for a content link, or null for Esc / ✕. */
  button: string | null;
  checkboxChecked: boolean;
  /** The date field's date, when the dialog has one and was closed with its `requiredBy` button. */
  date?: ISODate;
}

export interface OpenDialog {
  id: number;
  options: TaskDialogOptions;
  resolve: (result: TaskDialogResult) => void;
}

export const CANCEL_TYPES: readonly string[] = ['cancel', 'close', 'no'];

/** The default button (17 §1): the flagged one, else the last footer button that isn't Cancel/No. */
export function defaultButtonId(options: TaskDialogOptions): string | null {
  const flagged = options.buttons.find((b) => typeof b !== 'string' && b.isDefault);
  if (flagged && typeof flagged !== 'string') return flagged.id;
  const ids = options.buttons.map((b) => (typeof b === 'string' ? b : b.id));
  return [...ids].reverse().find((id) => id !== 'cancel' && id !== 'no') ?? ids.at(-1) ?? null;
}

/** Esc closes only with a Cancel, Close or No button, or when `cancelable` (17 §1). */
export function escClosable(options: TaskDialogOptions): boolean {
  return (
    options.cancelable === true ||
    options.buttons.some((b) => typeof b === 'string' && CANCEL_TYPES.includes(b))
  );
}

export const useDialogs = defineStore('dialogs', () => {
  const stack = ref<OpenDialog[]>([]);
  let nextId = 1;

  function showTaskDialog(options: TaskDialogOptions): Promise<TaskDialogResult> {
    return new Promise((resolve) => {
      stack.value.push({ id: nextId++, options: markRaw(options), resolve });
    });
  }

  function close(id: number, result: TaskDialogResult): void {
    const i = stack.value.findIndex((d) => d.id === id);
    if (i === -1) return;
    const [dialog] = stack.value.splice(i, 1);
    dialog?.resolve(result);
  }

  return { stack, showTaskDialog, close };
});
