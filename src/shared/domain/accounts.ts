// Account rules shared by the host and the renderer (13 §1–2, 08 §2.3, §4; 04 §3): name validation,
// default names, the sidebar groups, and the `sort_order` a move writes.
import type { Account, Id } from './types';

export type AccountNameError = 'empty' | 'duplicate' | 'backtick';

/**
 * Name rules (13 §1): non-empty, unique ignoring letter case, no backtick. `selfId` is the account being
 * renamed, which may keep its own name.
 */
export function accountNameError(
  name: string,
  accounts: readonly Pick<Account, 'id' | 'name'>[],
  selfId: Id | null = null,
): AccountNameError | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.includes('`')) return 'backtick';
  const lower = trimmed.toLocaleLowerCase();
  if (accounts.some((a) => a.id !== selfId && a.name.trim().toLocaleLowerCase() === lower))
    return 'duplicate';
  return null;
}

/** The prefix itself, or with " 2", " 3"… appended if taken (13 §2). */
export function uniqueName(prefix: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.trim().toLocaleLowerCase()));
  if (!names.has(prefix.toLocaleLowerCase())) return prefix;
  for (let n = 2; ; n++) {
    const candidate = `${prefix} ${String(n)}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** The three sidebar groups (08 §2.3). */
export type AccountGroup = 'onBudget' | 'offBudget' | 'closed';

export const ACCOUNT_GROUPS: readonly AccountGroup[] = ['onBudget', 'offBudget', 'closed'];

export const groupOf = (a: Pick<Account, 'onBudget' | 'closed'>): AccountGroup =>
  a.closed ? 'closed' : a.onBudget ? 'onBudget' : 'offBudget';

/** Sidebar order inside a group: `sort_order`, ties by name (04 §3). */
export function bySortOrder<T extends Pick<Account, 'sortIndex' | 'name'>>(a: T, b: T): number {
  return a.sortIndex - b.sortIndex || a.name.localeCompare(b.name);
}

/** The gap between `sort_order`s of consecutive accounts at the ends of a group (04 §3). */
export const SORT_STEP = 16384;
/** Neighbors closer than this are renumbered (04 §3). */
const MIN_GAP = 0.001;

export type Placement =
  /** Only the moved account changes. */
  | { kind: 'single'; sortOrder: number }
  /** The whole group is renumbered in steps of SORT_STEP, the moved account included. */
  | { kind: 'renumber'; orders: { id: Id; sortOrder: number }[] };

/**
 * Where a moved account goes (04 §3): the midpoint of its new neighbors, last + 16384 at the end, first
 * − 16384 at the start. `group` is the target group in sidebar order **without** the moved account.
 * `beforeId` null (or not in the group) means the end.
 */
export function placeAccount(
  group: readonly { id: Id; sortIndex: number }[],
  movedId: Id,
  beforeId: Id | null,
): Placement {
  const found = beforeId === null ? -1 : group.findIndex((a) => a.id === beforeId);
  const at = found === -1 ? group.length : found;
  const prev = group[at - 1];
  const next = group[at];
  if (!prev && !next) return { kind: 'single', sortOrder: SORT_STEP };
  if (!prev && next) return { kind: 'single', sortOrder: next.sortIndex - SORT_STEP };
  if (prev && !next) return { kind: 'single', sortOrder: prev.sortIndex + SORT_STEP };
  if (prev && next && (next.sortIndex - prev.sortIndex) / 2 >= MIN_GAP)
    return { kind: 'single', sortOrder: (prev.sortIndex + next.sortIndex) / 2 };
  const ids = group.map((a) => a.id);
  ids.splice(at, 0, movedId);
  return { kind: 'renumber', orders: ids.map((id, i) => ({ id, sortOrder: (i + 1) * SORT_STEP })) };
}
