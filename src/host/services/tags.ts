// Tag entities (03 §8 `tags`; 04 §5.2): the shared color and description of the tag names used in notes. The
// hashtag text itself lives in transaction notes, so renaming a tag (Actual's `tags-rename` rewrites every note) is a write
// to transactions too, and deleting an entity leaves the notes alone. `needs-review` drives approval state,
// so it can't be renamed or deleted here.
import type { TagEntity } from '@shared/domain/types';
import { noteTags } from '@shared/metadata/notes-codec';
import { REVIEW_TAG } from '@shared/metadata/tags';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi, RawTag } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';

const toEntity = (t: RawTag): TagEntity => ({
  id: t.id,
  tag: t.tag,
  color: t.color,
  description: t.description,
});

export class TagsService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
  ) {}

  private requireBudget(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  private async all(): Promise<TagEntity[]> {
    return (await this.actual.getTags()).map(toEntity);
  }

  /** `tags.list`: every entity, by name. */
  list(): Promise<TagEntity[]> {
    this.requireBudget();
    return this.queue.run('tags.list', async () => sortByName(await this.all()), { kind: 'read' });
  }

  /** `tags.create`: an existing name (case-sensitive) updates that tag's color and description instead. */
  create(input: {
    tag: string;
    color?: string | undefined;
    description?: string | undefined;
  }): Promise<TagEntity> {
    this.requireBudget();
    return this.connection.write('tags.create', ['tags'], async () => {
      const existing = (await this.all()).find((t) => t.tag === input.tag);
      if (existing) {
        const fields = {
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.description === undefined ? {} : { description: input.description }),
        };
        if (Object.keys(fields).length > 0) await this.actual.updateTag(existing.id, fields);
      } else {
        await this.actual.createTag({
          tag: input.tag,
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.description === undefined ? {} : { description: input.description }),
        });
      }
      return this.require(input.tag);
    });
  }

  /** `tags.update`: renaming rewrites the hashtag in the notes of every transaction that has it. */
  update(
    id: string,
    fields: {
      tag?: string | undefined;
      color?: string | null | undefined;
      description?: string | null | undefined;
    },
  ): Promise<TagEntity> {
    this.requireBudget();
    return this.connection.write('tags.update', ['tags', 'transactions'], async () => {
      const tags = await this.all();
      const current = tags.find((t) => t.id === id);
      if (!current) throw new RpcError('not-found', 'That tag no longer exists.');
      const rename = fields.tag !== undefined && fields.tag !== current.tag;
      if (rename) {
        if (current.tag === REVIEW_TAG)
          throw new RpcError('validation', 'The needs-review tag can’t be renamed.', {
            code: 'protected-tag',
          });
        if (tags.some((t) => t.tag === fields.tag)) throw duplicateTag();
        // Actual also refuses the name of a deleted tag, which the list doesn't show.
        await this.actual.renameTag(id, fields.tag ?? current.tag).catch((e: unknown) => {
          throw e instanceof Error && NAME_TAKEN.test(e.message) ? duplicateTag() : e;
        });
      }
      const rest = {
        ...(fields.color === undefined ? {} : { color: fields.color }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
      };
      if (Object.keys(rest).length > 0) await this.actual.updateTag(id, rest);
      return this.require(fields.tag ?? current.tag);
    });
  }

  /** `tags.delete`: the entity only; `#name` stays in the notes and can be discovered again. */
  delete(id: string): Promise<null> {
    this.requireBudget();
    return this.connection.write('tags.delete', ['tags'], async () => {
      const current = (await this.all()).find((t) => t.id === id);
      if (current?.tag === REVIEW_TAG)
        throw new RpcError('validation', 'The needs-review tag can’t be deleted.', {
          code: 'protected-tag',
        });
      if (current) await this.actual.deleteTag(id);
      return null;
    });
  }

  /**
   * `tags.unmanaged`: the tag names used in transaction notes (split lines too) that have no entity, by name.
   * Nothing is written: the Discover dialog lets the user choose which to add (`tags.createMany`).
   * `needs-review` is never listed; the session start restores its entity (03 §6.4).
   */
  unmanaged(): Promise<string[]> {
    this.requireBudget();
    return this.queue.run(
      'tags.unmanaged',
      async () => {
        const known = new Set((await this.all()).map((t) => t.tag));
        known.add(REVIEW_TAG);
        const found = new Set<string>();
        for (const notes of await this.actual.getTaggedNotes())
          for (const tag of noteTags(notes)) if (!known.has(tag)) found.add(tag);
        return [...found].sort(byName);
      },
      { kind: 'read' },
    );
  }

  /**
   * `tags.createMany`: an entity for each name, in one job. A name that already has one is left as it is.
   * Returns the tags that were added, by name.
   */
  createMany(
    tags: readonly { tag: string; color?: string | undefined; description?: string | undefined }[],
  ): Promise<TagEntity[]> {
    this.requireBudget();
    return this.connection.write('tags.createMany', ['tags'], async () => {
      const known = new Set((await this.all()).map((t) => t.tag));
      const added = new Set<string>();
      for (const t of tags) {
        if (known.has(t.tag) || added.has(t.tag)) continue;
        await this.actual.createTag({
          tag: t.tag,
          ...(t.color === undefined ? {} : { color: t.color }),
          ...(t.description === undefined ? {} : { description: t.description }),
        });
        added.add(t.tag);
      }
      return sortByName((await this.all()).filter((t) => added.has(t.tag)));
    });
  }

  private async require(name: string): Promise<TagEntity> {
    const found = (await this.all()).find((t) => t.tag === name);
    if (!found) throw new RpcError('actual', `The tag ${name} was not saved.`);
    return found;
  }
}

/** Actual's `tags-rename` refusal of a name in use, by a live or deleted tag (26.10.0). */
const NAME_TAKEN = /already exists/i;

const duplicateTag = (): RpcError =>
  new RpcError('validation', 'A tag with that name already exists.', { code: 'duplicate-tag' });

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortByName = (tags: TagEntity[]): TagEntity[] =>
  [...tags].sort((a, b) => byName(a.tag, b.tag));
