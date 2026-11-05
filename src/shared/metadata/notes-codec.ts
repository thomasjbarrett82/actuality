// The transaction `notes` codec (04 §5.1). Actual's notes hold the user's text (tags included), then optional
// app metadata in this canonical order: `{notes}[ ⟦chk {n}⟧][ #needs-review]`. The two metadata tokens are found
// anywhere (users edit notes in Actual) and removed from the notes; everything else, user tags too, is kept as typed.
import { REVIEW_TAG } from './tags';

export interface DecodedNotes {
  notes: string;
  checkNumber: string | null;
  needsReview: boolean;
}

/**
 * A check-number token, at the start or after whitespace (as the app writes it). Glued to other text it's
 * part of that text: after `#tag` Actual reads it as part of the tag. Its content can't contain another
 * bracket, so stray text never swallows one.
 */
const CHECK = /(?<=^|\s)⟦chk ([^⟦⟧]*)⟧/g;
/**
 * The review marker: the one tag the app owns. It must end at whitespace, another `#`, or the end of the text,
 * and is case-sensitive like every Actual tag.
 */
const REVIEW = /(?<!#)#needs-review(?=[\s#]|$)/g;
/** Actual's tag rule: `#` plus a run of non-whitespace, non-`#` characters, not preceded by `#`; case-sensitive. */
const ANY_TAG = /(?<!#)#([^#\s]+)/g;

/** The tags in `notes` (04 §5.1), in order of appearance and spelled as typed; repeats are listed once. */
export function noteTags(notes: string): string[] {
  const seen = new Set<string>();
  for (const m of notes.matchAll(ANY_TAG)) seen.add(m[1] ?? '');
  return [...seen];
}

/** A run of notes: plain text, or one tag (`text` is `#name`, `tag` the name). */
export interface NoteSegment {
  text: string;
  tag?: string;
}

/** Splits `notes` into plain text and tags, in order, so the UI can draw each tag as a pill (10 §6.2). */
export function noteSegments(notes: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  let last = 0;
  for (const m of notes.matchAll(ANY_TAG)) {
    if (m.index > last) out.push({ text: notes.slice(last, m.index) });
    out.push({ text: m[0], tag: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < notes.length) out.push({ text: notes.slice(last) });
  return out;
}

interface Hit {
  start: number;
  end: number;
}

/** Removes the hits from `text`; at each join, whitespace on either side becomes a single space. */
function cut(text: string, hits: Hit[]): string {
  let out = '';
  let last = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < last) continue;
    const left = text.slice(last, h.start);
    out += left;
    last = h.end;
    const right = text.slice(last);
    const spaceBefore = /\s$/.test(out) || (out === '' && left === '');
    const spaceAfter = /^\s/.test(right);
    if (spaceBefore || spaceAfter) {
      out = out.replace(/\s+$/, '');
      const skip = /^\s*/.exec(right)?.[0].length ?? 0;
      last += skip;
      if (out !== '' && last < text.length) out += ' ';
    }
  }
  return (out + text.slice(last)).trim();
}

function decodeOnce(text: string): DecodedNotes {
  const hits: Hit[] = [];
  let checkNumber: string | null = null;
  let needsReview = false;
  // The last token is the check number (encode writes it after the notes). Earlier ones stay in the
  // notes as text, so a second token typed in Actual isn't lost.
  const check = [...text.matchAll(CHECK)].at(-1);
  if (check) {
    hits.push({ start: check.index, end: check.index + check[0].length });
    const n = (check[1] ?? '').trim();
    checkNumber = n === '' ? null : n;
  }
  for (const m of text.matchAll(REVIEW)) {
    hits.push({ start: m.index, end: m.index + m[0].length });
    needsReview = true;
  }
  return { notes: cut(text, hits), checkNumber, needsReview };
}

const same = (a: DecodedNotes, b: DecodedNotes): boolean =>
  a.notes === b.notes && a.checkNumber === b.checkNumber && a.needsReview === b.needsReview;

/**
 * Reads notes. Cutting a token can leave text that reads differently once re-encoded (a token glued to a
 * tag, say), so decoding repeats until encode → decode is stable. That makes `encode(decode(n))` change
 * `n` only by moving and normalizing known tokens (04 §5.1). Each pass only removes text, so it stops.
 */
export function decode(notes: string | null | undefined): DecodedNotes {
  let current = decodeOnce(notes ?? '');
  for (let i = 0; i < 8; i++) {
    const next = decodeOnce(encode(current));
    if (same(next, current)) break;
    current = next;
  }
  return current;
}

/**
 * The canonical notes text, or '' when there's nothing to store. A check number loses any `⟦`/`⟧`: the
 * token couldn't be read back with them, and the rest would leak into the notes.
 */
export function encode(meta: DecodedNotes): string {
  const parts = [meta.notes.trim()];
  const check = meta.checkNumber?.replace(/[⟦⟧]/g, '').trim() ?? '';
  if (check !== '') parts.push(`⟦chk ${check}⟧`);
  if (meta.needsReview) parts.push(`#${REVIEW_TAG}`);
  return parts.filter((p) => p !== '').join(' ');
}

/**
 * The notes with the check number and review tag `before` had put back, keeping the rest as a rule left
 * it (23 §5); null when nothing was lost.
 */
export function restoredNotes(before: string | null, after: string | null): string | null {
  const was = decode(before);
  const now = decode(after);
  const checkNumber = now.checkNumber ?? was.checkNumber;
  const needsReview = now.needsReview || was.needsReview;
  if (checkNumber === now.checkNumber && needsReview === now.needsReview) return null;
  return encode({ notes: now.notes, checkNumber, needsReview });
}
