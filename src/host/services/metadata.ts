// The reserved-note repository (04 §5.3) and the tag entities (04 §5.2).
//
// - All reserved notes load in one query (the 'ad:'…'ad;' range), so `ad-bak:` backups never load.
// - A change is a read-modify-write inside one queue job; call `modifyInJob` from inside a write job.
// - A note that isn't valid JSON for its schema reads as empty. Before it's first overwritten, its text is
//   copied to `ad-bak:{id}`, and a warning is logged.
import {
  backupIdFor,
  parseReserved,
  RESERVED,
  reservedIds,
  serializeReserved,
  type BudgetMeta,
  type CellNotes,
  type ImportMappings,
  type PayeesMeta,
  type ReservedKind,
} from '@shared/metadata/reserved';
import { REVIEW_TAG, REVIEW_TAG_COLOR, REVIEW_TAG_DESCRIPTION } from '@shared/metadata/tags';
import type { ActualApi } from '../actual';

export interface MetadataSnapshot {
  payees: PayeesMeta;
  budget: BudgetMeta;
  importMappings: ImportMappings;
}

const CELL_PREFIX = 'ad:cellnotes:';

export interface MetadataHooks {
  /** A reserved note isn't valid: it reads as empty and is backed up before it is rewritten (04 §5.3). */
  onInvalidNote?: (facts: { id: string }) => void;
}

export class MetadataRepository {
  constructor(
    private readonly actual: ActualApi,
    private readonly hooks: MetadataHooks = {},
  ) {}

  private warnInvalid(id: string): void {
    this.hooks.onInvalidNote?.({ id });
  }

  /** The single reserved notes, parsed (04 §5.3); cell notes are read per month. Call inside a job. */
  async loadAll(): Promise<MetadataSnapshot> {
    const snapshot: MetadataSnapshot = {
      payees: RESERVED.payees.empty,
      budget: RESERVED.budget.empty,
      importMappings: RESERVED.importMappings.empty,
    };
    for (const { id, note } of await this.actual.getReservedNotes()) {
      if (id === reservedIds.payees) {
        snapshot.payees = this.parsed(id, RESERVED.payees, note);
      } else if (id === reservedIds.budget) {
        snapshot.budget = this.parsed(id, RESERVED.budget, note);
      } else if (id === reservedIds.importMappings) {
        snapshot.importMappings = this.parsed(id, RESERVED.importMappings, note);
      }
    }
    return snapshot;
  }

  private parsed<T>(id: string, kind: ReservedKind<T>, note: string | null): T {
    const r = parseReserved(kind, note);
    if (r.status === 'invalid') this.warnInvalid(id);
    return r.value;
  }

  /** One reserved note. Call inside a job. */
  async read<T>(id: string, kind: ReservedKind<T>): Promise<T> {
    return this.parsed(id, kind, await this.actual.getNote(id));
  }

  /**
   * Read-modify-write of one reserved note (04 §5.3). Call inside a write job, so nothing else runs
   * between the read and the write. Unknown fields survive. Returns the stored value.
   */
  async modifyInJob<T>(id: string, kind: ReservedKind<T>, mutate: (value: T) => T): Promise<T> {
    const text = await this.actual.getNote(id);
    const current = parseReserved(kind, text);
    if (current.status === 'invalid') {
      this.warnInvalid(id);
      await this.actual.updateNote(backupIdFor(id), current.raw);
    }
    const next = mutate(current.value);
    await this.actual.updateNote(id, serializeReserved(next));
    return next;
  }

  /**
   * Removes deleted categories' entries from every month's cell notes (04 §5.3). Call inside a write job.
   * Only months that hold one are rewritten; an invalid note is left as it is.
   */
  async removeCellNotes(categoryIds: readonly string[]): Promise<void> {
    const ids = new Set(categoryIds);
    for (const { id, note } of await this.actual.getReservedNotes()) {
      if (!id.startsWith(CELL_PREFIX)) continue;
      const r = parseReserved(RESERVED.cellNotes, note);
      if (r.status !== 'ok' || !Object.keys(r.value.notes).some((c) => ids.has(c))) continue;
      await this.modifyInJob<CellNotes>(id, RESERVED.cellNotes, (v) => ({
        ...v,
        notes: Object.fromEntries(Object.entries(v.notes).filter(([c]) => !ids.has(c))),
      }));
    }
  }

  /**
   * A session start task (04 §5.2, 03 §6.4): create the `needs-review` tag entity when it is missing. An
   * existing one is never updated (the user may have changed its color), and user tags are never touched.
   */
  async ensureTags(): Promise<void> {
    if ((await this.actual.getTags()).some((t) => t.tag === REVIEW_TAG)) return;
    await this.actual.createTag({
      tag: REVIEW_TAG,
      color: REVIEW_TAG_COLOR,
      description: REVIEW_TAG_DESCRIPTION,
    });
  }
}
