import { describe, expect, it } from 'vitest';
import {
  checkDocs,
  checkGuide,
  expandRange,
  referencesIn,
  sectionsOf,
  specChaptersOf,
  type DocFile,
} from './docs-check-lib';

const ch05 = `# 05 — Visual\n\n## 1. Colors\n\n### 1.2 Text\n\n| Token | Light |\n| --- | --- |\n| \`--text\` | \`#333\` |\n\n## 3. Sizes\n`;
const readme = '# Spec\n\n| [05-visual.md](05-visual.md) |\n| [06-shell.md](06-shell.md) |\n';

const docs = (shell: string): DocFile[] => [
  { path: 'docs/app-spec/05-visual.md', text: ch05 },
  { path: 'docs/app-spec/06-shell.md', text: shell },
  { path: 'docs/app-spec/README.md', text: readme },
];
const exists = (p: string): boolean =>
  ['docs/app-spec/05-visual.md', 'docs/app-spec/06-shell.md'].includes(p);

describe('docs-check', () => {
  it('reads numbered headings', () => {
    expect([...sectionsOf(ch05)]).toEqual(['1', '1.2', '3']);
  });

  it('expands same-level ranges', () => {
    expect(expandRange('1', '3')).toEqual(['1', '2', '3']);
    expect(expandRange('5.2', '5.4')).toEqual(['5.2', '5.3', '5.4']);
    expect(expandRange('3', '5.4')).toEqual(['3', '5.4']);
  });

  it('finds prefixed, follow-on and bare references', () => {
    expect(referencesIn('see `05` §1.2, §3 and §1, then §2', '06')).toEqual([
      { chapter: '05', section: '1.2' },
      { chapter: '05', section: '3' },
      { chapter: '05', section: '1' },
      { chapter: '06', section: '2' },
    ]);
    expect(referencesIn('code `§9` is not a reference', '06')).toEqual([]);
  });

  it('passes a consistent spec', () => {
    expect(
      checkDocs(
        docs('## 2. Shell\n\nSee `05` §1.2 and §3, and own §2. Uses `--text`. [x](05-visual.md)\n'),
        null,
        exists,
      ),
    ).toEqual([]);
  });

  it('reports a broken `05` §x.y reference, an unknown token and a missing link', () => {
    const problems = checkDocs(
      docs('## 2. Shell\n\nSee `05` §9.9. Uses `--nope`. [x](missing.md) and `07` §1.\n'),
      null,
      exists,
    );
    expect(problems.map((p) => p.message)).toEqual([
      "`05` §9.9 doesn't exist",
      "chapter `07` doesn't exist",
      "CSS token --nope isn't defined in `05` or tokens.css",
      "link target missing.md doesn't exist",
    ]);
  });

  it('accepts tokens defined only in tokens.css, and ignores fenced code', () => {
    expect(
      checkDocs(
        docs('## 2. S\n\n`--new`\n\n```text\n`05` §77\n```\n'),
        ':root { --new: 1px; }',
        exists,
      ),
    ).toEqual([]);
  });

  it('reports a chapter missing from the README table', () => {
    const files = [...docs('## 2. S\n'), { path: 'docs/app-spec/07-x.md', text: '# 07\n' }];
    expect(checkDocs(files, null, exists).map((p) => p.message)).toEqual([
      "the chapter table doesn't list 07-x.md",
    ]);
  });

  it("reads a guide page's spec chapters from its front matter", () => {
    expect(specChaptersOf("---\nspec: ['09', '10']\ndescription: x\n---\n# T\n")).toEqual({
      chapters: ['09', '10'],
      line: 2,
    });
    expect(specChaptersOf("# T\n\nspec: ['09']\n")).toBeNull();
  });

  it('checks the guide pages against the spec chapters', () => {
    const chapters: DocFile[] = [
      { path: 'docs/app-spec/05-visual.md', text: '' },
      { path: 'docs/app-spec/06-shell.md', text: '' },
      { path: 'docs/app-spec/09-budget.md', text: '' },
    ];
    const guides: DocFile[] = [
      { path: 'website/docs/a.md', text: "---\nspec: ['06', '99']\n---\n" },
      { path: 'website/docs/b.md', text: '---\ndescription: x\n---\n' },
    ];
    expect(checkGuide(guides, chapters).map((p) => `${p.path}:${p.line}: ${p.message}`)).toEqual([
      "website/docs/a.md:2: spec chapter 99 doesn't exist",
      "website/docs/b.md:1: front matter needs `spec: ['NN', …]`, the spec chapters this page describes",
      // 05 is internal, so only 09 needs a page.
      'docs/app-spec/09-budget.md:1: no user guide page lists chapter 09 in its front matter `spec:`',
    ]);
  });
});
