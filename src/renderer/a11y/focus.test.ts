import { describe, expect, it } from 'vitest';
import { trapFocus } from './focus';

const tab = (shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

function dialog(controls = '<button id="first">First</button><button id="last">Last</button>') {
  document.body.innerHTML = `<button id="opener">Open</button><div id="dialog">${controls}</div>`;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  el('opener').focus();
  return el;
}

describe('focus trap (22 §3)', () => {
  it('focuses the first control, and Tab and Shift+Tab wrap inside the dialog', () => {
    const el = dialog();
    trapFocus(el('dialog'));
    expect(document.activeElement).toBe(el('first'));
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('last'));
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('first'));
    // Between the ends, Tab is the browser's own.
    expect(tab().defaultPrevented).toBe(false);
  });

  it('focuses the initial element when given one', () => {
    const el = dialog();
    trapFocus(el('dialog'), el('last'));
    expect(document.activeElement).toBe(el('last'));
  });

  it('focuses the dialog itself when it has no controls, and keeps Tab there', () => {
    const el = dialog('<p>Nothing to press</p>');
    trapFocus(el('dialog'));
    expect(document.activeElement).toBe(el('dialog'));
    expect(el('dialog').tabIndex).toBe(-1);
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('dialog'));
  });

  it('returns focus to the opener on release, or to the fallback when the opener is gone', () => {
    let el = dialog();
    let release = trapFocus(el('dialog'));
    release();
    expect(document.activeElement).toBe(el('opener'));

    el = dialog();
    release = trapFocus(el('dialog'));
    el('opener').remove();
    const fallback = document.createElement('button');
    document.body.append(fallback);
    release(() => fallback);
    expect(document.activeElement).toBe(fallback);
  });

  it('stops trapping after release', () => {
    const el = dialog();
    const release = trapFocus(el('dialog'));
    release();
    el('last').focus();
    expect(tab().defaultPrevented).toBe(false);
  });
});
