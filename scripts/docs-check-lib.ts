// Pure checks behind `npm run docs:check` (21 §4.5). The CLI in docs-check.ts reads the files.

export interface DocFile {
  /** Path relative to the repo root, with forward slashes. */
  path: string;
  text: string;
}

export interface Problem {
  path: string;
  line: number;
  message: string;
}

/** CLI flags written as whole code spans in the docs. They look like CSS custom properties but aren't. */
const CLI_FLAGS = new Set([
  '--no-verify',
  '--name',
  '--cache',
  '--report-unused-disable-directives',
]);

/** Chapter number ("05") of a spec chapter file, or null for other docs. */
export function chapterOf(path: string): string | null {
  const m = /(?:^|\/)app-spec\/(\d\d)-[^/]+\.md$/.exec(path);
  return m?.[1] ?? null;
}

/** Section numbers ("3", "3.2", "5.4") of every numbered heading in a chapter. */
export function sectionsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of withoutFences(text)) {
    const m = /^#{2,6}\s+(\d+(?:\.\d+)*)\.?\s/.exec(line.text);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

interface Line {
  n: number;
  text: string;
}

/** Lines outside fenced code blocks. */
function withoutFences(text: string): Line[] {
  const out: Line[] = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((t, i) => {
    if (/^\s*```/.test(t)) {
      fenced = !fenced;
      return;
    }
    if (!fenced) out.push({ n: i + 1, text: t });
  });
  return out;
}

const SECTION = String.raw`§\s*(\d+(?:\.\d+)*)(?:\s*[–-]\s*(\d+(?:\.\d+)*))?`;

/** Expands "3–5" within the same level ("3"→"5": 3, 4, 5; "5.2"→"5.4": 5.2, 5.3, 5.4); other ranges give their ends. */
export function expandRange(from: string, to: string | undefined): string[] {
  if (!to) return [from];
  const a = from.split('.').map(Number);
  const b = to.split('.').map(Number);
  if (a.length === b.length && a.slice(0, -1).join('.') === b.slice(0, -1).join('.')) {
    const prefix = a.slice(0, -1);
    const start = a.at(-1) ?? 0;
    const end = b.at(-1) ?? 0;
    if (end >= start && end - start < 50) {
      return Array.from({ length: end - start + 1 }, (_, i) => [...prefix, start + i].join('.'));
    }
  }
  return [from, to];
}

/**
 * Every chapter cross-reference in a line: `NN` §x.y (with follow-on ", §z" / "and §z" items) and bare §x.y.
 * Bare references resolve against `ownChapter`: a chapter number, or the path of a non-chapter doc.
 */
export function referencesIn(
  line: string,
  ownChapter: string,
): { chapter: string; section: string }[] {
  const refs: { chapter: string; section: string }[] = [];
  const consumed: [number, number][] = [];
  const prefixed = new RegExp(String.raw`\x60(\d\d)\x60((?:\s*(?:,|and|or)?\s*${SECTION})+)`, 'g');
  for (const m of line.matchAll(prefixed)) {
    const chapter = m[1] ?? '';
    consumed.push([m.index, m.index + m[0].length]);
    for (const s of (m[2] ?? '').matchAll(new RegExp(SECTION, 'g'))) {
      for (const section of expandRange(s[1] ?? '', s[2])) refs.push({ chapter, section });
    }
  }
  // Bare references belong to the file's own chapter. Text inside code spans isn't a reference.
  const outsideCode = line.replace(/\x60[^\x60]*\x60/g, (span, offset: number) =>
    consumed.some(([a, b]) => offset >= a && offset < b) ? span : ' '.repeat(span.length),
  );
  for (const m of outsideCode.matchAll(new RegExp(SECTION, 'g'))) {
    if (consumed.some(([a, b]) => m.index >= a && m.index < b)) continue;
    for (const section of expandRange(m[1] ?? '', m[2]))
      refs.push({ chapter: ownChapter, section });
  }
  return refs;
}

/** Custom properties defined in chapter 05 tables (first column) or in tokens.css. */
export function definedTokens(chapter05: string, tokensCss: string | null): Set<string> {
  const out = new Set<string>();
  for (const line of chapter05.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/\x60(--[a-z0-9-]+)\x60/g)) if (m[1]) out.add(m[1]);
  }
  if (tokensCss) for (const m of tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) if (m[1]) out.add(m[1]);
  return out;
}

export function checkDocs(
  files: DocFile[],
  tokensCss: string | null,
  exists: (path: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  const chapters = new Map<string, Set<string>>();
  // Chapters are keyed by number; other docs by path, so their bare §x.y resolve against their own headings.
  for (const f of files) chapters.set(chapterOf(f.path) ?? f.path, sectionsOf(f.text));
  const ch05 = files.find((f) => chapterOf(f.path) === '05');
  const tokens = definedTokens(ch05?.text ?? '', tokensCss);

  for (const f of files) {
    const own = chapterOf(f.path) ?? f.path;
    const dir = f.path.slice(0, f.path.lastIndexOf('/') + 1);
    for (const { n, text } of withoutFences(f.text)) {
      // Cross-references.
      for (const ref of referencesIn(text, own)) {
        const sections = chapters.get(ref.chapter);
        if (!sections)
          problems.push({
            path: f.path,
            line: n,
            message: `chapter \`${ref.chapter}\` doesn't exist`,
          });
        else if (!sections.has(ref.section)) {
          problems.push({
            path: f.path,
            line: n,
            message: `\`${ref.chapter}\` §${ref.section} doesn't exist`,
          });
        }
      }
      // CSS tokens named as a whole code span.
      for (const m of text.matchAll(/\x60(--[a-z][a-z0-9-]*)\x60/g)) {
        const t = m[1] ?? '';
        if (!tokens.has(t) && !CLI_FLAGS.has(t)) {
          problems.push({
            path: f.path,
            line: n,
            message: `CSS token ${t} isn't defined in \`05\` or tokens.css`,
          });
        }
      }
      // Relative links and images.
      for (const m of text
        .replace(/\x60[^\x60]*\x60/g, '')
        .matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = (m[1] ?? '').split('#')[0] ?? '';
        if (!target || /^[a-z]+:/i.test(target)) continue;
        if (!exists(normalize(dir + target))) {
          problems.push({ path: f.path, line: n, message: `link target ${target} doesn't exist` });
        }
      }
    }
  }

  // The README chapter table lists every chapter file.
  const readme = files.find((f) => f.path.endsWith('app-spec/README.md'));
  if (readme) {
    for (const f of files) {
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      if (chapterOf(f.path) && !readme.text.includes(`](${name})`)) {
        problems.push({
          path: readme.path,
          line: 1,
          message: `the chapter table doesn't list ${name}`,
        });
      }
    }
  }
  return problems;
}

/**
 * Spec chapters about internals (architecture, data model, design tokens, dialog components, string
 * authoring, testing) that describe nothing a user does, so no user guide page has to cover them.
 */
export const INTERNAL_CHAPTERS: ReadonlySet<string> = new Set(['02', '04', '05', '17', '20', '21']);

/**
 * The spec chapters a user guide page describes: its front matter line `spec: ['09', '10']`. Null when
 * the page has no such line.
 */
export function specChaptersOf(text: string): { chapters: string[]; line: number } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^spec:\s*\[([^\]]*)\]\s*$/.exec(lines[i] ?? '');
    if (m) {
      const chapters = [...(m[1] ?? '').matchAll(/['"]?([^'",\s]+)['"]?/g)].map((x) => x[1] ?? '');
      return { chapters, line: i + 1 };
    }
  }
  return null;
}

/**
 * User guide checks (`02` §3): every page names the spec chapters it describes, those chapters exist,
 * and every chapter users can see is described by at least one page.
 */
export function checkGuide(guides: DocFile[], chapterFiles: DocFile[]): Problem[] {
  const problems: Problem[] = [];
  const chapterPaths = new Map<string, string>();
  for (const f of chapterFiles) {
    const n = chapterOf(f.path);
    if (n) chapterPaths.set(n, f.path);
  }
  const covered = new Set<string>();
  for (const g of guides) {
    const spec = specChaptersOf(g.text);
    if (!spec || spec.chapters.length === 0) {
      problems.push({
        path: g.path,
        line: 1,
        message: "front matter needs `spec: ['NN', …]`, the spec chapters this page describes",
      });
      continue;
    }
    for (const n of spec.chapters) {
      if (chapterPaths.has(n)) covered.add(n);
      else
        problems.push({
          path: g.path,
          line: spec.line,
          message: `spec chapter ${n} doesn't exist`,
        });
    }
  }
  for (const [n, path] of chapterPaths) {
    if (!INTERNAL_CHAPTERS.has(n) && !covered.has(n)) {
      problems.push({
        path,
        line: 1,
        message: `no user guide page lists chapter ${n} in its front matter \`spec:\``,
      });
    }
  }
  return problems;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}
