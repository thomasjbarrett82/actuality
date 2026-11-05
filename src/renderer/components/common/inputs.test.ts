import type { ISODate } from '@shared/domain/types';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { liveRegions, resetAnnouncer } from '../../a11y/announcer';
import { budgetWeekStart } from '../../i18n';
import { axe, mountApp } from '../../testing/mount';
import type { AutoCompleteEntry } from './autocomplete-list';
import AutoComplete from './AutoComplete.vue';
import CalculatorPanel from './CalculatorPanel.vue';
import DateField from './DateField.vue';
import MoneyInput from './MoneyInput.vue';
import MonthPicker from './MonthPicker.vue';

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
    expect(document.activeElement?.getAttribute('aria-label')).toContain('October 15');
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
