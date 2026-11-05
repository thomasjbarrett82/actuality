// Display text for an amount (06 §7): the formatted value, or the privacy mask while privacy mode is on.
// The renderer's <MoneyAmount> component and its text helpers are built on this. Exports and backups are
// data, not display, and call `format` directly.
import type { Money } from './domain/types';
import { format, type FormatOptions, type MoneySettings } from './money';

/**
 * The mask as text, for places that can't hold the mask glyph: chart labels, messages and tooltips. Its
 * length doesn't depend on the value, so the digit count can't be inferred.
 */
export const HIDDEN_AMOUNT_TEXT = '∿∿∿∿';

export interface DisplayOptions extends FormatOptions {
  /** Privacy mode is on: the mask replaces the value. */
  hidden: boolean;
  /** Zero shows as '' (register and budget cells). A blank cell isn't an amount, so it isn't masked. */
  blankZero?: boolean;
}

export function formatMoneyDisplay(
  m: Money,
  settings: MoneySettings,
  opts: DisplayOptions,
): string {
  if (opts.blankZero && m === 0) return '';
  return opts.hidden ? HIDDEN_AMOUNT_TEXT : format(m, settings, opts);
}
