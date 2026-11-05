// Category writes (03 §8 `categories.*`; 09 §4, §6.1–6.2, §6.5; 11 §4.2). Each is one gated write job. The
// name rules are 09 §6.1–6.2's. Moves use the internal `category-move` / `category-group-move` (03 §3);
// without `category-move` only a move into another group works, through `updateCategory({ group_id })`.
import { categoryNameError, groupNameError } from '@shared/domain/categories';
import type { Id } from '@shared/domain/types';
import type { DeleteImpact } from '@shared/rpc/host-api';
import { RpcError } from '@shared/rpc/protocol';
import { UNAVAILABLE_HANDLER, type ActualApi, type RawCategoryGroup } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';

const TABLES = ['categories', 'category_groups'];
const DELETE_TABLES = [...TABLES, 'transactions', 'zero_budgets', 'reflect_budgets', 'notes'];

const isUnavailable = (e: unknown): boolean =>
  e instanceof RpcError &&
  (e.details as { code?: unknown } | undefined)?.code === UNAVAILABLE_HANDLER;

const fold = (s: string): string => s.trim().toLocaleLowerCase();

/** `base`, or "base 2", "base 3"… whichever isn't taken (09 §4.1, §4.3). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(fold));
  if (!used.has(fold(base))) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${String(i)}`;
    if (!used.has(fold(name))) return name;
  }
}

export class CategoriesService {
  constructor(
    private readonly actual: ActualApi,
    private readonly connection: Connection,
    private readonly queue: JobQueue,
    private readonly metadata: MetadataRepository,
  ) {}

  private write<T>(label: string, fn: () => Promise<T>, tables = TABLES): Promise<T> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.connection.write(label, tables, fn);
  }

  private static group(groups: readonly RawCategoryGroup[], id: Id): RawCategoryGroup {
    const group = groups.find((g) => g.id === id);
    if (!group) throw new RpcError('not-found', 'That category group no longer exists.');
    return group;
  }

  private static category(groups: readonly RawCategoryGroup[], id: Id) {
    for (const group of groups) {
      const category = group.categories.find((c) => c.id === id);
      if (category) return { group, category };
    }
    throw new RpcError('not-found', 'That category no longer exists.');
  }

  /** `categories.create`: into `groupId`, or into a new group named `groupName`. */
  create(input: {
    groupId?: Id | undefined;
    groupName?: string | undefined;
    name: string;
    unique?: boolean | undefined;
  }): Promise<{ id: Id; groupId: Id; name: string }> {
    return this.write('categories.create', async () => {
      const groups = await this.actual.getCategoryGroups();
      let groupId = input.groupId;
      let siblings: string[] = [];
      if (groupId !== undefined) {
        siblings = CategoriesService.group(groups, groupId).categories.map((c) => c.name);
      } else {
        const groupName = (input.groupName ?? '').trim();
        const error = groupNameError(
          groupName,
          groups.map((g) => g.name),
        );
        if (error)
          throw new RpcError('validation', 'The group name is not allowed.', {
            code: `group-${error}`,
          });
      }
      const name = input.unique ? uniqueName(input.name.trim(), siblings) : input.name.trim();
      const error = categoryNameError(name, siblings);
      if (error)
        throw new RpcError('validation', 'The category name is not allowed.', {
          code: `name-${error}`,
        });
      if (groupId === undefined)
        groupId = await this.actual.createCategoryGroup((input.groupName ?? '').trim());
      const income = groups.find((g) => g.id === groupId)?.isIncome === true;
      const id = await this.actual.createCategory(groupId, name, income);
      // createCategory puts it first; the app puts new categories last (04 §3).
      try {
        await this.actual.moveCategory(id, groupId, null);
      } catch (e) {
        if (!isUnavailable(e)) throw e;
      }
      return { id, groupId, name };
    });
  }

  /** `categories.createGroup` (09 §4.1): a uniquely named group, placed at the top. */
  createGroup(base: string): Promise<{ id: Id; name: string }> {
    return this.write('categories.createGroup', async () => {
      const groups = await this.actual.getCategoryGroups();
      const name = uniqueName(
        base.trim(),
        groups.map((g) => g.name),
      );
      const error = groupNameError(
        name,
        groups.map((g) => g.name),
      );
      if (error)
        throw new RpcError('validation', 'The group name is not allowed.', {
          code: `group-${error}`,
        });
      const id = await this.actual.createCategoryGroup(name);
      // Actual appends it; the app puts a new master category at the top (04 §3).
      const first = groups[0];
      if (first) {
        try {
          await this.actual.moveCategoryGroup(id, first.id);
        } catch (e) {
          if (!isUnavailable(e)) throw e;
        }
      }
      return { id, name };
    });
  }

  /** `categories.update` (09 §6.1): the name is checked only when it changes. */
  update(
    id: Id,
    patch: { name?: string | undefined; hidden?: boolean | undefined },
  ): Promise<null> {
    return this.write('categories.update', async () => {
      const groups = await this.actual.getCategoryGroups();
      const { group, category } = CategoriesService.category(groups, id);
      let name = category.name;
      if (patch.name !== undefined && patch.name.trim() !== category.name) {
        name = patch.name.trim();
        const error = categoryNameError(
          name,
          group.categories.filter((c) => c.id !== id).map((c) => c.name),
        );
        if (error)
          throw new RpcError('validation', 'The category name is not allowed.', {
            code: `name-${error}`,
          });
      }
      await this.actual.updateCategory(id, {
        name,
        ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
      });
      return null;
    });
  }

  /** `categories.updateGroup` (09 §6.2). `reserved`: the UI language's reserved names. */
  updateGroup(
    id: Id,
    patch: {
      name?: string | undefined;
      hidden?: boolean | undefined;
      reserved?: readonly string[] | undefined;
    },
  ): Promise<null> {
    return this.write('categories.updateGroup', async () => {
      const groups = await this.actual.getCategoryGroups();
      const group = CategoriesService.group(groups, id);
      let name = group.name;
      if (patch.name !== undefined && patch.name.trim() !== group.name) {
        name = patch.name.trim();
        const error = groupNameError(
          name,
          groups.filter((g) => g.id !== id).map((g) => g.name),
          patch.reserved ?? [],
        );
        if (error)
          throw new RpcError('validation', 'The group name is not allowed.', {
            code: `group-${error}`,
          });
      }
      await this.actual.updateCategoryGroup(id, {
        name,
        ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
      });
      return null;
    });
  }

  /** `categories.setHidden` (09 §6.5): groups and categories in one job. */
  setHidden(categoryIds: readonly Id[], groupIds: readonly Id[], hidden: boolean): Promise<null> {
    return this.write('categories.setHidden', async () => {
      const groups = await this.actual.getCategoryGroups();
      for (const id of groupIds) {
        const group = CategoriesService.group(groups, id);
        if (group.hidden !== hidden)
          await this.actual.updateCategoryGroup(id, { name: group.name, hidden });
      }
      for (const id of categoryIds) {
        const { category } = CategoriesService.category(groups, id);
        if (category.hidden !== hidden)
          await this.actual.updateCategory(id, { name: category.name, hidden });
      }
      return null;
    });
  }

  /**
   * `categories.delete` (09 §6.1): `deleteCategory` with no transfer category, so its transactions become
   * uncategorized and its budgeted amounts are lost. Its cell notes are removed (04 §5.3).
   */
  delete(id: Id): Promise<null> {
    return this.write(
      'categories.delete',
      async () => {
        CategoriesService.category(await this.actual.getCategoryGroups(), id);
        await this.actual.deleteCategory(id);
        await this.metadata.removeCellNotes([id]);
        return null;
      },
      DELETE_TABLES,
    );
  }

  /** `categories.deleteGroup` (09 §6.2): its categories first, then the group, then their cell notes. */
  deleteGroup(id: Id): Promise<null> {
    return this.write(
      'categories.deleteGroup',
      async () => {
        const group = CategoriesService.group(await this.actual.getCategoryGroups(), id);
        for (const c of group.categories) await this.actual.deleteCategory(c.id);
        await this.actual.deleteCategoryGroup(id);
        await this.metadata.removeCellNotes(group.categories.map((c) => c.id));
        return null;
      },
      DELETE_TABLES,
    );
  }

  /** `categories.deleteImpact` (09 §6.1–6.2): a category's, or every category's of a group. */
  deleteImpact(id: Id): Promise<DeleteImpact> {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
    return this.queue.run(
      'categories.deleteImpact',
      async () => {
        const groups = await this.actual.getCategoryGroups();
        const group = groups.find((g) => g.id === id);
        const ids = new Set(
          group
            ? group.categories.map((c) => c.id)
            : [CategoriesService.category(groups, id).category.id],
        );
        let budgetedMonths = 0;
        for (const month of await this.actual.getBudgetMonths()) {
          const m = await this.actual.getBudgetMonth(month);
          const any = m.categoryGroups
            .flatMap((g) => g.categories ?? [])
            .some((c) => ids.has(c.id) && (c.budgeted ?? 0) !== 0);
          if (any) budgetedMonths++;
        }
        const usage = await this.actual.categoryUsage([...ids]);
        return {
          budgetedMonths,
          transactionCount: usage.count,
          transactionTotal: usage.total,
        };
      },
      { kind: 'read' },
    );
  }

  /**
   * `categories.move` (09 §4.3): into `groupId` before `beforeId` (null = last). A group that already has
   * a category with that name refuses it. Without `category-move`, a move into another group goes through
   * `updateCategory` at a position Actual picks; a reorder within the group fails as unavailable.
   */
  move(id: Id, groupId: Id, beforeId: Id | null): Promise<null> {
    return this.write('categories.move', async () => {
      const groups = await this.actual.getCategoryGroups();
      const { group: from, category } = CategoriesService.category(groups, id);
      const to = CategoriesService.group(groups, groupId);
      if (from.isIncome !== to.isIncome)
        throw new RpcError('validation', 'Income and expense categories stay apart.', {
          code: 'income-mismatch',
        });
      if (to.id !== from.id && to.categories.some((c) => fold(c.name) === fold(category.name)))
        throw new RpcError('validation', 'The group has a category with that name.', {
          code: 'name-duplicate',
        });
      if (beforeId === id) return null;
      if (this.actual.internalHandlerAvailable('category-move')) {
        try {
          await this.actual.moveCategory(id, groupId, beforeId);
          return null;
        } catch (e) {
          if (!isUnavailable(e)) throw e;
        }
      }
      if (to.id === from.id)
        throw new RpcError('actual', 'This version of Actual has no category-move handler.', {
          code: UNAVAILABLE_HANDLER,
        });
      await this.actual.updateCategory(id, { name: category.name, groupId });
      return null;
    });
  }

  /** `categories.moveGroup` (09 §4.3): before `beforeId` (null = last). Needs `category-group-move`. */
  moveGroup(id: Id, beforeId: Id | null): Promise<null> {
    return this.write('categories.moveGroup', async () => {
      CategoriesService.group(await this.actual.getCategoryGroups(), id);
      if (beforeId !== id) await this.actual.moveCategoryGroup(id, beforeId);
      return null;
    });
  }

  /** `categories.moveSupport`: false once a move handler was found missing (03 §3). */
  moveSupport(): Promise<{ category: boolean; group: boolean }> {
    return Promise.resolve({
      category: this.actual.internalHandlerAvailable('category-move'),
      group: this.actual.internalHandlerAvailable('category-group-move'),
    });
  }
}
