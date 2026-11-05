import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decode,
  encode,
  noteSegments,
  noteTags,
  restoredNotes,
  type DecodedNotes,
} from './notes-codec';

describe('notes codec (04 §5.1)', () => {
  it('reads the canonical form', () => {
    expect(decode('Groceries #trip ⟦chk 1234⟧ #needs-review')).toEqual({
      notes: 'Groceries #trip',
      checkNumber: '1234',
      needsReview: true,
    });
    expect(decode(null)).toEqual({ notes: '', checkNumber: null, needsReview: false });
  });

  it('finds the two metadata tokens anywhere, keeps user tags, and joins the notes at the cut points', () => {
    expect(decode('#needs-review lunch with #work friends #Trip2025')).toEqual({
      notes: 'lunch with #work friends #Trip2025',
      checkNumber: null,
      needsReview: true,
    });
    expect(decode('a  b #needs-review c').notes).toBe('a  b c');
  });

  it('keeps the last check token as the check number and the others as notes text', () => {
    expect(decode('paid ⟦chk 5⟧ twice ⟦chk 7⟧')).toEqual({
      notes: 'paid ⟦chk 5⟧ twice',
      checkNumber: '7',
      needsReview: false,
    });
    expect(encode(decode('paid ⟦chk 5⟧ twice ⟦chk 7⟧'))).toBe('paid ⟦chk 5⟧ twice ⟦chk 7⟧');
  });

  it('follows Actual’s tag rules (S-6)', () => {
    expect(decode('#Needs-Review').needsReview).toBe(false);
    expect(decode('#needs-review.').needsReview).toBe(false);
    expect(decode('#needs-review,').notes).toBe('#needs-review,');
    expect(decode('##needs-review').needsReview).toBe(false);
    expect(decode('##needs-review').notes).toBe('##needs-review');
    expect(decode('word#needs-review')).toMatchObject({ notes: 'word', needsReview: true });
    expect(decode('#trip#needs-review')).toMatchObject({ notes: '#trip', needsReview: true });
  });

  it('treats a former flag tag as an ordinary user tag', () => {
    const d = decode('lunch #flag-red');
    expect(d.notes).toBe('lunch #flag-red');
    expect(encode(d)).toBe('lunch #flag-red');
    expect(decode('#flag-red #flag-blue').notes).toBe('#flag-red #flag-blue');
  });

  it('encodes in canonical order, and nothing as empty', () => {
    expect(encode({ notes: ' Rent #home ', checkNumber: '101', needsReview: true })).toBe(
      'Rent #home ⟦chk 101⟧ #needs-review',
    );
    expect(encode({ notes: '', checkNumber: null, needsReview: false })).toBe('');
  });

  it('drops token brackets from a typed check number, so it reads back and the notes stays intact', () => {
    const notes = encode({ notes: 'Rent', checkNumber: '1⟧2⟦', needsReview: false });
    expect(decode(notes)).toEqual({ notes: 'Rent', checkNumber: '12', needsReview: false });
    expect(encode({ notes: 'x', checkNumber: '⟦⟧', needsReview: false })).toBe('x');
  });

  describe('tags in the notes', () => {
    it('lists each case-sensitive tag once, as typed', () => {
      expect(noteTags('a #Vacation2025 b #trip #trip #Trip')).toEqual([
        'Vacation2025',
        'trip',
        'Trip',
      ]);
    });

    it('lets punctuation belong to the tag, and escapes ## and mid-word tags', () => {
      expect(noteTags('#trip, #trip')).toEqual(['trip,', 'trip']);
      expect(noteTags('##literal')).toEqual([]);
      expect(noteTags('word#tag')).toEqual(['tag']);
      expect(noteTags('#a#b')).toEqual(['a', 'b']);
      expect(noteTags('# alone')).toEqual([]);
    });

    it('splits notes into text and tag segments', () => {
      expect(noteSegments('pay #rent now #home')).toEqual([
        { text: 'pay ' },
        { text: '#rent', tag: 'rent' },
        { text: ' now ' },
        { text: '#home', tag: 'home' },
      ]);
      expect(noteSegments('')).toEqual([]);
    });
  });

  const word = fc.stringMatching(/^[^\s⟦⟧]{1,8}$/);
  /** Normalized notes with no app-owned token: the only kind encode receives (04 §5.1). */
  const notes = fc
    .array(word, { maxLength: 5 })
    .map((w) => w.join(' '))
    .filter((n) => decode(n).notes === n);
  const meta: fc.Arbitrary<DecodedNotes> = fc.record({
    notes,
    checkNumber: fc.option(fc.stringMatching(/^[0-9A-Za-z-]{1,6}$/), { nil: null }),
    needsReview: fc.boolean(),
  });

  it('decode(encode(x)) == x for normalized notes, user tags included', () => {
    fc.assert(
      fc.property(meta, (x) => {
        expect(decode(encode(x))).toEqual(x);
      }),
    );
  });

  it('encode(decode(n)) is stable: it only moves and normalizes the app tokens, for any text', () => {
    const anyNotes = fc.oneof(
      fc.string(),
      fc
        .array(
          fc.oneof(
            fc.string({ maxLength: 6 }),
            fc.constantFrom(
              '#flag-red',
              '#needs-review',
              '⟦chk 7⟧',
              '⟦chk ',
              '⟧',
              '##needs-review',
              ' ',
              '#x',
              '#Trip',
              '##',
            ),
          ),
        )
        .map((p) => p.join('')),
    );
    fc.assert(
      fc.property(anyNotes, (n) => {
        const once = decode(n);
        expect(decode(encode(once))).toEqual(once);
      }),
    );
  });

  it('never loses or changes a user tag', () => {
    const tag = fc.stringMatching(/^[A-Za-z0-9._-]{1,8}$/).filter((t) => t !== 'needs-review');
    fc.assert(
      fc.property(fc.array(tag, { minLength: 1, maxLength: 4 }), fc.boolean(), (tags, review) => {
        const text = tags.map((t) => `#${t}`).join(' ');
        const out = decode(encode({ notes: text, checkNumber: '5', needsReview: review }));
        expect(noteTags(out.notes)).toEqual([...new Set(tags)]);
        expect(out.notes).toBe(text);
      }),
    );
  });
});

describe('restoredNotes (23 §5)', () => {
  it('puts back the check number and review tag a rule removed, keeping its text', () => {
    expect(restoredNotes('Weekly ⟦chk 12⟧ #needs-review', 'Groceries')).toBe(
      'Groceries ⟦chk 12⟧ #needs-review',
    );
    expect(restoredNotes('⟦chk 12⟧', 'Paid ⟦chk 12⟧')).toBeNull();
    expect(restoredNotes('Weekly #needs-review', 'Weekly')).toBe('Weekly #needs-review');
  });

  it('changes nothing when nothing was lost', () => {
    expect(restoredNotes(null, 'Groceries')).toBeNull();
    expect(restoredNotes('a', null)).toBeNull();
    // A check number the rule wrote wins over the old one.
    expect(restoredNotes('⟦chk 1⟧', 'x ⟦chk 2⟧')).toBeNull();
  });
});
