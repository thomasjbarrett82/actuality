import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusables, isTextInput, KeyboardDispatcher } from './dispatcher';

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('keyboard dispatcher (06 §6, 22 §2)', () => {
  let keys: KeyboardDispatcher;

  beforeEach(() => {
    keys = new KeyboardDispatcher();
    keys.install(window);
  });

  afterEach(() => {
    keys.uninstall();
  });

  it('runs a shortcut from the top scope down, and stops at the scope that takes it', () => {
    const calls: string[] = [];
    keys.push((e) => {
      calls.push('lower');
      return e.ctrlKey && e.key === 'k';
    });
    const popUpper = keys.push(() => {
      calls.push('upper');
      return false;
    });
    const taken = press('k', { ctrlKey: true });
    expect(calls).toEqual(['upper', 'lower']);
    expect(taken.defaultPrevented).toBe(true);

    calls.length = 0;
    popUpper();
    expect(press('j').defaultPrevented).toBe(false);
    expect(calls).toEqual(['lower']);
  });

  it('gives keys only to the modal scope and the scopes above it', () => {
    const below = vi.fn(() => true);
    const modal = vi.fn(() => false);
    keys.push(below);
    const popModal = keys.push(modal, { modal: true });
    expect(keys.modalOpen).toBe(true);
    press('Enter');
    expect(modal).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();

    popModal();
    expect(keys.modalOpen).toBe(false);
    press('Enter');
    expect(below).toHaveBeenCalledOnce();
  });

  it('ignores events another handler already took', () => {
    const handler = vi.fn(() => true);
    keys.push(handler);
    const e = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    e.preventDefault();
    keys.handle(e);
    expect(handler).not.toHaveBeenCalled();
  });

  describe('F6 region cycling (22 §2.1)', () => {
    function regions() {
      document.body.innerHTML = `
        <nav id="sidebar"><button id="s1">One</button><button id="s2">Two</button></nav>
        <main id="panel"><input id="p1" /></main>
        <section id="empty"><p>No controls</p></section>`;
      const el = (id: string) => document.getElementById(id) as HTMLElement;
      // Registered out of order: the order number decides.
      keys.registerRegion('panel', 50, el('panel'));
      keys.registerRegion('sidebar', 10, el('sidebar'));
      const unregisterEmpty = keys.registerRegion('empty', 90, el('empty'));
      return { el, unregisterEmpty };
    }

    it('moves through the regions in order and wraps round; Shift+F6 goes back', () => {
      const { el } = regions();
      expect(press('F6').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('s1'));
      press('F6');
      expect(document.activeElement).toBe(el('p1'));
      press('F6');
      // A region without focusable controls takes focus itself.
      expect(document.activeElement).toBe(el('empty'));
      expect(el('empty').tabIndex).toBe(-1);
      press('F6');
      expect(document.activeElement).toBe(el('s1'));
      press('F6', { shiftKey: true });
      expect(document.activeElement).toBe(el('empty'));
    });

    it('returns to the element focused last in a region', () => {
      const { el } = regions();
      el('s2').focus();
      press('F6');
      expect(document.activeElement).toBe(el('p1'));
      press('F6', { shiftKey: true });
      expect(document.activeElement).toBe(el('s2'));
    });

    it('skips hidden and removed regions', () => {
      const { el, unregisterEmpty } = regions();
      el('panel').hidden = true;
      unregisterEmpty();
      el('s1').focus();
      press('F6');
      expect(document.activeElement).toBe(el('s1'));
    });

    it('does nothing while a modal is open', () => {
      const { el } = regions();
      el('s1').focus();
      keys.push(() => false, { modal: true });
      expect(press('F6').defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(el('s1'));
    });

    it('does nothing with Ctrl or without regions', () => {
      regions();
      expect(press('F6', { ctrlKey: true }).defaultPrevented).toBe(false);
      const none = new KeyboardDispatcher();
      expect(none.cycleRegion(1)).toBe(false);
    });
  });

  it('Shift+F10 and the Menu key open the focused item’s context menu (22 §2.2)', () => {
    document.body.innerHTML = '<button id="row">Row</button>';
    const row = document.getElementById('row') as HTMLElement;
    const menu = vi.fn();
    row.addEventListener('contextmenu', menu);
    row.focus();
    expect(press('F10', { shiftKey: true }, row).defaultPrevented).toBe(true);
    press('ContextMenu', {}, row);
    expect(menu).toHaveBeenCalledTimes(2);

    row.blur();
    expect(press('F10', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(menu).toHaveBeenCalledTimes(2);
  });
});

describe('keyboard helpers', () => {
  it('treats text fields as text input, and buttons and checkboxes not', () => {
    document.body.innerHTML = `
      <input id="text" /><input id="check" type="checkbox" /><textarea id="area"></textarea>
      <select id="sel"></select><button id="btn">B</button><div id="edit" contenteditable="true"></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(isTextInput(el('text'))).toBe(true);
    expect(isTextInput(el('area'))).toBe(true);
    expect(isTextInput(el('sel'))).toBe(true);
    expect(isTextInput(el('check'))).toBe(false);
    expect(isTextInput(el('btn'))).toBe(false);
    expect(isTextInput(null)).toBe(false);
    expect(isTextInput(window)).toBe(false);
  });

  it('lists focusable elements, leaving out disabled, inert and aria-hidden ones', () => {
    document.body.innerHTML = `
      <div id="root">
        <button id="a">A</button>
        <button disabled>Off</button>
        <div inert><button>Inert</button></div>
        <a href="#x" aria-hidden="true">Hidden</a>
        <span tabindex="-1">Skipped</span>
        <span id="b" tabindex="0">B</span>
      </div>`;
    const root = document.getElementById('root') as HTMLElement;
    expect(focusables(root).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
