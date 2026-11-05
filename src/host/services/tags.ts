// Tag entities (03 §8 `tags`; 04 §5.2): the shared color and description of the tag names used in notes. The
// hashtag text itself lives in transaction notes, so renaming a tag (Actual's `tags-rename` rewrites every note) is a write
// to transactions too, and deleting an entity leaves the notes alone. `needs-review` drives approval state,
// so it can't be renamed or deleted here.
import type { TagEntity } from '@shared/domain/types';
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

  /** `tags.discover`: entities for the tags already used in notes. Returns the tags that were added. */
  discover(): Promise<TagEntity[]> {
    this.requireBudget();
    return this.connection.write('tags.discover', ['tags'], async () => {
      const before = new Set((await this.all()).map((t) => t.id));
      await this.actual.discoverTags();
      return sortByName((await this.all()).filter((t) => !before.has(t.id)));
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

const sortByName = (tags: TagEntity[]): TagEntity[] =>
  [...tags].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
