import type { ISODate } from '@shared/domain/types';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { liveRegions, resetAnnouncer } from '../../a11y/announcer';
import { budgetWeekStart } from '../../i18n';
import { axe, mountApp } from '../../testing/mount';
import type { AutoCompleteEntry } from './autocomplete-list';
import AutoComplete from './AutoComplete.vue';
import CalculatorPanel from './CalculatorPanel.vue';
import DateField from './DateField.vue';
import MoneyInput from './MoneyInput.vue';
import MonthPicker from './MonthPicker.vue';
import StandardDialog from './StandardDialog.vue';

const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

async function type(input: HTMLInputElement, text: string): Promise<void> {
  input.value = text;
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }),
  );
  await nextTick();
  await nextTick();
}

describe('AutoComplete (11 §4, 22 §4.4)', () => {
  const entries: AutoCompleteEntry[] = [
    { kind: 'item', id: 'amazon', label: 'Amazon' },
    { kind: 'item', id: 'kroger', label: 'Kroger' },
    { kind: 'heading', id: 'transfers', label: 'Transfer to/from account:' },
    { kind: 'item', id: 'checking', label: 'Transfer : Checking' },
  ];

  it('is a combobox; typing filters, types ahead and Enter accepts the match', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(AutoComplete, {
      props: { modelValue: '', entries, label: 'Payee', onCommit },
    });
    const input = wrapper.find('input').element;
    input.focus();
    await type(input, 'kr');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.value).toBe('kroger');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active?.getAttribute('role')).toBe('option');
    expect(active?.querySelector('strong')?.textContent).toBe('Kr');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(await axe(document.body)).toHaveNoViolations();
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('Kroger', entries[1], 'enter');
    await nextTick();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves with ↓/↑ over items only, keeping headings as groups', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(AutoComplete, {
      props: { modelValue: '', entries, label: 'Payee', onCommit },
    });
    const input = wrapper.find('input').element;
    input.focus();
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    await nextTick();
    expect(input.value).toBe('Transfer : Checking');
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBeTruthy();
    key(input, 'ArrowUp');
    await nextTick();
    expect(input.value).toBe('Kroger');
    expect(await axe(document.body)).toHaveNoViolations();
    key(input, 'Tab');
    expect(onCommit).toHaveBeenCalledWith('Kroger', entries[1], 'tab');
  });

  it('commits new text as typed, and Esc closes the list', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(AutoComplete, {
      props: { modelValue: '', entries, label: 'Payee', onCommit },
    });
    const input = wrapper.find('input').element;
    input.focus();
    await type(input, 'New Payee');
    key(input, 'Escape');
    await nextTick();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('New Payee', null, 'enter');
  });

  it('accepts text that is a prefix of an item once the type-ahead is deleted', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(AutoComplete, {
      props: { modelValue: '', entries, label: 'Payee', onCommit },
    });
    const input = wrapper.find('input').element;
    input.focus();
    input.value = 'Kro';
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );
    await nextTick();
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('Kro', null, 'enter');
  });

  it('normalizes an exact name to its stored capitalization (11 §4.1)', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(AutoComplete, {
      props: { modelValue: '', entries, label: 'Payee', onCommit },
    });
    const input = wrapper.find('input').element;
    input.value = 'amazon';
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );
    await nextTick();
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('Amazon', entries[0], 'enter');
  });

  it('shows the empty-list text when there are no entries', async () => {
    const wrapper = mountApp(AutoComplete, {
      props: {
        modelValue: '',
        entries: [],
        label: 'Payee',
        emptyText: 'Your memorized payee list is empty.',
      },
    });
    await wrapper.find('input').trigger('click');
    expect(document.querySelector('.ac__empty')?.textContent).toBe(
      'Your memorized payee list is empty.',
    );
  });
});

describe('MoneyInput (09 §5.4, 11 §2)', () => {
  it('parses on commit and reverts invalid text', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(MoneyInput, {
      props: { modelValue: 1000, label: 'Outflow', onCommit },
    });
    const input = wrapper.find('input');
    expect(input.element.value).toBe('10.00');
    expect(await axe(document.body)).toHaveNoViolations();
    await input.setValue('1,234.5');
    key(input.element, 'Enter');
    expect(onCommit).toHaveBeenCalledWith(123450);
    await input.setValue('abc');
    key(input.element, 'Enter');
    await nextTick();
    expect(input.element.value).toBe('10.00');
  });

  it('blocks letters, and + opens the calculator with the current value', async () => {
    const wrapper = mountApp(MoneyInput, { props: { modelValue: 1000, label: 'Outflow' } });
    const input = wrapper.find('input').element;
    expect(key(input, 'q').defaultPrevented).toBe(true);
    expect(key(input, '5').defaultPrevented).toBe(false);
    key(input, '+');
    await flushPromises();
    const calc = document.querySelector('[role="dialog"]');
    expect(calc?.getAttribute('aria-label')).toBe('Calculator');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('10.00');
  });

  it('doesn’t commit when a blank-zero field at 0 is left blank', () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(MoneyInput, {
      props: { modelValue: 0, label: 'Inflow', blankZero: true, onCommit },
    });
    const input = wrapper.find('input').element;
    expect(input.value).toBe('');
    input.dispatchEvent(new FocusEvent('blur'));
    key(input, 'Enter');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('types a minus sign at 0 instead of opening the calculator', () => {
    const wrapper = mountApp(MoneyInput, { props: { modelValue: 0, label: 'Outflow' } });
    const input = wrapper.find('input').element;
    expect(key(input, '-').defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Calculator (09 §5.4, 22 §4.4)', () => {
  it('is a named dialog with a status display and computes exactly', async () => {
    const onOk = vi.fn();
    mountApp(CalculatorPanel, { props: { initial: 1000, operator: '+', onOk } });
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    expect(await axe(document.body)).toHaveNoViolations();
    for (const k of ['2', '.', '5', '*', '3']) key(dialog, k);
    await nextTick();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('3');
    key(dialog, 'Enter');
    expect(onOk).toHaveBeenCalledWith(3750);
  });

  it('shows Error for division by zero, and the keys have names', async () => {
    mountApp(CalculatorPanel, { props: { initial: 500 } });
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    for (const k of ['/', '0', '=']) key(dialog, k);
    await nextTick();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Error');
    expect(document.querySelector('[aria-label="Change sign"]')?.textContent.trim()).toBe('+/-');
  });
});

describe('DateField (11 §3, 22 §4.4)', () => {
  const today = '2026-10-18' as ISODate;

  it('shows the budget format and steps with the Quicken keys', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(DateField, {
      props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'MM/dd/yyyy', today, onCommit },
    });
    const input = wrapper.find('input').element;
    expect(input.value).toBe('10/15/2026');
    expect(await axe(document.body)).toHaveNoViolations();
    key(input, '+');
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-16');
    key(input, 'm');
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-01');
    key(input, 'Y');
    expect(onCommit).toHaveBeenLastCalledWith('2026-12-31');
    key(input, 't');
    expect(onCommit).toHaveBeenLastCalledWith(today);
  });

  it('keeps - and . as separators when the format uses them', () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(DateField, {
      props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'yyyy-MM-dd', today, onCommit },
    });
    expect(key(wrapper.find('input').element, '-').defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('parses loose input on Enter', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(DateField, {
      props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'MM/dd/yyyy', today, onCommit },
    });
    await wrapper.find('input').setValue('3.4');
    key(wrapper.find('input').element, 'Enter');
    expect(onCommit).toHaveBeenLastCalledWith('2026-03-04');
  });

  it('reverts invalid input, shows the Invalid date callout and announces it', async () => {
    resetAnnouncer();
    const onCommit = vi.fn();
    const wrapper = mountApp(DateField, {
      props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'MM/dd/yyyy', today, onCommit },
    });
    const input = wrapper.find('input');
    await input.setValue('13/45');
    key(input.element, 'Enter');
    await flushPromises();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.element.value).toBe('10/15/2026');
    const callout = document.querySelector('.callout');
    expect(callout?.textContent).toContain('Invalid date');
    expect(callout?.textContent).toContain("Could not understand: '13/45'");
    expect(callout?.textContent).toContain('MM/DD/YYYY');
    expect(liveRegions.assertive).toContain('Could not understand');

    await input.setValue('1/1/2040');
    key(input.element, 'Enter');
    await flushPromises();
    expect(document.querySelector('.callout')?.textContent).toContain('within 10 years');
  });

  it('refuses past dates in the scheduler', async () => {
    const onCommit = vi.fn();
    const wrapper = mountApp(DateField, {
      props: {
        modelValue: today,
        label: 'Date',
        dateFormat: 'MM/dd/yyyy',
        today,
        scheduler: true,
        onCommit,
      },
    });
    await wrapper.find('input').setValue('10/17/2026');
    key(wrapper.find('input').element, 'Enter');
    await flushPromises();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.querySelector('.callout')?.textContent).toContain(
      "can't be scheduled before today",
    );
  });

  it('opens a calendar grid from its button; arrows move and Enter picks', async () => {
    const onCommit = vi.fn();
    mountApp(DateField, {
      props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'MM/dd/yyyy', today, onCommit },
    });
    document.querySelector<HTMLButtonElement>('[aria-label="Choose date"]')?.click();
    await flushPromises();
    expect(document.querySelector('[role="grid"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Thursday, October 15, 2026');
    expect(await axe(document.body)).toHaveNoViolations();
    key(document.activeElement ?? document.body, 'ArrowDown');
    await flushPromises();
    expect(document.activeElement?.getAttribute('aria-label')).toContain('October 22');
    key(document.activeElement ?? document.body, 'PageDown');
    await flushPromises();
    expect(document.activeElement?.getAttribute('aria-label')).toContain('November 22');
    key(document.activeElement ?? document.body, 'Enter');
    expect(onCommit).toHaveBeenLastCalledWith('2026-11-22');
    await flushPromises();
    expect(document.querySelector('[role="grid"]')).toBeNull();
  });

  it('starts the week on the budget’s first day, and Home goes there (07 §4)', async () => {
    budgetWeekStart.value = 1;
    try {
      mountApp(DateField, {
        props: { modelValue: '2026-10-15', label: 'Date', dateFormat: 'MM/dd/yyyy', today },
      });
      document.querySelector<HTMLButtonElement>('[aria-label="Choose date"]')?.click();
      await flushPromises();
      expect(document.querySelector('[role="grid"] th')?.getAttribute('abbr')).toBe('Monday');
      key(document.activeElement ?? document.body, 'Home');
      await flushPromises();
      expect(document.activeElement?.getAttribute('aria-label')).toContain('Monday, October 12');
    } finally {
      budgetWeekStart.value = null;
    }
  });

  describe('calendar on focus (11 §3)', () => {
    const props = {
      modelValue: '2026-10-15' as ISODate,
      label: 'Date',
      dateFormat: 'MM/dd/yyyy',
      today,
    };
    const grid = (): Element | null => document.querySelector('[role="grid"]');
    const active = (): Element => document.activeElement ?? document.body;

    /** A field in a parent that records the Esc presses reaching it, focused with its calendar open. */
    async function focusedField(onEsc: () => void = vi.fn(), extra: Record<string, unknown> = {}) {
      const wrapper = mountApp(() =>
        h(
          'div',
          {
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'Escape') onEsc();
            },
          },
          h(DateField, { ...props, ...extra }),
        ),
      );
      const input = wrapper.find('input');
      input.element.focus();
      await flushPromises();
      return input;
    }

    /** A field as the only input of a modal dialog, which focuses it on opening. */
    async function fieldInDialog(onCancel: () => void): Promise<void> {
      mountApp(() =>
        h(StandardDialog, { title: 'Dialog', onCancel }, { default: () => h(DateField, props) }),
      );
      await flushPromises();
    }

    /** Whether the calendar stopped a mouse press from moving focus. */
    function pressKeepsFocus(el: Element | null): boolean {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      el?.dispatchEvent(e);
      return e.defaultPrevented;
    }

    it('opens when focus enters the field and closes on Tab', async () => {
      const input = await focusedField();
      expect(grid()).not.toBeNull();
      expect(document.activeElement).toBe(input.element);
      expect(await axe(document.body)).toHaveNoViolations();
      key(input.element, 'Tab');
      await flushPromises();
      expect(grid()).toBeNull();
    });

    it('stays closed when disabled', async () => {
      const wrapper = mountApp(DateField, { props: { ...props, disabled: true } });
      wrapper.find('input').element.focus();
      await flushPromises();
      expect(grid()).toBeNull();
    });

    it('takes two Escs to reach the form: close, then cancel (11 §1 step 4)', async () => {
      const onEsc = vi.fn();
      const input = await focusedField(onEsc);
      key(input.element, 'Escape');
      await flushPromises();
      expect(grid()).toBeNull();
      expect(onEsc).not.toHaveBeenCalled();
      key(input.element, 'Escape');
      expect(onEsc).toHaveBeenCalledOnce();
    });

    it('never takes more than two Escs: the first also reverts typed text', async () => {
      const onEsc = vi.fn();
      const onTyped = vi.fn();
      const input = await focusedField(onEsc, { onTyped });
      await input.setValue('3/4');
      key(input.element, 'Escape');
      await flushPromises();
      expect(grid()).toBeNull();
      expect(input.element.value).toBe('10/15/2026');
      expect(onTyped).toHaveBeenLastCalledWith('2026-10-15');
      expect(onEsc).not.toHaveBeenCalled();
      key(input.element, 'Escape');
      expect(onEsc).toHaveBeenCalledOnce();
    });

    it('in a modal, the first Esc closes only the calendar and the second the dialog', async () => {
      const onCancel = vi.fn();
      await fieldInDialog(onCancel);
      expect(grid()).not.toBeNull();
      key(active(), 'Escape');
      await flushPromises();
      expect(grid()).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
      key(active(), 'Escape');
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('in a modal, Esc also closes it with focus in the calendar', async () => {
      const onCancel = vi.fn();
      await fieldInDialog(onCancel);
      document.querySelector<HTMLElement>('.calendar__nav')?.focus();
      key(active(), 'Escape');
      await flushPromises();
      expect(grid()).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
      expect(active().tagName).toBe('INPUT');
    });

    it('opens again when the user comes back after an Esc', async () => {
      const input = await focusedField();
      key(input.element, 'Escape');
      await flushPromises();
      input.element.blur();
      await flushPromises();
      input.element.focus();
      await flushPromises();
      expect(grid()).not.toBeNull();
    });

    it('stays closed when a pick returns focus to the field', async () => {
      await focusedField();
      const nav = document.querySelector<HTMLElement>('.calendar__nav');
      nav?.focus();
      document.querySelector<HTMLElement>('.calendar__day.is-selected')?.click();
      await flushPromises();
      expect(grid()).toBeNull();
      expect(active().tagName).toBe('INPUT');
    });

    it('stays closed when an invalid date keeps focus in the field', async () => {
      const input = await focusedField();
      await input.setValue('13/45');
      input.element.blur();
      await flushPromises();
      expect(document.querySelector('.callout')).not.toBeNull();
      expect(document.activeElement).toBe(input.element);
      expect(grid()).toBeNull();
    });

    it('stays closed when focus returns from another window', async () => {
      const input = await focusedField();
      // Leaving the window blurs the input but leaves it the active element.
      input.element.dispatchEvent(new FocusEvent('blur'));
      await flushPromises();
      expect(grid()).toBeNull();
      input.element.dispatchEvent(new FocusEvent('focus'));
      await flushPromises();
      expect(grid()).toBeNull();
    });

    it('stays closed when focus returns from a dialog opened over the field', async () => {
      const input = await focusedField();
      const dialog = document.createElement('div');
      dialog.setAttribute('aria-modal', 'true');
      const button = document.createElement('button');
      dialog.append(button);
      document.body.append(dialog);
      input.element.blur();
      input.element.dispatchEvent(new FocusEvent('blur', { relatedTarget: button }));
      await flushPromises();
      expect(grid()).toBeNull();
      input.element.focus();
      await flushPromises();
      expect(grid()).toBeNull();
    });

    it('keeps focus in the field on clicks in the calendar, and keeps it open', async () => {
      const input = await focusedField();
      expect(pressKeepsFocus(document.querySelector('.calendar__month'))).toBe(true);
      expect(pressKeepsFocus(document.querySelector('.calendar__nav'))).toBe(true);
      expect(document.activeElement).toBe(input.element);
      expect(grid()).not.toBeNull();
    });

    it('with focus in the calendar, a control may take a click but blank space may not', async () => {
      mountApp(DateField, { props });
      document.querySelector<HTMLButtonElement>('[aria-label="Choose date"]')?.click();
      await flushPromises();
      expect(pressKeepsFocus(document.querySelector('.calendar__nav'))).toBe(false);
      expect(pressKeepsFocus(document.querySelector('.calendar__month'))).toBe(true);
    });

    it('commits typed text on an outside click when focus is in the calendar', async () => {
      const onCommit = vi.fn();
      const input = await focusedField(vi.fn(), { onCommit });
      await input.setValue('3/4');
      document.querySelector<HTMLElement>('.calendar__nav')?.focus();
      await flushPromises();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await flushPromises();
      expect(grid()).toBeNull();
      expect(onCommit).toHaveBeenLastCalledWith('2026-03-04');
    });

    it('Tab past either end of the calendar closes it and returns to the field', async () => {
      const input = await focusedField();
      document.querySelector<HTMLElement>('.calendar__day[tabindex="0"]')?.focus();
      expect(key(active(), 'Tab').defaultPrevented).toBe(true);
      await flushPromises();
      expect(grid()).toBeNull();
      expect(document.activeElement).toBe(input.element);

      document.querySelector<HTMLButtonElement>('[aria-label="Choose date"]')?.click();
      await flushPromises();
      const first = document.querySelector<HTMLElement>('.calendar__nav');
      first?.focus();
      expect(key(active(), 'Tab').defaultPrevented).toBe(false);
      expect(grid()).not.toBeNull();
      expect(key(active(), 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
      await flushPromises();
      expect(grid()).toBeNull();
      expect(document.activeElement).toBe(input.element);
    });
  });
});

describe('MonthPicker (05 §6, 22 §4.4)', () => {
  it('is a combobox with a listbox of the allowed months', async () => {
    const onUpdate = vi.fn();
    const wrapper = mountApp(MonthPicker, {
      props: {
        modelValue: '2026-03',
        from: '2026-01',
        to: '2026-06',
        label: 'From',
        'onUpdate:modelValue': onUpdate,
      },
    });
    const box = wrapper.find('[role="combobox"]').element as HTMLElement;
    expect(box.textContent).toContain('March 2026');
    box.focus();
    key(box, 'Enter');
    await nextTick();
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(6);
    expect(await axe(document.body)).toHaveNoViolations();
    key(box, 'ArrowDown');
    await nextTick();
    expect(
      document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent.trim(),
    ).toBe('April 2026');
    key(box, 'Enter');
    expect(onUpdate).toHaveBeenCalledWith('2026-04');
    key(box, 'End');
    expect(onUpdate).toHaveBeenLastCalledWith('2026-06');
  });
});
