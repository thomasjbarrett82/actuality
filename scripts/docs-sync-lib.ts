// Pure checks behind `npm run docs:sync` (21 §4.5): a change keeps the spec, the user guide and the UI
// strings in step. The CLI in docs-sync.ts reads git.
import {
  chapterOf,
  INTERNAL_CHAPTERS,
  specChaptersOf,
  type DocFile,
  type Problem,
} from './docs-check-lib';

/** The commit message trailer that says a spec change makes no difference to the user guide. */
export const NO_GUIDE_IMPACT = 'Guide-Impact: none';

/** Fragments of a removed UI string shorter than this are too common to search the docs for. */
const MIN_FRAGMENT = 10;

export interface SyncInput {
  /** Paths changed by the range, relative to the repo root. */
  changed: string[];
  /** The commit messages in the range. */
  messages: string[];
  /** The user guide pages after the change. */
  guides: DocFile[];
  /** The spec chapters and guide pages after the change, searched for stale UI strings. */
  docs: DocFile[];
  /** Every English UI string before and after the change. */
  stringsBefore: string[];
  stringsAfter: string[];
}

/** Every string value in a (nested) message bundle. */
export function messageValues(bundle: unknown): string[] {
  if (typeof bundle === 'string') return [bundle];
  if (bundle && typeof bundle === 'object') return Object.values(bundle).flatMap(messageValues);
  return [];
}

/** The literal text of a message: the parts between `{placeholders}` and plural `|` bars. */
export function fragmentsOf(message: string): string[] {
  return message
    .split(/\{[^}]*\}|\s\|\s/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_FRAGMENT);
}

export function checkSync(input: SyncInput): Problem[] {
  const problems: Problem[] = [];

  // 1. A changed user-facing spec chapter comes with a change to a guide page that describes it.
  const waived = input.messages.some((m) =>
    m.split(/\r?\n/).some((line) => line.trim().toLowerCase() === NO_GUIDE_IMPACT.toLowerCase()),
  );
  const changed = new Set(input.changed);
  if (!waived) {
    for (const path of input.changed) {
      const n = chapterOf(path);
      if (!n || INTERNAL_CHAPTERS.has(n)) continue;
      const pages = input.guides.filter((g) => specChaptersOf(g.text)?.chapters.includes(n));
      if (pages.some((g) => changed.has(g.path))) continue;
      problems.push({
        path,
        line: 1,
        message:
          `chapter ${n} changed, but no user guide page that describes it did (${pages.map((g) => g.path).join(', ') || 'none'}). ` +
          `Update the guide, or add the line "${NO_GUIDE_IMPACT}" to a commit message if users see no difference.`,
      });
    }
  }

  // 2. Text from a UI string that was removed or reworded isn't still quoted in the spec or the guide.
  const after = new Set(input.stringsAfter);
  const current = input.stringsAfter.join('\n');
  const stale = new Set(
    input.stringsBefore
      .filter((s) => !after.has(s))
      .flatMap(fragmentsOf)
      .filter((f) => !current.includes(f)),
  );
  for (const doc of input.docs) {
    doc.text.split(/\r?\n/).forEach((line, i) => {
      for (const f of stale) {
        if (line.includes(f)) {
          problems.push({
            path: doc.path,
            line: i + 1,
            message: `quotes "${f}", which is no longer in the English UI strings`,
          });
        }
      }
    });
  }
  return problems;
}
