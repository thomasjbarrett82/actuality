// MoneyInput's calculator popup never stays open once the user has moved on, and its keys and clicks stay
// its own whatever holds the field (09 §5.4, 11 §2, 17 §3).
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { mountApp } from '../../testing/mount';
import Callout from './Callout.vue';
import MoneyInput from './MoneyInput.vue';
import StandardDialog from './StandardDialog.vue';

const calculator = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Calculator"]');
const press = async (target: Element): Promise<void> => {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await flushPromises();
};

/** A field holding 10.00 with `typed` in it and the calculator open. */
async function open(
  onCommit = vi.fn(),
  typed = '10.00',
): Promise<{ wrapper: VueWrapper; input: HTMLInputElement }> {
  const wrapper = mountApp(MoneyInput, {
    props: { modelValue: 1000, label: 'Outflow', onCommit },
    attachTo: document.body,
  });
  const field = wrapper.find('input');
  await field.setValue(typed);
  field.element.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
  await flushPromises();
  expect(calculator()).not.toBeNull();
  return { wrapper, input: field.element };
}

describe('MoneyInput calculator: closing without OK', () => {
  it('an outside click closes it and discards the calculation', async () => {
    const onCommit = vi.fn();
    const { wrapper } = await open(onCommit);
    calculator()?.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    await press(document.body);
    expect(calculator()).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('an outside click commits what was typed in the field', async () => {
    const onCommit = vi.fn();
    const { wrapper } = await open(onCommit, '25.00');
    await press(document.body);
    expect(calculator()).toBeNull();
    expect(onCommit).toHaveBeenCalledWith(2500);
    wrapper.unmount();
  });

  it('focus moving to another control closes it and commits the field', async () => {
    const onCommit = vi.fn();
    const { wrapper } = await open(onCommit, '25.00');
    const other = document.createElement('button');
    document.body.append(other);
    calculator()?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: other }),
    );
    await flushPromises();
    expect(calculator()).toBeNull();
    expect(onCommit).toHaveBeenCalledWith(2500);
    other.remove();
    wrapper.unmount();
  });

  it('switching to another application closes it', async () => {
    const { wrapper } = await open();
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      calculator()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await flushPromises();
      expect(calculator()).toBeNull();
    } finally {
      hasFocus.mockRestore();
    }
    wrapper.unmount();
  });

  it('a click in the field closes it, keeps focus there and commits nothing yet', async () => {
    const onCommit = vi.fn();
    const { wrapper, input } = await open(onCommit, '25.00');
    await press(input);
    calculator()?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: input }),
    );
    await flushPromises();
    expect(calculator()).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(onCommit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('a press or a focus move inside it keeps it open', async () => {
    const { wrapper } = await open();
    const key = calculator()?.querySelector('button');
    if (!key) throw new Error('no keys');
    await press(key);
    calculator()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: key }));
    await flushPromises();
    expect(calculator()).not.toBeNull();
    wrapper.unmount();
  });

  it('stops listening for presses when the field goes away with it open', async () => {
    const onCommit = vi.fn();
    const { wrapper } = await open(onCommit, '25.00');
    wrapper.unmount();
    await press(document.body);
    expect(onCommit).not.toHaveBeenCalled();
    expect(calculator()).toBeNull();
  });
});

describe('MoneyInput calculator inside what holds the field', () => {
  const field = () => h(MoneyInput, { modelValue: 1000, label: 'Amount' });
  const keydown = (k: string): void => {
    calculator()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
  };
  const openCalculator = async (): Promise<void> => {
    document
      .querySelector('input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    await flushPromises();
    expect(calculator()).not.toBeNull();
  };
  const heldValue = () => document.querySelector('input')?.value;

  describe('a callout (17 §3)', () => {
    async function inCallout(): Promise<ReturnType<typeof vi.fn>> {
      const anchor = document.createElement('button');
      document.body.append(anchor);
      const onClose = vi.fn();
      mountApp(Callout, {
        props: { anchor, title: 'T', onClose },
        slots: { default: field },
      });
      await flushPromises();
      await openCalculator();
      return onClose;
    }

    it('a click on a calculator key leaves the callout open', async () => {
      const onClose = await inCallout();
      const key = calculator()?.querySelector('button');
      if (!key) throw new Error('no keys');
      await press(key);
      expect(onClose).not.toHaveBeenCalled();
      expect(calculator()).not.toBeNull();
    });

    it('Esc closes only the calculator', async () => {
      const onClose = await inCallout();
      keydown('Escape');
      await flushPromises();
      expect(calculator()).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('a click outside both closes the callout and the calculator', async () => {
      const onClose = await inCallout();
      await press(document.body);
      expect(onClose).toHaveBeenCalledWith('clickOutside');
      expect(calculator()).toBeNull();
    });
  });

  describe('a dialog (17 §2)', () => {
    async function inDialog(): Promise<{
      onSubmit: ReturnType<typeof vi.fn>;
      onCancel: ReturnType<typeof vi.fn>;
    }> {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      mountApp(StandardDialog, {
        props: { title: 'T', onSubmit, onCancel },
        slots: { default: field },
      });
      await flushPromises();
      await openCalculator();
      return { onSubmit, onCancel };
    }

    it('Enter gives the field the result and doesn’t submit the dialog', async () => {
      const { onSubmit } = await inDialog();
      keydown('5');
      keydown('Enter');
      await flushPromises();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(calculator()).toBeNull();
      expect(heldValue()).toBe('15.00');
    });

    it('Esc closes only the calculator', async () => {
      const { onCancel } = await inDialog();
      keydown('Escape');
      await flushPromises();
      expect(onCancel).not.toHaveBeenCalled();
      expect(calculator()).toBeNull();
    });
  });
});
