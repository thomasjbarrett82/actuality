// Facts about the fixture budgets (21 §2), shared by the builder and the tests that use them. The
// fixture's months end in the month it was built in, so the facts read the builder's record of that month.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The git-ignored folder the builder writes the fixture budgets to. */
export const FIXTURE_DIR = join(import.meta.dirname, 'budgets');

/** The builder's record of what it built: `{ endMonth, source }` (`source` is a hash of its inputs). */
export const FIXTURE_RECORD = join(FIXTURE_DIR, 'fixture.json');

/** This month, in local time: the fixture ends in the month it is built in. */
export function thisMonth(now = new Date()): string {
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The 14 months the Typical fixture covers, ending with `end` (`YYYY-MM`). */
export function fixtureMonths(end: string): string[] {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: 14 }, (_, i) => {
    const index = (y ?? 0) * 12 + (m ?? 1) - 1 - (13 - i);
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

/** The month the fixture budgets were built for: the builder's record, else this month. */
function builtFor(): string {
  if (!existsSync(FIXTURE_RECORD)) return thisMonth();
  const { endMonth } = JSON.parse(readFileSync(FIXTURE_RECORD, 'utf8')) as { endMonth?: string };
  return endMonth ?? thisMonth();
}

/** The 14 months the built Typical fixture covers. */
export const FIXTURE_MONTHS: readonly string[] = fixtureMonths(builtFor());

export const LARGE_TRANSACTIONS = 20_000;

export const FIXTURE_NAMES = {
  typical: 'Fixture: Typical',
  large: 'Fixture: Large',
} as const;

/** The Typical fixture's accounts: 4 on-budget, 2 off-budget, 1 closed. */
export const TYPICAL_ACCOUNTS = ['Checking', 'Savings', 'Visa', 'Cash', 'Mortgage', '401k', 'Old Checking'];

/**
 * The Typical fixture's accounts that need attention, with their badge counts and levels (08 §2.2,
 * 04 §7): what the sidebar shows.
 */
export const TYPICAL_ATTENTION = {
  Checking: { count: 29, maxLevel: 'error' },
  Visa: { count: 17, maxLevel: 'forReview' },
  Cash: { count: 6, maxLevel: 'forReview' },
} as const;
