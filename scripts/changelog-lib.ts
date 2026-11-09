// Reads CHANGELOG.md, which commit-and-tag-version writes (02 §5.1). Used by release-notes.ts and
// release-post.ts.

/**
 * The body of `version`'s section, trimmed (empty when the release has no user-visible changes), or null when
 * the changelog has no such section. commit-and-tag-version starts every release, patches included, with
 * "## [x.y.z](compare link) (date)" or "## x.y.z (date)".
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => /^## \[?(\d+\.\d+\.\d+)\]?[\s(]/.exec(line)?.[1] === version,
  );
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}
