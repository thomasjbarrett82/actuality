import { describe, expect, it, vi } from 'vitest';
import { defaultButtonId, escClosable, useDialogs } from '../../stores/dialogs';
import { SHOW_AFTER_MS, useLoadingOverlay } from '../../stores/loading';
import {
  bestMatch,
  containsFilter,
  groups,
  highlight,
  itemsOf,
  prefixFilter,
  type AutoCompleteEntry,
} from './autocomplete-list';
import {
  BELOW_LEFT,
  BELOW_RIGHT,
  calloutMiddleware,
  DEFAULT_TAILS,
  placementFor,
  placementsFor,
  tailFor,
  TAILS,
} from './callout-placement';
import { parseRichText } from './rich-text';

describe('rich text (17 §1, 20 §1)', () => {
  it('parses the allowed tags, markdown emphasis and line breaks', () => {
    expect(parseRichText("Could not understand: '**12/40**'<br/>Use *this*")).toEqual([
      { type: 'text', text: "Could not understand: '" },
      { type: 'b', children: [{ type: 'text', text: '12/40' }] },
      { type: 'text', text: "'" },
      { type: 'br' },
      { type: 'text', text: 'Use ' },
      { type: 'i', children: [{ type: 'text', text: 'this' }] },
    ]);
    expect(parseRichText('a\r\nb\nc')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'br' },
      { type: 'text', text: 'b' },
      { type: 'br' },
      { type: 'text', text: 'c' },
    ]);
  });

  it('keeps data-event and http(s) links, and drops other links and tags but keeps their text', () => {
    expect(parseRichText('<a data-event="more">More</a>')).toEqual([
      { type: 'a', event: 'more', children: [{ type: 'text', text: 'More' }] },
    ]);
    expect(parseRichText('<a href="https://actualbudget.org">Docs</a>')).toEqual([
      { type: 'a', href: 'https://actualbudget.org', children: [{ type: 'text', text: 'Docs' }] },
    ]);
    const unsafe = parseRichText(
      '<a href="javascript:alert(1)">x</a><script>y</script><img src=x>z',
    );
    expect(JSON.stringify(unsafe)).not.toContain('javascript');
    expect(unsafe.some((n) => n.type === 'a')).toBe(false);
    expect(JSON.stringify(unsafe)).toContain('"x"');
  });

  it('decodes entities', () => {
    expect(parseRichText('a &amp; b &lt;c&gt;')).toEqual([{ type: 'text', text: 'a & b <c>' }]);
  });
});

describe('auto-complete list (11 §4)', () => {
  const entries: AutoCompleteEntry[] = [
    { kind: 'item', id: 'k', label: 'Kroger' },
    { kind: 'item', id: 'a', label: 'Amazon' },
    { kind: 'heading', id: 'h', label: 'Transfer to/from account:' },
    { kind: 'item', id: 't1', label: 'Transfer : Checking' },
    { kind: 'item', id: 't2', label: 'Transfer : Savings' },
  ];

  it('filters by contains or prefix, keeping a heading when it or a child matches', () => {
    expect(itemsOf(containsFilter(entries, 'ro')).map((i) => i.id)).toEqual(['k']);
    expect(containsFilter(entries, 'sav').map((e) => e.id)).toEqual(['h', 't2']);
    expect(containsFilter(entries, 'Transfer to').map((e) => e.id)).toEqual(['h']);
    expect(prefixFilter(entries, 'am').map((e) => e.id)).toEqual(['a']);
    expect(prefixFilter(entries, 'zon')).toEqual([]);
    expect(containsFilter(entries, '')).toHaveLength(entries.length);
  });

  it('groups entries under their headings', () => {
    const g = groups(entries);
    expect(g).toHaveLength(2);
    expect(g[0]?.heading).toBeNull();
    expect(g[1]?.heading?.id).toBe('h');
    expect(g[1]?.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });

  it('types ahead the first prefix match and bolds the match', () => {
    expect(bestMatch(itemsOf(entries), 'kr')?.label).toBe('Kroger');
    expect(bestMatch(itemsOf(entries), 'roger')).toBeNull();
    expect(bestMatch(itemsOf(entries), '')).toBeNull();
    expect(highlight('Kroger', 'OG')).toEqual({ before: 'Kr', match: 'og', after: 'er' });
    expect(highlight('Kroger', 'x')).toEqual({ before: 'Kroger', match: '', after: '' });
  });
});

describe('callout placement (17 §3)', () => {
  it('maps all 12 tail positions to distinct placements and back', () => {
    expect(TAILS).toHaveLength(12);
    expect(new Set(TAILS.map(placementFor)).size).toBe(12);
    for (const tail of TAILS) expect(tailFor(placementFor(tail))).toBe(tail);
    expect(placementFor('top')).toBe('bottom');
    expect(placementFor('rightBottom')).toBe('left-end');
  });

  it('tries the first tail, then the rest in order', () => {
    expect(placementsFor(['left', 'top'])).toEqual({ placement: 'right', fallbacks: ['bottom'] });
    expect(placementsFor(DEFAULT_TAILS).fallbacks).toHaveLength(11);
    expect(placementsFor([]).placement).toBe('top');
  });

  it('names a tail by the callout edge that carries it: top* opens below the anchor', () => {
    expect(placementFor('topLeft')).toBe('bottom-start');
    expect(placementFor('bottomRight')).toBe('top-end');
    expect(placementFor('left')).toBe('right');
  });

  it('drop-down lists open below first, above only as a fallback (10 §3, 13 §3)', () => {
    for (const [list, first] of [
      [BELOW_LEFT, 'topLeft'],
      [BELOW_RIGHT, 'topRight'],
    ] as const) {
      expect(list[0]).toBe(first);
      expect(list.slice(0, 3).every((tail) => tail.startsWith('top'))).toBe(true);
      expect(list.slice(3).every((tail) => tail.startsWith('bottom'))).toBe(true);
    }
  });

  it('uses offset, flip (bestFit), shift, size and arrow, in that order', () => {
    const fit = vi.fn();
    const middleware = calloutMiddleware(['top'], 13, document.createElement('span'), fit);
    expect(middleware.map((m) => m.name)).toEqual(['offset', 'flip', 'shift', 'size', 'arrow']);
    expect(middleware[1]?.options).toMatchObject({
      fallbackPlacements: ['top'],
      fallbackStrategy: 'bestFit',
    });
    expect(middleware[2]?.options).toEqual({ padding: 6.5 });
    expect(middleware[3]?.options).toMatchObject({ padding: 6.5 });
  });
});

describe('dialog service (17 §1)', () => {
  it('picks the default button', () => {
    expect(defaultButtonId({ instruction: 'x', buttons: ['ok', 'cancel'] })).toBe('ok');
    expect(defaultButtonId({ instruction: 'x', buttons: ['yes', 'no'] })).toBe('yes');
    expect(
      defaultButtonId({
        instruction: 'x',
        buttons: [{ id: 'a', label: 'A', isDefault: true }, 'ok'],
      }),
    ).toBe('a');
    expect(defaultButtonId({ instruction: 'x', buttons: ['cancel'] })).toBe('cancel');
  });

  it('closes on Esc only with a cancel-type button or when cancelable', () => {
    expect(escClosable({ instruction: 'x', buttons: ['ok'] })).toBe(false);
    expect(escClosable({ instruction: 'x', buttons: ['ok', 'close'] })).toBe(true);
    expect(escClosable({ instruction: 'x', buttons: ['ok'], cancelable: true })).toBe(true);
  });

  it('stacks dialogs and resolves each with its result', async () => {
    const dialogs = useDialogs();
    const first = dialogs.showTaskDialog({ instruction: 'one', buttons: ['ok'] });
    const second = dialogs.showTaskDialog({ instruction: 'two', buttons: ['ok'] });
    expect(dialogs.stack.map((d) => d.options.instruction)).toEqual(['one', 'two']);
    const top = dialogs.stack[1];
    if (top) dialogs.close(top.id, { button: 'ok', checkboxChecked: true });
    await expect(second).resolves.toEqual({ button: 'ok', checkboxChecked: true });
    const rest = dialogs.stack[0];
    if (rest) dialogs.close(rest.id, { button: null, checkboxChecked: false });
    await expect(first).resolves.toEqual({ button: null, checkboxChecked: false });
    expect(dialogs.stack).toHaveLength(0);
  });
});

describe('loading overlay (17 §6)', () => {
  it('shows only when the work takes longer than 150 ms', async () => {
    vi.useFakeTimers();
    try {
      const loading = useLoadingOverlay();
      const quick = loading.during('Quick', new Promise((r) => setTimeout(r, SHOW_AFTER_MS - 50)));
      await vi.advanceTimersByTimeAsync(SHOW_AFTER_MS);
      await quick;
      expect(loading.label).toBeNull();

      const slow = loading.during('Slow', new Promise((r) => setTimeout(r, 1000)));
      await vi.advanceTimersByTimeAsync(SHOW_AFTER_MS + 1);
      expect(loading.label).toBe('Slow');
      await vi.advanceTimersByTimeAsync(1000);
      await slow;
      expect(loading.label).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
