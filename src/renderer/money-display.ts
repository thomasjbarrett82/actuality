// The renderer's amount text (06 §7). Every amount the UI shows goes through <MoneyAmount> or these helpers,
// which apply privacy mode; components never test the flag themselves. Amount fields show the real value
// only while they have focus (`useMaskedField`). Exports and backups show real values and don't use them.
import type { Money } from '@shared/domain/types';
import { format, type FormatOptions, type MoneySettings } from '@shared/money';
import { formatMoneyDisplay, HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { i18n } from './i18n';
import { useAppStore } from './stores/app';

export type MoneyTextOptions = FormatOptions & { blankZero?: boolean };

/** Visible text: the formatted amount, or the mask text in privacy mode. Reactive in templates. */
export function moneyText(m: Money, settings: MoneySettings, opts: MoneyTextOptions = {}): string {
  return formatMoneyDisplay(m, settings, { ...opts, hidden: useAppStore().privacyMode });
}

/** An accessible name or announcement: the amount, or "Hidden amount" in privacy mode. */
export function moneyLabel(m: Money, settings: MoneySettings, opts: FormatOptions = {}): string {
  return useAppStore().privacyMode ? i18n.global.t('a11y.hiddenAmount') : format(m, settings, opts);
}

/**
 * A formatter fixed to the current privacy mode, for chart libraries that format later. Built inside a
 * computed, it makes the computed follow the mode.
 */
export function moneyFormatter(
  settings: MoneySettings,
  opts: FormatOptions = {},
): (m: Money) => string {
  const hidden = useAppStore().privacyMode;
  return (m) => formatMoneyDisplay(m, settings, { ...opts, hidden });
}

/** Keys that pass through or leave a field without editing it, so they don't reveal it. */
const NON_EDITING_KEYS = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta']);

/**
 * An amount field's text while privacy mode is on (06 §7): the mask text until the user clicks in the
 * field or presses a key in it, and again once it loses focus. Focus alone doesn't reveal it, because
 * dialogs and the editor focus an amount field as they open. Bind `:value="shown"`,
 * `v-bind="attrs"` and the handlers in place of `v-model`; call `onKeydown` before the
 * field's own key handling. The real text goes into the input before the key acts, and a fully selected
 * mask becomes the fully selected amount, so typing still replaces it.
 */
export function useMaskedField(text: Ref<string>): {
  shown: ComputedRef<string>;
  /**
   * `v-bind` these: the accessible description "Hidden amount" while masked, so a screen reader doesn't
   * read out the squiggle. (Vue's attribute types don't list `aria-description` yet.)
   */
  attrs: ComputedRef<Record<string, string>>;
  onInput: (e: Event) => void;
  onPointerdown: (e: PointerEvent) => void;
  onKeydown: (e: KeyboardEvent) => void;
  onBlur: () => void;
} {
  const app = useAppStore();
  const revealed = ref(false);
  const masked = computed(() => app.privacyMode && !revealed.value && text.value.trim() !== '');
  function reveal(el: HTMLInputElement): void {
    if (!masked.value) return;
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    revealed.value = true;
    el.value = text.value;
    if (all && document.activeElement === el) el.select();
  }
  return {
    shown: computed(() => (masked.value ? HIDDEN_AMOUNT_TEXT : text.value)),
    attrs: computed(() =>
      masked.value ? { 'aria-description': i18n.global.t('a11y.hiddenAmount') } : {},
    ),
    onInput: (e) => {
      text.value = (e.target as HTMLInputElement).value;
    },
    onPointerdown: (e) => {
      reveal(e.target as HTMLInputElement);
    },
    onKeydown: (e) => {
      if (!NON_EDITING_KEYS.has(e.key)) reveal(e.target as HTMLInputElement);
    },
    onBlur: () => {
      revealed.value = false;
    },
  };
}
