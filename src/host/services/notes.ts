// Notes (03 §8 `notes` group). Reads run as read jobs; writes go through the write gate (03 §5). Month
// notes are Actual's `budget-{YYYY-MM}`; cell notes live in the reserved `ad:cellnotes:{YYYY-MM}` (04 §5.3).
import type { Id } from '@shared/domain/types';
import {
  BACKUP_PREFIX,
  isReservedId,
  RESERVED,
  reservedIds,
  type CellNotes,
} from '@shared/metadata/reserved';
import { RpcError } from '@shared/rpc/protocol';
import type { ActualApi } from '../actual';
import type { Connection } from '../connection';
import type { JobQueue } from '../queue';
import type { MetadataRepository } from './metadata';

/** Actual web's note id for a month. */
export const monthNoteId = (month: string): string => `budget-${month}`;

export class NotesService {
  constructor(
    private readonly actual: ActualApi,
    private readonly queue: JobQueue,
    private readonly connection: Connection,
    private readonly metadata: MetadataRepository,
  ) {}

  private requireBudget(): void {
    if (!this.connection.state.budget) throw new RpcError('validation', 'No budget is open.');
  }

  get(id: string): Promise<string | null> {
    this.requireBudget();
    return this.queue.run('notes.get', () => this.actual.getNote(id), { kind: 'read' });
  }

  /**
   * `updateNote` has landed when it resolves, so no settling is needed. "" clears a note (04 §5.3).
   * Reserved notes and their backups are refused: they change only through the metadata repository's
   * validated read-modify-write (04 §5.3).
   */
  async set(id: string, text: string): Promise<null> {
    this.requireBudget();
    if (isReservedId(id) || id.startsWith(BACKUP_PREFIX))
      throw new RpcError('validation', 'Reserved notes are written by their own methods.', {
        code: 'reserved-note',
      });
    await this.connection.write('notes.set', ['notes'], () => this.actual.updateNote(id, text));
    return null;
  }

  /** `notes.monthNote` (09 §6.3): "" reads as no note. */
  monthNote(month: string): Promise<string | null> {
    this.requireBudget();
    return this.queue.run(
      'notes.monthNote',
      async () => (await this.actual.getNote(monthNoteId(month))) || null,
      { kind: 'read' },
    );
  }

  setMonthNote(month: string, text: string): Promise<null> {
    this.requireBudget();
    return this.connection.write('notes.setMonthNote', ['notes'], async () => {
      await this.actual.updateNote(monthNoteId(month), text);
      return null;
    });
  }

  /** `notes.cellNotes` (09 §6.3): a month's category-cell notes. */
  cellNotes(month: string): Promise<Record<Id, string>> {
    this.requireBudget();
    return this.queue.run(
      'notes.cellNotes',
      async () =>
        (await this.metadata.read<CellNotes>(reservedIds.cellNotes(month), RESERVED.cellNotes))
          .notes,
      { kind: 'read' },
    );
  }

  /** A read-modify-write of the month's reserved note (04 §5.3); "" removes the entry. */
  setCellNote(month: string, categoryId: Id, text: string): Promise<null> {
    this.requireBudget();
    return this.connection.write('notes.setCellNote', ['notes'], async () => {
      await this.metadata.modifyInJob<CellNotes>(
        reservedIds.cellNotes(month),
        RESERVED.cellNotes,
        (v) => {
          const rest = Object.fromEntries(
            Object.entries(v.notes).filter(([id]) => id !== categoryId),
          );
          return { ...v, notes: text === '' ? rest : { ...rest, [categoryId]: text } };
        },
      );
      return null;
    });
  }
}
