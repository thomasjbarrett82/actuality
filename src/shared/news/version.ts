// Release versions for the update check (24 §3.2): plain `MAJOR.MINOR.PATCH`, compared numerically.
// Actuality publishes no pre-releases, so a tag with a suffix is unknown.
import { RELEASE_VERSION } from './feed';

export type Version = readonly [major: number, minor: number, patch: number];

/** The version in `s` (one leading `v` allowed), or null when it isn't a plain version. */
export function parseVersion(s: string): Version | null {
  const plain = s.startsWith('v') ? s.slice(1) : s;
  if (!RELEASE_VERSION.test(plain)) return null;
  const [major = 0, minor = 0, patch = 0] = plain.split('.').map(Number);
  return [major, minor, patch];
}

/** The version in `s` as `X.Y.Z` without its `v`, or null when it isn't a plain version. */
export function normalizeVersion(s: string): string | null {
  const v = parseVersion(s);
  return v ? v.join('.') : null;
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal: the first part that differs
 * decides, numerically (`0.10.0` is newer than `0.9.0`). Null when either isn't a plain version.
 */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (let i = 0; i < 3; i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Whether the running version is older than the latest published one. An unknown latest version is never
 * outdated, and neither is a development build ahead of the latest release.
 */
export function isOutdated(clientVersion: string, latest: string | null): boolean {
  if (latest === null) return false;
  const d = compareVersions(clientVersion, latest);
  return d !== null && d < 0;
}
