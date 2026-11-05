import { INITIAL_CONNECTION } from '@shared/connection';
import { flushPromises } from '@vue/test-utils';
import { CalendarClock } from 'lucide-vue-next';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { liveRegions, resetAnnouncer } from '../../a11y/announcer';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useLoadingOverlay } from '../../stores/loading';
import { axe, mountApp } from '../../testing/mount';
import Callout from './Callout.vue';
import ConnectionBanner from './ConnectionBanner.vue';
import DialogHost from './DialogHost.vue';
import LoadingOverlay from './LoadingOverlay.vue';
import StandardDialog from './StandardDialog.vue';
import { SHOW_DELAY_MS, tooltipState } from './tooltip';
import TooltipHost from './TooltipHost.vue';
import UiButton from './UiButton.vue';
import UiChunkyButton from './UiChunkyButton.vue';
import UiLink from './UiLink.vue';
import UiMenuButton from './UiMenuButton.vue';
import UiSegmented from './UiSegmented.vue';
import UiSmallButton from './UiSmallButton.vue';

const key = (target: Element, k: string, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
};

describe('TaskDialog and DialogHost (17 §1, 22 §4.4)', () => {
  it('renders an accessible dialog, focuses the default button and resolves with it on Enter', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Delete';
    document.body.append(opener);
    opener.focus();
    mountApp(DialogHost);
    const dialogs = useDialogs();
    const result = dialogs.showTaskDialog({
      title: 'Title',
      instruction: 'Delete 3 transactions?',
      content: 'This **can** be undone.',
      icon: 'warning',
      buttons: ['yes', 'no'],
      checkbox: { text: 'Remember' },
    });
    await flushPromises();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Delete 3 transactions?');
    expect(document.activeElement?.textContent.trim()).toBe('Yes');
    expect(await axe(document.body)).toHaveNoViolations();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    key(document.querySelector('.task-dialog__instruction') ?? document.body, 'Enter');
    await expect(result).resolves.toEqual({ button: 'yes', checkboxChecked: true });
    await flushPromises();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Esc only when it may (17 §1)', async () => {
    mountApp(DialogHost);
    const dialogs = useDialogs();
    const okOnly = vi.fn();
    void dialogs.showTaskDialog({ instruction: 'Info', buttons: ['ok'] }).then(okOnly);
    await flushPromises();
    key(document.activeElement ?? document.body, 'Escape');
    await flushPromises();
    expect(okOnly).not.toHaveBeenCalled();
    expect(dialogs.stack).toHaveLength(1);

    const withCancel = dialogs.showTaskDialog({ instruction: 'Sure?', buttons: ['ok', 'cancel'] });
    await flushPromises();
    key(document.activeElement ?? document.body, 'Escape');
    await expect(withCancel).resolves.toEqual({ button: null, checkboxChecked: false });
  });

  it('offers command links and resolves content links as link:{event}', async () => {
    mountApp(DialogHost);
    const dialogs = useDialogs();
    const result = dialogs.showTaskDialog({
      instruction: 'Choose',
      content: 'Or <a data-event="help">read more</a>',
      icon: 'help',
      buttons: ['cancel'],
      commandLinks: [
        { id: 'a', title: 'Keep both', subLabel: 'Nothing changes' },
        { id: 'b', title: 'Merge', isDefault: true },
      ],
    });
    await flushPromises();
    expect(document.activeElement?.textContent).toContain('Merge');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
    document.querySelector<HTMLAnchorElement>('.task-dialog__content a')?.click();
    await expect(result).resolves.toEqual({ button: 'link:help', checkboxChecked: false });
  });

  it('holds a date field: its button waits for a valid date and returns it (10 §6.1)', async () => {
    mountApp(DialogHost);
    const dialogs = useDialogs();
    const result = dialogs.showTaskDialog({
      instruction: 'Change the date of 2 transactions?',
      dateField: {
        label: 'Date',
        placeholder: '10/20/2026',
        dateFormat: 'MM/dd/yyyy',
        today: '2026-10-20',
        requiredBy: 'change',
      },
      buttons: [{ id: 'change', label: 'Change Date', isDefault: true }, 'cancel'],
    });
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>('.task-dialog__date input');
    const change = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent.trim() === 'Change Date',
    );
    if (!input || !change) throw new Error('no date field');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('10/20/2026');
    expect(change.disabled).toBe(true);
    expect(await axe(document.body)).toHaveNoViolations();
    // Enter with no valid date keeps the dialog open.
    key(input, 'Enter');
    await flushPromises();
    expect(dialogs.stack).toHaveLength(1);
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    expect(change.disabled).toBe(true);
    input.value = '11/5/2026';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    expect(change.disabled).toBe(false);
    key(input, 'Enter');
    await expect(result).resolves.toEqual({
      button: 'change',
      checkboxChecked: false,
      date: '2026-11-05',
    });
  });
});

describe('buttons (05 §4, 22 §4.4)', () => {
  it('render as accessible buttons and links', async () => {
    const Demo = defineComponent(() => {
      const value = ref('a');
      return () =>
        h('div', [
          h(UiButton, null, () => 'Cancel'),
          h(UiButton, { primary: true }, () => 'Done'),
          h(UiSmallButton, null, () => 'Rename'),
          h(UiLink, null, () => 'Edit Payees'),
          h(UiLink, { href: 'https://actualbudget.org/docs/' }, () => 'Docs'),
          h(UiMenuButton, null, () => 'Edit Transactions'),
          h(UiChunkyButton, { icon: CalendarClock, count: 2 }, () => 'Scheduled'),
          h(UiSegmented, {
            modelValue: value.value,
            'onUpdate:modelValue': (v: string) => (value.value = v),
            label: 'View',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          }),
        ]);
    });
    mountApp(Demo);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('UiSegmented is a radio group with one Tab stop and arrow keys (22 §4.4)', () => {
    const value = ref('a');
    mountApp(UiSegmented, {
      props: {
        modelValue: value.value,
        'onUpdate:modelValue': (v: string) => (value.value = v),
        label: 'View',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    });
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    radios[0]?.focus();
    key(radios[0] ?? document.body, 'ArrowRight');
    expect(value.value).toBe('b');
    expect(document.activeElement).toBe(radios[1]);
  });

  it('UiMenuButton opens on ↓ and reports aria-expanded (22 §4.4)', () => {
    const onOpen = vi.fn();
    const wrapper = mountApp(UiMenuButton, {
      props: { expanded: true, onOpen },
      slots: { default: 'Edit' },
    });
    expect(wrapper.attributes('aria-haspopup')).toBe('menu');
    expect(wrapper.attributes('aria-expanded')).toBe('true');
    key(wrapper.element as Element, 'ArrowDown');
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('UiLink opens http links in the OS browser (02 §6)', async () => {
    const openExternal = vi.spyOn(window.app.shell, 'openExternal');
    const wrapper = mountApp(UiLink, {
      props: { href: 'https://actualbudget.org/docs/' },
      slots: { default: 'Docs' },
    });
    await wrapper.trigger('click');
    expect(openExternal).toHaveBeenCalledWith('https://actualbudget.org/docs/');
  });
});

describe('StandardDialog (17 §2)', () => {
  it('is a named modal dialog; Esc cancels and Enter submits except in a text area', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    mountApp(StandardDialog, {
      props: { title: 'New Category', onCancel, onSubmit },
      slots: {
        default: '<label>Name <input type="text"></label><label>Note <textarea></textarea></label>',
      },
    });
    await nextTick();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement?.tagName).toBe('INPUT');
    expect(await axe(document.body)).toHaveNoViolations();
    key(document.querySelector('textarea') ?? document.body, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    key(document.querySelector('input') ?? document.body, 'Enter');
    expect(onSubmit).toHaveBeenCalledOnce();
    key(document.querySelector('input') ?? document.body, 'Escape');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('Callout (17 §3)', () => {
  it('is a non-modal dialog that takes focus, and Esc closes it and returns focus to the anchor', async () => {
    const anchor = document.createElement('button');
    anchor.textContent = 'Timeframe';
    document.body.append(anchor);
    const onClose = vi.fn();
    mountApp(Callout, {
      props: { anchor, title: 'Timeframe', buttons: true, onClose },
      slots: { default: '<p>Body</p>' },
    });
    await flushPromises();
    const dialog = document.querySelector('.callout');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(await axe(document.body)).toHaveNoViolations();
    key(document.activeElement ?? document.body, 'Escape');
    expect(onClose).toHaveBeenCalledWith('cancel');
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on an outside click, and Done reports done', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const onClose = vi.fn();
    mountApp(Callout, { props: { anchor, title: 'T', buttons: true, onClose } });
    await flushPromises();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenLastCalledWith('clickOutside');
    const done = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Done'),
    );
    done?.click();
    expect(onClose).toHaveBeenLastCalledWith('done');
  });

  it('can leave focus on its anchor (Invalid date, 11 §3)', async () => {
    const anchor = document.createElement('input');
    anchor.setAttribute('aria-label', 'Date');
    document.body.append(anchor);
    anchor.focus();
    mountApp(Callout, { props: { anchor, title: 'Invalid date', takeFocus: false } });
    await flushPromises();
    expect(document.activeElement).toBe(anchor);
  });
});

describe('tooltip directive (17 §4, 22 §4.7)', () => {
  it('describes its target, shows after 650 ms on focus, and Esc hides it', async () => {
    vi.useFakeTimers();
    try {
      const Demo = defineComponent({
        setup: () => ({ tip: 'Clear the filter' }),
        template: '<button v-tooltip="tip">Clear</button>',
      });
      mountApp(Demo);
      mountApp(TooltipHost);
      const button = document.querySelector('button');
      const describedBy = button?.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent).toBe('Clear the filter');
      button?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(SHOW_DELAY_MS - 1);
      expect(tooltipState.visible).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(tooltipState.visible).toBe(true);
      await nextTick();
      expect(document.querySelector('.tooltip')?.textContent.trim()).toBe('Clear the filter');
      // axe schedules its own timers; the tooltip stays shown meanwhile.
      vi.useRealTimers();
      expect(await axe(document.body)).toHaveNoViolations();
      key(button ?? document.body, 'Escape');
      expect(tooltipState.visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LoadingOverlay (17 §6, 22 §4.5)', () => {
  it('shows its label, marks the app busy and announces Done', async () => {
    resetAnnouncer();
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountApp(LoadingOverlay);
    const loading = useLoadingOverlay();
    loading.label = 'Loading budget…';
    await nextTick();
    expect(document.querySelector('.loading__box')?.textContent).toBe('Loading budget…');
    expect(app.getAttribute('aria-busy')).toBe('true');
    expect(liveRegions.polite).toBe('Loading budget…');
    expect(await axe(document.body)).toHaveNoViolations();
    loading.label = null;
    await nextTick();
    expect(app.getAttribute('aria-busy')).toBe('false');
    expect(liveRegions.polite).toBe('Done.');
  });

  it('does not announce Done for progress updates in place', async () => {
    resetAnnouncer();
    mountApp(LoadingOverlay);
    const loading = useLoadingOverlay();
    loading.label = 'Deleting transactions… 0/9';
    await nextTick();
    loading.label = 'Deleting transactions… 4/9';
    await nextTick();
    expect(liveRegions.polite).toBe('Deleting transactions… 0/9');
    loading.label = null;
    await nextTick();
    expect(liveRegions.polite).toBe('Done.');
  });
});

describe('ConnectionBanner (03 §4, 17 §7)', () => {
  it('is hidden while online and shows the offline text with Retry now', async () => {
    const connection = useConnection();
    const onRetry = vi.fn();
    const wrapper = mountApp(ConnectionBanner, { props: { onRetry } });
    expect(wrapper.find('.banner').exists()).toBe(false);
    connection.info = { ...INITIAL_CONNECTION, state: 'OfflineReadOnly', lastSyncAt: null };
    await nextTick();
    expect(wrapper.text()).toContain("Can't reach your Actual server");
    expect(await axe(document.body)).toHaveNoViolations();
    await wrapper.find('button').trigger('click');
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the signed-out, unsynced and reconnecting variants', async () => {
    const connection = useConnection();
    const wrapper = mountApp(ConnectionBanner);
    connection.info = { ...INITIAL_CONNECTION, state: 'OfflineReadOnly', signedOut: true };
    await nextTick();
    expect(wrapper.text()).toContain("You're signed out");
    expect(wrapper.find('button').text()).toBe('Sign in');
    connection.info = { ...INITIAL_CONNECTION, state: 'OfflineReadOnly', unsyncedChanges: true };
    await nextTick();
    expect(wrapper.text()).toContain("hasn't reached your Actual server");
    connection.info = { ...INITIAL_CONNECTION, state: 'Online' };
    connection.hostStatus = 'restarting';
    await nextTick();
    expect(wrapper.text()).toContain('Reconnecting…');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
