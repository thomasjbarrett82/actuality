// Category and group names (04 §9; 09 §6.1–6.2) and their display text (10 §2.2, 11 §4.2).
import type { Category, CategoryGroup } from './types';

export type CategoryNameError = 'empty' | 'characters' | 'duplicate';
export type GroupNameError = CategoryNameError | 'income' | 'reserved';

/**
 * Names of the budget's synthetic rows, which no group may take (09 §6.2). The renderer adds the UI
 * language's versions; these English ones are always refused.
 */
export const RESERVED_GROUP_NAMES: readonly string[] = [
  'Hidden Categories',
  'Uncategorized Transactions',
  'Add New Category...',
  'Pre-Existing Debt',
];

const fold = (s: string): string => s.trim().toLocaleLowerCase();
const BAD_CHARACTERS = /[:`]/;

/** A category name in a group (09 §6.1). `siblings`: the other categories' names in that group. */
export function categoryNameError(
  name: string,
  siblings: readonly string[],
): CategoryNameError | null {
  const n = name.trim();
  if (n === '') return 'empty';
  if (BAD_CHARACTERS.test(n)) return 'characters';
  if (siblings.some((s) => fold(s) === fold(n))) return 'duplicate';
  return null;
}

/** A group name (09 §6.2). `others`: the other groups' names; `reserved`: extra reserved names. */
export function groupNameError(
  name: string,
  others: readonly string[],
  reserved: readonly string[] = [],
): GroupNameError | null {
  const n = name.trim();
  if (n === '') return 'empty';
  if (BAD_CHARACTERS.test(n)) return 'characters';
  if (fold(n) === 'income') return 'income';
  if ([...RESERVED_GROUP_NAMES, ...reserved].some((r) => fold(r) === fold(n))) return 'reserved';
  if (others.some((s) => fold(s) === fold(n))) return 'duplicate';
  return null;
}

/** "{Group}: {Category}" (10 §2.2). The income group is named "Income" in the budget (X1). */
export const categoryLabel = (
  group: Pick<CategoryGroup, 'name'>,
  category: Pick<Category, 'name'>,
): string => `${group.name}: ${category.name}`;

/** Every category by id, with its group. */
export function categoryIndex(
  groups: readonly CategoryGroup[],
): Map<string, { category: Category; group: CategoryGroup }> {
  return new Map(
    groups.flatMap((group) =>
      group.categories.map((category) => [category.id, { category, group }] as const),
    ),
  );
}
