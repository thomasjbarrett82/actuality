// Privacy mode (06 §7): <MoneyAmount> and the text helpers show the amount, or the mask while the mode is
// on, and switch back without reloading anything.
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import { HIDDEN_AMOUNT_TEXT } from '@shared/money-display';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { moneyFormatter, moneyLabel, moneyText } from '../../money-display';
import { printAmount } from '../../print/print-view';
import { useSettings } from '../../stores/settings';
import { axe, mountApp } from '../../testing/mount';
import MoneyAmount from './MoneyAmount.vue';
import MoneyInput from './MoneyInput.vue';

const usd = { ...DEFAULT_MONEY_SETTINGS, currencyCode: 'USD' };
const privacy = (on: boolean): void => {
  useSettings().app = { ...DEFAULT_APP_SETTINGS, privacyMode: on };
};

beforeEach(() => {
  privacy(false);
});

describe('<MoneyAmount> (06 §7)', () => {
  it('shows the formatted amount while privacy mode is off', () => {
    const w = mountApp(MoneyAmount, { props: { value: -123456, settings: usd, symbol: true } });
    expect(w.text()).toBe('-$1,234.56');
    expect(w.find('.money-mask').exists()).toBe(false);
  });

  it('shows the mask, named "Hidden amount", with the value nowhere in the DOM', async () => {
    privacy(true);
    const w = mountApp(MoneyAmount, { props: { value: -123456, settings: usd, symbol: true } });
    const mask = w.get('.money-mask');
    expect(mask.attributes('role')).toBe('img');
    expect(mask.attributes('aria-label')).toBe('Hidden amount');
    expect(w.text()).toBe('');
    expect(w.html()).not.toContain('1,234');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('masks every value the same way, so the size can’t be inferred', () => {
    privacy(true);
    const html = [1, 123456789].map((value) =>
      mountApp(MoneyAmount, { props: { value, settings: usd } }).html(),
    );
    expect(html[0]).toBe(html[1]);
  });

  it('follows the mode as it changes', async () => {
    const w = mountApp(MoneyAmount, { props: { value: 500, settings: usd, plus: true } });
    expect(w.text()).toBe('+5.00');
    privacy(true);
    await flushPromises();
    expect(w.find('.money-mask').exists()).toBe(true);
    privacy(false);
    await flushPromises();
    expect(w.text()).toBe('+5.00');
  });

  it('leaves blank cells and null values blank', () => {
    privacy(true);
    const zero = mountApp(MoneyAmount, { props: { value: 0, settings: usd, blankZero: true } });
    expect(zero.find('.money-mask').exists()).toBe(false);
    expect(zero.text()).toBe('');
    const none = mountApp(MoneyAmount, { props: { value: null, settings: usd } });
    expect(none.find('.money-mask').exists()).toBe(false);
  });
});

describe('amount fields (06 §7)', () => {
  it('mask a pre-filled amount, even with focus, until the user types in the field', async () => {
    privacy(true);
    const w = mountApp(MoneyInput, {
      props: { modelValue: 123456, label: 'Outflow', settings: usd },
      attachTo: document.body,
    });
    const input = w.get('input');
    const el = input.element;
    expect(el.value).toBe(HIDDEN_AMOUNT_TEXT);
    expect(input.attributes('aria-description')).toBe('Hidden amount');
    expect(w.html()).not.toContain('1234');
    expect(await axe(document.body)).toHaveNoViolations();

    // The editor focuses and selects the field as it opens: still masked.
    el.focus();
    el.select();
    await flushPromises();
    expect(el.value).toBe(HIDDEN_AMOUNT_TEXT);

    // A key reveals the amount, still fully selected, so typing replaces it.
    await input.trigger('keydown', { key: 'ArrowRight' });
    expect(el.value).toBe('1234.56');
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, el.value.length]);
    expect(input.attributes('aria-description')).toBeUndefined();

    await input.setValue('20');
    el.blur();
    await flushPromises();
    expect(w.emitted('update:modelValue')).toEqual([[2000]]);
    expect(el.value).toBe(HIDDEN_AMOUNT_TEXT);
    w.unmount();
  });

  it('reveal on a click in the field, but not on Tab', async () => {
    privacy(true);
    const w = mountApp(MoneyInput, { props: { modelValue: 500, label: 'Outflow', settings: usd } });
    const input = w.get('input');
    await input.trigger('keydown', { key: 'Tab' });
    expect(input.element.value).toBe(HIDDEN_AMOUNT_TEXT);
    await input.trigger('pointerdown');
    expect(input.element.value).toBe('5.00');
  });

  it('show the amount while privacy mode is off, and leave an empty field empty', async () => {
    const w = mountApp(MoneyInput, { props: { modelValue: 500, label: 'Outflow', settings: usd } });
    expect(w.get('input').element.value).toBe('5.00');
    privacy(true);
    await w.setProps({ modelValue: null });
    expect(w.get('input').element.value).toBe('');
  });
});

describe('amount text helpers (06 §7)', () => {
  it('give the amount while privacy mode is off', () => {
    expect(moneyText(-5000, usd, { symbol: true })).toBe('-$50.00');
    expect(moneyLabel(-5000, usd, { symbol: true })).toBe('-$50.00');
    expect(moneyFormatter(usd)(5000)).toBe('50.00');
    expect(printAmount(5000, usd)).toBe('$50.00');
  });

  it('mask messages, chart labels and print, and name the amount "Hidden amount"', () => {
    privacy(true);
    expect(moneyText(-5000, usd, { symbol: true })).toBe(HIDDEN_AMOUNT_TEXT);
    expect(moneyLabel(-5000, usd, { symbol: true })).toBe('Hidden amount');
    expect(moneyFormatter(usd)(5000)).toBe(HIDDEN_AMOUNT_TEXT);
    expect(printAmount(5000, usd)).toBe(HIDDEN_AMOUNT_TEXT);
  });

  it('fixes a formatter to the mode it was built in', () => {
    const shown = moneyFormatter(usd);
    privacy(true);
    expect(shown(5000)).toBe('50.00');
    expect(moneyFormatter(usd)(5000)).toBe(HIDDEN_AMOUNT_TEXT);
  });
});
